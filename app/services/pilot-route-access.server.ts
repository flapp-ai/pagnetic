import type { PrismaClient } from "@prisma/client";

import { requirePilotRole, type PilotRoleName } from "./access.server";

export type PilotRouteAction =
  | "get-started:sync-products"
  | "get-started:select-hero"
  | "get-started:approve-brand"
  | "get-started:build-library"
  | "messages:build-draft"
  | "messages:campaign-draft"
  | "messages:revise-draft"
  | "messages:approve-message"
  | "messages:prepare-adaptive-package"
  | "messages:approve-adaptive-package"
  | "settings:view"
  | "settings:export"
  | "settings:verify-subscription"
  | "settings:pause"
  | "settings:resume"
  | "operations:kill-switch-on"
  | "operations:kill-switch-off"
  | "operations:view"
  | "governance:view"
  | "measurement:view"
  | "setup:grant-role";

const OWNER_ONLY: readonly PilotRoleName[] = ["OWNER"];
const OPERATIONS: readonly PilotRoleName[] = ["OWNER", "OPERATOR"];
const ONBOARDING_CONFIGURATION: readonly PilotRoleName[] = [
  "OWNER",
  "OPERATOR",
  "SETUP",
];
const SETTINGS_READ_ONLY: readonly PilotRoleName[] = [
  "OWNER",
  "OPERATOR",
  "SETUP",
  "VIEWER",
];

const POLICIES: Record<PilotRouteAction, readonly PilotRoleName[]> = {
  "get-started:sync-products": ONBOARDING_CONFIGURATION,
  "get-started:select-hero": ONBOARDING_CONFIGURATION,
  "get-started:approve-brand": OWNER_ONLY,
  "get-started:build-library": OWNER_ONLY,
  "messages:build-draft": ONBOARDING_CONFIGURATION,
  "messages:campaign-draft": ONBOARDING_CONFIGURATION,
  "messages:revise-draft": ONBOARDING_CONFIGURATION,
  "messages:approve-message": OWNER_ONLY,
  "messages:prepare-adaptive-package": OWNER_ONLY,
  "messages:approve-adaptive-package": OWNER_ONLY,
  "settings:view": SETTINGS_READ_ONLY,
  "settings:export": OWNER_ONLY,
  "settings:verify-subscription": OPERATIONS,
  "settings:pause": OPERATIONS,
  "settings:resume": OPERATIONS,
  "operations:kill-switch-on": OPERATIONS,
  "operations:kill-switch-off": OPERATIONS,
  "operations:view": OPERATIONS,
  "governance:view": OPERATIONS,
  "measurement:view": OPERATIONS,
  "setup:grant-role": OWNER_ONLY,
};

export function pilotRolesForRouteAction(action: PilotRouteAction) {
  return POLICIES[action];
}

export async function requirePilotRouteAction(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  action: PilotRouteAction;
}) {
  return requirePilotRole({
    db: args.db,
    merchantId: args.merchantId,
    actor: args.actor,
    allowed: [...pilotRolesForRouteAction(args.action)],
  });
}
