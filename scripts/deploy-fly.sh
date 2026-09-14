#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
release="$(git rev-parse HEAD)"
case "$release" in
  *[!0-9a-f]*|'') echo "Refusing deploy: invalid Git release identifier." >&2; exit 1 ;;
esac
test "${#release}" -eq 40 || { echo "Refusing deploy: Git release must be a full SHA-1." >&2; exit 1; }

# Release notes may be edited during evidence capture. Runtime inputs must be
# committed so APP_RELEASE identifies the exact code inside the image.
runtime_paths="Dockerfile app extensions prisma scripts storefront package.json pnpm-lock.yaml pnpm-workspace.yaml shopify.app.toml fly.toml"
git diff HEAD --quiet -- $runtime_paths || {
  echo "Refusing deploy: runtime inputs differ from APP_RELEASE=$release." >&2
  exit 1
}
untracked="$(git ls-files --others --exclude-standard -- $runtime_paths)"
test -z "$untracked" || {
  echo "Refusing deploy: untracked runtime inputs are not part of APP_RELEASE=$release." >&2
  exit 1
}

exec "${FLYCTL_BIN:-flyctl}" deploy --build-arg "APP_RELEASE=$release" "$@"
