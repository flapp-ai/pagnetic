export type SubscriptionPresentationInput = {
  status: string;
  verifiedAt?: string | null;
  periodEnd?: string | null;
  cancellationAt?: string | null;
  providerVerified?: boolean;
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Turns the verified managed-pricing contract into merchant-facing copy.
 * Dates are displayed only when supplied by the provider-backed loader.
 */
export function subscriptionPresentation(
  subscription: SubscriptionPresentationInput | null,
  now: Date = new Date(),
) {
  if (!subscription) {
    return {
      heading: "Free evaluation",
      detail: "No paid Shopify subscription has been verified.",
      requiresReapproval: false,
      date: null,
    };
  }

  const status = subscription.status.trim().toUpperCase();
  const date = subscription.periodEnd ? dateLabel(subscription.periodEnd) : null;
  const periodEnd = subscription.periodEnd ? new Date(subscription.periodEnd) : null;
  const expired = Boolean(periodEnd && Number.isFinite(periodEnd.getTime()) && periodEnd <= now);
  const cancellationDate = subscription.cancellationAt
    ? dateLabel(subscription.cancellationAt)
    : null;

  if ((status === "ACTIVE" || status === "CANCEL_AT_PERIOD_END") && expired) {
    return {
      heading: "Expired — reapproval required",
      detail: `Shopify's last confirmed access date was ${date ?? "unavailable"}. Review the plan before continuing.`,
      requiresReapproval: true,
      date,
    };
  }
  if (status === "ACTIVE" && date) {
    return {
      heading: "Active",
      detail: `Shopify has confirmed this plan through ${date}.`,
      requiresReapproval: false,
      date,
    };
  }
  if (status === "CANCEL_AT_PERIOD_END" && date) {
    return {
      heading: "Cancellation scheduled",
      detail: `Shopify has confirmed access through ${date}.`,
      requiresReapproval: false,
      date,
    };
  }
  if (status === "FREE_EVALUATION" && date && subscription.providerVerified !== false) {
    return {
      heading: "Free evaluation",
      detail: `Shopify has confirmed the evaluation through ${date}.`,
      requiresReapproval: false,
      date,
    };
  }
  if (status === "FREE_EVALUATION") {
    return {
      heading: "Free evaluation",
      detail: "This is a locally recorded evaluation; Shopify has not confirmed a paid subscription or end date.",
      requiresReapproval: false,
      date: null,
    };
  }
  if (status === "ACTIVE") {
    return {
      heading: "Active — date unavailable",
      detail: "Shopify has not supplied a verified billing end date. Review or reapprove the plan before relying on paid access.",
      requiresReapproval: true,
      date: null,
    };
  }
  if (status === "CANCEL_AT_PERIOD_END") {
    return {
      heading: "Cancellation scheduled — date unavailable",
      detail: "Shopify has confirmed cancellation, but has not supplied the access end date.",
      requiresReapproval: true,
      date: null,
    };
  }
  if (status === "PENDING_APPROVAL") {
    return {
      heading: "Reapproval required",
      detail: "Shopify is waiting for you to approve the plan.",
      requiresReapproval: true,
      date: null,
    };
  }

  const label = status === "CANCELED" ? "Canceled" : status.replaceAll("_", " ");
  return {
    heading: label || "Reapproval required",
    detail: cancellationDate
      ? `Shopify recorded cancellation on ${cancellationDate}. Review the plan to restore paid access.`
      : "Shopify has not confirmed an active paid plan. Review or reapprove the plan to continue.",
    requiresReapproval: true,
    date: null,
  };
}
