import assert from "node:assert/strict";
import test from "node:test";

import { provisionTest1DemoOperator, resolveTest1Demo, startTest1Demo, stopTest1Demo, TEST1_DEMO_SHOP } from "../app/services/test1-demo.server";
import { isTest1SyntheticDemoOrder } from "../app/services/measurement.server";
import { approveAdaptivePackageReview, buildAdaptiveApprovedPackage, createAdaptivePackageReview } from "../app/services/adaptive-package.server";
import { cutoverAndPrepare, testDatabase } from "./test-store-cutover.test";
import { createCampaignMapping } from "../app/services/governance.server";

const environment = { SHOPIFY_API_SECRET: "x".repeat(64) };

test("demo resolver fails closed outside the exact test store without reading tenant data", async () => {
  const db = new Proxy({}, { get() { throw new Error("database must not be read"); } });
  const result = await resolveTest1Demo({ db: db as never, shop: "other.myshopify.com", context: "invalid", consent: { analytics: true, preferences: true }, environment });
  assert.deepEqual(result, { schemaVersion: 1, serving: "ORIGINAL", reason: "DEMO_CONTEXT_INVALID", demo: null, content: null });
});

test("demo resolver fails closed when the authenticated app-proxy shop has no merchant", async () => {
  const db = { merchant: { findUnique: async () => null } };
  const result = await resolveTest1Demo({ db: db as never, shop: TEST1_DEMO_SHOP, context: "invalid", consent: { analytics: true, preferences: true }, environment });
  assert.equal(result.serving, "ORIGINAL");
  assert.equal(result.reason, "DEMO_CONTEXT_INVALID");
  assert.equal(result.content, null);
});

test("demo resolver rejects a malformed opaque context before receipt lookup", async () => {
  let receiptReads = 0;
  const db = {
    merchant: { findUnique: async () => ({ id: "merchant-test1" }) },
    actionReceipt: { findFirst: async () => { receiptReads += 1; return null; } },
  };
  const result = await resolveTest1Demo({ db: db as never, shop: TEST1_DEMO_SHOP, context: "not-a-signed-context", consent: { analytics: true, preferences: true }, environment });
  assert.equal(result.reason, "DEMO_CONTEXT_INVALID");
  assert.equal(receiptReads, 0);
});

test("only the exact test1 synthetic product order is marked for demo exclusion", () => {
  const payload = { line_items: [{ product_id: 10345426977074, properties: [{ name: "_adaptive_decision", value: "old-valid-ref" }] }] };
  assert.equal(isTest1SyntheticDemoOrder(TEST1_DEMO_SHOP, payload), true);
  assert.equal(isTest1SyntheticDemoOrder("other.myshopify.com", payload), false);
  assert.equal(isTest1SyntheticDemoOrder(TEST1_DEMO_SHOP, { line_items: [{ product_id: 10345426977075 }] }), false);
});

