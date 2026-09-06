export function publicBetaCapacity(environment = process.env) {
  const parsed = Number(environment.PUBLIC_BETA_MAX_STORES ?? "");
  const configured = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_000;
  return { configured, maximumStores: configured ? parsed : null };
}

export function canAcceptPublicBetaStore(
  currentStores: number,
  environment = process.env,
) {
  const capacity = publicBetaCapacity(environment);
  return {
    ...capacity,
    currentStores,
    accepted:
      !capacity.configured || currentStores < (capacity.maximumStores ?? 0),
  };
}
