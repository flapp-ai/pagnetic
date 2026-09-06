import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { accessCustomerPrivacyArtifact, confirmCustomerPrivacyArtifactDelivery,
  customerPrivacyArtifactManifest } from "../app/services/customer-privacy-access.server";
import { processCustomerPrivacyExportStep } from "../app/services/customer-privacy-artifact.server";
import { claimCustomerPrivacyRequest } from "../app/services/customer-privacy-queue.server";
import { processPrivacyWebhook } from "../app/services/privacy.server";
import { encryptField } from "../app/services/field-encryption.server";

const now = new Date("2026-09-05T12:00:00.000Z");
const shop = "privacy-access.myshopify.com";
const actor = `${shop}:user:123`;
const field = "privacy-access-independent-field-key-32-characters";
const lookup = "privacy-access-independent-lookup-key-32-characters";
const environment = { NODE_ENV: "production", FIELD_ENCRYPTION_KEY: field, PRIVACY_LOOKUP_KEY: lookup };

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-access-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const merchant = await db.merchant.create({ data: { shop } });
  const request = await processPrivacyWebhook({ db, shop, type: "CUSTOMERS_DATA_REQUEST",
    secret: lookup, scopeSecret: field, now,
    payload: { data_request: { id: 100 }, customer: { id: 1234 }, orders_requested: [11] } });
  const lease = await claimCustomerPrivacyRequest({ db, now });
  assert.ok(lease);
  await processCustomerPrivacyExportStep({ db, lease, now, scopeSecret: field, privacySecret: lookup });
  const args = { db, shop, actor, requestId: request.id, environment, now,
    ownerAuthority: { shop, userId: "123", expiresAt: new Date(now.getTime() + 60_000) } };
  return { db, merchant, request, args, async close() {
    await db.$disconnect(); rmSync(directory, { recursive: true, force: true });
  } };
}

test("customer data downloads never bootstrap owners and reject viewer/operator, foreign tenant and fallback actors", async () => {
  const f = await fixture();
  try {
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 }), /PRIVACY_ACCESS_DENIED/);
    assert.equal(await f.db.pilotRole.count(), 0);
    const role = await f.db.pilotRole.create({ data: { merchantId: f.merchant.id, actorKey: actor,
      role: "VIEWER", grantedBy: "test" } });
    for (const name of ["VIEWER", "OPERATOR"]) {
      await f.db.pilotRole.update({ where: { id: role.id }, data: { role: name } });
      await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 }), /PRIVACY_ACCESS_DENIED/);
    }
    await f.db.pilotRole.update({ where: { id: role.id }, data: { role: "OWNER" } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0,
      ownerAuthority: { shop, userId: "999", expiresAt: new Date(now.getTime() + 60_000) } }), /PRIVACY_ACCESS_DENIED/);
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0,
      ownerAuthority: { shop, userId: "123", expiresAt: now } }), /PRIVACY_ACCESS_DENIED/);
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, actor: `${shop}:shop-admin`, ordinal: 0 }), /PRIVACY_ACCESS_DENIED/);
    const otherShop = "privacy-other.myshopify.com";
    const other = await f.db.merchant.create({ data: { shop: otherShop } });
    await f.db.pilotRole.create({ data: { merchantId: other.id, actorKey: `${otherShop}:user:123`,
      role: "OWNER", grantedBy: "test" } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, shop: otherShop,
      actor: `${otherShop}:user:123`, ordinal: 0 }), /PRIVACY_ACCESS_DENIED/);
    assert.equal(await f.db.auditLog.count(), 0);
  } finally { await f.close(); }
});

test("owner gets a safe manifest and authenticated exact copy; access is audited but never delivery or completion", async () => {
  const f = await fixture();
  try {
    await f.db.pilotRole.create({ data: { merchantId: f.merchant.id, actorKey: actor, role: "OWNER", grantedBy: "test" } });
    const manifest = await customerPrivacyArtifactManifest(f.args);
    assert.equal(manifest.partCount, 1);
    assert.deepEqual(Object.keys(manifest.parts[0]).sort(), ["expiresAt", "ordinal"]);
    assert.equal(JSON.stringify(manifest).includes("gid://"), false);
    const data = await accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 });
    assert.equal(data.orderId, "gid://shopify/Order/11");
    assert.equal("scopeHash" in data, false);
    assert.equal(data.deliveryConfirmed, false);
    const rotatedCopy = await accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0, environment: {
      ...environment, FIELD_ENCRYPTION_KEY: "rotated-field-secret-at-least-32-characters",
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify([field]),
    } });
    assert.equal(rotatedCopy.orderId, data.orderId);
    const request = await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } });
    assert.equal(request.status, "EXPORT_READY_OWNER_DELIVERY");
    assert.equal(request.completedAt, null);
    const audit = await f.db.auditLog.findFirstOrThrow();
    assert.equal(audit.action, "PRIVACY_EXPORT_ACCESSED");
    assert.equal(audit.resourceId, request.id);
    assert.equal(audit.detailsJson.includes("gid://"), false);
    await f.db.pilotRole.updateMany({ data: { active: false } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 }), /PRIVACY_ACCESS_DENIED/);
    assert.equal(await f.db.auditLog.count(), 2);
  } finally { await f.close(); }
});

