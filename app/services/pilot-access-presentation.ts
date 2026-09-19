export function getStartedAccessPresentation(role: string) {
  const owner = role === "OWNER";
  return {
    canApproveBrand: owner,
    canBuildLibrary: owner,
    canOpenOwnerReview: owner,
    canOpenOwnerStages: owner,
  };
}
