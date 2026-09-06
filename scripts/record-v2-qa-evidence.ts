import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import prisma from "../app/db.server";
import { recordOperatorV2QaEvidence } from "../app/services/test-store-cutover.server";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    shop: { type: "string" },
    "product-id": { type: "string" },
    "check-key": { type: "string" },
    applicability: { type: "string", default: "APPLICABLE" },
    "artifact-file": { type: "string" },
    "artifact-ref": { type: "string" },
    "actor-key": { type: "string" },
    "idempotency-key": { type: "string" },
    "captured-at": { type: "string" },
  },
  strict: true,
});

if (!values.apply)
  throw new Error(
    "V2_QA_EXPLICIT_APPLY_REQUIRED: inspect the private artifact and rerun with --apply",
  );
const shop = String(values.shop ?? "").trim().toLowerCase();
const productId = String(values["product-id"] ?? "").trim();
const artifactPath = path.resolve(String(values["artifact-file"] ?? ""));
const actor = String(values["actor-key"] ?? "").trim();
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
  throw new Error("V2_QA_SHOP_INVALID");
if (!/^[A-Za-z0-9_-]{1,160}$/.test(productId))
  throw new Error("V2_QA_PRODUCT_INVALID");
if (!actor || actor.length > 200) throw new Error("V2_QA_ACTOR_INVALID");
const stat = lstatSync(artifactPath);
if (!stat.isFile() || stat.isSymbolicLink())
  throw new Error("V2_QA_ARTIFACT_FILE_INVALID");
const artifactBytes = readFileSync(artifactPath);
const capturedAt = values["captured-at"]
  ? new Date(values["captured-at"])
  : new Date(stat.mtimeMs);
const merchant = await prisma.merchant.findUnique({ where: { shop } });
if (!merchant) throw new Error("V2_QA_MERCHANT_NOT_FOUND");

try {
  const result = await recordOperatorV2QaEvidence({
    db: prisma,
    merchantId: merchant.id,
    productId,
    checkKey: String(values["check-key"] ?? ""),
    applicability: String(values.applicability ?? ""),
    artifactRef: String(values["artifact-ref"] ?? ""),
    artifactBytes,
    actor,
    idempotencyKey: String(values["idempotency-key"] ?? ""),
    capturedAt,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      receiptId: result.receipt.id,
      evidenceId: result.evidence.id,
      checkKey: result.evidence.checkKey,
      replayed: result.replayed,
    })}\n`,
  );
} finally {
  await prisma.$disconnect();
}
