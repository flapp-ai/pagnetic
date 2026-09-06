const EFFECT_RESULT_STATES = new Set(["POSITIVE", "NEGATIVE", "INCONCLUSIVE"]);

export type FrozenResultSnapshotLike = {
  id: string;
  experimentId: string;
  resultState: string;
  payloadJson: string;
};

export function resolveFrozenResultSnapshot<T extends FrozenResultSnapshotLike>(args: {
  experimentId: string;
  finalResultSnapshotId: string | null;
  snapshots: T[];
}) {
  if (!args.finalResultSnapshotId) return null;
  return args.snapshots.find(
    (snapshot) =>
      snapshot.id === args.finalResultSnapshotId &&
      snapshot.experimentId === args.experimentId,
  ) ?? null;
}

export function canPresentMonetaryResult(args: {
  frozenResultState: string;
  payloadResultState?: string;
  estimatedAdditionalSalesMinor?: string;
}) {
  return (
    EFFECT_RESULT_STATES.has(args.frozenResultState) &&
    args.payloadResultState === args.frozenResultState &&
    typeof args.estimatedAdditionalSalesMinor === "string" &&
    /^-?\d+$/.test(args.estimatedAdditionalSalesMinor)
  );
}

export function formatMinorAmount(
  minor: string | number | undefined,
  currency = "",
) {
  if (minor == null) return "Not available";
  if (typeof minor === "string" && !/^-?\d+$/.test(minor)) {
    return "Not available";
  }
  if (typeof minor === "number" && !Number.isFinite(minor)) {
    return "Not available";
  }
  const amount = Number(minor) / 100;
  if (!Number.isFinite(amount)) return "Not available";
  return `${amount.toFixed(2)} ${currency}`.trim();
}

export type FinalizationReviewAuditLike = {
  createdAt: Date;
  detailsJson: string;
};

export function findFinalizationReviewNotice(args: {
  experimentId: string;
  finalResultSnapshotId: string;
  audits: FinalizationReviewAuditLike[];
}) {
  for (const audit of args.audits) {
    try {
      const details = JSON.parse(audit.detailsJson) as {
        experimentId?: string;
        finalResultSnapshotId?: string;
        revisionHash?: string;
        reviewRequired?: boolean;
      };
      if (
        details.reviewRequired === true &&
        details.experimentId === args.experimentId &&
        details.finalResultSnapshotId === args.finalResultSnapshotId
      ) {
        return {
          detectedAt: audit.createdAt.toISOString(),
          reference: details.revisionHash?.slice(0, 12) ?? "unavailable",
        };
      }
    } catch {
      // Invalid audit details are not merchant-facing authority.
    }
  }
  return null;
}
