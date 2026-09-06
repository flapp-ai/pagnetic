import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { privacyHash } from "./privacy.server";
import { readCustomerPrivacyScope } from "./customer-privacy-queue.server";
import { privacyLookupKeys } from "./privacy-lookup-keys.server";
import { privacyStorageKeyId, privacyStorageKeys } from "./privacy-storage-keys.server";
import { decryptField } from "./field-encryption.server";
import { privacyOrderHash } from "./order-privacy-guard.server";
import { privacyIdentityHash, type PrivacyIdentity } from "./identity-privacy-guard.server";

const FINGERPRINT_DOMAIN = "pagnetic-recovery-protected-db-v1\0";
const METADATA_DOMAIN = "pagnetic-recovery-metadata-v1\0";
const EXCLUDED_TABLES = new Set([
  "_PagneticRecoveryHold", "RecoveryReplayEvidence", "RecoveryReleaseAudit",
  "_prisma_migrations", "sqlite_sequence",
]);
const FINGERPRINT_PAGE_SIZE = 200;
const FINGERPRINT_MAX_TABLES = 256;
const FINGERPRINT_MAX_ROWS = 1_000_000;
const FINGERPRINT_MAX_BYTES = 128 * 1024 * 1024;
const FINGERPRINT_MAX_ROW_BYTES = 1024 * 1024;

type QueryDb = Pick<PrismaClient, "$queryRawUnsafe"> | Prisma.TransactionClient;

function stable(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString("base64"));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function applicationTables(db: QueryDb) {
  const rows = await db.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const application = rows.filter((row) => !EXCLUDED_TABLES.has(row.name));
  if (application.length > FINGERPRINT_MAX_TABLES) throw new Error("RECOVERY_FINGERPRINT_BUDGET_EXCEEDED");
  return application;
}

