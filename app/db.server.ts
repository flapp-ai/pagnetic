import { PrismaClient } from "@prisma/client";
import { assertRecoveryHoldClear } from "./services/recovery-hold.server";

declare global {
  // eslint-disable-next-line no-var
  var adaptiveStorefrontPrisma: PrismaClient | undefined;
}

const prisma =
  global.adaptiveStorefrontPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Gate the imported client itself: bypassing the supervisor via `pnpm start`
// must not expose a restored database before privacy recovery is complete.
await assertRecoveryHoldClear(prisma, process.env.DATABASE_URL);

const sqliteInitialization = process.env.DATABASE_URL?.startsWith("file:")
  ? Promise.all([
      prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL"),
      prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000"),
      prisma.$queryRawUnsafe("PRAGMA foreign_keys=ON"),
    ]).then(() => undefined)
  : Promise.resolve();

export async function databaseReady() {
  await sqliteInitialization;
  await prisma.$queryRaw`SELECT 1`;
}

if (process.env.NODE_ENV !== "production") {
  global.adaptiveStorefrontPrisma = prisma;
}

export default prisma;
