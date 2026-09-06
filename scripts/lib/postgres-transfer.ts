import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertRecoveryHoldClear } from "../../app/services/recovery-hold.server";

export type TransferField = {
  name: string;
  type: string;
  kind: string;
  isId: boolean;
  isList: boolean;
  dbName?: string | null;
};
export type TransferModel = {
  name: string;
  dbName?: string | null;
  fields: readonly TransferField[];
  primaryKey?: { fields: string[] } | null;
};
export type PgConnection = {
  host: string;
  port: number;
  user: string;
  database: string;
  password?: string;
  sslmode?: string;
};

export async function runTransferCommand(
  command: string,
  args: string[],
  options: {
    input?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    fixtureDiagnostics?: boolean;
  } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const timeout = setTimeout(() => {
      failed = true;
      child.kill("SIGTERM");
    }, options.timeout ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        failed = true;
        child.kill("SIGTERM");
      } else chunks.push(chunk);
    });
    // Do not forward SQL errors: they can contain source shopper values or credentials.
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      if (options.fixtureDiagnostics)
        diagnostic = (diagnostic + chunk.toString()).slice(-4000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || failed)
        reject(
          new Error(
            `${command} failed (${failed ? "timeout/output limit" : code}); ${options.fixtureDiagnostics ? diagnostic : "no source row data logged"}`,
          ),
        );
      else resolve(Buffer.concat(chunks).toString("utf8").trim());
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
}

export function pgArgs(pg: PgConnection) {
  return [
    "-X",
    "--no-password",
    "--set=ON_ERROR_STOP=1",
    "-h",
    pg.host,
    "-p",
    String(pg.port),
    "-U",
    pg.user,
    "-d",
    pg.database,
    "-A",
    "-t",
  ];
}

export function pgEnv(pg: PgConnection) {
  return {
    ...process.env,
    PGPASSWORD: pg.password ?? "",
    PGSSLMODE: pg.sslmode ?? "verify-full",
    PGCLIENTENCODING: "UTF8",
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS:
      "-c timezone=UTC -c statement_timeout=120000 -c lock_timeout=10000",
  };
}

export const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const table = (model: TransferModel) => ident(model.dbName || model.name);
const column = (field: TransferField) => ident(field.dbName || field.name);
const scalars = (model: TransferModel) =>
  model.fields.filter((field) => field.kind !== "object");

function order(model: TransferModel, dialect: "sqlite" | "postgres") {
  const keys =
    model.primaryKey?.fields ??
    model.fields.filter((field) => field.isId).map((field) => field.name);
  if (!keys.length)
    throw new Error(`Transfer requires an explicit primary key: ${model.name}`);
  return keys
    .map((key) => {
      const field = model.fields.find((field) => field.name === key)!;
      return (
        column(field) +
        (field.type === "String"
          ? dialect === "sqlite"
            ? " COLLATE BINARY"
            : ' COLLATE "C"'
          : "")
      );
    })
    .join(",");
}

export function normalizeTransferValue(field: TransferField, value: unknown) {
  if (value === null) return null;
  if (field.isList)
    throw new Error("Array transfer requires an explicit adapter");
  switch (field.type) {
    case "String":
      if (typeof value !== "string" || value.includes("\0"))
        throw new Error("Invalid text field");
      return value;
    case "Boolean":
      if (![true, false, 1, 0].includes(value as boolean))
        throw new Error("Invalid boolean");
      return value === true || value === 1;
    case "DateTime": {
      let time =
        typeof value === "string" && /^-?\d+$/.test(value)
          ? Number(value)
          : value;
      // SQLite CURRENT_TIMESTAMP is UTC text without an offset. Interpreting it
      // in the operator's local timezone silently shifts historical events.
      if (
        typeof time === "string" &&
        /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(time)
      )
        time = time.replace(" ", "T") + "Z";
      const date = new Date(time as string | number);
      if (!Number.isFinite(date.getTime()))
        throw new Error("Invalid source timestamp");
      return date.toISOString();
    }
    case "Int":
    case "BigInt": {
      if (typeof value !== "string" || !/^-?\d+$/.test(value))
        throw new Error("Integer must transfer as exact decimal text");
      const integer = BigInt(value);
      const minimum =
        field.type === "Int" ? -2147483648n : -9223372036854775808n;
      const maximum = field.type === "Int" ? 2147483647n : 9223372036854775807n;
      if (integer < minimum || integer > maximum)
        throw new Error(
          `${field.type} overflow; change the storage contract before cutover`,
        );
      return integer.toString();
    }
    case "Float":
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error("Invalid float");
      return value;
    case "Decimal": {
      if (
        typeof value !== "string" ||
        !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
      )
        throw new Error("Decimal must transfer as text");
      const decimal = new Prisma.Decimal(value);
      if (
        !decimal.isFinite() ||
        decimal.decimalPlaces() > 30 ||
        decimal.abs().gte("1e35")
      )
        throw new Error("Decimal exceeds PostgreSQL NUMERIC(65,30) contract");
      return decimal.toFixed();
    }
    default:
      throw new Error(`Unsupported transfer scalar ${field.type}`);
  }
}

