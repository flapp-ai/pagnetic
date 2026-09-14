import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { buildAdaptiveApprovedPackage, parseAdaptiveApprovedPackage } from "./adaptive-package.server";
import { canonicalQueuePayload } from "./job-outbox.server";
import { MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION } from "./mvp-v2";
import { loadV2TestStoreCutoverReceipt } from "./test-store-cutover.server";
import type { ApprovedPanelV2 } from "./v2-decision.server";

export const TEST1_DEMO_SHOP = "test1-eczm2zce.myshopify.com";
export const TEST1_DEMO_PRODUCT_ID = "cmtpl078j0042q6m2tyug5g3t";
export const TEST1_DEMO_SHOPIFY_PRODUCT_ID = "gid://shopify/Product/10345426977074";
export const TEST1_DEMO_SHOPIFY_PRODUCT_NUMERIC_ID = "10345426977074";
export const TEST1_DEMO_OPERATOR = "test1:operator:codex-astra";
const START_ACTION = "TEST1_SYNTHETIC_DEMO_STARTED";
const STOP_ACTION = "TEST1_SYNTHETIC_DEMO_STOPPED";
const WINDOW_MS = 15 * 60_000;

type Db = PrismaClient | Prisma.TransactionClient;

type StartReceipt = {
  schemaVersion: 1;
  merchantId: string;
  shop: typeof TEST1_DEMO_SHOP;
  productId: typeof TEST1_DEMO_PRODUCT_ID;
  shopifyProductId: typeof TEST1_DEMO_SHOPIFY_PRODUCT_ID;
  sourceVersion: string;
  sourceHash: string;
  planId: string;
  planHash: string;
  cutoverReceiptId: string;
  packageReviewId: string;
  packageHash: string;
  packagePayloadHash: string;
  generation: string;
  operator: typeof TEST1_DEMO_OPERATOR;
  requestedBy: string;
  developmentStoreVerifiedAt: string;
  issuedAt: string;
  expiresAt: string;
};

export type DemoResponseV1 = {
  schemaVersion: 1;
  serving: "ORIGINAL" | "DEMO_SYNTHETIC";
  reason: "DEMO_ACTIVE" | "DEMO_CONTEXT_INVALID" | "DEMO_EXPIRED" | "DEMO_STOPPED" |
    "DEMO_CONSENT_REQUIRED" | "DEMO_AUTHORITY_CHANGED" | "DEMO_INTERNAL_FAILURE";
  demo: { label: "Demo / synthetic test — not a live experiment"; generation: string; leaseExpiresAt: string } | null;
  content: ApprovedPanelV2 | null;
};

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function secret(environment: Record<string, string | undefined>) {
  const value = environment.SHOPIFY_API_SECRET?.trim() ?? "";
  if (value.length < 32) throw new Error("TEST1_DEMO_SECRET_UNAVAILABLE");
  return createHmac("sha256", value).update("pagnetic-test1-demo-v1\0").digest();
}

