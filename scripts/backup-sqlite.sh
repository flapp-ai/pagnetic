#!/bin/sh
set -eu

exec node --import tsx "$(dirname "$0")/backup-sqlite.ts"
