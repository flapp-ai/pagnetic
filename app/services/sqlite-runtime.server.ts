/** SQLite permits one writer. Queue this process at its connection pool rather
 * than letting concurrent transactions hold read locks while awaiting a writer.
 * No operation or transaction is replayed: authority and lease checks stay local.
 */
export function sqliteRuntimeUrl(url: string | undefined) {
  if (!url?.startsWith("file:")) return url;
  const separator = url.indexOf("?");
  const file = separator < 0 ? url : url.slice(0, separator);
  const parameters = new URLSearchParams(
    separator < 0 ? "" : url.slice(separator + 1),
  );
  parameters.set("connection_limit", "1");
  parameters.set("socket_timeout", "2");
  parameters.set("pool_timeout", "5");
  return `${file}?${parameters}`;
}

export async function initializeSqlite(db: {
  $queryRawUnsafe(query: string): Promise<unknown>;
}) {
  // One connection makes these connection-local PRAGMAs deterministic.
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
  await db.$queryRawUnsafe("PRAGMA busy_timeout=2000");
  await db.$queryRawUnsafe("PRAGMA foreign_keys=ON");
}
