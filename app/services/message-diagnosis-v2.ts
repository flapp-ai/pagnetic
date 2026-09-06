import { createHash } from "node:crypto";

export const MESSAGE_DIAGNOSIS_RULES_VERSION = "message-diagnosis-v2.2";
export const DETERMINISTIC_MESSAGE_ADAPTER_VERSION =
  "deterministic-source-composer-v2.2";

export type DiagnosisMode = "CLARITY_REVIEW" | "CAMPAIGN_MESSAGE_REVIEW";
export type DiagnosisGap =
  | "BENEFIT_NOT_PROMINENT"
  | "OBJECTION_UNANSWERED"
  | "CAMPAIGN_PROMISE_NOT_REFLECTED"
  | "NO_SUPPORTED_OPPORTUNITY";

export type DiagnosisSource = {
  title: string;
  description: string;
  vendor?: string | null;
  productType?: string | null;
  sourceVersion?: string;
  productRef?: string;
  locale?: string;
};

export type SourceSpan = {
  id: string;
  field: "TITLE" | "DESCRIPTION" | "VENDOR" | "PRODUCT_TYPE";
  text: string;
  position: number;
  sourceVersion: string;
  productRef: string;
  riskClass: "LOW" | "HIGH" | "PROHIBITED";
};

export type MessageCandidate = {
  key: "primary" | "alternative";
  headline: string;
  supportingLine: string | null;
  benefits: string[];
  reassurance: string | null;
  evidenceSpanIds: string[];
  contentHash: string;
  nearDuplicateSimilarity: number;
  explanations: string[];
};

export type MessageDiagnosis = {
  mode: DiagnosisMode;
  status:
    | "PROPOSED"
    | "NO_SUPPORTED_OPPORTUNITY"
    | "UNSUPPORTED_SOURCE";
  gapType: DiagnosisGap;
  rationale: string;
  requestedSource: string | null;
  sourceSpans: SourceSpan[];
  blockedSpanIds: string[];
  current: MessageCandidate;
  primary: MessageCandidate | null;
  alternative: MessageCandidate | null;
  findings: Array<{ code: string; detail: string }>;
  rulesVersion: string;
  adapterVersion: string;
};

export type MessageProposalAdapter = {
  id: string;
  proposeMessage(args: {
    evidence: SourceSpan[];
    campaign: string | null;
    constraints: {
      maximumCandidates: 2;
      minimumBenefits: 2;
      maximumBenefits: 4;
      sourceOnly: true;
    };
  }): Promise<MessageCandidate[]>;
};

const STOP_WORDS = new Set([
  "about", "after", "all", "and", "are", "but", "buy", "for", "from",
  "get", "have", "into", "its", "now", "our", "that", "the", "their",
  "this", "with", "you", "your",
]);

const OBJECTION_WORDS = new Set([
  "care", "compatible", "easy", "fit", "guarantee", "included", "returns",
  "size", "sizing", "warranty", "washable", "waterproof",
]);

const HIGH_RISK_PATTERN =
  /\b(cure[sd]?|diagnos(?:e|es|ed|is)|prevent(?:s|ed)? disease|treat(?:s|ed)?|clinically proven|guaranteed results?|risk[- ]free)\b/i;
const INSTRUCTION_PATTERN =
  /(?:<\s*script\b|javascript\s*:|ignore (?:all |any )?(?:previous|prior) instructions?|system prompt|developer message|execute (?:this )?(?:command|code)|BEGIN [A-Z ]*INSTRUCTIONS)/i;
const EXCLUDED_CATEGORY_PATTERN =
  /\b(alcohol|cbd|medical device|medicine|nicotine|supplement|tobacco|weapon)\b/i;

export function validateCampaignEvidenceInput(
  value: string,
  locale = "en",
) {
  const text = clean(value, 2_001);
  if (!text) throw new Error("Paste the exact campaign or ad message.");
  if (text.length > 2_000)
    throw new Error("Campaign or ad text must be 2,000 characters or fewer.");
  if (unsupportedLocale(locale))
    throw new Error("Campaign evidence currently supports English only.");
  if (INSTRUCTION_PATTERN.test(text))
    throw new Error("Campaign evidence contains instruction-like or executable text.");
  if (HIGH_RISK_PATTERN.test(text))
    throw new Error("Campaign evidence contains a high-risk claim outside the MVP scope.");
  return {
    text,
    locale: locale.toLowerCase(),
    contentHash: createHash("sha256").update(text).digest("hex"),
  };
}