async function readRows(
  model: TransferModel,
  offset: number,
  source: { sqlite: string } | { postgres: PgConnection },
) {
  const isSqlite = "sqlite" in source;
  const fields = scalars(model);
  const projections = fields
    .map((field) => {
      const name = column(field);
      let expression = name;
      if (
        field.type === "Int" ||
        field.type === "BigInt" ||
        field.type === "Decimal" ||
        (isSqlite && field.type === "DateTime")
      )
        expression = `CAST(${name} AS TEXT)`;
      else if (!isSqlite && field.type === "DateTime")
        expression = `to_char(${name}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
      return `${expression} AS ${ident(field.name)}`;
    })
    .join(",");
  const sql = `SELECT ${projections} FROM ${table(model)} ORDER BY ${order(model, isSqlite ? "sqlite" : "postgres")} LIMIT 100 OFFSET ${offset}`;
  const text = isSqlite
    ? await runTransferCommand("sqlite3", [
        "-batch",
        "-readonly",
        "-json",
        source.sqlite,
        sql,
      ])
    : await runTransferCommand(
        "psql",
        [
          ...pgArgs(source.postgres),
          "-c",
          `SELECT row_to_json(r) FROM (${sql}) r`,
        ],
        { env: pgEnv(source.postgres) },
      );
  const rows: Record<string, unknown>[] = isSqlite
    ? JSON.parse(text || "[]")
    : text
      ? text.split("\n").map((line) => JSON.parse(line))
      : [];
  return rows.map((row) =>
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        normalizeTransferValue(field, row[field.name]),
      ]),
    ),
  );
}

export async function transferSqliteToPostgres(input: {
  sourcePath: string;
  postgres: PgConnection;
  models: readonly TransferModel[];
  migrationSql: string;
  schemaHash: string;
  environment?: Record<string, string | undefined>;
}) {
  const scratch = await mkdtemp(join(tmpdir(), "pagnetic-transfer-"));
  const started = Date.now();
  const report: Array<{ model: string; count: number; sha256: string }> = [];
  try {
    const snapshot = join(scratch, "source.sqlite");
    await runTransferCommand("sqlite3", [
      "-batch",
      "-readonly",
      input.sourcePath,
      `VACUUM INTO ${literal(snapshot)};`,
    ]);
    const sourceDb = new PrismaClient({ datasourceUrl: `file:${snapshot}` });
    try {
      await assertRecoveryHoldClear(sourceDb, `file:${snapshot}`, input.environment ?? process.env);
    } finally {
      await sourceDb.$disconnect();
    }
    const holdTable = (await runTransferCommand("sqlite3", ["-readonly", snapshot,
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_PagneticRecoveryHold';"])).trim();
    if (holdTable !== "0") {
      const holdColumns = (await runTransferCommand("sqlite3", ["-readonly", snapshot,
        "SELECT group_concat(name, '|') FROM pragma_table_info('_PagneticRecoveryHold');"])).trim().split("|").filter(Boolean);
      if (holdColumns.length === 2 && holdColumns.includes("id") && holdColumns.includes("reason")) throw new Error("RECOVERY_HOLD_SCHEMA_UNSUPPORTED");
      const required = ["id", "state", "reason", "sourceManifestSha256", "sourceArtifact", "sourceArtifactSha256", "restoredDbSha256", "schemaSha256", "replayEvidenceId", "integrityTag", "createdAt", "updatedAt"];
      if (!required.every((name) => holdColumns.includes(name))) throw new Error("RECOVERY_HOLD_SCHEMA_MALFORMED");
      const states = (await runTransferCommand("sqlite3", ["-readonly", snapshot,
        "SELECT state FROM _PagneticRecoveryHold ORDER BY id;"])).trim();
      if (!states) {
        // A known empty metadata table is permitted.
      } else if (states !== "RELEASED") throw new Error("RECOVERY_PRIVACY_REPLAY_REQUIRED");
    }
    if (
      (await runTransferCommand("sqlite3", [
        "-readonly",
        snapshot,
        "PRAGMA integrity_check;",
      ])) !== "ok" ||
      (await runTransferCommand("sqlite3", [
        "-readonly",
        snapshot,
        "PRAGMA foreign_key_check;",
      ]))
    )
      throw new Error("Source integrity/foreign-key check failed");
    const sqlPath = join(scratch, "transfer.sql");
    const output = createWriteStream(sqlPath, { flags: "wx", mode: 0o600 });
    const write = async (value: string) => {
      if (!output.write(value)) await once(output, "drain");
    };
    await write(
      "BEGIN;\nSET LOCAL standard_conforming_strings=on;\nSELECT pg_advisory_xact_lock(736246182);\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public') THEN RAISE EXCEPTION 'TARGET_NOT_EMPTY'; END IF; END $$;\n",
    );
    await write(input.migrationSql + "\n");
    // Defer the imported graph within this transaction; restore every FK's original
    // non-deferrable semantics after validation. No trigger disabling/superuser bypass.
    await write(
      "DO $$ DECLARE c record; BEGIN FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',c.tbl,c.conname); END LOOP; END $$;\n",
    );
    for (const model of [...input.models].sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const hash = createHash("sha256");
      for (const field of scalars(model).filter(
        (field) => field.type === "Decimal",
      )) {
        const name = column(field);
        const changed = await runTransferCommand("sqlite3", [
          "-readonly",
          snapshot,
          `SELECT count(*) FROM ${table(model)} WHERE ${name} IS NOT NULL AND CAST(CAST(${name} AS TEXT) AS NUMERIC) != ${name};`,
        ]);
        if (changed !== "0")
          throw new Error(
            `Legacy decimal text roundtrip is not exact in ${model.name}; explicit reconciliation required`,
          );
      }
      let count = 0;
      for (;;) {
        const rows = await readRows(model, count, { sqlite: snapshot });
        if (!rows.length) break;
        const fields = scalars(model);
        for (const row of rows) hash.update(JSON.stringify(row) + "\n");
        const tuples = rows.map(
          (row) =>
            `(${fields
              .map((field) => {
                const value = row[field.name];
                return value === null
                  ? "NULL"
                  : typeof value === "boolean"
                    ? String(value)
                    : literal(String(value));
              })
              .join(",")})`,
        );
        await write(
          `INSERT INTO ${table(model)} (${fields.map(column).join(",")}) VALUES ${tuples.join(",")};\n`,
        );
        count += rows.length;
      }
      report.push({ model: model.name, count, sha256: hash.digest("hex") });
    }
    await write(
      "SET CONSTRAINTS ALL IMMEDIATE;\nDO $$ DECLARE c record; BEGIN FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I NOT DEFERRABLE',c.tbl,c.conname); END LOOP; END $$;\nCOMMIT;\n",
    );
    output.end();
    await once(output, "close");
    await runTransferCommand(
      "psql",
      [...pgArgs(input.postgres), "-f", sqlPath],
      { env: pgEnv(input.postgres), timeout: 240_000 },
    );
    for (const expected of report) {
      const model = input.models.find(
        (model) => model.name === expected.model,
      )!;
      const hash = createHash("sha256");
      let count = 0;
      for (;;) {
        const rows = await readRows(model, count, { postgres: input.postgres });
        if (!rows.length) break;
        for (const row of rows) hash.update(JSON.stringify(row) + "\n");
        count += rows.length;
      }
      if (count !== expected.count || hash.digest("hex") !== expected.sha256)
        throw new Error(
          `Post-transfer parity failed: ${model.name}; do not cut over`,
        );
    }
    return {
      version: 1,
      schemaHash: input.schemaHash,
      verifiedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      models: report,
      totalRows: report.reduce((total, model) => total + model.count, 0),
      foreignKeys: "validated" as const,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function schemaFingerprint(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function fingerprintPostgres(
  postgres: PgConnection,
  models: readonly TransferModel[],
) {
  const result: Array<{ model: string; count: number; sha256: string }> = [];
  for (const model of [...models].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const hash = createHash("sha256");
    let count = 0;
    for (;;) {
      const rows = await readRows(model, count, { postgres });
      if (!rows.length) break;
      for (const row of rows) hash.update(JSON.stringify(row) + "\n");
      count += rows.length;
    }
    result.push({ model: model.name, count, sha256: hash.digest("hex") });
  }
  return result;
}
