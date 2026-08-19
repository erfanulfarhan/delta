#!/usr/bin/env bash
#
# Deploy the Raw (Singapore) endpoint to Vercel, then rebuild the site against it.
#
#   ./scripts/deploy-raw-vercel.sh
#
# Needs VERCEL_TOKEN in ~/.erfanul-secrets.env. Reuses SIGNING_SECRET so results
# from this endpoint can be verified; without it they save but stay unverified.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="${HOME}/.erfanul-secrets.env"

if [[ -f "$SECRETS" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS"
  set +a
fi

: "${VERCEL_TOKEN:?Set VERCEL_TOKEN in ~/.erfanul-secrets.env}"

VERCEL="npx --yes vercel@latest"
cd "$ROOT/services/raw-vercel"

echo "==> 1/3  Deploying to Vercel (region sin1)"
$VERCEL link --yes --project delta-raw --token "$VERCEL_TOKEN" >/dev/null
DEPLOY_OUTPUT="$($VERCEL deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1 | tee /dev/stderr)"
RAW_HOST="$(printf '%s' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)"

if [[ -z "$RAW_HOST" ]]; then
  echo "Could not determine the deployment URL." >&2
  exit 1
fi
RAW_URL="${RAW_HOST}/api"
echo "    Raw endpoint: $RAW_URL"

echo "==> 2/3  Confirming it really runs in Singapore"
# This is the check that matters. If the functions are not pinned to sin1 the
# request is served from wherever is nearest and the "international" number was
# never international at all.
META="$(curl -fsS --max-time 30 "$RAW_URL/meta" || true)"
echo "    $META"
case "$META" in
  *'"region":"sin1"'*) echo "    region ok: sin1" ;;
  *) echo "    WARNING: region is not sin1. Raw numbers would be meaningless." >&2 ;;
esac

echo "==> 3/3  Rebuilding the site with Raw enabled"
cd "$ROOT"
VITE_RAW_URL="$RAW_URL" ./scripts/deploy-cloudflare.sh
