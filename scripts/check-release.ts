import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runManagedProcess } from "./lib/production-supervisor";
import { assertSameReleaseSource, captureReleaseSource, type SourceManifest } from "./lib/release-manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  if (args[0] === "--verify" && args.length === 2) {
    const prior = JSON.parse(await readFile(resolve(args[1]!), "utf8")) as { source: SourceManifest };
    assertSameReleaseSource(prior.source, await captureReleaseSource(root));
    console.log("Release source matches recorded manifest. This does not rerun checks or certify provenance/deployment.");
  } else if (args.length === 0) {
    process.chdir(root);
    const source = await captureReleaseSource(root);
    const startedAt = new Date().toISOString();
    const commands = [
      ["check"],
      ["exec", "tsx", "scripts/prepare-postgres-track.ts", "--check"],
      ["exec", "tsx", "scripts/rehearse-postgres.ts"],
    ];
    // The source manifest makes a simultaneous edit a failed gate, not a mixed-release pass.
    for (const command of commands) await runManagedProcess("pnpm", command, {
      label: `release-${command[0]}`, signal: cancellation.signal, timeoutMs: 1_800_000,
    });
    cancellation.signal.throwIfAborted();
    const evidenceBytes = await readFile(join(root, "docs/audit-2026-09-05/statistical-calibration.json"));
    const calibration = JSON.parse(evidenceBytes.toString("utf8")) as {
      passed: boolean; sourceUnchangedDuringRun: boolean; sourceHashes: Record<string, string>;
    };
    if (calibration.passed !== true || calibration.sourceUnchangedDuringRun !== true || Object.keys(calibration.sourceHashes).length < 7)
      throw new Error("RELEASE_STATISTICAL_EVIDENCE_INCOMPLETE");
    for (const [path, digest] of Object.entries(calibration.sourceHashes)) {
      if (!source.files.some((file) => file.path === path && file.sha256 === digest))
        throw new Error(`RELEASE_STATISTICAL_EVIDENCE_STALE:${path}`);
    }
    assertSameReleaseSource(source, await captureReleaseSource(root));
    const parent = join(root, "docs/release-checks");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, "local-"));
    const path = join(directory, "manifest.json");
    await writeFile(path, JSON.stringify({
      format: 1, startedAt, completedAt: new Date().toISOString(), node: process.version,
      scope: "Local source/build/schema-track/statistical-reference gate only; not provider or launch approval.",
      commands: commands.map((arguments_) => ({ executable: "pnpm", arguments: arguments_, exitCode: 0 })),
      statisticalEvidenceSha256: createHash("sha256").update(evidenceBytes).digest("hex"),
      source,
      deploymentVerified: false, designPartnerDeployable: false, publicAcquisitionReady: false,
    }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Local release gate passed: ${path}`);
  } else throw new Error("Usage: tsx scripts/check-release.ts [--verify manifest.json]");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release check failed");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
