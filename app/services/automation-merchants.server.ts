import type { Prisma, PrismaClient } from "@prisma/client";

// Nullable relation/reason branches are explicit: SQL NOT alone drops nulls.
// This excludes confirmed uninstall only, never ordinary safety/privacy pauses.
export const automationMerchantWhere: Prisma.MerchantWhereInput = {
  OR: [
    { runtimeControl: { is: null } },
    { runtimeControl: { is: { killSwitch: false } } },
    { runtimeControl: { is: { reason: null } } },
    { runtimeControl: { is: { reason: { not: "App uninstalled" } } } },
  ],
};

export function listAutomationMerchants(db: PrismaClient) {
  return db.merchant.findMany({
    where: automationMerchantWhere,
    select: { id: true, shop: true },
  });
}