function clean(value: string, maximum = 4_000) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function comparable(value: string) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(
    comparable(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function tokenSetSimilarity(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return comparable(left) === comparable(right) ? 1 : 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / union.size;
}

function sourceRisk(text: string): SourceSpan["riskClass"] {
  if (INSTRUCTION_PATTERN.test(text)) return "PROHIBITED";
  if (HIGH_RISK_PATTERN.test(text)) return "HIGH";
  return "LOW";
}

const PERIOD_ABBREVIATION =
  /(?:\b(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|sr|jr|inc|ltd|co|no)\.|(?:\b[A-Za-z]\.){2,})$/i;

function sentenceBoundaryAt(text: string, index: number) {
  const punctuation = text[index];
  if (![".", "!", "?"].includes(punctuation ?? "")) return false;
  const following = text.slice(index + 1);
  const nextOffset = following.search(/\S/);
  if (nextOffset < 0) return true;
  const next = following[nextOffset]!;
  const nextIndex = index + 1 + nextOffset;
  if (punctuation === ".") {
    if (/\d/.test(text[index - 1] ?? "") && /\d/.test(next)) return false;
    if (/[A-Z]/.test(next) && text[nextIndex + 1] === ".") return false;
    if (PERIOD_ABBREVIATION.test(text.slice(0, index + 1))) return false;
  }
  return nextOffset > 0 || /[A-Z]/.test(next);
}

export function descriptionSentences(description: string) {
  const normalized = clean(description);
  const parts = normalized.split(/\s*[•·]\s*|\s+[-–—]\s+/);
  const sentences: string[] = [];
  for (const part of parts) {
    let start = 0;
    for (let index = 0; index < part.length; index += 1) {
      if (!sentenceBoundaryAt(part, index)) continue;
      sentences.push(part.slice(start, index + 1));
      start = index + 1;
      while (/\s/.test(part[start] ?? "")) start += 1;
    }
    if (start < part.length) sentences.push(part.slice(start));
  }
  return sentences
    .map((value) => clean(value, 280))
    .filter((value) => value.length >= 12);
}

export function extractDiagnosisSourceSpans(source: DiagnosisSource) {
  const sourceVersion = clean(source.sourceVersion ?? "public-current", 160);
  const productRef = clean(source.productRef ?? "public-product", 300);
  const candidates: Array<Omit<SourceSpan, "id" | "riskClass">> = [
    {
      field: "TITLE" as const,
      text: clean(source.title, 160),
      position: 0,
      sourceVersion,
      productRef,
    },
    ...descriptionSentences(source.description).map((text, position) => ({
      field: "DESCRIPTION" as const,
      text,
      position,
      sourceVersion,
      productRef,
    })),
    ...(source.vendor
      ? [{
          field: "VENDOR" as const,
          text: `Vendor: ${clean(source.vendor, 120)}.`,
          position: 0,
          sourceVersion,
          productRef,
        }]
      : []),
    ...(source.productType
      ? [{
          field: "PRODUCT_TYPE" as const,
          text: `Product type: ${clean(source.productType, 120)}.`,
          position: 0,
          sourceVersion,
          productRef,
        }]
      : []),
  ].filter((span) => span.text);

  const seen = new Set<string>();
  return candidates.flatMap((span) => {
    const normalized = comparable(span.text);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    const id = createHash("sha256")
      .update(JSON.stringify({ ...span, text: clean(span.text) }))
      .digest("hex")
      .slice(0, 24);
    return [{ ...span, id, riskClass: sourceRisk(span.text) }];
  });
}

function candidate(args: {
  key: MessageCandidate["key"];
  lead: SourceSpan;
  supporting: SourceSpan[];
  currentText: string;
  explanation: string;
}) {
  const benefits = args.supporting
    .filter((span) => span.id !== args.lead.id)
    .slice(0, 4)
    .map((span) => span.text);
  const body = [args.lead.text, ...benefits].join("\n");
  return {
    key: args.key,
    headline: args.lead.text,
    supportingLine: null,
    benefits,
    reassurance: null,
    evidenceSpanIds: [args.lead, ...args.supporting]
      .filter(
        (span, index, all) =>
          all.findIndex((candidate) => candidate.id === span.id) === index,
      )
      .slice(0, 5)
      .map((span) => span.id),
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateSimilarity: Number(
      tokenSetSimilarity(body, args.currentText).toFixed(4),
    ),
    explanations: [args.explanation, "Every displayed fact is linked to an exact source span."],
  } satisfies MessageCandidate;
}

function emptyCurrent(source: DiagnosisSource, spans: SourceSpan[]) {
  const title = spans.find((span) => span.field === "TITLE")?.text ?? clean(source.title, 160);
  const descriptions = spans.filter((span) => span.field === "DESCRIPTION");
  const body = [title, ...descriptions.map((span) => span.text)].join("\n");
  return {
    key: "primary" as const,
    headline: title,
    supportingLine: descriptions[0]?.text ?? null,
    benefits: descriptions.slice(1, 5).map((span) => span.text),
    reassurance: null,
    evidenceSpanIds: spans.slice(0, 6).map((span) => span.id),
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateSimilarity: 1,
    explanations: ["Current source order reconstructed from the supplied product text."],
  };
}

function unsupportedLocale(locale: string | undefined) {
  if (!locale) return false;
  const normalized = locale.toLowerCase();
  return normalized !== "en" && !normalized.startsWith("en-");
}

function contradictoryDescription(spans: SourceSpan[]) {
  for (let leftIndex = 0; leftIndex < spans.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < spans.length; rightIndex += 1) {
      const left = comparable(spans[leftIndex]!.text);
      const right = comparable(spans[rightIndex]!.text);
      const leftNegative = /\b(no|not|never|without)\b/.test(left);
      const rightNegative = /\b(no|not|never|without)\b/.test(right);
      if (
        leftNegative !== rightNegative &&
        overlap(tokens(left), tokens(right)) >= 0.4
      ) return true;
    }
  }
  return false;
}

export function diagnoseProductMessage(args: {
  source: DiagnosisSource;
  campaignAdText?: string | null;
}): MessageDiagnosis {
  const campaign = clean(args.campaignAdText ?? "", 2_001);
  if (campaign.length > 2_000)
    throw new Error("Campaign or ad text must be 2,000 characters or fewer.");
  const mode: DiagnosisMode = campaign
    ? "CAMPAIGN_MESSAGE_REVIEW"
    : "CLARITY_REVIEW";
  const spans = extractDiagnosisSourceSpans(args.source);
  const current = emptyCurrent(args.source, spans);
  const blocked = spans.filter((span) => span.riskClass !== "LOW");
  const eligible = spans.filter(
    (span) => span.field === "DESCRIPTION" && span.riskClass === "LOW",
  );
  const findings = blocked.map((span) => ({
    code: span.riskClass === "PROHIBITED" ? "SOURCE_INSTRUCTION_BLOCKED" : "HIGH_RISK_CLAIM_BLOCKED",
    detail: `A ${span.field.toLowerCase()} source span was excluded from draft composition.`,
  }));

  const categoryExcluded = EXCLUDED_CATEGORY_PATTERN.test(
    `${args.source.productType ?? ""} ${args.source.title}`,
  );
  const hasContradiction = contradictoryDescription(eligible);
  if (
    unsupportedLocale(args.source.locale) ||
    categoryExcluded ||
    hasContradiction
  ) {
    const unsupportedReason = unsupportedLocale(args.source.locale)
      ? "This preview currently supports English product evidence only."
      : categoryExcluded
        ? "This product category is outside the low-claims-risk MVP scope."
        : "The product description contains contradictory factual statements.";
    const unsupportedFinding = unsupportedLocale(args.source.locale)
      ? { code: "UNSUPPORTED_LOCALE", detail: `Locale ${args.source.locale} is not supported.` }
      : categoryExcluded
        ? { code: "EXCLUDED_CATEGORY", detail: "The declared product category is outside the MVP scope." }
        : { code: "CONTRADICTORY_SOURCE", detail: "Resolve contradictory product facts before drafting." };
    return {
      mode,
      status: "UNSUPPORTED_SOURCE",
      gapType: "NO_SUPPORTED_OPPORTUNITY",
      rationale: unsupportedReason,
      requestedSource: unsupportedLocale(args.source.locale)
        ? "Use an English product description or wait for declared locale support."
        : categoryExcluded
          ? "Use preview-only mode; this category is not eligible for the initial experiment workflow."
          : "Correct the conflicting product statements and refresh the source.",
      sourceSpans: spans,
      blockedSpanIds: blocked.map((span) => span.id),
      current,
      primary: null,
      alternative: null,
      findings: [...findings, unsupportedFinding],
      rulesVersion: MESSAGE_DIAGNOSIS_RULES_VERSION,
      adapterVersion: DETERMINISTIC_MESSAGE_ADAPTER_VERSION,
    };
  }

  const currentText = [current.headline, current.supportingLine, ...current.benefits]
    .filter(Boolean)
    .join("\n");
  let gapType: DiagnosisGap = "BENEFIT_NOT_PROMINENT";
  let ranked = [...eligible];
  let rationale =
    "A supported benefit appears later in the product description and can be made more prominent.";

  if (campaign) {
    const campaignTokens = tokens(campaign);
    ranked = eligible
      .map((span) => ({ span, relevance: overlap(campaignTokens, tokens(span.text)) }))
      .sort(
        (left, right) =>
          right.relevance - left.relevance ||
          left.span.position - right.span.position ||
          left.span.text.length - right.span.text.length,
      )
      .filter(({ relevance }) => relevance > 0)
      .map(({ span }) => span);
    gapType = "CAMPAIGN_PROMISE_NOT_REFLECTED";
    rationale =
      "The supplied campaign language matches a supported product fact that is not the current lead message.";
  } else {
    const objections = eligible.filter((span) =>
      [...tokens(span.text)].some((token) => OBJECTION_WORDS.has(token)),
    );
    const laterObjection = objections.find((span) => span.position > 0);
    if (laterObjection) {
      gapType = "OBJECTION_UNANSWERED";
      ranked = [laterObjection, ...eligible.filter((span) => span.id !== laterObjection.id)];
      rationale =
        "A supported reassurance or fit detail appears later in the description instead of answering the concern early.";
    } else {
      ranked = [...eligible].sort(
        (left, right) =>
          Number(right.position > 0) - Number(left.position > 0) ||
          left.text.length - right.text.length ||
          left.position - right.position,
      );
    }
  }

  const lead = ranked[0];
  const support = eligible.filter((span) => span.id !== lead?.id);
  if (!lead || support.length < 2) {
    const requestedSource = campaign
      ? "Add a product fact that explicitly supports the campaign promise, or revise the campaign input."
      : "Add at least three specific, factual product benefits or reassurances to the product description.";
    return {
      mode,
      status: "NO_SUPPORTED_OPPORTUNITY",
      gapType: "NO_SUPPORTED_OPPORTUNITY",
      rationale: "The current source does not support a materially useful, evidence-linked change.",
      requestedSource,
      sourceSpans: spans,
      blockedSpanIds: blocked.map((span) => span.id),
      current,
      primary: null,
      alternative: null,
      findings: [...findings, { code: "NO_MATERIAL_SUPPORTED_CHANGE", detail: requestedSource }],
      rulesVersion: MESSAGE_DIAGNOSIS_RULES_VERSION,
      adapterVersion: DETERMINISTIC_MESSAGE_ADAPTER_VERSION,
    };
  }

  const primary = candidate({
    key: "primary",
    lead,
    supporting: support,
    currentText,
    explanation: rationale,
  });
  const alternativeLead = ranked.find(
    (span) =>
      span.id !== lead.id &&
      span.position > 0 &&
      tokenSetSimilarity(span.text, lead.text) < 0.9,
  );
  const alternative = alternativeLead
    ? candidate({
        key: "alternative",
        lead: alternativeLead,
        supporting: eligible.filter((span) => span.id !== alternativeLead.id),
        currentText,
        explanation: "A materially different supported lead is available for merchant review.",
      })
    : null;

  if (primary.contentHash === current.contentHash) {
    return {
      mode,
      status: "NO_SUPPORTED_OPPORTUNITY",
      gapType: "NO_SUPPORTED_OPPORTUNITY",
      rationale: "The proposed source-backed body is identical to the current message.",
      requestedSource: "Provide one additional specific product fact for a useful intervention.",
      sourceSpans: spans,
      blockedSpanIds: blocked.map((span) => span.id),
      current,
      primary: null,
      alternative: null,
      findings: [...findings, { code: "EXACT_DUPLICATE_TREATMENT", detail: "No separate treatment was created." }],
      rulesVersion: MESSAGE_DIAGNOSIS_RULES_VERSION,
      adapterVersion: DETERMINISTIC_MESSAGE_ADAPTER_VERSION,
    };
  }

  return {
    mode,
    status: "PROPOSED",
    gapType,
    rationale,
    requestedSource: null,
    sourceSpans: spans,
    blockedSpanIds: blocked.map((span) => span.id),
    current,
    primary,
    alternative,
    findings: primary.nearDuplicateSimilarity >= 0.9
      ? [...findings, { code: "NEAR_DUPLICATE_REVIEW", detail: "The proposed and current messages share at least 90% of their normalized tokens." }]
      : findings,
    rulesVersion: MESSAGE_DIAGNOSIS_RULES_VERSION,
    adapterVersion: DETERMINISTIC_MESSAGE_ADAPTER_VERSION,
  };
}

export function deterministicMessageAdapter(): MessageProposalAdapter {
  return {
    id: DETERMINISTIC_MESSAGE_ADAPTER_VERSION,
    async proposeMessage({ evidence, campaign }) {
      const source: DiagnosisSource = {
        title: evidence.find((span) => span.field === "TITLE")?.text ?? "",
        description: evidence
          .filter((span) => span.field === "DESCRIPTION")
          .sort((left, right) => left.position - right.position)
          .map((span) => span.text)
          .join(" "),
        sourceVersion: evidence[0]?.sourceVersion,
        productRef: evidence[0]?.productRef,
      };
      const diagnosis = diagnoseProductMessage({ source, campaignAdText: campaign });
      return [diagnosis.primary, diagnosis.alternative].filter(
        (item): item is MessageCandidate => Boolean(item),
      );
    },
  };
}
