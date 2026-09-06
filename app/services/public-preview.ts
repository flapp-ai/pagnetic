import {
  diagnoseProductMessage,
  type DiagnosisSource,
} from "./message-diagnosis-v2";

export type PreviewSource = DiagnosisSource;

export type PreviewCard = {
  key: "original" | "primary" | "alternative";
  label: string;
  audience: string;
  headline: string;
  supportingLine: string | null;
  benefits: string[];
  evidence: string[];
};

const ANGLE_LABELS = {
  original: { label: "Original", audience: "Your current product message" },
  primary: {
    label: "Proposed change",
    audience: "The strongest source-backed opportunity",
  },
  alternative: {
    label: "Alternative",
    audience: "One materially different source-backed option",
  },
} as const;

export function normalizePreviewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function previewStatements(description: string) {
  const normalized = normalizePreviewText(description);
  if (!normalized) return [];
  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+|\s*[•·]\s*|\s+[-–—]\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 12 && value.length <= 280);
  return [...new Set(sentenceParts)].slice(0, 8);
}

export function buildPublicPreviews(
  source: PreviewSource,
  campaignAdText?: string | null,
) {
  const diagnosis = diagnoseProductMessage({ source, campaignAdText });
  const evidenceById = new Map(
    diagnosis.sourceSpans.map((span) => [span.id, span.text]),
  );
  const cards: PreviewCard[] = [
    {
      key: "original",
      ...ANGLE_LABELS.original,
      headline: diagnosis.current.headline,
      supportingLine: diagnosis.current.supportingLine,
      benefits: diagnosis.current.benefits,
      evidence: diagnosis.current.evidenceSpanIds.flatMap((id) =>
        evidenceById.has(id) ? [evidenceById.get(id)!] : [],
      ),
    },
    ...[diagnosis.primary, diagnosis.alternative].flatMap((candidate) =>
      candidate
        ? [{
            key: candidate.key,
            ...ANGLE_LABELS[candidate.key],
            headline: candidate.headline,
            supportingLine: candidate.supportingLine,
            benefits: candidate.benefits,
            evidence: candidate.evidenceSpanIds.flatMap((id) =>
              evidenceById.has(id) ? [evidenceById.get(id)!] : [],
            ),
          } satisfies PreviewCard]
        : [],
    ),
  ];
  const statements = previewStatements(source.description);
  const findings = [
    {
      label: "Specific opportunity",
      passed: diagnosis.status === "PROPOSED",
      detail: diagnosis.rationale,
    },
    {
      label: "Evidence trace",
      passed: diagnosis.blockedSpanIds.length === 0,
      detail: diagnosis.blockedSpanIds.length
        ? `${diagnosis.blockedSpanIds.length} unsafe or instruction-like source span(s) were excluded.`
        : "Every proposed sentence links to exact supplied product evidence.",
    },
    {
      label: "Distinct treatment",
      passed:
        Boolean(diagnosis.primary) &&
        !diagnosis.findings.some((finding) =>
          ["EXACT_DUPLICATE_TREATMENT", "NEAR_DUPLICATE_REVIEW"].includes(
            finding.code,
          ),
        ),
      detail: diagnosis.primary
        ? diagnosis.findings.some(
            (finding) => finding.code === "NEAR_DUPLICATE_REVIEW",
          )
          ? "The proposed copy is source-backed but needs review because it is very similar to the current message."
          : "The proposal changes the lead message instead of relabeling identical copy."
        : diagnosis.requestedSource ?? "No separate treatment was created.",
    },
  ];
  return {
    score: diagnosis.status === "PROPOSED" ? 100 : 0,
    readiness:
      diagnosis.status === "PROPOSED"
        ? "PREVIEW_READY"
        : "SOURCE_WORK_NEEDED",
    statements,
    findings,
    cards,
    diagnosis,
  };
}
