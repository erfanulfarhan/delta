#!/usr/bin/env bash
#
# Vendor packages/attest into services/raw-vercel.
#
# Vercel bundles only files beneath the project root, so an import reaching up
# into the monorepo resolves at build time and then fails at runtime with
# ERR_MODULE_NOT_FOUND. Copying keeps packages/attest as the single source of
# truth while giving the function a file it can actually see.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/packages/attest/src/index.ts"
DEST="$ROOT/services/raw-vercel/api/_attest.ts"

{
  echo "// GENERATED FILE - DO NOT EDIT."
  echo "// Copied from packages/attest/src/index.ts by scripts/sync-attest.sh."
  echo "// Vercel cannot bundle imports from outside its project root."
  echo
  cat "$SRC"
} > "$DEST"

echo "  synced attest -> services/raw-vercel/api/_attest.ts"
