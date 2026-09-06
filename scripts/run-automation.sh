#!/bin/sh
set -eu

app_url="${SHOPIFY_APP_URL:?SHOPIFY_APP_URL is required}"
automation_secret="${AUTOMATION_SECRET:?AUTOMATION_SECRET is required}"
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $automation_secret" \
  "$app_url/internal/automation"
