#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "\n[bun missing] Please install Bun before running this script." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "\n[npm missing] Please install npm before running this script." >&2
  exit 1
fi

echo "Installing css-view globally from ${ROOT_DIR}..."
if ! npm install -g "$ROOT_DIR"; then
  echo "Global install failed" >&2
  exit 1
fi

echo "\ncss-view linked globally."
echo "Ensure your global npm bin directory is on your PATH so \`css-view\` resolves."
echo "The installed command still requires Bun at runtime because it uses \`bun run\`."
