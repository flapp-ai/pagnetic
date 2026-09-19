export async function load(url, context, nextLoad) {
  if (url.endsWith("/app/shopify.server.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export async function authenticateAdmin() { throw new Error('not available in render-only tests'); }",
    };
  }
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  }
  return nextLoad(url, context);
}
