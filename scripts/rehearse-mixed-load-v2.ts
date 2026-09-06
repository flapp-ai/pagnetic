import { pathToFileURL } from "node:url";

import { runMixedLoadRehearsal } from "./lib/mixed-load-v2";

export async function main() {
  const result = await runMixedLoadRehearsal();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
