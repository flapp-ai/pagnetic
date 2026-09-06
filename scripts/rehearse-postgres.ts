import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { rehearseFinancialConcurrency } from "./lib/financial-concurrency-rehearsal";
import { rehearseLifecycleConcurrency } from "./lib/lifecycle-concurrency-rehearsal";
import { rehearseDeploymentConcurrency } from "./lib/deployment-concurrency-rehearsal";
import { rehearsePrivacyIntakeConcurrency } from "./lib/privacy-concurrency-rehearsal";
import { rehearseReportConcurrency } from "./lib/report-concurrency-rehearsal";

import {
  claimJobs,
  completeJob,
  enqueueJob,
} from "../app/services/job-outbox.server";
import {
  pgArgs,
  fingerprintPostgres,
  pgEnv,
  runTransferCommand,
  transferSqliteToPostgres,
  type PgConnection,
  type TransferModel,
} from "./lib/postgres-transfer";

// Own a fresh local cluster on a private Unix socket. No production URL is accepted.
const scratch = await mkdtemp("/tmp/pagnetic-pg-rehearsal-");
await mkdir(resolve("tmp"), { recursive: true });
const generatedDirectory = await mkdtemp(resolve("tmp/pagnetic-pg-client-"));
const data = join(scratch, "cluster");
const socket = join(scratch, "socket");
const connection: PgConnection = {
  host: socket,
  port: 5432,
  user: "pagnetic_rehearsal",
  database: "postgres",
  sslmode: "disable",
};
const prismaCli = resolve("node_modules/prisma/build/index.js");
let started = false;
let db: PrismaClient | undefined;
let second: PrismaClient | undefined;
try {
  const sourceSchema = await readFile("prisma/schema.prisma", "utf8");
  const schemaHash = createHash("sha256").update(sourceSchema).digest("hex");
  const clientPath = join(generatedDirectory, "client");
  const pgSchema = sourceSchema
    .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
    .replace(
      /generator client \{/,
      `generator client {\n  output = ${JSON.stringify(clientPath)}`,
    );
  const schemaPath = join(generatedDirectory, "schema.prisma");
  await writeFile(schemaPath, pgSchema, { mode: 0o600 });
  const env = {
    ...process.env,
    PRISMA_GENERATE_SKIP_AUTOINSTALL: "true",
    DATABASE_URL: `postgresql://pagnetic_rehearsal@localhost/postgres?host=${encodeURIComponent(socket)}`,
  };
  await runTransferCommand(
    process.execPath,
    [prismaCli, "generate", "--schema", schemaPath],
    { env, fixtureDiagnostics: true },
  );
  const generated = await import(
    pathToFileURL(join(clientPath, "index.js")).href
  );
  const models = generated.Prisma.dmmf.datamodel.models as TransferModel[];
  const trackSchemaPath = resolve("prisma/postgresql/schema.prisma");
  const trackedSchema = await readFile(trackSchemaPath, "utf8");
  if (
    trackedSchema !==
    sourceSchema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  )
    throw new Error(
      "PostgreSQL migration track is stale; prepare/review it first",
    );
  const postgresMigrations = (await readdir("prisma/postgresql/migrations"))
    .filter((name) => /^\d/.test(name))
    .sort();
  const postgresSql: string[] = [];
  const postgresMigrationEvidence: Array<{ name: string; sha256: string }> = [];
  for (const name of postgresMigrations) {
    const sql = await readFile(
      join("prisma/postgresql/migrations", name, "migration.sql"),
      "utf8",
    );
    postgresSql.push(sql);
    postgresMigrationEvidence.push({
      name,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  const migrationSql = postgresSql.join("\n");
  const source = join(scratch, "source.sqlite");
  const migrationInputs: Array<{ name: string; sha256: string }> = [];
  for (const name of (await readdir("prisma/migrations"))
    .filter((name) => /^\d/.test(name))
    .sort()) {
    const sql = await readFile(
      join("prisma/migrations", name, "migration.sql"),
      "utf8",
    );
    migrationInputs.push({
      name,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
    await runTransferCommand("sqlite3", [source], { input: sql });
  }
  const now = Date.parse("2026-09-05T00:00:00.123Z");
  // Synthetic fixture only. Include exact large Shopify identity, Unicode, booleans,
  // source/approval links, immutable registration/report hashes, and signed job material.
  await runTransferCommand("sqlite3", [source], {
    input: `
    PRAGMA foreign_keys=ON;
    INSERT INTO Merchant(id,shop,displayName,updatedAt) VALUES('merchant-a','fixture-a.myshopify.com','Ölçüm mağazası',${now}),('merchant-b','fixture-b.myshopify.com','Other tenant',${now});
    INSERT INTO Session(id,shop,state,isOnline,accessToken,userId,expires) VALUES('fixture-session','fixture-a.myshopify.com','fixture-only',0,'not-a-real-token',9007199254740993,${now});
    INSERT INTO Product(id,merchantId,shopifyProductId,title,handle,status,sourceVersion,sourceHash,sourceSnapshot,updatedAt) VALUES('product-a','merchant-a','gid://shopify/Product/123','Trail shoe','trail-shoe','ACTIVE','source-v1','fixture-source-hash','{}',${now});
    INSERT INTO ExperienceVersion(id,merchantId,productId,version,status,headline,benefitsJson,proofItemsJson,contentHash,sourceSnapshotHash,promptVersion,rawOutputJson) VALUES('experience-a','merchant-a','product-a',1,'APPROVED_ACTIVE','A sourced message','["Original approved text"]','[]','immutable-content-hash','immutable-source-hash','fixture-v1','{}');
    INSERT INTO Approval(id,merchantId,experienceVersionId,approver,contentHash,evidenceSnapshotHash,policyVersion) VALUES('approval-a','merchant-a','experience-a','fixture-owner','immutable-content-hash','immutable-source-hash','fixture-policy');
    INSERT INTO Experiment(id,merchantId,productId,key,salt) VALUES('experiment-a','merchant-a','product-a','legacy-test','fixture-salt');
    INSERT INTO ExperimentRegistration(id,experimentId,protocolVersion,hypothesis,primaryMetric,revenueDefinition,minimumMeaningfulLift,alpha,power,targetSampleSize,minimumDurationDays,maximumDurationDays,randomizationUnit,eligibilityJson,exclusionsJson,covariatesJson,stoppingRule,analysisVersion,contentVersionsJson,mappingVersionsJson,guardrailsJson,registrationHash) VALUES('registration-a','experiment-a','legacy-preserved','fixture hypothesis','revenue_per_session','legacy-gross',0.05,0.05,0.8,1000,14,42,'SESSION','{}','[]','[]','legacy-stop','legacy-analysis','["experience-a"]','[]','{}','immutable-registration-hash');
    INSERT INTO ExperimentResultSnapshot(id,experimentId,analysisVersion,resultState,dataMaturityAt,dataHash,payloadJson,reportMarkdown) VALUES('report-a','experiment-a','legacy-analysis','INCONCLUSIVE',${now},'immutable-report-hash','{"amountMinor":"9007199254740991"}','Historical report — unchanged');
    INSERT INTO Assignment(id,merchantId,experimentId,randomizationUnitId,randomizationUnitType,arm,bucket,saltVersion,consentState,assignedAt,expiresAt) VALUES('legacy-assignment','merchant-a','experiment-a','legacy-session-hash','SESSION','ORIGINAL',123,1,'analytics_allowed',${now},${now + 604800000});
    INSERT INTO StoreOrder(id,merchantId,shopifyOrderId,currencyCode,grossAmount,netAmount,financialStatus,occurredAt,updatedAt) VALUES('legacy-order','merchant-a','gid://shopify/Order/111','USD',123456.78,123450.12,'PAID',${now},${now});
    INSERT INTO StoreRefund(id,merchantId,orderId,shopifyRefundId,amount,currencyCode,occurredAt) VALUES('legacy-refund','merchant-a','legacy-order','gid://shopify/Refund/111',6.66,'USD',${now});
    INSERT INTO OrderLedger(id,merchantId,shopifyOrderId,shopifyCreatedAt,sourceUpdatedAt,shopCurrency,originalObligationMinor,paymentState,sourceHash,completenessJson,updatedAt) VALUES('ledger-order','merchant-a','gid://shopify/Order/222',${now},${now},'USD','3000000000','PAID','immutable-financial-source','{}',${now});
    INSERT INTO OrderLedgerLine(id,orderId,shopifyLineItemId,shopifyProductId,merchandiseAfterDiscountMinor,currencyCode) VALUES('ledger-line','ledger-order','gid://shopify/LineItem/222','gid://shopify/Product/123','3000000000','USD');
    INSERT INTO RefundLedger(id,merchantId,orderId,shopifyOrderId,shopifyRefundId,shopifyTransactionId,shopifyLineItemId,sourceKey,amountMinor,currencyCode,sourceOccurredAt) VALUES('ledger-refund','merchant-a','ledger-order','gid://shopify/Order/222','gid://shopify/Refund/222','gid://shopify/OrderTransaction/222','gid://shopify/LineItem/222','immutable-refund-key','123456789','USD',${now});
  `,
  });
  await mkdir(socket, { mode: 0o700 });
  await runTransferCommand("initdb", [
    "-D",
    data,
    "--username=pagnetic_rehearsal",
    "--auth-local=trust",
    "--auth-host=reject",
    "--no-locale",
    "--encoding=UTF8",
    "--data-checksums",
  ]);
  await runTransferCommand("pg_ctl", [
    "-D",
    data,
    "-l",
    join(scratch, "postgres.log"),
    "-o",
    `-k ${socket} -h '' -p 5432`,
    "-w",
    "start",
  ]);
  started = true;
  const parity = await transferSqliteToPostgres({
    sourcePath: source,
    postgres: connection,
    models,
    migrationSql,
    schemaHash,
  });
  // Adopt only the exact provider-specific history that created the verified schema.
  for (const name of postgresMigrations)
    await runTransferCommand(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "resolve",
        "--schema",
        trackSchemaPath,
        "--applied",
        name,
      ],
      { env, fixtureDiagnostics: true },
    );
  await runTransferCommand(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", trackSchemaPath],
    { env, fixtureDiagnostics: true },
  );
  await runTransferCommand(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-schema-datasource",
      trackSchemaPath,
      "--to-schema-datamodel",
      trackSchemaPath,
      "--exit-code",
    ],
    { env, fixtureDiagnostics: true },
  );
  db = new generated.PrismaClient({
    datasourceUrl: env.DATABASE_URL,
  }) as PrismaClient;
  second = new generated.PrismaClient({
    datasourceUrl: env.DATABASE_URL,
  }) as PrismaClient;
  assert.equal(
    (await db.session.findUniqueOrThrow({ where: { id: "fixture-session" } }))
      .userId,
    9007199254740993n,
  );
  assert.equal(
    (await db.orderLedger.findUniqueOrThrow({ where: { id: "ledger-order" } }))
      .originalObligationMinor,
    "3000000000",
  );
  assert.equal(
    (
      await db.orderLedgerLine.findUniqueOrThrow({
        where: { id: "ledger-line" },
      })
    ).merchandiseAfterDiscountMinor,
    "3000000000",
  );
  assert.equal(
    (
      await db.refundLedger.findUniqueOrThrow({
        where: { id: "ledger-refund" },
      })
    ).amountMinor,
    "123456789",
  );
  assert.equal(
    (
      await db.storeOrder.findUniqueOrThrow({ where: { id: "legacy-order" } })
    ).grossAmount.toFixed(),
    "123456.78",
  );
  assert.equal(
    (
      await db.storeRefund.findUniqueOrThrow({ where: { id: "legacy-refund" } })
    ).amount.toFixed(),
    "6.66",
  );
  assert.equal(
    (
      await db.experimentRegistration.findUniqueOrThrow({
        where: { id: "registration-a" },
      })
    ).primaryMetric,
    "revenue_per_session",
  );
  assert.equal(
    (
      await db.experimentResultSnapshot.findUniqueOrThrow({
        where: { id: "report-a" },
      })
    ).dataHash,
    "immutable-report-hash",
  );
  for (let n = 0; n < 12; n++)
    await enqueueJob({
      db,
      merchantId: n % 2 ? "merchant-a" : "merchant-b",
      type: "RECONCILE_ORDER",
      idempotencyKey: `fixture-${n}`,
      payload: { order: `fixture-${n}` },
    });
  const [one, two] = await Promise.all([
    claimJobs({ db, workerId: "pg-worker-one", limit: 12 }),
    claimJobs({ db: second, workerId: "pg-worker-two", limit: 12 }),
  ]);
  const claimed = [...one, ...two];
  assert.equal(claimed.length, 12);
  assert.equal(new Set(claimed.map((job) => job.id)).size, 12);
  const job = claimed[0];
  await assert.rejects(
    completeJob({
      db,
      merchantId: job.merchantId === "merchant-a" ? "merchant-b" : "merchant-a",
      jobId: job.id,
      leaseToken: job.leaseToken!,
    }),
    /STALE_JOB_LEASE/,
  );
  await completeJob({
    db,
    merchantId: job.merchantId,
    jobId: job.id,
    leaseToken: job.leaseToken!,
  });
  await assert.rejects(
    completeJob({
      db,
      merchantId: job.merchantId,
      jobId: job.id,
      leaseToken: job.leaseToken!,
    }),
    /STALE_JOB_LEASE/,
  );
  // A second transfer must refuse a populated target and preserve its original rows.
  await assert.rejects(
    transferSqliteToPostgres({
      sourcePath: source,
      postgres: connection,
      models,
      migrationSql,
      schemaHash,
    }),
  );
  assert.equal(await db.job.count(), 12);
  const financialConcurrency = await rehearseFinancialConcurrency(db, second);
  const lifecycleConcurrency = await rehearseLifecycleConcurrency(db, second);
  const deploymentConcurrency = await rehearseDeploymentConcurrency(db, second);
  const privacyIntakeConcurrency = await rehearsePrivacyIntakeConcurrency(db, second);
  const reportConcurrency = await rehearseReportConcurrency(db, second);
  const restoreStarted = Date.now();
  const pgCommon = ["-h", socket, "-p", "5432", "-U", connection.user];
  const beforeRestore = await fingerprintPostgres(connection, models);
  await runTransferCommand(
    "pg_dump",
    [
      ...pgCommon,
      "-d",
      connection.database,
      "--format=custom",
      "--file",
      join(scratch, "restore.dump"),
    ],
    { env: pgEnv(connection) },
  );
  await runTransferCommand("createdb", [...pgCommon, "restored_fixture"], {
    env: pgEnv(connection),
  });
  const restored = { ...connection, database: "restored_fixture" };
  await runTransferCommand(
    "pg_restore",
    [
      ...pgCommon,
      "-d",
      restored.database,
      "--exit-on-error",
      join(scratch, "restore.dump"),
    ],
    { env: pgEnv(connection) },
  );
  assert.deepEqual(await fingerprintPostgres(restored, models), beforeRestore);
  const invalidConstraints = await runTransferCommand(
    "psql",
    [
      ...pgArgs(restored),
      "-c",
      "SELECT count(*) FROM pg_constraint WHERE NOT convalidated",
    ],
    { env: pgEnv(restored) },
  );
  assert.equal(invalidConstraints, "0");
  const restoreDurationMs = Date.now() - restoreStarted;
  const currentSchemaHash = createHash("sha256")
    .update(await readFile("prisma/schema.prisma"))
    .digest("hex");
  const report = {
    ...parity,
    databaseVersion: await runTransferCommand(
      "psql",
      [...pgArgs(connection), "-c", "SHOW server_version"],
      { env: pgEnv(connection) },
    ),
    schemaStillCurrent: currentSchemaHash === schemaHash,
    migrationInputs,
    postgresMigrationEvidence,
    postgresMigrationHistoryVerified: true,
    concurrency: {
      workers: 2,
      exclusiveClaims: claimed.length,
      wrongTenantRejected: true,
      repeatedCompletionRejected: true,
    },
    populatedTargetRejected: true,
    financialConcurrency,
    lifecycleConcurrency,
    deploymentConcurrency,
    privacyIntakeConcurrency,
    reportConcurrency,
    restore: {
      durationMs: restoreDurationMs,
      tablesMatched: beforeRestore.length,
      foreignKeysValidated: true,
      kind: "local-pg-dump-restore",
      fullApplicationRtoVerified: false,
    },
    scope:
      "Synthetic local database rehearsal only; production cutover, managed PITR and full application recovery unverified",
  };
  const evidence = resolve("docs/audit-2026-09-05/postgres-rehearsal.json");
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `PostgreSQL rehearsal: ${parity.totalRows} rows across ${parity.models.length} tables matched; two workers claimed 12 jobs exactly once. Evidence: ${evidence}`,
  );
  if (!report.schemaStillCurrent) {
    console.error(
      "Schema changed during rehearsal; rerun against the settled checkpoint.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "PostgreSQL rehearsal failed",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
  await second?.$disconnect();
  if (started)
    await runTransferCommand("pg_ctl", [
      "-D",
      data,
      "-m",
      "fast",
      "-w",
      "stop",
    ]);
  await rm(scratch, { recursive: true, force: true });
  await rm(generatedDirectory, { recursive: true, force: true });
}
