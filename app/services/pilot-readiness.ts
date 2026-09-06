export type PilotReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export function assessPilotLaunchReadiness(input: {
  hasRegistration: boolean;
  brandProfileApproved: boolean;
  pixelActive: boolean;
  killSwitchActive: boolean;
  productQualified: boolean;
  themeActive: boolean;
  qaComplete: boolean;
  incidentContactConfigured: boolean;
  productionEnvironmentReady: boolean;
  frozenConfigurationCurrent: boolean;
  requiresAaValidation: boolean;
  requiresUniversal: boolean;
  universalApproved: boolean;
  requiresMatched: boolean;
  matchedApprovedCount: number;
  activeMappings: number;
  aaValidated: boolean;
  stageOnePositive: boolean;
}) {
  const checks: PilotReadinessCheck[] = [
    {
      key: "brand",
      label: "Approved brand profile",
      passed: input.brandProfileApproved,
      detail: input.brandProfileApproved
        ? "The merchant approved the generated brand profile."
        : "Sync the catalog and approve the generated brand profile.",
    },
    {
      key: "qualification",
      label: "Product qualification",
      passed: input.productQualified,
      detail: input.productQualified
        ? "Product traffic and baseline support the registered test."
        : "Complete product qualification or record an approved override.",
    },
    {
      key: "theme",
      label: "Published theme",
      passed: input.themeActive,
      detail: input.themeActive
        ? "Adaptive Panel is active on the published theme."
        : "Verify the Adaptive Panel on the published product template.",
    },
    {
      key: "qa",
      label: "Pilot QA",
      passed: input.qaComplete,
      detail: input.qaComplete
        ? "All required browser, checkout, consent, fallback, accessibility, and performance checks passed."
        : "Complete the required pilot QA evidence matrix.",
    },
    {
      key: "contact",
      label: "Incident contact",
      passed: input.incidentContactConfigured,
      detail: input.incidentContactConfigured
        ? "A merchant incident contact is recorded."
        : "Record the merchant incident contact.",
    },
    {
      key: "production",
      label: "Production environment",
      passed: input.productionEnvironmentReady,
      detail: input.productionEnvironmentReady
        ? "Hosting, secrets, database, backups, automation, and alerts are configured."
        : "Complete every production environment check in Setup and qualification.",
    },
    {
      key: "frozenConfig",
      label: "Frozen content and mappings",
      passed: input.frozenConfigurationCurrent,
      detail: input.frozenConfigurationCurrent
        ? "Active content and mappings match the registered snapshot."
        : "Content or campaign mappings changed after registration; create a new experiment version.",
    },
    {
      key: "registration",
      label: "Frozen registration",
      passed: input.hasRegistration,
      detail: input.hasRegistration
        ? "Protocol and analysis plan are frozen."
        : "Register the protocol before launch.",
    },
    {
      key: "pixel",
      label: "Measurement endpoint",
      passed: input.pixelActive,
      detail: input.pixelActive
        ? "Web Pixel is active."
        : "Reconnect the Web Pixel.",
    },
    {
      key: "killSwitch",
      label: "Runtime enabled",
      passed: !input.killSwitchActive,
      detail: input.killSwitchActive
        ? "Clear the merchant kill switch before launch."
        : "Original fallback remains available.",
    },
  ];
  if (input.requiresAaValidation) {
    checks.push({
      key: "aa",
      label: "A/A validation",
      passed: input.aaValidated,
      detail: input.aaValidated
        ? "A/A validation has a mature passing snapshot."
        : "A mature VALIDATED A/A snapshot is required.",
    });
  }
  if (input.requiresUniversal) {
    checks.push({
      key: "universal",
      label: "Universal bundle",
      passed: input.universalApproved,
      detail: input.universalApproved
        ? "An approved universal bundle is frozen."
        : "Approve the universal bundle for this product.",
    });
  }
  if (input.requiresMatched) {
    checks.push(
      {
        key: "matched",
        label: "Matched bundles",
        passed: input.matchedApprovedCount >= 3,
        detail: `${input.matchedApprovedCount} of 3 required matched angle bundles approved.`,
      },
      {
        key: "mappings",
        label: "Campaign mappings",
        passed: input.activeMappings >= 1,
        detail: `${input.activeMappings} active campaign mapping(s).`,
      },
      {
        key: "stageOne",
        label: "Stage 1 evidence",
        passed: input.stageOnePositive,
        detail: input.stageOnePositive
          ? "Stage 1 has a mature positive snapshot."
          : "Stage 2 requires a mature positive Stage 1 result.",
      },
    );
  }
  return { checks, ready: checks.every((check) => check.passed) };
}
