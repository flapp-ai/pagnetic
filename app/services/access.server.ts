import type { PrismaClient } from "@prisma/client";

export type PilotRoleName = "OWNER" | "OPERATOR" | "VIEWER";

export function actorKey(
  shop: string,
  subject: string | number | null | undefined,
) {
  const normalized = String(subject ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 80);
  return normalized ? `${shop}:user:${normalized}` : `${shop}:shop-admin`;
}

export async function ensurePilotRole(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
}) {
  const existing = await args.db.pilotRole.findUnique({
    where: {
      merchantId_actorKey: {
        merchantId: args.merchantId,
        actorKey: args.actor,
      },
    },
  });
  if (existing) return existing;
  try {
    return await args.db.$transaction(async (tx) => {
      // SQLite must obtain its writer lock before authorization reads: a deferred
      // read-to-write upgrade can deadlock competing first-install transactions.
      // No-op SQL preserves Merchant timestamps and every business field.
      const locked =
        await tx.$executeRaw`UPDATE "Merchant" SET "id" = "id" WHERE "id" = ${args.merchantId}`;
      if (locked !== 1) throw new Error("PILOT_BOOTSTRAP_MERCHANT_NOT_FOUND");
      const role = await tx.pilotRole.findUnique({
        where: {
          merchantId_actorKey: {
            merchantId: args.merchantId,
            actorKey: args.actor,
          },
        },
      });
      if (role) return role;
      const count = await tx.pilotRole.count({
        where: { merchantId: args.merchantId, active: true },
      });
      if (count > 0) return null;
      return tx.pilotRole.create({
        data: {
          merchantId: args.merchantId,
          actorKey: args.actor,
          role: "OWNER",
          grantedBy: "SYSTEM_BOOTSTRAP",
        },
      });
    });
  } catch (error) {
    // Only the identical actor's unique-key collision is recoverable. Never
    // retry permission decisions or upgrade/reactivate the winning role.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const role = await args.db.pilotRole.findUnique({
        where: {
          merchantId_actorKey: {
            merchantId: args.merchantId,
            actorKey: args.actor,
          },
        },
      });
      if (role) return role;
    }
    throw error;
  }
}

export async function requirePilotRole(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  allowed: PilotRoleName[];
}) {
  const role = await ensurePilotRole(args);
  if (!role?.active || !args.allowed.includes(role.role as PilotRoleName)) {
    throw new Error(
      `This operation requires one of these pilot roles: ${args.allowed.join(", ")}.`,
    );
  }
  return role;
}

export async function grantPilotRole(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  shop: string;
  shopifyUserId: string;
  role: string;
}) {
  await requirePilotRole({
    db: args.db,
    merchantId: args.merchantId,
    actor: args.actor,
    allowed: ["OWNER"],
  });
  const role = args.role.toUpperCase() as PilotRoleName;
  if (!new Set<PilotRoleName>(["OWNER", "OPERATOR", "VIEWER"]).has(role))
    throw new Error("Select a valid pilot role.");
  if (!/^\d{1,30}$/.test(args.shopifyUserId))
    throw new Error("Provide the Shopify staff user ID.");
  const target = actorKey(args.shop, args.shopifyUserId);
  return args.db.pilotRole.upsert({
    where: {
      merchantId_actorKey: { merchantId: args.merchantId, actorKey: target },
    },
    create: {
      merchantId: args.merchantId,
      actorKey: target,
      role,
      grantedBy: args.actor,
    },
    update: {
      role,
      active: true,
      grantedBy: args.actor,
      grantedAt: new Date(),
    },
  });
}
