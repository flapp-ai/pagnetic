import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "Dockerfile", ".dockerignore", ".gitignore", ".env.example", ".eslintrc.cjs", ".graphqlrc.ts", ".node-version", ".npmrc", "env.d.ts", "fly.toml", "fly.toml.example", "react-router.config.ts", "shopify.app.toml", "shopify.web.toml", "tsconfig.json", "vite.config.ts"];
const SOURCE_DIRS = ["app", "extensions", "prisma", "public", "scripts", "storefront", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".css", ".json", ".toml", ".prisma", ".sql", ".liquid", ".graphql", ".svg", ".sh", ".py", ".txt", ".html", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".webmanifest"]);
const OMIT_DIRS = new Set(["node_modules", ".git", ".cache", "build", "dist", ".shopify", "__pycache__"]);
const REQUIRED = ["package.json", "pnpm-lock.yaml", "Dockerfile", "prisma/schema.prisma"];

export type SourceManifest = {
  version: 1;
  sourceSha256: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

/** Source identity only: never reads .env files, databases, tmp, logs or shopper exports. */
export async function captureReleaseSource(root: string): Promise<SourceManifest> {
  const paths: string[] = [];
  async function scan(relative: string) {
    const entry = await lstat(join(root, relative)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry) return;
    if (entry.isSymbolicLink()) throw new Error(`RELEASE_SOURCE_LINK_UNSUPPORTED:${relative}`);
    if (entry.isDirectory()) {
      for (const child of (await readdir(join(root, relative))).sort()) {
        if (OMIT_DIRS.has(child) || child.startsWith(".env") || child.startsWith(".")) continue;
        await scan(`${relative}/${child}`);
      }
    } else if (entry.isFile() && (ROOT_FILES.includes(relative) || EXTENSIONS.has(extname(relative)))) {
      paths.push(relative);
      if (paths.length > 20_000) throw new Error("RELEASE_SOURCE_FILE_LIMIT");
    }
  }
  for (const item of [...ROOT_FILES, ...SOURCE_DIRS]) await scan(item);
  for (const required of REQUIRED) if (!paths.includes(required)) throw new Error(`RELEASE_SOURCE_MISSING:${required}`);
  const files: SourceManifest["files"] = [];
  for (const path of paths.sort()) {
    const before = await lstat(join(root, path));
    if (!before.isFile() || before.isSymbolicLink() || before.size > 128 * 1024 * 1024)
      throw new Error(`RELEASE_SOURCE_UNSAFE:${path}`);
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(join(root, path))) hash.update(bytes);
    const after = await lstat(join(root, path));
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error(`RELEASE_SOURCE_CHANGED_DURING_HASH:${path}`);
    files.push({ path, bytes: before.size, sha256: hash.digest("hex") });
  }
  return { version: 1, sourceSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files };
}

export function assertSameReleaseSource(before: SourceManifest, after: SourceManifest) {
  if (before.version !== 1 || after.version !== 1 || before.sourceSha256 !== after.sourceSha256 ||
    JSON.stringify(before.files) !== JSON.stringify(after.files)) throw new Error("RELEASE_SOURCE_CHANGED_OR_MANIFEST_INVALID");
}
