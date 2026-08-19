#!/usr/bin/env bash
#
# Deploy the endpoint to one Vercel region as its own project.
#
#   ./scripts/deploy-region.sh sin1
#   ./scripts/deploy-region.sh bom1
#
# One project per region, because the Hobby plan pins a project to a single
# region. Separate projects is the only way to offer a genuine choice of
# locations, and it keeps each one's bandwidth accounted for separately.
set -euo pipefail

REGION="${1:?usage: deploy-region.sh <vercel-region>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="${HOME}/.erfanul-secrets.env"

if [[ -f "$SECRETS" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$SECRETS"; set +a
fi
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN}"

PROJECT="delta-${REGION}"
VERCEL="npx --yes vercel@latest"

"$ROOT/scripts/sync-attest.sh"

WORK="$ROOT/services/raw-vercel"
cd "$WORK"

# Region is written per deploy. Node runtime, never Edge: Edge executes at the
# PoP nearest the visitor, which would silently collapse every region to
# whichever is closest and report a location that was never measured.
cat > vercel.json <<JSON
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["${REGION}"],
  "functions": { "api/*.ts": { "maxDuration": 30 } }
}
JSON

rm -rf .vercel
$VERCEL link --yes --project "$PROJECT" --token "$VERCEL_TOKEN" >/dev/null
printf '%s' "${SIGNING_SECRET:-}" | $VERCEL env add SIGNING_SECRET production --token "$VERCEL_TOKEN" --force >/dev/null 2>&1 || true

$VERCEL deploy --prod --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1

# Deployment Protection would answer every request with a login redirect.
curl -s -X PATCH "https://api.vercel.com/v9/projects/${PROJECT}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "Content-Type: application/json" \
  -d '{"ssoProtection":null}' >/dev/null

URL="https://${PROJECT}.vercel.app"
sleep 3

# The check that matters: confirm the function really ran where we asked.
META="$(curl -fsS --max-time 30 "$URL/api/meta" 2>/dev/null || echo '{}')"
case "$META" in
  *"\"region\":\"${REGION}\""*) echo "  ${REGION}: ok  ->  ${URL}/api" ;;
  *) echo "  ${REGION}: WRONG REGION or unreachable -> $META" >&2 ;;
esac