test("verified Shopify account owner can recover a pre-uninstall copy after reinstall without restoring an app role", async () => {
  const f = await fixture();
  try {
    await f.db.merchant.delete({ where: { id: f.merchant.id } });
    const reinstalled = await f.db.merchant.create({ data: { shop,
      installedAt: new Date(now.getTime() + 60_000) } });
    assert.equal(await f.db.pilotRole.count({ where: { merchantId: reinstalled.id } }), 0);
    const manifest = await customerPrivacyArtifactManifest(f.args);
    assert.equal(manifest.available, true);
    assert.equal(manifest.accessMode, "VERIFIED_REINSTALL_RECOVERY");
    const copy = await accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 });
    assert.equal(copy.orderId, "gid://shopify/Order/11");
    assert.equal(await f.db.pilotRole.count({ where: { merchantId: reinstalled.id } }), 0,
      "privacy recovery must not bootstrap general app authority");
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { merchantId: reinstalled.id } });
    assert.match(audit.detailsJson, /VERIFIED_REINSTALL_RECOVERY/);
    const delivered = await confirmCustomerPrivacyArtifactDelivery({ ...f.args,
      attestation: "I_CONFIRMED_SECURE_DELIVERY_TO_REQUESTER", evidenceReference: "ticket:reinstall-delivery-1" });
    assert.equal(delivered.deliveryConfirmed, true);
    await f.db.merchant.delete({ where: { id: reinstalled.id } });
    assert.equal(await f.db.privacyDeliveryAudit.count({ where: { requestId: f.request.id } }), 1,
      "delivery audit must survive a later uninstall");
  } finally { await f.close(); }
});

test("delivery confirmation requires every part access and creates one keyed uninstall-safe attestation", async () => {
  const f = await fixture();
  try {
    await f.db.pilotRole.create({ data: { merchantId: f.merchant.id, actorKey: actor, role: "OWNER", grantedBy: "test" } });
    const confirmation = { ...f.args, attestation: "I_CONFIRMED_SECURE_DELIVERY_TO_REQUESTER",
      evidenceReference: "approved-ticket:privacy-delivery-100" };
    await assert.rejects(confirmCustomerPrivacyArtifactDelivery(confirmation), /PRIVACY_DELIVERY_PARTS_NOT_ACCESSED/);
    await accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 });
    await assert.rejects(confirmCustomerPrivacyArtifactDelivery({ ...confirmation, evidenceReference: "short" }),
      /PRIVACY_DELIVERY_CONFIRMATION_INVALID/);
    const result = await confirmCustomerPrivacyArtifactDelivery(confirmation);
    assert.equal(result.status, "OWNER_CONFIRMED_SECURE_DELIVERY");
    const request = await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } });
    assert.equal(request.status, "OWNER_CONFIRMED_SECURE_DELIVERY");
    assert.equal(request.completedAt?.toISOString(), now.toISOString());
    const delivery = await f.db.privacyDeliveryAudit.findUniqueOrThrow({ where: { requestId: f.request.id } });
    assert.equal(delivery.shopHash.includes(shop), false);
    assert.equal(delivery.actorHash.includes(actor), false);
    assert.notEqual(delivery.evidenceReference, confirmation.evidenceReference);
    assert.match(delivery.evidenceReference, /^[a-f0-9]{64}$/);
    assert.match(delivery.integrityTag, /^[a-f0-9]{64}$/);
    await assert.rejects(confirmCustomerPrivacyArtifactDelivery(confirmation), /PRIVACY_ARTIFACT_UNAVAILABLE/);
    assert.equal(await f.db.privacyDeliveryAudit.count(), 1);
    await f.db.privacyDeliveryAudit.update({ where: { requestId: f.request.id }, data: { integrityTag: "0".repeat(64) } });
    await assert.rejects(customerPrivacyArtifactManifest(f.args), /PRIVACY_DELIVERY_AUDIT_INVALID/);
  } finally { await f.close(); }
});

test("expired, tampered, wrong-key or transplanted artifacts fail without an access receipt", async () => {
  const f = await fixture();
  try {
    await f.db.pilotRole.create({ data: { merchantId: f.merchant.id, actorKey: actor, role: "OWNER", grantedBy: "test" } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0,
      now: new Date(now.getTime() + 8 * 86_400_000),
      ownerAuthority: { shop, userId: "123", expiresAt: new Date(now.getTime() + 9 * 86_400_000) } }), /PRIVACY_ARTIFACT_UNAVAILABLE/);
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0,
      environment: { ...environment, FIELD_ENCRYPTION_KEY: "different-field-key-at-least-32-characters" } }));
    const chunk = await f.db.privacyArtifactChunk.findFirstOrThrow();
    await f.db.privacyArtifactChunk.update({ where: { id: chunk.id }, data: { ciphertextHash: "bad" } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 }), /PRIVACY_ARTIFACT_UNAVAILABLE/);
    const transplant = encryptField({ version: 1, requestId: "different-request", orderOrdinal: 0,
      orderId: "gid://shopify/Order/11" }, field);
    await f.db.privacyArtifactChunk.update({ where: { id: chunk.id }, data: { payloadCiphertext: transplant,
      ciphertextHash: createHash("sha256").update(transplant).digest("hex") } });
    await assert.rejects(accessCustomerPrivacyArtifact({ ...f.args, ordinal: 0 }), /PRIVACY_ARTIFACT_UNAVAILABLE/);
    assert.equal(await f.db.auditLog.count(), 0);
  } finally { await f.close(); }
});
