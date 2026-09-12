export type ApprovedMessageSummary = {
  id: string;
  status: string;
  angle: string;
  headline: string;
  supportingLine: string | null;
  benefits: string[];
  reassurance: string | null;
  claims: Array<{ text: string; sources: string[] }>;
};

/** Keep approved campaign cards visible after approval and preserve their preview target. */
export function approvedMessageSummaries(
  experiences: ApprovedMessageSummary[],
  productId: string,
) {
  return experiences
    .filter((experience) => experience.status === "APPROVED_ACTIVE")
    .map((experience) => ({
      ...experience,
      previewHref: previewExperienceHref(productId, experience.id),
    }));
}

export function previewExperienceHref(productId: string, experienceId: string) {
  return `/app/preview?productId=${encodeURIComponent(productId)}&experienceId=${encodeURIComponent(experienceId)}`;
}

export function selectRequestedExperience<T extends { id: string }>(
  experiences: T[],
  requestedExperienceId: string | null,
  fallback: () => T | null,
) {
  if (requestedExperienceId) {
    return experiences.find((experience) => experience.id === requestedExperienceId) ?? null;
  }
  return fallback();
}
