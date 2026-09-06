export const AUTOPILOT_PREPARATION_REFRESH_INTERVAL_MS = 15_000;
export const AUTOPILOT_PREPARATION_REFRESH_LIMIT = 24;

export function shouldRefreshAutopilotPreparation(input: {
  pending: boolean;
  visible: boolean;
  busy: boolean;
  revalidatorIdle: boolean;
  editableFocused: boolean;
  attempts: number;
}) {
  return Boolean(
    input.pending &&
    input.visible &&
    !input.busy &&
    input.revalidatorIdle &&
    !input.editableFocused &&
    Number.isSafeInteger(input.attempts) &&
    input.attempts >= 0 &&
    input.attempts < AUTOPILOT_PREPARATION_REFRESH_LIMIT,
  );
}
