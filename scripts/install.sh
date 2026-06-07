#!/usr/bin/env bash
# install.sh — Pack css-view and install it globally via Bun.
#
# This script wraps `bun pm pack` and `bun install -g` to work around a
# Bun 1.3.11 dependency-loop error that prevents `bun install -g .` from
# completing. It also repairs stale global manifest entries left by a
# previously failed install.
#
# Usage: run from the repository root:
#   scripts/install.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  printf '\n[bun missing] Please install Bun before running this script.\n' >&2
  exit 1
fi

PKG_NAME="$(grep -m1 '"name"' package.json | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
PKG_VERSION="$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "$PKG_NAME" || -z "$PKG_VERSION" ]]; then
  echo "Failed to read package metadata from package.json" >&2
  exit 1
fi

TARBALL="${PKG_NAME}-${PKG_VERSION}.tgz"
rm -f "$TARBALL"

echo "Packing ${PKG_NAME}@${PKG_VERSION}..."
bun pm pack --quiet >/dev/null

if [[ ! -f "$TARBALL" ]]; then
  echo "bun pm pack did not emit ${TARBALL}" >&2
  exit 1
fi

ABS_TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

GLOBAL_MANIFEST="$(dirname "$(bun pm bin -g)")/install/global/package.json"
if [[ -f "$GLOBAL_MANIFEST" ]] && grep -q '"":[[:space:]]*"\."' "$GLOBAL_MANIFEST"; then
  echo "Removing stale empty Bun global dependency entry..."
  bun --eval '
    const fs = require("node:fs");
    const manifestPath = process.argv.at(-1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.dependencies) {
      delete manifest.dependencies[""];
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ' "$GLOBAL_MANIFEST"
fi

if [[ -f "$GLOBAL_MANIFEST" ]] && grep -qF "\"${PKG_NAME}\":" "$GLOBAL_MANIFEST"; then
  echo "Removing existing global ${PKG_NAME} before reinstalling..."
  bun remove -g "$PKG_NAME" >/dev/null
fi

echo "Installing globally from ${ABS_TARBALL}..."
if ! bun install -g "$ABS_TARBALL"; then
  echo "Global install failed" >&2
  exit 1
fi

printf '\ncss-view linked globally. Ensure the Bun bin directory (typically ~/.bun/bin) is on your PATH.\n'
printf 'Recommended backend on Fedora and Rocky:\n  npm install -g agent-browser\n  agent-browser install\n'
printf 'For local Playwright captures, install only the browsers needed, for example:\n  bunx playwright install chromium\n'
