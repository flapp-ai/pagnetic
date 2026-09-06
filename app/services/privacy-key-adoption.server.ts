import type { PrismaClient } from "@prisma/client";
import { readCustomerPrivacyScope } from "./customer-privacy-queue.server";
import { privacyLookupKeyId } from "./privacy-lookup-keys.server";
import {
  privacyStorageKeyId,
  privacyStorageKeys,
} from "./privacy-storage-keys.server";
import { privacyOrderHash } from "./order-privacy-guard.server";

// Explicit one-request upgrade. This proves the supplied legacy key against
// authenticated original scope; merely configuring a plausible old key is unsafe.
export async function adoptLegacyPrivacyLookupKey(args: {
  db: PrismaClient;
  requestId: string;
  legacySecret: string;
  scopeSecret: string;
  dryRun?: boolean;
}) {
  return args.db.$transaction(async (tx) => {
    const request = await tx.privacyRequest.findUniqueOrThrow({
      where: { id: args.requestId },
    });
    const keyId = privacyLookupKeyId(args.legacySecret);
    const storage = privacyStorageKeys({
      FIELD_ENCRYPTION_KEY: args.scopeSecret,
    });
    const scopeKeyId = privacyStorageKeyId(storage.active);
    if (request.lookupKeyId && request.lookupKeyId !== keyId)
      throw new Error("PRIVACY_LOOKUP_KEY_ID_CONFLICT");
    if (request.scopeKeyId && request.scopeKeyId !== scopeKeyId)
      throw new Error("PRIVACY_STORAGE_KEY_ID_CONFLICT");
    const scope = readCustomerPrivacyScope({
      request,
      scopeSecret: args.scopeSecret,
      privacySecret: args.legacySecret,
    });
    const merchant = await tx.merchant.findUnique({
      where: { shop: scope.shop },
      select: { id: true },
    });
    if (merchant && !args.dryRun)
      await tx.runtimeControl.upsert({
        where: { merchantId: merchant.id },
        create: { merchantId: merchant.id },
        update: { merchantId: merchant.id },
      });
    const bound = args.dryRun
      ? { count: 1 }
      : await tx.privacyRequest.updateMany({
          where: {
            id: request.id,
            lookupKeyId: request.lookupKeyId,
            scopeKeyId: request.scopeKeyId,
            scopeCiphertext: request.scopeCiphertext,
            shopHash: request.shopHash,
          },
          data: { lookupKeyId: keyId, scopeKeyId },
        });
    if (bound.count !== 1) throw new Error("PRIVACY_LOOKUP_ADOPTION_CONFLICT");
    const hashes = new Set(
      scope.orderIds.map((id) => privacyOrderHash(args.legacySecret, id)),
    );
    let cursor: string | undefined;
    let verified = 0;
    let more = true;
    while (more) {
      const batch = await tx.privacyOrderSuppression.findMany({
        where: { requestId: request.id },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const row of batch)
        if (
          row.shopHash !== request.shopHash ||
          !hashes.has(row.orderHash) ||
          (row.lookupKeyId !== null && row.lookupKeyId !== keyId)
        )
          throw new Error("PRIVACY_LOOKUP_ADOPTION_SCOPE_MISMATCH");
      if (!args.dryRun)
        await tx.privacyOrderSuppression.updateMany({
          where: { id: { in: batch.map((row) => row.id) } },
          data: { lookupKeyId: keyId },
        });
      verified += batch.length;
      if (verified > scope.orderIds.length)
        throw new Error("PRIVACY_LOOKUP_ADOPTION_SCOPE_MISMATCH");
      cursor = batch[batch.length - 1].id;
      more = batch.length === 500;
    }
    if (request.requestType === "CUSTOMERS_REDACT") {
      verified = 0;
      const expectedHashes = [...hashes];
      for (let start = 0; start < expectedHashes.length; start += 500) {
        const expected = expectedHashes.slice(start, start + 500);
        const rows = await tx.privacyOrderSuppression.findMany({
          where: { shopHash: request.shopHash, orderHash: { in: expected } },
          select: { id: true, lookupKeyId: true },
        });
        if (
          rows.length !== expected.length ||
          rows.some(
            (row) => row.lookupKeyId !== null && row.lookupKeyId !== keyId,
          )
        )
          throw new Error("PRIVACY_LOOKUP_ADOPTION_SUPPRESSION_GAP");
        if (!args.dryRun)
          await tx.privacyOrderSuppression.updateMany({
            where: { id: { in: rows.map((row) => row.id) } },
            data: { lookupKeyId: keyId },
          });
        verified += rows.length;
      }
    }
    return {
      requestId: request.id,
      lookupKeyId: keyId,
      scopeKeyId,
      verifiedSuppressionRows: verified,
      applied: !args.dryRun,
    };
  });
}
