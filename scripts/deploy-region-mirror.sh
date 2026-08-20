#!/usr/bin/env bash
# Deploy an extra mirror of one region: same code, same region, new hostname.
# Extra hostnames are the only way a browser opens extra connections.
set -euo pipefail
REGION="${1:?region}"; N="${2:?mirror number}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="${HOME}/.erfanul-secrets.env"
[[ -f "$SECRETS" ]] && { set -a; source "$SECRETS"; set +a; }
: "${VERCEL_TOKEN:?}"
PROJECT="delta-${REGION}-${N}"
V="npx --yes vercel@latest"
"$ROOT/scripts/sync-attest.sh" >/dev/null
cd "$ROOT/services/raw-vercel"
cat > vercel.json <<JSON
{ "\$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["${REGION}"],
  "functions": { "api/*.ts": { "maxDuration": 30 } } }
JSON
rm -rf .vercel
$V link --yes --project "$PROJECT" --token "$VERCEL_TOKEN" >/dev/null 2>&1
printf '%s' "${SIGNING_SECRET:-}" | $V env add SIGNING_SECRET production --token "$VERCEL_TOKEN" --force >/dev/null 2>&1 || true
$V deploy --prod --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1
curl -s -X PATCH "https://api.vercel.com/v9/projects/${PROJECT}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "Content-Type: application/json" \
  -d '{"ssoProtection":null}' >/dev/null
sleep 2
META="$(curl -fsS --max-time 30 "https://${PROJECT}.vercel.app/api/meta" 2>/dev/null || echo '{}')"
case "$META" in
  *"\"region\":\"${REGION}\""*) echo "  ${PROJECT}: ok" ;;
  *) echo "  ${PROJECT}: WRONG REGION -> $META" >&2 ;;
esac
