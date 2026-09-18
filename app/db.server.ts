import { PrismaClient } from "@prisma/client";
import { assertRecoveryHoldClear } from "./services/recovery-hold.server";
import {
  initializeSqlite,
  sqliteRuntimeUrl,
} from "./services/sqlite-runtime.server";

declare global {
  // eslint-disable-next-line no-var
  var adaptiveStorefrontPrisma: PrismaClient | undefined;
}

const prisma =
  global.adaptiveStorefrontPrisma ??
  new PrismaClient({
    datasourceUrl: sqliteRuntimeUrl(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Gate the imported client itself: bypassing the supervisor via `pnpm start`
// must not expose a restored database before privacy recovery is complete.
await assertRecoveryHoldClear(prisma, process.env.DATABASE_URL);

const sqliteInitialization = process.env.DATABASE_URL?.startsWith("file:")
  ? initializeSqlite(prisma)
  : Promise.resolve();

// No route/session store can observe the client before its connection policy is ready.
await sqliteInitialization;

export async function databaseReady() {
  await sqliteInitialization;
  await prisma.$queryRaw`SELECT 1`;
}

if (process.env.NODE_ENV !== "production") {
  global.adaptiveStorefrontPrisma = prisma;
}

export default prisma;
