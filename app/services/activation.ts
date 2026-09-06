export type ActivationStep = {
  key: string;
  number: number;
  label: string;
  detail: string;
  complete: boolean;
  href: string;
  cta: string;
};

export type ActivationFacts = {
  catalogSynced: boolean;
  heroSelected: boolean;
  brandApproved: boolean;
  draftLibraryCreated: boolean;
  contentApproved: boolean;
  productQualified: boolean;
  themeActive: boolean;
  qaComplete: boolean;
  pixelActive: boolean;
  aaRegistered: boolean;
  aaValidated: boolean;
  realResultReady: boolean;
};

export function buildActivationJourney(facts: ActivationFacts) {
  const steps: ActivationStep[] = [
    {
      key: "catalog",
      number: 1,
      label: "Bring in one product",
      detail:
        "Sync the current Shopify catalog and choose the product you want to improve first.",
      complete: facts.catalogSynced && facts.heroSelected,
      href: "/app/get-started#catalog",
      cta: facts.catalogSynced ? "Choose hero product" : "Sync catalog",
    },
    {
      key: "preview",
      number: 2,
      label: "See your message angles",
      detail:
        "Generate source-bound Universal, Comfort, Performance, and Value drafts before touching the storefront.",
      complete: facts.brandApproved && facts.draftLibraryCreated,
      href: "/app/get-started#preview",
      cta: facts.brandApproved
        ? "Create preview library"
        : "Approve brand profile",
    },
    {
      key: "approve",
      number: 3,
      label: "Approve what shoppers may see",
      detail:
        "Review every statement and evidence trace. Drafts can never reach shoppers.",
      complete: facts.contentApproved,
      href: "/app/governance",
      cta: "Review content",
    },
    {
      key: "qualify",
      number: 4,
      label: "Check whether a test can finish",
      detail:
        "Use PDP sessions and orders to estimate a realistic sample window before starting.",
      complete: facts.productQualified,
      href: "/app/setup",
      cta: "Qualify product",
    },
    {
      key: "activate",
      number: 5,
      label: "Activate without checkout risk",
      detail:
        "Add the theme block, verify the pixel, and complete the checkout, consent, fallback, and performance checks.",
      complete: facts.themeActive && facts.qaComplete && facts.pixelActive,
      href: "/app/setup",
      cta: "Complete activation QA",
    },
    {
      key: "validate",
      number: 6,
      label: "Validate measurement with A/A",
      detail:
        "Both arms remain original while the app proves assignment, event, and order joins are trustworthy.",
      complete: facts.aaRegistered && facts.aaValidated,
      href: "/app/measurement",
      cta: facts.aaRegistered ? "Monitor A/A" : "Register A/A",
    },
    {
      key: "result",
      number: 7,
      label: "Run the first real comparison",
      detail:
        "Only a mature Original-versus-Universal result ends the free-until-result period.",
      complete: facts.realResultReady,
      href: "/app/operations",
      cta: "Open pilot operations",
    },
  ];
  const completed = steps.filter((step) => step.complete).length;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    next: steps.find((step) => !step.complete) ?? null,
  };
}
