import { PrismaClient } from "@prisma/client";
import { adoptLegacyPrivacyLookupKey } from "../app/services/privacy-key-adoption.server";
import { privacyLookupKeys } from "../app/services/privacy-lookup-keys.server";

const inputs = process.argv.slice(2);
const at = inputs.indexOf("--request-id");
const requestId = at >= 0 ? inputs[at + 1] : undefined;
if (!requestId || !/^[A-Za-z0-9_-]{1,160}$/.test(requestId) ||
  inputs.some((value, index) => index !== at + 1 && value !== "--request-id" && value !== "--apply"))
  throw new Error("Usage: adopt-legacy-privacy-key.ts --request-id ID [--apply]. Default is read-only verification.");
const keys = privacyLookupKeys();
if (!keys.legacy || !process.env.FIELD_ENCRYPTION_KEY)
  throw new Error("Configure the exact PRIVACY_LEGACY_LOOKUP_KEY and FIELD_ENCRYPTION_KEY. Never pass keys as command arguments.");
const db = new PrismaClient();
try {
  const result = await adoptLegacyPrivacyLookupKey({ db, requestId, legacySecret: keys.legacy,
    scopeSecret: process.env.FIELD_ENCRYPTION_KEY, dryRun: !inputs.includes("--apply") });
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
