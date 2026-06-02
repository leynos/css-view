#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "\n[bun missing] Please install Bun before running this script." >&2
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
bun pack >/dev/null

if [[ ! -f "$TARBALL" ]]; then
  echo "bun pack did not emit ${TARBALL}" >&2
  exit 1
fi

ABS_TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

echo "Installing globally from ${ABS_TARBALL}..."
if ! bun install -g "$ABS_TARBALL"; then
  echo "Global install failed" >&2
  exit 1
fi

echo "\ncss-view linked globally. Ensure the Bun bin directory (typically ~/.bun/bin) is on your PATH."
echo "Recommended backend on Fedora and Rocky:\n  npm install -g agent-browser\n  agent-browser install"
echo "For local Playwright captures, install only the browsers you need, for example:\n  bunx playwright install chromium"
