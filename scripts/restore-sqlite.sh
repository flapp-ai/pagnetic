#!/bin/sh
set -eu

exec node --import tsx "$(dirname "$0")/restore-sqlite.ts" "$@"
