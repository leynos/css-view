# css-view CLI

`css-view` is a Bun + Playwright command-line tool that emits a structured JSON snapshot of a page's computed CSS. It exposes both capture strategies detailed in the design note:

- **`cdp` mode** (Chromium-only) calls `DOMSnapshot.captureSnapshot` via CDP and returns a flat list of nodes with whitelisted computed values, paint-order data, and bounding boxes. It can launch a local Playwright Chromium browser or attach to an existing browser endpoint with `--cdp-url`.
- **`walker` mode** (all browsers) runs a browser-side walker that diffs `getComputedStyle` output per element against its parent (for inherited props) and against user-agent defaults.

The CLI always writes a JSON document with the capture metadata plus the chosen mode's payload.

## Installation

1. Install dependencies:
   ```bash
   BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bun install
   ```
2. Download Playwright browsers (needed once per machine):
   ```bash
   BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bunx playwright install chromium firefox webkit
   ```
   > On stripped-down Linux images you may need to install system libraries such as `libicu`, `libjpeg`, `libwebp`, or `libffi` before the browsers run. Playwright prints the missing list (see `playwright-core/lib/server/registry/dependencies.js` for details).

## Usage

```
bun run bin/css-view.ts <url> [options]
```

Common examples:

- Capture a walker snapshot of `example.org` and stream to stdout:
  ```bash
  bun run bin/css-view.ts https://example.org --mode walker --pretty
  ```
- Capture a CDP snapshot of `localhost:4173` and save it to a file:
  ```bash
  bun run bin/css-view.ts http://localhost:4173 --mode cdp --output snapshot.json
  ```
- Capture a page already opened by agent-browser:
  ```bash
  agent-browser open http://localhost:4173
  CDP_URL="$(agent-browser get cdp-url)"
  bun run bin/css-view.ts http://localhost:4173 \
    --mode cdp --cdp-url "$CDP_URL" --pretty
  ```
- Restrict computed props to spacing + layout via a manifest file:
  ```bash
  bun run bin/css-view.ts https://example.com \
    --props-file ./configs/layout-props.txt \
    --mode cdp --pretty
  ```

## Options

| Flag | Description |
| --- | --- |
| `--mode <cdp|walker>` | Choose the capture backend (default `walker`). |
| `--browser <chromium|firefox|webkit>` | Override the browser engine. CDP mode always forces `chromium`. |
| `--cdp-url <url>` | CDP-only: attach to an existing Chromium CDP endpoint from a tool such as `agent-browser get cdp-url`. Accepts HTTP(S) debugging URLs and WS(S) browser WebSocket URLs. Cannot be combined with `--browser`. |
| `--props`, `--props-file` | Override the computed-style whitelist. Accepts comma or newline separated values. |
| `--inherited`, `--inherited-file` | Walker-only overrides for the inherited-property set used when diffing. |
| `--max-nodes <n>` | Walker-only guard to stop after visiting `n` elements (default 2000). |
| `--text-clip <n>` | Walker-only text truncation length (default 160 chars). |
| `--wait-until <state>` | Navigation lifecycle wait (`load`, `domcontentloaded`, `networkidle`). Default `networkidle`. |
| `--timeout <ms>` | Navigation timeout override (default 45000ms). |
| `--output <file>` | Write JSON to a file. When omitted, stdout is used. |
| `--pretty` | Pretty-print JSON with two-space indentation. |
| `--headful` | Launch browsers with a visible UI (headless off). |

## JSON shape

All runs include metadata:

```json
{
  "url": "https://example.org/",
  "capturedAt": "2025-11-08T12:34:56.000Z",
  "mode": "walker",
  "browser": "firefox",
  "waitUntil": "networkidle",
  "headless": true,
  "payload": { "mode": "walker", ... }
}
```

- CDP payloads contain `nodes[]`, where each node stores attributes, children indexes, computed values (matching the `--props` list), and bounding boxes. Text may appear on child text nodes rather than the element node itself, matching Chromium's DOMSnapshot representation.
- Walker payloads contain a tree rooted at `<html>`, where each node exposes `styleDiff` (only differences vs parent/defaults), trimmed text, and bounding boxes.

## Dev workflow

- Unit tests (`bun test`) cover diff/inheritance helpers, option resolvers, and CDP target selection.
- Snapshot and e2e tests serve `tests/fixtures/hello-css` with `bunx http-server` on a random available port.
- `bun run lint` executes Biome's lint + organize-imports checks.
- `bun run fmt` formats the repo (`@biomejs/biome format --write .`).

When adding new features, extend the docs in this file so the CLI usage always stays in sync with the shipped behavior.
