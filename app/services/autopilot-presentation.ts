import type { AutopilotPlanState } from "./autopilot";

export type MerchantAutopilotState =
  | "PREPARING"
  | "NEEDS_ENABLEMENT"
  | "MEASURING"
  | "RESULT_READY"
  | "NEEDS_ATTENTION";

export type MerchantStatusV2 = {
  state: MerchantAutopilotState;
  title: string;
  detail: string;
  severity: "neutral" | "success" | "attention" | "critical";
  serving: "ORIGINAL" | "TEST" | "APPROVED_MESSAGE";
  owner: "MERCHANT" | "PAGNETIC" | "WAITING_FOR_DATA" | "NONE";
  primaryAction: {
    id: string;
    label: string;
    href?: string;
    intent?: string;
  } | null;
  secondaryAction?: {
    id: string;
    label: string;
    href?: string;
    intent?: string;
  };
  nextCheckAt: string | null;
  blockers: Array<{
    code: string;
    customerText: string;
    evidenceRef?: string;
  }>;
  // Compatibility aliases for the current merchant route while v2 is gated.
  eyebrow: string;
  headline: string;
  action: string | null;
};

const BLOCKING_NOTICE_KINDS = new Set([
  "CANDIDATE_TIE",
  "SOURCE_CHANGED",
  "ACTIVATION_BLOCKED",
  "INSUFFICIENT_TRAFFIC",
  "PREPARATION_FAILED",
  "THEME_SAVE_REQUIRED",
  "AUTOMATED_ROLLBACK",
  "MEASUREMENT_HEALTH",
  "ORDER_RECOVERY",
  "AUTOMATION_FAILURE",
]);

export function isBlockingMerchantNotice(kind: string | null | undefined) {
  return Boolean(kind && BLOCKING_NOTICE_KINDS.has(kind));
}

export function shouldOfferThemeVerification(input: {
  planState: string;
  pendingQaChecks?: readonly string[] | null;
}) {
  if (["APPROVED", "WAITING_FOR_THEME"].includes(input.planState)) return true;
  if (input.planState !== "VERIFYING" || !input.pendingQaChecks) return false;
  return input.pendingQaChecks.some((check) =>
    ["placement", "original_fallback"].includes(check),
  );
}

function status(input: Omit<MerchantStatusV2, "headline" | "action">) {
  return {
    ...input,
    headline: input.title,
    action: input.primaryAction?.label ?? null,
  } satisfies MerchantStatusV2;
}

export function resultValueSemantics() {
  return {
    verified: {
      eyebrow: "Observed during this test",
      heading: "Verified in-test incremental revenue estimate",
      ariaLabel: "Verified in-test incremental revenue estimate",
      visualTreatment: "resultHero",
    },
    projected: {
      eyebrow: "Projected monthly upside at full rollout",
      heading: "Projection, not observed incremental revenue",
      ariaLabel: "Projected future value, not verified test value",
      visualTreatment: "projectionCard",
    },
  } as const;
}

export function presentPlanTimeline(input: {
  planState: AutopilotPlanState;
  v2: boolean;
  baselineComplete?: boolean;
  legacyQualificationBand: string;
  legacyDurationLabel: string;
}) {
  if (!input.v2) {
    return `${input.legacyQualificationBand.replaceAll("_", " ")} traffic · expected completion ${input.legacyDurationLabel}`;
  }
  if (input.planState === "RESULT_READY") return "Registered evidence complete";
  if (input.planState === "REAL_TEST_RUNNING")
    return "Message-test result window: 28–56 days from its activation";
  if (input.baselineComplete)
    return "Baseline complete · message-test result window: 28–56 days from its activation";
  if (input.planState === "AA_RUNNING")
    return "Baseline: 14 days + 14 days maturity · message test then takes 28–56 days";
  return "Registered measurement windows: 56–84 days after activation, plus any setup delay";
}

