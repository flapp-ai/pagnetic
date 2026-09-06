import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { runTransferCommand } from "./lib/postgres-transfer";

// A separate migration history for a separate provider; never replay SQLite SQL.
const root = resolve("prisma/postgresql");
const source = await readFile("prisma/schema.prisma", "utf8");
const schema = source.replace(
  /provider\s*=\s*"sqlite"/,
  'provider = "postgresql"',
);
if (schema === source)
  throw new Error("Expected canonical SQLite source schema");
await mkdir(root, { recursive: true });
const scratch = await mkdtemp(join(root, ".prepare-"));
try {
  const candidate = join(scratch, "schema.prisma");
  await writeFile(candidate, schema);
  const previous = join(root, "schema.prisma");
  let before: string | null = null;
  try {
    before = await readFile(previous, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (before === schema) {
    console.log(
      "PostgreSQL schema track matches canonical source; no changes.",
    );
  } else if (process.argv.includes("--check")) {
    console.error(
      "PostgreSQL schema track is stale or absent. Generate/review a new provider-specific migration before release.",
    );
    process.exitCode = 1;
  } else {
    const migration = await runTransferCommand(
      process.execPath,
      [
        resolve("node_modules/prisma/build/index.js"),
        "migrate",
        "diff",
        ...(before ? ["--from-schema-datamodel", previous] : ["--from-empty"]),
        "--to-schema-datamodel",
        candidate,
        "--script",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://unused@localhost/unused",
        },
      },
    );
    const hash = createHash("sha256").update(schema).digest("hex");
    const id = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${hash.slice(0, 12)}`;
    const directory = join(root, "migrations", id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "migration.sql"), migration + "\n", {
      flag: "wx",
    });
    await writeFile(
      join(root, "migrations", "migration_lock.toml"),
      'provider = "postgresql"\n',
    );
    await rename(candidate, previous);
    await writeFile(
      join(root, "source-version.json"),
      JSON.stringify(
        {
          canonicalSourceSha256: createHash("sha256")
            .update(source)
            .digest("hex"),
          postgresSchemaSha256: hash,
          migration: id,
          generatedAt: new Date().toISOString(),
          reviewedForProduction: false,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Prepared PostgreSQL migration ${id}; review required, no database changed.`,
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