function signContext(receiptId: string, generation: string, expiresAt: string, environment: Record<string, string | undefined>) {
  const body = Buffer.from(canonicalQueuePayload({ receiptId, generation, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret(environment)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function parseContext(value: string, environment: Record<string, string | undefined>) {
  const [body, supplied, extra] = value.split(".");
  if (!body || !supplied || extra || body.length > 800 || supplied.length > 100) return null;
  const expected = createHmac("sha256", secret(environment)).update(body).digest("base64url");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof parsed.receiptId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(parsed.receiptId) &&
      typeof parsed.generation === "string" && /^[a-f0-9-]{36}$/.test(parsed.generation) &&
      typeof parsed.expiresAt === "string"
      ? { receiptId: parsed.receiptId, generation: parsed.generation, expiresAt: parsed.expiresAt }
      : null;
  } catch {
    return null;
  }
}

function parseStart(value: string): StartReceipt {
  const parsed = JSON.parse(value) as StartReceipt;
  if (!parsed || parsed.schemaVersion !== 1 || parsed.shop !== TEST1_DEMO_SHOP ||
    parsed.productId !== TEST1_DEMO_PRODUCT_ID || parsed.shopifyProductId !== TEST1_DEMO_SHOPIFY_PRODUCT_ID ||
    !/^[a-f0-9]{64}$/.test(parsed.packageHash) || parsed.operator !== TEST1_DEMO_OPERATOR ||
    !/^[a-f0-9-]{36}$/.test(parsed.generation)) throw new Error("TEST1_DEMO_RECEIPT_INVALID");
  return parsed;
}

function original(reason: DemoResponseV1["reason"]): DemoResponseV1 {
  return { schemaVersion: 1, serving: "ORIGINAL", reason, demo: null, content: null };
}

export async function provisionTest1DemoOperator(args: { db: PrismaClient; merchantId: string; shop: string; requestedBy: string; now?: Date }) {
  if (args.shop !== TEST1_DEMO_SHOP) throw new Error("TEST1_DEMO_SCOPE_MISMATCH");
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({ where: { id: args.merchantId, shop: TEST1_DEMO_SHOP } });
    if (!merchant) throw new Error("TEST1_DEMO_SCOPE_MISMATCH");
    const requester = await tx.pilotRole.findUnique({ where: { merchantId_actorKey: { merchantId: args.merchantId, actorKey: args.requestedBy } } });
    if (!requester?.active || requester.role !== "OWNER") throw new Error("TEST1_DEMO_OWNER_REQUIRED");
    const role = await tx.pilotRole.upsert({
      where: { merchantId_actorKey: { merchantId: args.merchantId, actorKey: TEST1_DEMO_OPERATOR } },
      create: { merchantId: args.merchantId, actorKey: TEST1_DEMO_OPERATOR, role: "OPERATOR", grantedBy: args.requestedBy, grantedAt: now },
      update: { role: "OPERATOR", active: true, grantedBy: args.requestedBy, grantedAt: now },
    });
    await tx.auditLog.create({ data: { merchantId: args.merchantId, actor: args.requestedBy, action: "TEST1_DEMO_OPERATOR_PROVISIONED", resourceType: "PILOT_ROLE", resourceId: role.id, detailsJson: canonicalQueuePayload({ actorKey: TEST1_DEMO_OPERATOR, shop: TEST1_DEMO_SHOP }), createdAt: now } });
    return role;
  });
}

async function currentAuthority(db: Db, merchantId: string, requestedBy?: string, expectedCurrentPackageHash?: string) {
  const [merchant, product, plan, review, operator, runtime, activeExperiments, activeDeployments] = await Promise.all([
    db.merchant.findFirst({ where: { id: merchantId, shop: TEST1_DEMO_SHOP } }),
    db.product.findFirst({ where: { id: TEST1_DEMO_PRODUCT_ID, merchantId, shopifyProductId: TEST1_DEMO_SHOPIFY_PRODUCT_ID, status: "ACTIVE" } }),
    db.autopilotPlan.findFirst({ where: { merchantId, productId: TEST1_DEMO_PRODUCT_ID, state: "VERIFYING", orchestrationProtocolVersion: MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION, expiresAt: { gt: new Date() }, approvedAt: { not: null }, approvalRecordJson: { not: null }, cutoverReceiptId: { not: null } }, orderBy: { version: "desc" } }),
    db.adaptivePackageReview.findFirst({ where: { merchantId, productId: TEST1_DEMO_PRODUCT_ID, status: "APPROVED" }, orderBy: { approvedAt: "desc" } }),
    db.pilotRole.findUnique({ where: { merchantId_actorKey: { merchantId, actorKey: TEST1_DEMO_OPERATOR } } }),
    db.runtimeControl.findUnique({ where: { merchantId } }),
    db.experiment.count({ where: { merchantId, status: "ACTIVE" } }),
    db.activeDeployment.count({ where: { merchantId } }),
  ]);
  if (!merchant || !product || !plan?.cutoverReceiptId || !review || !operator?.active || operator.role !== "OPERATOR" ||
    !runtime?.killSwitch || activeExperiments || activeDeployments)
    throw new Error("TEST1_DEMO_AUTHORITY_UNAVAILABLE");
  if (requestedBy) {
    const requester = await db.pilotRole.findUnique({ where: { merchantId_actorKey: { merchantId, actorKey: requestedBy } } });
    if (!requester?.active || requester.role !== "OWNER") throw new Error("TEST1_DEMO_OWNER_REQUIRED");
  }
  let approval: { planHash?: unknown; cutoverReceiptId?: unknown };
  try { approval = JSON.parse(plan.approvalRecordJson!) as typeof approval; } catch { throw new Error("TEST1_DEMO_APPROVAL_INVALID"); }
  if (approval.planHash !== plan.planHash || approval.cutoverReceiptId !== plan.cutoverReceiptId)
    throw new Error("TEST1_DEMO_APPROVAL_INVALID");
  const cutover = await loadV2TestStoreCutoverReceipt({ db, merchantId, receiptId: plan.cutoverReceiptId, productId: product.id, requireCurrentSource: true });
  if (runtime.reason !== cutover.scope.holdReason) throw new Error("TEST1_DEMO_HOLD_MISMATCH");
  const pkg = parseAdaptiveApprovedPackage(review.payloadJson);
  const currentHash = expectedCurrentPackageHash ?? (await buildAdaptiveApprovedPackage({ db: db as PrismaClient, merchantId, productId: product.id })).packageHash;
  if (pkg.packageHash !== review.packageHash || pkg.merchantId !== merchantId || pkg.productId !== product.id ||
    pkg.productSourceVersion !== product.sourceVersion || pkg.productSourceHash !== product.sourceHash || currentHash !== review.packageHash)
    throw new Error("TEST1_DEMO_PACKAGE_CHANGED");
  return { product, plan, review, pkg };
}

export async function startTest1Demo(args: { db: PrismaClient; merchantId: string; shop: string; requestedBy: string; partnerDevelopment: boolean; now?: Date; environment?: Record<string, string | undefined> }) {
  if (args.shop !== TEST1_DEMO_SHOP || args.partnerDevelopment !== true) throw new Error("TEST1_DEMO_DEVELOPMENT_STORE_REQUIRED");
  const now = args.now ?? new Date();
  secret(args.environment ?? process.env);
  const currentPackage = await buildAdaptiveApprovedPackage({ db: args.db, merchantId: args.merchantId, productId: TEST1_DEMO_PRODUCT_ID });
  const generation = randomUUID();
  const expiresAt = new Date(now.getTime() + WINDOW_MS);
  const receipt = await args.db.$transaction(async (tx) => {
    const authority = await currentAuthority(tx, args.merchantId, args.requestedBy, currentPackage.packageHash);
    const prior = await tx.testStoreDemoLease.findUnique({ where: { merchantId: args.merchantId } });
    if (prior && !prior.stoppedAt && prior.expiresAt > now) throw new Error("TEST1_DEMO_ALREADY_ACTIVE");
    const scope: StartReceipt = {
      schemaVersion: 1, merchantId: args.merchantId, shop: TEST1_DEMO_SHOP, productId: TEST1_DEMO_PRODUCT_ID,
      shopifyProductId: TEST1_DEMO_SHOPIFY_PRODUCT_ID, sourceVersion: authority.product.sourceVersion, sourceHash: authority.product.sourceHash,
      planId: authority.plan.id, planHash: authority.plan.planHash, cutoverReceiptId: authority.plan.cutoverReceiptId!,
      packageReviewId: authority.review.id, packageHash: authority.review.packageHash, packagePayloadHash: sha(authority.review.payloadJson),
      generation, operator: TEST1_DEMO_OPERATOR, requestedBy: args.requestedBy,
      developmentStoreVerifiedAt: now.toISOString(), issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
    };
    const responseRef = canonicalQueuePayload(scope);
    const created = await tx.actionReceipt.create({ data: { merchantId: args.merchantId, actor: TEST1_DEMO_OPERATOR, action: START_ACTION, idempotencyKey: `test1-demo:start:${generation}`, inputHash: sha(responseRef), responseRef, createdAt: now } });
    await tx.testStoreDemoLease.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId, startReceiptId: created.id, generation, expiresAt },
      update: { startReceiptId: created.id, generation, expiresAt, stoppedAt: null },
    });
    await tx.auditLog.create({ data: { merchantId: args.merchantId, actor: TEST1_DEMO_OPERATOR, action: START_ACTION, resourceType: "ACTION_RECEIPT", resourceId: created.id, detailsJson: canonicalQueuePayload({ requestedBy: args.requestedBy, productId: TEST1_DEMO_PRODUCT_ID, planId: authority.plan.id, packageHash: authority.review.packageHash, expiresAt: expiresAt.toISOString() }), createdAt: now } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { receiptId: receipt.id, expiresAt, context: signContext(receipt.id, generation, expiresAt.toISOString(), args.environment ?? process.env) };
}

async function loadStart(db: Db, merchantId: string, context: string, environment: Record<string, string | undefined>) {
  const token = parseContext(context, environment);
  if (!token) return null;
  const receipt = await db.actionReceipt.findFirst({ where: { id: token.receiptId, merchantId, action: START_ACTION } });
  if (!receipt || receipt.inputHash !== sha(receipt.responseRef)) return null;
  try {
    const scope = parseStart(receipt.responseRef);
    return scope.generation === token.generation && scope.expiresAt === token.expiresAt ? { receipt, scope } : null;
  } catch { return null; }
}

export async function stopTest1Demo(args: { db: PrismaClient; merchantId: string; shop: string; requestedBy: string; context: string; now?: Date; environment?: Record<string, string | undefined> }) {
  if (args.shop !== TEST1_DEMO_SHOP) throw new Error("TEST1_DEMO_SCOPE_MISMATCH");
  const now = args.now ?? new Date();
  const receipt = await args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({ where: { id: args.merchantId, shop: TEST1_DEMO_SHOP } });
    if (!merchant) throw new Error("TEST1_DEMO_SCOPE_MISMATCH");
    const requester = await tx.pilotRole.findUnique({ where: { merchantId_actorKey: { merchantId: args.merchantId, actorKey: args.requestedBy } } });
    if (!requester?.active || requester.role !== "OWNER") throw new Error("TEST1_DEMO_OWNER_REQUIRED");
    const started = await loadStart(tx, args.merchantId, args.context, args.environment ?? process.env);
    if (!started) throw new Error("TEST1_DEMO_CONTEXT_INVALID");
    const material = canonicalQueuePayload({ schemaVersion: 1, startReceiptId: started.receipt.id, generation: started.scope.generation, requestedBy: args.requestedBy, stoppedAt: now.toISOString() });
    const created = await tx.actionReceipt.upsert({
      where: { merchantId_idempotencyKey: { merchantId: args.merchantId, idempotencyKey: `test1-demo:stop:${started.receipt.id}` } },
      create: { merchantId: args.merchantId, actor: TEST1_DEMO_OPERATOR, action: STOP_ACTION, idempotencyKey: `test1-demo:stop:${started.receipt.id}`, inputHash: sha(material), responseRef: material, createdAt: now }, update: {},
    });
    const existingAudit = await tx.auditLog.findFirst({ where: { merchantId: args.merchantId, action: STOP_ACTION, resourceType: "ACTION_RECEIPT", resourceId: created.id } });
    if (!existingAudit) await tx.auditLog.create({ data: { merchantId: args.merchantId, actor: TEST1_DEMO_OPERATOR, action: STOP_ACTION, resourceType: "ACTION_RECEIPT", resourceId: created.id, detailsJson: canonicalQueuePayload({ requestedBy: args.requestedBy, startReceiptId: started.receipt.id }), createdAt: now } });
    await tx.testStoreDemoLease.updateMany({ where: { merchantId: args.merchantId, startReceiptId: started.receipt.id, generation: started.scope.generation, stoppedAt: null }, data: { stoppedAt: now } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { receiptId: receipt.id };
}

export async function loadTest1DemoAdminState(args: { db: PrismaClient; merchantId: string; shop: string; now?: Date; environment?: Record<string, string | undefined> }) {
  if (args.shop !== TEST1_DEMO_SHOP) return { eligibleShop: false, operatorProvisioned: false, packageStatus: null, active: null };
  const now = args.now ?? new Date();
  const [operator, review, lease] = await Promise.all([
    args.db.pilotRole.findUnique({ where: { merchantId_actorKey: { merchantId: args.merchantId, actorKey: TEST1_DEMO_OPERATOR } } }),
    args.db.adaptivePackageReview.findFirst({ where: { merchantId: args.merchantId, productId: TEST1_DEMO_PRODUCT_ID }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, packageHash: true } }),
    args.db.testStoreDemoLease.findUnique({ where: { merchantId: args.merchantId } }),
  ]);
  let active: { receiptId: string; expiresAt: string; context: string } | null = null;
  if (lease && !lease.stoppedAt && lease.expiresAt > now) {
    const receipt = await args.db.actionReceipt.findFirst({ where: { id: lease.startReceiptId, merchantId: args.merchantId, action: START_ACTION } });
    try {
      if (!receipt || receipt.inputHash !== sha(receipt.responseRef)) throw new Error("invalid");
      const scope = parseStart(receipt.responseRef);
      if (scope.generation === lease.generation && scope.expiresAt === lease.expiresAt.toISOString()) {
        active = { receiptId: receipt.id, expiresAt: scope.expiresAt, context: signContext(receipt.id, scope.generation, scope.expiresAt, args.environment ?? process.env) };
      }
    } catch { /* Invalid historical receipt is never authority. */ }
  }
  return { eligibleShop: true, operatorProvisioned: Boolean(operator?.active && operator.role === "OPERATOR"), packageStatus: review, active };
}

export async function resolveTest1Demo(args: { db: PrismaClient; shop: string; context: string; consent: { analytics: boolean; preferences: boolean }; now?: Date; environment?: Record<string, string | undefined> }): Promise<DemoResponseV1> {
  if (args.shop !== TEST1_DEMO_SHOP) return original("DEMO_CONTEXT_INVALID");
  const merchant = await args.db.merchant.findUnique({ where: { shop: args.shop }, select: { id: true } });
  if (!merchant) return original("DEMO_CONTEXT_INVALID");
  const started = await loadStart(args.db, merchant.id, args.context, args.environment ?? process.env);
  if (!started) return original("DEMO_CONTEXT_INVALID");
  const now = args.now ?? new Date();
  if (new Date(started.scope.expiresAt) <= now) return original("DEMO_EXPIRED");
  const lease = await args.db.testStoreDemoLease.findUnique({ where: { merchantId: merchant.id } });
  if (!lease || lease.startReceiptId !== started.receipt.id || lease.generation !== started.scope.generation || lease.stoppedAt) return original("DEMO_STOPPED");
  const stopped = await args.db.actionReceipt.findFirst({ where: { merchantId: merchant.id, action: STOP_ACTION, idempotencyKey: `test1-demo:stop:${started.receipt.id}` } });
  if (stopped) return original("DEMO_STOPPED");
  if (!args.consent.analytics || !args.consent.preferences) return original("DEMO_CONSENT_REQUIRED");
  try {
    const authority = await currentAuthority(args.db, merchant.id, started.scope.requestedBy);
    if (started.scope.sourceVersion !== authority.product.sourceVersion || started.scope.sourceHash !== authority.product.sourceHash ||
      started.scope.planId !== authority.plan.id || started.scope.planHash !== authority.plan.planHash ||
      started.scope.cutoverReceiptId !== authority.plan.cutoverReceiptId || started.scope.packageReviewId !== authority.review.id ||
      started.scope.packageHash !== authority.review.packageHash || started.scope.packagePayloadHash !== sha(authority.review.payloadJson)) return original("DEMO_AUTHORITY_CHANGED");
    const mapping = [...authority.pkg.reviewPayload.mappings].sort((a, b) => a.mappingId.localeCompare(b.mappingId))[0];
    if (!mapping) return original("DEMO_AUTHORITY_CHANGED");
    const content: ApprovedPanelV2 = {
      schemaVersion: 2, contentVersionId: mapping.bundleId, contentHash: mapping.contentHash,
      headline: mapping.headline, headlineEvidenceIds: mapping.claims.find((claim) => claim.text === mapping.headline)?.evidenceIds ?? [],
      benefits: mapping.benefits.map((text) => ({ text, evidenceIds: mapping.claims.find((claim) => claim.text === text)?.evidenceIds ?? [] })),
      proofItems: mapping.proofItems, faq: mapping.faq,
      reassurance: mapping.reassurance ? { text: mapping.reassurance, evidenceIds: mapping.claims.find((claim) => claim.text === mapping.reassurance)?.evidenceIds ?? [] } : null,
    };
    return { schemaVersion: 1, serving: "DEMO_SYNTHETIC", reason: "DEMO_ACTIVE", demo: { label: "Demo / synthetic test — not a live experiment", generation: started.scope.generation, leaseExpiresAt: new Date(Math.min(new Date(started.scope.expiresAt).getTime(), now.getTime() + 5_000)).toISOString() }, content };
  } catch { return original("DEMO_AUTHORITY_CHANGED"); }
}
