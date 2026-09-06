import type { PrismaClient } from "@prisma/client";

import { ADAPTIVE_EXPERIMENT_QUESTIONS } from "./adaptive-contracts";
import {
  registerV2Experiment,
  type RegisteredContentV2,
} from "./experiment-registration-v2.server";

export type AdaptiveExperimentComparison = keyof typeof ADAPTIVE_EXPERIMENT_QUESTIONS;

/**
 * Registers one of the two prospective adaptive questions without allowing a
 * caller to reuse the other question's wording or policy labels.
 */
export async function registerAdaptiveExperiment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  key: string;
  comparison: AdaptiveExperimentComparison;
  minimumMeaningfulLift: number;
  alpha: number;
  power: number;
  targetSampleSize: number;
  minimumDurationDays: number;
  maximumDurationDays: number;
  dataMaturityLagDays?: number;
  contentVersions: RegisteredContentV2[];
  mappingVersions: unknown[];
  guardrails: Record<string, unknown>;
  approvedAuthorityHash: string;
  now?: Date;
}) {
  const question = ADAPTIVE_EXPERIMENT_QUESTIONS[args.comparison];
  if (!args.mappingVersions.length) throw new Error("ADAPTIVE_REGISTRATION_MAPPING_REQUIRED");
  if (
    args.comparison === "UNIVERSAL_MATCHED" &&
    new Set(args.contentVersions.map((item) => item.id)).size < 2
  ) throw new Error("ADAPTIVE_REGISTRATION_UNIVERSAL_CONTROL_REQUIRED");
  return registerV2Experiment({
    ...args,
    controlPolicy: question.controlPolicy,
    treatmentPolicy: question.treatmentPolicy,
    hypothesis: question.question,
    guardrails: {
      ...args.guardrails,
      adaptiveExperimentProtocolVersion: question.protocolVersion,
      adaptiveQuestionInterpretation: question.interpretation,
      adaptiveComparison: args.comparison,
    },
  });
}
