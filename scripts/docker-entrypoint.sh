#!/bin/sh
set -eu

mkdir -p /data/backups
chown -R node:node /data

exec gosu node "$@"
