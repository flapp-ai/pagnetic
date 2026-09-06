export function uiQaRequestAllowed(
  request: Request,
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "PAGNETIC_UI_QA">> = process.env,
) {
  const host = new URL(request.url).hostname;
  return env.NODE_ENV !== "production" &&
    env.PAGNETIC_UI_QA === "true" &&
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

export function uiQaReadOnlyResponse() {
  return Response.json(
    { ok: false, message: "The isolated UI fixture is read-only." },
    { status: 405 },
  );
}
