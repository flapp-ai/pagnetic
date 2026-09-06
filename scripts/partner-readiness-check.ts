import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import prisma from "../app/db.server";
import { productionEnvironmentStatus } from "../app/services/pilot-setup.server";
import { backupS3Config } from "./lib/backup-s3";
import { checkBackupEvidence, decodeBackupKey } from "./lib/sqlite-backup";

type Check = { name: string; passed: boolean; detail: string };
const root = process.cwd();
const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

const runtimePath = resolve(
  root,
  "extensions/adaptive-panel/assets/adaptive-panel.js",
);
if (existsSync(runtimePath)) {
  const compressedBytes = gzipSync(readFileSync(runtimePath)).byteLength;
  check(
    "Storefront bundle",
    compressedBytes < 50 * 1024,
    `${(compressedBytes / 1024).toFixed(1)} KB gzipped; target <50 KB`,
  );
} else {
  check("Storefront bundle", false, "Theme runtime asset is missing");
}

const requiredFiles = [
  "app/routes/healthz.ts",
  "app/routes/internal.automation.ts",
  "app/routes/storefront.events.ts",
  "app/routes/storefront.experience.ts",
  "app/routes/internal.funnel.ts",
  "app/routes/app.get-started.tsx",
  "app/services/autopilot-preparation.server.ts",
  "app/services/autopilot-orchestrator.server.ts",
  "app/services/autopilot-presentation.server.ts",
  "app/services/incremental-value.ts",
  "app/services/public-preview.server.ts",
  "app/routes/privacy.tsx",
  "app/routes/terms.tsx",
  "app/routes/support.tsx",
  "app/routes/webhooks.customers.data_request.tsx",
  "app/routes/webhooks.customers.redact.tsx",
  "app/routes/webhooks.shop.redact.tsx",
  "scripts/backup-sqlite.sh",
  "scripts/start-production.sh",
  "scripts/restore-sqlite.sh",
  "docs/08-design-partner-launch-checklist.md",
];
for (const path of requiredFiles)
  check(
    path,
    existsSync(resolve(root, path)),
    existsSync(resolve(root, path)) ? "present" : "missing",
  );

const appConfig = readFileSync(resolve(root, "shopify.app.toml"), "utf8");
for (const topic of [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]) {
  check(
    `Webhook ${topic}`,
    appConfig.includes(topic),
    appConfig.includes(topic) ? "configured" : "missing from shopify.app.toml",
  );
}

const migrations = readdirSync(resolve(root, "prisma/migrations")).filter(
  (entry) => statSync(resolve(root, "prisma/migrations", entry)).isDirectory(),
);
check(
  "Database migrations",
  migrations.length >= 10,
  `${migrations.length} migration directories`,
);

try {
  await prisma.$queryRaw`SELECT 1`;
  check("Database connection", true, "query succeeded");
} catch (error) {
  check(
    "Database connection",
    false,
    error instanceof Error ? error.message : "query failed",
  );
}

if (process.argv.includes("--production")) {
  for (const [name, passed] of Object.entries(productionEnvironmentStatus())) {
    check(
      `Environment ${name}`,
      passed,
      passed ? "configured" : "missing or unsafe",
    );
  }
  try {
    const evidence = await checkBackupEvidence({
      directory: process.env.BACKUP_DESTINATION || "",
      key: decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY),
      expectedDestination: backupS3Config().destination,
    });
    check(
      "Verified off-volume backup and isolated restore",
      evidence.passed,
      evidence.detail,
    );
  } catch {
    check(
      "Verified off-volume backup and isolated restore",
      false,
      "Configure encrypted S3-compatible backups and complete a verified backup run",
    );
  }
}

for (const item of checks)
  console.log(`${item.passed ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
const failures = checks.filter((item) => !item.passed);
await prisma.$disconnect();
if (failures.length) {
  console.error(`\n${failures.length} readiness check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${checks.length} readiness checks passed.`);
}
