#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "\n[bun missing] Please install Bun before running this script." >&2
  exit 1
fi

echo "Linking css-view from ${ROOT_DIR}..."
if ! bun link; then
  echo "bun link failed" >&2
  exit 1
fi

echo "\ncss-view linked via Bun."
echo "Ensure ~/.bun/bin is on your PATH so \`css-view\` resolves."