export async function protectedDatabaseFingerprint(db: QueryDb) {
  const hash = createHash("sha256").update(FINGERPRINT_DOMAIN);
  let totalRows = 0;
  let totalBytes = 0;
  for (const table of await applicationTables(db)) {
    const columns = await db.$queryRawUnsafe<Array<{ name: string; type: string; notnull: number; pk: number }>>(
      `PRAGMA table_info(${quote(table.name)})`,
    );
    hash.update(stable({ table: table.name, sql: table.sql, columns }));
    const primary = columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    const ordering = (primary.length ? primary : columns).map((column) => quote(column.name)).join(",") || "1";
    const sizeExpression = columns.length
      ? columns.map((column) => `coalesce(length(quote(${quote(column.name)})),0)`).join("+")
      : "0";
    const bounds = await db.$queryRawUnsafe<Array<{ rowCount: bigint | number; maxRowBytes: bigint | number; totalRawBytes: bigint | number }>>(
      `SELECT count(*) AS rowCount, coalesce(max(${sizeExpression}),0) AS maxRowBytes, coalesce(sum(${sizeExpression}),0) AS totalRawBytes FROM ${quote(table.name)}`,
    );
    const rowCount = Number(bounds[0]?.rowCount ?? 0);
    const maxRowBytes = Number(bounds[0]?.maxRowBytes ?? 0);
    const totalRawBytes = Number(bounds[0]?.totalRawBytes ?? 0);
    if (!Number.isSafeInteger(rowCount) || !Number.isSafeInteger(maxRowBytes) || !Number.isSafeInteger(totalRawBytes) ||
      rowCount < 0 || maxRowBytes < 0 || totalRawBytes < 0 ||
      totalRows + rowCount > FINGERPRINT_MAX_ROWS || maxRowBytes > FINGERPRINT_MAX_ROW_BYTES ||
      totalBytes + totalRawBytes > FINGERPRINT_MAX_BYTES)
      throw new Error("RECOVERY_FINGERPRINT_BUDGET_EXCEEDED");
    let offset = 0;
    for (;;) {
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM ${quote(table.name)} ORDER BY ${ordering} LIMIT ${FINGERPRINT_PAGE_SIZE} OFFSET ${offset}`,
      );
      for (const row of rows) {
        const encoded = stable(row);
        const rowBytes = Buffer.byteLength(encoded, "utf8");
        if (rowBytes > FINGERPRINT_MAX_ROW_BYTES || totalBytes + rowBytes > FINGERPRINT_MAX_BYTES ||
          totalRows + 1 > FINGERPRINT_MAX_ROWS) throw new Error("RECOVERY_FINGERPRINT_BUDGET_EXCEEDED");
        totalBytes += rowBytes;
        totalRows += 1;
        hash.update(encoded);
      }
      if (rows.length < FINGERPRINT_PAGE_SIZE) break;
      offset += rows.length;
    }
  }
  hash.update(stable({ totalRows, totalBytes }));
  return hash.digest("hex");
}

export type RecoveryHoldMetadata = {
  state: string;
  reason: string;
  sourceManifestSha256: string | null;
  sourceArtifact: string | null;
  sourceArtifactSha256: string | null;
  restoredDbSha256: string | null;
  schemaSha256: string | null;
  replayEvidenceId: string | null;
};

export function canonicalRecoveryHoldMetadata(value: RecoveryHoldMetadata): RecoveryHoldMetadata {
  return {
    state: value.state,
    reason: value.reason,
    sourceManifestSha256: value.sourceManifestSha256,
    sourceArtifact: value.sourceArtifact,
    sourceArtifactSha256: value.sourceArtifactSha256,
    restoredDbSha256: value.restoredDbSha256,
    schemaSha256: value.schemaSha256,
    replayEvidenceId: value.replayEvidenceId,
  };
}

export function recoveryHoldIntegrityTag(key: Buffer, value: RecoveryHoldMetadata) {
  return recoveryMetadataTag(key, "hold", canonicalRecoveryHoldMetadata(value));
}

export function verifyRecoveryHoldIntegrity(key: Buffer, value: RecoveryHoldMetadata & { integrityTag: string }) {
  return verifyRecoveryMetadataTag(key, "hold", canonicalRecoveryHoldMetadata(value), value.integrityTag);
}

export async function protectedSchemaFingerprint(db: QueryDb) {
  const hash = createHash("sha256").update(`${FINGERPRINT_DOMAIN}schema\0`);
  const rows = await db.$queryRawUnsafe<Array<{ type: string; name: string; tbl_name: string; sql: string | null }>>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_PagneticRecoveryHold','RecoveryReplayEvidence','RecoveryReleaseAudit') ORDER BY type, name",
  );
  for (const row of rows) hash.update(stable(row));
  return hash.digest("hex");
}

export function recoveryMetadataTag(key: Buffer, kind: string, value: unknown) {
  if (key.length !== 32) throw new Error("RECOVERY_INTEGRITY_KEY_INVALID");
  return createHmac("sha256", key).update(METADATA_DOMAIN).update(kind).update("\0").update(stable(value)).digest("hex");
}

export function verifyRecoveryMetadataTag(key: Buffer, kind: string, value: unknown, supplied: string) {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = recoveryMetadataTag(key, kind, value);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function recoveryBackupKey(environment: Record<string, string | undefined> = process.env) {
  return recoveryBackupKeys(environment)[0];
}

// New backups always use the first (active) key. Historical manifests and
// recovery metadata may be authenticated by a retained previous key.
export function recoveryBackupKeys(environment: Record<string, string | undefined> = process.env) {
  const active = environment.BACKUP_ENCRYPTION_KEY;
  if (!active || !/^[A-Za-z0-9+/]{43}=$/.test(active)) throw new Error("RECOVERY_INTEGRITY_KEY_INVALID");
  let previous: unknown = [];
  try { previous = JSON.parse(environment.BACKUP_ENCRYPTION_PREVIOUS_KEYS || "[]"); }
  catch { throw new Error("RECOVERY_INTEGRITY_KEYRING_INVALID"); }
  if (!Array.isArray(previous) || previous.length > 7 ||
    !previous.every((value) => typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value)))
    throw new Error("RECOVERY_INTEGRITY_KEYRING_INVALID");
  const keys = [...new Set([active, ...previous])].map((value) => Buffer.from(value, "base64"));
  if (keys.some((key) => key.length !== 32)) throw new Error("RECOVERY_INTEGRITY_KEY_INVALID");
  return keys;
}

export function recoveryBackupKeyById(keyId: string,
  environment: Record<string, string | undefined> = process.env) {
  if (!/^[a-f0-9]{16}$/.test(keyId)) throw new Error("RECOVERY_INTEGRITY_KEY_INVALID");
  const matches = recoveryBackupKeys(environment).filter((key) =>
    createHash("sha256").update(key).digest("hex").slice(0, 16) === keyId);
  if (matches.length !== 1) throw new Error("RECOVERY_INTEGRITY_KEY_HISTORY_MISSING");
  return matches[0];
}

export function evidenceHash(evidence: Record<string, unknown>) {
  return createHash("sha256").update(`${METADATA_DOMAIN}evidence\0`).update(stable(evidence)).digest("hex");
}

export function canonicalRecoveryEvidence(input: {
  sourceManifestSha256: string; sourceArtifact: string; sourceArtifactSha256: string;
  restoredDbSha256: string; schemaSha256: string; receiptInventoryDigest: string;
  receiptInventoryStarted: string; receiptInventoryFinished: string;
  retainedKeyFingerprints: string; replayStartedAt: string; replayFinishedAt: string;
  receiptCount: number; unresolvedCount: number; erasureDigest: string; postReplayDbSha256: string;
  generatedAt: string;
}) {
  return { evidenceVersion: 1, ...input };
}

export function assertFreshTimestamp(value: Date | string, now = new Date()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 60_000 || now.getTime() - timestamp > 24 * 60 * 60_000)
    throw new Error("RECOVERY_EVIDENCE_STALE_OR_FUTURE");
}

export function receiptInventoryDigest(inventory: { names: string[]; receipts: Array<{ name: string; ciphertextSha256: string }> }) {
  return createHash("sha256").update(`${FINGERPRINT_DOMAIN}receipt-inventory\0`)
    .update(stable(inventory.receipts.map((item) => [item.name, item.ciphertextSha256]).sort(([a], [b]) => a.localeCompare(b))))
    .update(stable([...inventory.names].sort())).digest("hex");
}

function assertReceiptInventory(inventory: { names: string[]; receipts: Array<{ name: string; ciphertextSha256: string }> }) {
  if (inventory.names.length > 10_000 || inventory.receipts.length !== inventory.names.length ||
    new Set(inventory.names).size !== inventory.names.length || new Set(inventory.receipts.map((item) => item.name)).size !== inventory.receipts.length ||
    inventory.names.some((name) => !/^pagnetic-privacy-[a-f0-9]{64}\.enc$/.test(name)) ||
    inventory.receipts.some((item) => !inventory.names.includes(item.name) || !/^[a-f0-9]{64}$/.test(item.ciphertextSha256)))
    throw new Error("PRIVACY_RECEIPT_INVENTORY_INVALID");
}

function assertSha256(value: string, code = "RECOVERY_SOURCE_IDENTITY_INVALID") {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(code);
}

function assertEvidenceTimeline(values: { started: Date; finished: Date; generated: Date }, now: Date) {
  if (values.started.getTime() > values.finished.getTime() || values.finished.getTime() > values.generated.getTime())
    throw new Error("RECOVERY_EVIDENCE_TIMELINE_INVALID");
  for (const value of [values.started, values.finished, values.generated]) assertFreshTimestamp(value, now);
}

export async function verifyErasureGraph(db: PrismaClient | Prisma.TransactionClient, environment: Record<string, string | undefined>) {
  const requests = await db.privacyRequest.findMany({ where: { requestType: "CUSTOMERS_REDACT" }, orderBy: { id: "asc" } });
  if (requests.length > 10_000) throw new Error("RECOVERY_ERASURE_GRAPH_BUDGET_EXCEEDED");
  const lookupSecrets = privacyLookupKeys(environment).secrets;
  const storageSecrets = privacyStorageKeys(environment).secrets;
  const result = createHash("sha256").update(`${FINGERPRINT_DOMAIN}erasure\0`);
  for (const request of requests) {
    if (request.status !== "ACTIVE_DATA_ERASED_BACKUP_REVIEW") throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
    const lookup = lookupSecrets.find((key) => request.lookupKeyId && createHash("sha256").update("pagnetic-privacy-lookup-key-v1\0").update(key).digest("hex") === request.lookupKeyId);
    const storage = storageSecrets.find((key) => request.scopeKeyId === privacyStorageKeyId(key));
    if (!lookup || !storage) throw new Error("RECOVERY_ERASURE_KEY_HISTORY_MISSING");
    const scope = readCustomerPrivacyScope({ request, privacySecret: lookup, scopeSecret: storage });
    const shopHash = privacyHash(lookup, scope.shop);
    const suppressionRows = await db.privacyOrderSuppression.findMany({ where: {
      shopHash, orderHash: { in: scope.orderIds.map((orderId) => privacyOrderHash(lookup, orderId)) },
    }, select: { orderHash: true, lookupKeyId: true } });
    if (suppressionRows.length !== scope.orderIds.length || suppressionRows.some((row) => row.lookupKeyId !== request.lookupKeyId))
      throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
    const details = JSON.parse(request.detailsJson) as Record<string, unknown>;
    const erasure = details.erasure as Record<string, unknown> | undefined;
    if (erasure?.activeGraphErasureVerified !== true) throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
    const chunks = await db.privacyArtifactChunk.findMany({ where: { requestId: request.id, kind: "ERASURE_GRAPH" }, orderBy: { ordinal: "asc" } });
    if (chunks.length !== scope.orderIds.length) throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
    const graphs: Array<Record<string, unknown>> = [];
    for (const chunk of chunks) {
      if (createHash("sha256").update(chunk.payloadCiphertext).digest("hex") !== chunk.ciphertextHash) throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
      const envelope = decryptField<Record<string, unknown>>(chunk.payloadCiphertext, storage);
      if (!envelope || typeof envelope !== "object") throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
      const graph = envelope.graph;
      if (!graph || typeof graph !== "object" || envelope.requestId !== request.id || envelope.orderId !== scope.orderIds[chunk.ordinal]) throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
      graphs.push(graph as Record<string, unknown>);
    }
    const merchant = await db.merchant.findUnique({ where: { shop: scope.shop }, select: { id: true } });
    const orderIds = scope.orderIds;
    const [storeOrders, ledgerOrders, refunds, revisions, storeRefunds, orderLines, attributions, legacyAttributions, revisionLinks] = merchant ? await Promise.all([
      db.storeOrder.count({ where: { merchantId: merchant.id, shopifyOrderId: { in: orderIds } } }),
      db.orderLedger.count({ where: { merchantId: merchant.id, shopifyOrderId: { in: orderIds } } }),
      db.refundLedger.count({ where: { merchantId: merchant.id, shopifyOrderId: { in: orderIds } } }),
      db.financialOrderRevision.count({ where: { merchantId: merchant.id, shopifyOrderId: { in: orderIds } } }),
      db.storeRefund.count({ where: { merchantId: merchant.id, order: { shopifyOrderId: { in: orderIds } } } }),
      db.orderLedgerLine.count({ where: { order: { merchantId: merchant.id, shopifyOrderId: { in: orderIds } } } }),
      db.attributionV2.count({ where: { merchantId: merchant.id, orderLine: { order: { shopifyOrderId: { in: orderIds } } } } }),
      db.orderAttribution.count({ where: { merchantId: merchant.id, order: { shopifyOrderId: { in: orderIds } } } }),
      db.financialRevisionLink.count({ where: { merchantId: merchant.id, revision: { shopifyOrderId: { in: orderIds } } } }),
    ]) : [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if ([storeOrders, ledgerOrders, refunds, revisions, storeRefunds, orderLines, attributions, legacyAttributions, revisionLinks].some(Boolean))
      throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
    if (merchant) {
      const graphIds = {
        assignments: graphs.flatMap((graph) => (Array.isArray(graph.assignmentIds) ? graph.assignmentIds : []) as string[]),
        decisions: graphs.flatMap((graph) => (Array.isArray(graph.decisionIds) ? graph.decisionIds : []) as string[]),
        events: graphs.flatMap((graph) => (Array.isArray(graph.eventIds) ? graph.eventIds : []) as string[]),
        financial: graphs.flatMap((graph) => (Array.isArray(graph.financialRecordIds) ? graph.financialRecordIds : []) as string[]),
        experiments: graphs.flatMap((graph) => (Array.isArray(graph.experimentIds) ? graph.experimentIds : []) as string[]),
      };
      const [assignments, decisions, events, renders, outcomes, affectedExperiments] = await Promise.all([
        db.assignment.count({ where: { merchantId: merchant.id, id: { in: graphIds.assignments } } }),
        db.decision.count({ where: { merchantId: merchant.id, id: { in: graphIds.decisions } } }),
        db.commerceEvent.count({ where: { merchantId: merchant.id, id: { in: graphIds.events } } }),
        db.renderEvent.count({ where: { merchantId: merchant.id, decisionId: { in: graphIds.decisions } } }),
        db.visitorOutcome.count({ where: { merchantId: merchant.id, assignmentId: { in: graphIds.assignments } } }),
        db.experiment.count({ where: { merchantId: merchant.id, id: { in: graphIds.experiments }, privacyAffectedAt: null } }),
      ]);
      if (assignments || decisions || events || renders || outcomes || affectedExperiments)
        throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");

      const identities = graphs.flatMap((graph) => (Array.isArray(graph.identities) ? graph.identities : []) as PrivacyIdentity[]);
      for (let start = 0; start < identities.length; start += 100) {
        const batch = identities.slice(start, start + 100);
        const tombstones = await db.privacyIdentitySuppression.findMany({ where: {
          shopHash, OR: batch.map((identity) => ({ kind: identity.kind, identityHash: privacyIdentityHash(lookup, identity) })),
        }, select: { kind: true, identityHash: true, lookupKeyId: true } });
        const expected = new Set(batch.map((identity) => `${identity.kind}\0${privacyIdentityHash(lookup, identity)}`));
        const actual = new Set(tombstones.filter((row) => row.lookupKeyId === request.lookupKeyId)
          .map((row) => `${row.kind}\0${row.identityHash}`));
        if (expected.size !== actual.size || [...expected].some((identity) => !actual.has(identity)))
          throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
      }

      const refs = new Set([...orderIds, ...graphIds.assignments, ...graphIds.decisions, ...graphIds.events, ...graphIds.financial,
        ...identities.map((identity) => identity.value)]);
      const touches = (value: unknown): boolean => {
        if (typeof value === "string") {
          if (refs.has(value) || value.split(/[^A-Za-z0-9_-]+/).some((token) => refs.has(token))) return true;
          try { return touches(JSON.parse(value)); } catch { return false; }
        }
        if (Array.isArray(value)) return value.some(touches);
        return Boolean(value && typeof value === "object" && Object.values(value).some(touches));
      };
      let scanned = 0;
      for (const table of ["webhookInbox", "job", "outboxEvent", "auditLog", "actionReceipt"] as const) {
        let cursor: string | undefined;
        for (;;) {
          const where = { merchantId: merchant.id, ...(cursor ? { id: { gt: cursor } } : {}) };
          const rows = table === "webhookInbox" ? await db.webhookInbox.findMany({ where, orderBy: { id: "asc" }, take: 500,
            select: { id: true, payloadJson: true, shopifyEventId: true } }) :
            table === "job" ? await db.job.findMany({ where, orderBy: { id: "asc" }, take: 500,
              select: { id: true, payloadJson: true, idempotencyKey: true, resultRef: true } }) :
            table === "outboxEvent" ? await db.outboxEvent.findMany({ where, orderBy: { id: "asc" }, take: 500,
              select: { id: true, payloadJson: true, aggregateId: true, idempotencyKey: true } }) :
            table === "auditLog" ? await db.auditLog.findMany({ where, orderBy: { id: "asc" }, take: 500,
              select: { id: true, detailsJson: true, resourceId: true } }) :
            await db.actionReceipt.findMany({ where, orderBy: { id: "asc" }, take: 500,
              select: { id: true, responseRef: true, idempotencyKey: true } });
          scanned += rows.length;
          if (scanned > 100_000) throw new Error("RECOVERY_ERASURE_GRAPH_BUDGET_EXCEEDED");
          if (rows.some((row) => touches(row))) throw new Error("RECOVERY_ERASURE_GRAPH_UNRESOLVED");
          if (rows.length < 500) break;
          cursor = rows[rows.length - 1]?.id;
          if (!cursor) throw new Error("RECOVERY_ERASURE_GRAPH_BUDGET_EXCEEDED");
        }
      }
    }
    result.update(stable({ requestId: request.id, orderIds, suppressionRows,
      graphHashes: graphs.map((graph) => createHash("sha256").update(stable(graph)).digest("hex")),
      counts: { storeOrders, ledgerOrders, refunds, revisions, storeRefunds, orderLines, attributions, legacyAttributions, revisionLinks } }));
  }
  return result.digest("hex");
}

export async function recordRecoveryReplayEvidence(input: {
  db: PrismaClient;
  before: { names: string[]; receipts: Array<{ name: string; ciphertextSha256: string }> };
  after: { names: string[]; receipts: Array<{ name: string; ciphertextSha256: string }> };
  sourceManifestSha256: string; sourceArtifact: string; sourceArtifactSha256: string;
  restoredDbSha256: string; schemaSha256: string; retainedKeyFingerprints: string;
  replayStartedAt: Date; replayFinishedAt: Date; unresolvedCount: number; environment?: Record<string, string | undefined>;
  integrityKey: Buffer; now?: Date;
}) {
  assertReceiptInventory(input.before);
  assertReceiptInventory(input.after);
  if (JSON.stringify(input.before.names) !== JSON.stringify(input.after.names)) throw new Error("PRIVACY_RECEIPT_INVENTORY_CHANGED");
  const inventoryDigest = receiptInventoryDigest(input.before);
  if (inventoryDigest !== receiptInventoryDigest(input.after)) throw new Error("PRIVACY_RECEIPT_INVENTORY_CHANGED");
  if (input.unresolvedCount) throw new Error("RECOVERY_REPLAY_UNRESOLVED");
  assertSha256(input.sourceManifestSha256);
  assertSha256(input.sourceArtifactSha256);
  assertSha256(input.restoredDbSha256);
  assertSha256(input.schemaSha256);
  if (!/^pagnetic-[a-f0-9-]{36}\.sqlite\.enc$/.test(input.sourceArtifact) ||
    !input.retainedKeyFingerprints.split(",").every((value) => /^[a-f0-9]{64}$/.test(value)) ||
    new Set(input.retainedKeyFingerprints.split(",")).size !== input.retainedKeyFingerprints.split(",").length)
    throw new Error("RECOVERY_SOURCE_IDENTITY_INVALID");
  const now = input.now ?? new Date();
  assertEvidenceTimeline({ started: input.replayStartedAt, finished: input.replayFinishedAt, generated: now }, now);
  return input.db.$transaction(async (tx) => {
    const locked = await tx.recoveryHold.updateMany({ where: { id: "1", state: { in: ["HELD", "READY"] } }, data: { updatedAt: now } });
    if (locked.count !== 1) throw new Error("RECOVERY_HOLD_NOT_ACTIVE");
    const hold = await tx.recoveryHold.findUnique({ where: { id: "1" } });
    if (!hold || !verifyRecoveryHoldIntegrity(input.integrityKey, hold)) throw new Error("RECOVERY_HOLD_AUTHENTICATION_FAILED");
    if (hold.sourceManifestSha256 !== input.sourceManifestSha256 || hold.sourceArtifact !== input.sourceArtifact ||
      hold.sourceArtifactSha256 !== input.sourceArtifactSha256 || hold.restoredDbSha256 !== input.restoredDbSha256 ||
      hold.schemaSha256 !== input.schemaSha256) throw new Error("RECOVERY_SOURCE_IDENTITY_MISMATCH");
    const erasureDigest = await verifyErasureGraph(tx, input.environment ?? process.env);
    const postReplayDbSha256 = await protectedDatabaseFingerprint(tx);
    if (await protectedSchemaFingerprint(tx) !== input.schemaSha256) throw new Error("RECOVERY_SCHEMA_CHANGED");
    const canonical = canonicalRecoveryEvidence({
      sourceManifestSha256: input.sourceManifestSha256, sourceArtifact: input.sourceArtifact,
      sourceArtifactSha256: input.sourceArtifactSha256, restoredDbSha256: input.restoredDbSha256,
      schemaSha256: input.schemaSha256, receiptInventoryDigest: inventoryDigest,
      receiptInventoryStarted: input.replayStartedAt.toISOString(), receiptInventoryFinished: input.replayFinishedAt.toISOString(),
      retainedKeyFingerprints: input.retainedKeyFingerprints, replayStartedAt: input.replayStartedAt.toISOString(),
      replayFinishedAt: input.replayFinishedAt.toISOString(), receiptCount: input.before.receipts.length,
      unresolvedCount: input.unresolvedCount, erasureDigest, postReplayDbSha256, generatedAt: now.toISOString(),
    });
    const hash = evidenceHash(canonical);
    const integrityTag = recoveryMetadataTag(input.integrityKey, "evidence", { ...canonical, evidenceHash: hash });
    const id = randomUUID();
    await tx.recoveryReplayEvidence.create({ data: {
      id, holdId: "1", ...canonical, integrityTag,
    } });
    const ready = canonicalRecoveryHoldMetadata({ ...hold, state: "READY", reason: "REPLAY_EVIDENCE_READY", replayEvidenceId: id });
    await tx.recoveryHold.update({ where: { id: "1" }, data: { ...ready, integrityTag: recoveryHoldIntegrityTag(input.integrityKey, ready) } });
    return { id, evidenceHash: hash, inventoryDigest, erasureDigest, postReplayDbSha256 };
  });
}
