# css-view CLI

`css-view` is a Bun command-line tool that emits a structured JSON snapshot of
a page's computed CSS. It uses `agent-browser` by default when available, can
launch local Playwright browsers when requested, and exposes both capture
strategies detailed in the design note:

- **`cdp` mode** (Chromium-only) calls `DOMSnapshot.captureSnapshot` via CDP
  and returns a flat list of nodes with whitelisted computed values,
  paint-order data, and bounding boxes. It can launch a local Playwright
  Chromium browser or attach to an existing browser endpoint with `--cdp-url`.
- **`walker` mode** (all browsers) runs a browser-side walker that diffs
  `getComputedStyle` output per element against its parent (for inherited
  props) and against user-agent defaults.

The CLI always writes a JSON document with the capture metadata plus the chosen
mode's payload.

## Installation

1. Install dependencies:

   ```bash
   BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bun install
   ```

2. Install the recommended Fedora/Rocky backend:

   ```bash
   npm install -g agent-browser
   agent-browser install
   ```

3. Optional: download Playwright browsers only when using
   `--backend playwright`:

   ```bash
   BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bunx playwright install chromium
   ```

   > On stripped-down Linux images, install system libraries such as `libicu`,
   > `libjpeg`, `libwebp`, or `libffi` before local Playwright browsers run.
   > Playwright prints the missing list (see
   > `playwright-core/lib/server/registry/dependencies.js` for details).

## Usage

```bash
bun run bin/css-view.ts [url] [options]
```

Common examples:

- Capture with the default backend and stream to stdout:

  ```bash
  bun run bin/css-view.ts https://example.org --pretty
  ```

- Capture a walker snapshot with local Playwright and stream to stdout:

  ```bash
  bun run bin/css-view.ts https://example.org --backend playwright --mode walker --pretty
  ```

- Capture a CDP snapshot of `localhost:4173` and save it to a file:

  ```bash
  bun run bin/css-view.ts http://localhost:4173 --mode cdp --output snapshot.json
  ```

- Capture a page already opened by agent-browser:

  ```bash
  bun run bin/css-view.ts http://localhost:4173 \
    --backend agent-browser --agent-browser-session css-view --pretty
  ```

- Snapshot the current page in an agent-browser session without navigating:

  ```bash
  bun run bin/css-view.ts \
    --backend agent-browser --agent-browser-session css-view \
    --use-current-page --pretty
  ```

- Bypass backend selection with a known CDP endpoint:

  ```bash
  CDP_URL="$(agent-browser --session css-view get cdp-url)"
  bun run bin/css-view.ts http://localhost:4173 \
    --mode cdp --cdp-url "$CDP_URL" --pretty
  ```

  > **Security warning:** `--cdp-url` must only target trusted loopback
  > endpoints (typically `127.0.0.1`/`localhost`) under operator control.
  > Connections to a CDP endpoint grant full browser and session control —
  > including reading cookies, intercepting requests, executing arbitrary
  > JavaScript, and accessing every open page. Provider-issued WebSocket
  > URLs (`webSocketDebuggerUrl` values) are session secrets equivalent to a
  > long-lived auth token; they must not be logged, shared, or committed,
  > and the browser session must be revoked if one leaks. `--cdp-url` must
  > never be pointed at a remote host or a CDP endpoint exposed by
  > untrusted software.
- Restrict computed props to spacing + layout via a manifest file:

  ```bash
  bun run bin/css-view.ts https://example.com \
    --props-file ./configs/layout-props.txt \
    --mode cdp --pretty
  ```

## Options

| Flag                                    | Description                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--backend <agent-browser\|playwright>` | Choose the browser backend. Defaults to `agent-browser` when the binary is on `PATH`; otherwise falls back to `playwright`.                                                                                                                 |
| `--mode <cdp\|walker>`                  | Choose the capture mode. `agent-browser` uses `cdp`; Playwright defaults to `walker`.                                                                                                                                                       |
| `--browser <chromium\|firefox\|webkit>` | Override the Playwright browser engine. CDP mode requires `chromium`; this cannot be combined with `--backend agent-browser` or `--cdp-url`.                                                                                                |
| `--agent-browser-session <name>`        | Select the agent-browser session used by `--backend agent-browser` (default `css-view`).                                                                                                                                                    |
| `--use-current-page`                    | With `--backend agent-browser`, snapshot the active page in the selected session without opening or navigating a URL.                                                                                                                       |
| `--cdp-url <url>`                       | CDP-only: attach to an existing Chromium CDP endpoint from a tool such as `agent-browser get cdp-url`. Accepts HTTP(S) debugging URLs and WS(S) browser WebSocket URLs. Bypasses backend selection and cannot be combined with `--browser`. |
| `--props`, `--props-file`               | Override the computed-style whitelist. Accepts comma or newline separated values.                                                                                                                                                           |
| `--inherited`, `--inherited-file`       | Walker-only overrides for the inherited-property set used when diffing.                                                                                                                                                                     |
| `--max-nodes <n>`                       | Walker-only guard to stop after visiting `n` elements (default 2000).                                                                                                                                                                       |
| `--text-clip <n>`                       | Walker-only text truncation length (default 160 chars).                                                                                                                                                                                     |
| `--wait-until <state>`                  | Navigation lifecycle wait (`load`, `domcontentloaded`, `networkidle`). Default `networkidle`.                                                                                                                                               |
| `--timeout <ms>`                        | Navigation timeout override (default 45000ms).                                                                                                                                                                                              |
| `--output <file>`                       | Write JSON to a file. When omitted, stdout is used.                                                                                                                                                                                         |
| `--pretty`                              | Pretty-print JSON with two-space indentation.                                                                                                                                                                                               |
| `--headful`                             | Launch browsers with a visible UI (headless off).                                                                                                                                                                                           |

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

- CDP payloads contain `nodes[]`, where each node stores attributes, children
  indexes, computed values (matching the `--props` list), and bounding boxes.
  Text may appear on child text nodes rather than the element node itself,
  matching Chromium's DOMSnapshot representation.
- Walker payloads contain a tree rooted at `<html>`, where each node exposes
  `styleDiff` (only differences vs parent/defaults), trimmed text, and bounding
  boxes.

## Dev workflow

- Unit tests (`bun test`) cover diff/inheritance helpers, option resolvers, and
  CDP target selection.
- Snapshot and e2e tests serve `tests/fixtures/hello-css` with
  `bunx http-server` on a random available port.
- `bun run lint` executes Biome's lint + organize-imports checks.
- `bun run fmt` formats the repo (`@biomejs/biome format --write .`).

When adding new features, extend the docs in this file so the CLI usage always
stays in sync with the shipped behaviour.