test("isolated database executes start, active resolve, authority drift, stop, expiry, and singleton rejection", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await cutoverAndPrepare(fixture.db, "demo", { shop: TEST1_DEMO_SHOP, productId: "cmtpl078j0042q6m2tyug5g3t", shopifyProductId: "gid://shopify/Product/10345426977074" });
    const owner = `${TEST1_DEMO_SHOP}:owner`;
    await fixture.db.pilotRole.create({ data: { merchantId: seeded.merchant.id, actorKey: owner, role: "OWNER", grantedBy: owner } });
    await provisionTest1DemoOperator({ db: fixture.db, merchantId: seeded.merchant.id, shop: TEST1_DEMO_SHOP, requestedBy: owner });
    await fixture.db.autopilotPlan.update({ where: { id: seeded.approved.id }, data: { state: "VERIFYING" } });
    const angle = await fixture.db.acquisitionAngle.findFirstOrThrow({ where: { merchantId: seeded.merchant.id, key: "universal" } });
    const experience = await fixture.db.experienceVersion.findFirstOrThrow({ where: { merchantId: seeded.merchant.id, productId: seeded.product.id, status: "APPROVED_ACTIVE" } });
    await fixture.db.experienceVersion.update({ where: { id: experience.id }, data: { angleId: angle.id } });
    await createCampaignMapping({ db: fixture.db, merchantId: seeded.merchant.id, angleId: angle.id, utmSource: "demo", utmCampaign: "synthetic", utmContent: "", campaignAdText: "Soft recycled knit supports comfortable daily movement.", campaignLocale: "en", fallback: "ORIGINAL", actor: owner });
    const pkg = await buildAdaptiveApprovedPackage({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id });
    const review = await createAdaptivePackageReview({ db: fixture.db, package: pkg, actor: owner });
    await approveAdaptivePackageReview({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id, reviewId: review.id, actor: owner });
    const now = new Date("2026-09-14T12:00:00Z");
    const racingStarts = await Promise.allSettled([0, 1].map(() => startTest1Demo({ db: fixture.db, merchantId: seeded.merchant.id, shop: TEST1_DEMO_SHOP, requestedBy: owner, partnerDevelopment: true, now, environment })));
    const acceptedStart = racingStarts.find((result) => result.status === "fulfilled");
    assert.ok(acceptedStart && acceptedStart.status === "fulfilled");
    assert.equal(racingStarts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await fixture.db.actionReceipt.count({ where: { merchantId: seeded.merchant.id, action: "TEST1_SYNTHETIC_DEMO_STARTED" } }), 1);
    const started = acceptedStart.value;
    await assert.rejects(startTest1Demo({ db: fixture.db, merchantId: seeded.merchant.id, shop: TEST1_DEMO_SHOP, requestedBy: owner, partnerDevelopment: true, now, environment }), /TEST1_DEMO_ALREADY_ACTIVE/);
    const active = await resolveTest1Demo({ db: fixture.db, shop: TEST1_DEMO_SHOP, context: started.context, consent: { analytics: true, preferences: true }, now, environment });
    assert.equal(active.reason, "DEMO_ACTIVE");
    assert.equal(active.serving, "DEMO_SYNTHETIC");
    await fixture.db.product.update({ where: { id: seeded.product.id }, data: { sourceHash: "f".repeat(64) } });
    assert.equal((await resolveTest1Demo({ db: fixture.db, shop: TEST1_DEMO_SHOP, context: started.context, consent: { analytics: true, preferences: true }, now, environment })).reason, "DEMO_AUTHORITY_CHANGED");
    await fixture.db.product.update({ where: { id: seeded.product.id }, data: { sourceHash: seeded.product.sourceHash } });
    await fixture.db.pilotRole.update({ where: { merchantId_actorKey: { merchantId: seeded.merchant.id, actorKey: owner } }, data: { active: false } });
    assert.equal((await resolveTest1Demo({ db: fixture.db, shop: TEST1_DEMO_SHOP, context: started.context, consent: { analytics: true, preferences: true }, now, environment })).reason, "DEMO_AUTHORITY_CHANGED");
    await fixture.db.pilotRole.update({ where: { merchantId_actorKey: { merchantId: seeded.merchant.id, actorKey: owner } }, data: { active: true } });
    await stopTest1Demo({ db: fixture.db, merchantId: seeded.merchant.id, shop: TEST1_DEMO_SHOP, requestedBy: owner, context: started.context, now, environment });
    assert.equal((await resolveTest1Demo({ db: fixture.db, shop: TEST1_DEMO_SHOP, context: started.context, consent: { analytics: true, preferences: true }, now, environment })).reason, "DEMO_STOPPED");
    const later = new Date(now.getTime() + 16 * 60_000);
    const second = await startTest1Demo({ db: fixture.db, merchantId: seeded.merchant.id, shop: TEST1_DEMO_SHOP, requestedBy: owner, partnerDevelopment: true, now: later, environment });
    assert.equal((await resolveTest1Demo({ db: fixture.db, shop: TEST1_DEMO_SHOP, context: second.context, consent: { analytics: true, preferences: true }, now: new Date(later.getTime() + 16 * 60_000), environment })).reason, "DEMO_EXPIRED");
  } finally { await fixture.close(); }
});
