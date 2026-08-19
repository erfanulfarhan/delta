#!/usr/bin/env bash
#
# Deploy Delta to Cloudflare: the Local endpoint as a Worker, the site as Pages.
#
# Order matters. The Worker has to exist before the site is built, because its
# URL is compiled into the bundle as VITE_BDIX_URL. Building first would ship a
# site pointing at nothing.
#
#   ./scripts/deploy-cloudflare.sh
#
# Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from ~/.erfanul-secrets.env
# (R2_ACCOUNT_ID is accepted for the account, it is the same value).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="${HOME}/.erfanul-secrets.env"
PROJECT="deltaspeed"

if [[ -f "$SECRETS" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS"
  set +a
fi

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (needs the 'Edit Cloudflare Workers' template)}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${R2_ACCOUNT_ID:-}}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID or R2_ACCOUNT_ID}"

WRANGLER="npx --yes wrangler@latest"

echo "==> 1/4  Deploying the Local endpoint (Worker)"
cd "$ROOT/services/worker"
WORKER_OUTPUT="$($WRANGLER deploy 2>&1 | tee /dev/stderr)"

# wrangler prints the deployed URL; pull it out rather than guessing the
# subdomain, which differs per account.
WORKER_URL="$(printf '%s' "$WORKER_OUTPUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
if [[ -z "$WORKER_URL" ]]; then
  echo "Could not determine the Worker URL from wrangler output." >&2
  exit 1
fi
echo "    Local endpoint: $WORKER_URL"

echo "==> 2/4  Checking the endpoint answers"
# Retried: a freshly created workers.dev route 404s for a few seconds before it
# propagates, which is not a deployment failure.
OK=""
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 15 "$WORKER_URL/ping" -o /dev/null 2>/dev/null; then
    OK="yes"
    break
  fi
  echo "    not answering yet (attempt $attempt), waiting..."
  sleep 5
done
if [[ -z "$OK" ]]; then
  echo "    Worker deployed but /ping never answered." >&2
  exit 1
fi
COLO="$(curl -fsS --max-time 15 "$WORKER_URL/meta" | sed -n 's/.*"colo":"\([^"]*\)".*/\1/p' || true)"
echo "    /ping ok, served from PoP: ${COLO:-unknown}"

echo "==> 3/4  Building the site against that endpoint"
cd "$ROOT/apps/web"
# VITE_RAW_URL is intentionally left unset until a Singapore host exists. The
# interface reports Raw as undeployed rather than measuring the wrong path.
VITE_BDIX_URL="$WORKER_URL" \
VITE_RAW_URL="${VITE_RAW_URL:-}" \
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
  npx vite build

echo "==> 4/4  Publishing the site (Pages)"
# Created on first run only. `pages project create` errors if the project is
# already there, so the failure is swallowed rather than aborting a redeploy.
if ! $WRANGLER pages project list 2>/dev/null | grep -q "\b${PROJECT}\b"; then
  echo "    Creating Pages project '$PROJECT'"
  $WRANGLER pages project create "$PROJECT" --production-branch main || true
fi

PAGES_OUTPUT="$($WRANGLER pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | tee /dev/stderr)"

# Never assume the site lives at <project>.pages.dev. Cloudflare suffixes the
# subdomain when the name is already taken globally, and "delta.pages.dev" is
# someone else's blog. Read the real host out of the deployment URL instead.
SITE_URL="$(printf '%s' "$PAGES_OUTPUT" \
  | grep -oE 'https://[a-z0-9]+\.[a-z0-9-]+\.pages\.dev' \
  | head -1 \
  | sed -E 's#https://[a-z0-9]+\.#https://#')"
SITE_URL="${SITE_URL:-https://${PROJECT}.pages.dev}"

echo
echo "Done."
echo "  Local endpoint : $WORKER_URL"
echo "  Site           : $SITE_URL"
