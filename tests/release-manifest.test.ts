import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertSameReleaseSource, captureReleaseSource } from "../scripts/lib/release-manifest";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pagnetic-release-fixture-"));
  await mkdir(join(root, "prisma"));
  await mkdir(join(root, "app"));
  for (const path of ["package.json", "pnpm-lock.yaml", "Dockerfile", "prisma/schema.prisma", "app/index.ts"])
    await writeFile(join(root, path), `fixture ${path}`);
  return root;
}

test("release manifest is deterministic, detects changed and added sources, and excludes private runtime files", async () => {
  const root = await fixture();
  try {
    const first = await captureReleaseSource(root);
    await writeFile(join(root, ".env"), "PRIVATE=fixture");
    await writeFile(join(root, "prisma/dev.sqlite"), "synthetic database");
    assertSameReleaseSource(first, await captureReleaseSource(root));
    assert.ok(first.files.every((file) => !file.path.endsWith(".sqlite") && file.path !== ".env"));
    await writeFile(join(root, "app/index.ts"), "changed source");
    assert.throws(() => assertSameReleaseSource(first, { ...first, files: [] }), /MANIFEST_INVALID/);
    const changed = await captureReleaseSource(root);
    assert.throws(() => assertSameReleaseSource(first, changed), /MANIFEST_INVALID/);
    await writeFile(join(root, "app/added.ts"), "new source");
    const added = await captureReleaseSource(root);
    assert.throws(() => assertSameReleaseSource(changed, added), /MANIFEST_INVALID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release manifest rejects source links and missing required files", async () => {
  const root = await fixture();
  try {
    await symlink(join(root, "package.json"), join(root, "app/linked.ts"));
    await assert.rejects(captureReleaseSource(root), /LINK_UNSUPPORTED/);
    await rm(join(root, "app/linked.ts"));
    await rm(join(root, "Dockerfile"));
    await assert.rejects(captureReleaseSource(root), /SOURCE_MISSING/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