export function presentAutopilotState(input: {
  planState: AutopilotPlanState | null;
  hasCandidateTie?: boolean;
  openNoticeKind?: string | null;
}): MerchantStatusV2 {
  const planState = input.planState ?? "PREPARING";
  if (
    planState === "PREPARING" &&
    !input.hasCandidateTie &&
    !isBlockingMerchantNotice(input.openNoticeKind)
  ) {
    return status({
      state: "PREPARING" as const,
      eyebrow: "Preparing your opportunity",
      title: "Finding the safest product to improve first",
      detail:
        "Pagnetic is reading your catalog, checking source quality, and estimating whether a responsible test can finish.",
      severity: "neutral",
      serving: "ORIGINAL",
      owner: "PAGNETIC",
      primaryAction: null,
      nextCheckAt: null,
      blockers: [],
    });
  }
  if (
    input.hasCandidateTie ||
    isBlockingMerchantNotice(input.openNoticeKind) ||
    ["AA_FAILED", "INVALIDATED"].includes(planState)
  ) {
    const merchantOwned = new Set([
      "CANDIDATE_TIE",
      "SOURCE_CHANGED",
      "THEME_SAVE_REQUIRED",
    ]).has(input.openNoticeKind ?? "");
    const primaryAction = merchantOwned
      ? input.openNoticeKind === "THEME_SAVE_REQUIRED"
        ? {
            id: "open-theme-editor",
            label: "Open theme editor",
            intent: "open-theme-editor",
          }
        : {
            id: "review-required-item",
            label:
              input.openNoticeKind === "CANDIDATE_TIE"
                ? "Choose a product"
                : "Review updated source",
            href: "#attention",
          }
      : input.openNoticeKind === "INSUFFICIENT_TRAFFIC"
        ? null
        : {
            id: "contact-support",
            label: "Contact Pagnetic support",
            href: "/support",
          };
    return status({
      state: "NEEDS_ATTENTION" as const,
      eyebrow: "One item needs attention",
      title:
        planState === "AA_FAILED"
          ? "Measurement validation needs to be resolved"
          : "Pagnetic paused before making an unsafe change",
      detail:
        input.openNoticeKind === "INSUFFICIENT_TRAFFIC"
          ? "The original storefront remains active. This product is preview-only until its measurement baseline is sufficient."
          : merchantOwned
            ? "The original storefront remains active. Complete the named step below to continue."
            : "The original storefront remains active while Pagnetic resolves the measurement blocker.",
      severity: planState === "INVALIDATED" ? "critical" : "attention",
      serving: "ORIGINAL",
      owner: merchantOwned
        ? "MERCHANT"
        : input.openNoticeKind === "INSUFFICIENT_TRAFFIC"
          ? "NONE"
          : "PAGNETIC",
      primaryAction,
      nextCheckAt: null,
      blockers: [
        {
          code:
            input.openNoticeKind ??
            (planState === "AA_FAILED" ? "AA_FAILED" : "INVALIDATED"),
          customerText:
            input.openNoticeKind === "INSUFFICIENT_TRAFFIC"
              ? "The selected product does not yet have enough eligible baseline traffic."
              : "The test cannot continue safely until this item is resolved.",
        },
      ],
    });
  }
  if (planState === "READY_FOR_APPROVAL") {
    return status({
      state: "PREPARING" as const,
      eyebrow: "Opportunity ready",
      title: "Review one product opportunity",
      detail:
        "Approve the exact sourced message and bounded test plan before anything can appear to shoppers.",
      severity: "neutral",
      serving: "ORIGINAL",
      owner: "MERCHANT",
      primaryAction: {
        id: "review-opportunity",
        label: "Review opportunity",
        href: "#opportunity",
      },
      nextCheckAt: null,
      blockers: [],
    });
  }
  if (["APPROVED", "WAITING_FOR_THEME"].includes(planState)) {
    return status({
      state: "NEEDS_ENABLEMENT" as const,
      eyebrow: "One Shopify step",
      title: "Enable the panel on your published product template",
      detail: "Preview the panel, click Save in Shopify, then return here.",
      severity: "attention",
      serving: "ORIGINAL",
      owner: "MERCHANT",
      primaryAction: {
        id: "open-theme-editor",
        label: "Open theme editor",
        intent: "open-theme-editor",
      },
      nextCheckAt: null,
      blockers: [
        {
          code: "THEME_SAVE_REQUIRED",
          customerText:
            "Save the Pagnetic block on the selected published product template.",
        },
      ],
    });
  }
  if (planState === "PAUSED") {
    return status({
      state: "NEEDS_ATTENTION",
      eyebrow: "Measurement paused",
      title: "Your original storefront is serving",
      detail:
        "Resume only when you are ready to begin a new safe measurement run under a reviewed plan.",
      severity: "attention",
      serving: "ORIGINAL",
      owner: "MERCHANT",
      primaryAction: {
        id: "resume-plan",
        label: "Resume safely",
        intent: "resume-plan",
      },
      nextCheckAt: null,
      blockers: [{ code: "PAUSED", customerText: "Measurement is paused." }],
    });
  }
  if (["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING"].includes(planState)) {
    const verifying = planState === "VERIFYING";
    return status({
      state: "MEASURING" as const,
      eyebrow:
        planState === "AA_RUNNING"
          ? "Checking measurement"
          : planState === "REAL_TEST_RUNNING"
            ? "Measuring additional revenue"
            : "Verifying storefront",
      title: verifying
        ? "Pagnetic is verifying the storefront setup"
        : "Pagnetic is collecting the registered evidence",
      detail: verifying
        ? "Pagnetic owns the next check. The original storefront remains active until every measurement gate passes."
        : "The registered sample and maturity window determine completion. Early movement cannot change the stopping rule.",
      severity: "neutral",
      serving: verifying || planState === "AA_RUNNING" ? "ORIGINAL" : "TEST",
      owner: verifying ? "PAGNETIC" : "WAITING_FOR_DATA",
      primaryAction: null,
      nextCheckAt: null,
      blockers: [],
    });
  }
  return status({
    state: "RESULT_READY" as const,
    eyebrow: "Result ready",
    title: "Your first measured outcome is ready",
    detail:
      "Review the verified in-test estimate separately from any projected future upside.",
    severity: "success",
    serving: "ORIGINAL",
    owner: "MERCHANT",
    primaryAction: {
      id: "review-result",
      label: "Review result",
      href: "#result-title",
    },
    nextCheckAt: null,
    blockers: [],
  });
}
