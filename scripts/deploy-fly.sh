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
git diff --quiet -- Dockerfile app extensions prisma scripts storefront package.json pnpm-lock.yaml pnpm-workspace.yaml shopify.app.toml fly.toml || {
  echo "Refusing deploy: runtime inputs differ from APP_RELEASE=$release." >&2
  exit 1
}

exec flyctl deploy --build-arg "APP_RELEASE=$release" "$@"
