# User guide

This guide explains how to install, configure, and run `css-view` while
adhering to the documentation style set out in
`docs/documentation-style-guide.md`.

## Overview

`css-view` emits a JSON snapshot of computed Cascading Style Sheets (CSS)
data. It can ask `agent-browser` to own the browser session, attach directly to
an existing Chromium DevTools Protocol (CDP) endpoint, or launch a local
Playwright browser. Two capture modes are available:

- `cdp` contacts the Chromium DevTools Protocol (CDP) to retrieve DOM snapshots
  with explicitly whitelisted properties.
- `walker` runs an in-page script that diffs `getComputedStyle` output against
  inherited values and user agent defaults.

See `docs/css-view.md` for the architectural background and option reference.

## Requirements

- Bun 1.3 or newer.
- Playwright 1.48 or newer.
- Fedora and Rocky recommended path: `agent-browser` installed on `PATH`.
- Local Playwright path: Playwright browser binaries downloaded manually for
  the browsers that will be launched.
- Linux systems using local Playwright browsers must provide ICU, JPEG, WebP,
  and FFI libraries as listed in the Playwright dependency validator.

## Installation

```bash
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bun install
npm install -g agent-browser
agent-browser install
```

`agent-browser install` downloads the Chrome browser used by the default
backend. `css-view` does not download Chromium, Firefox, or WebKit during
`postinstall`.

Install Playwright browsers only when the local Playwright backend is needed,
for example walker mode or an explicit Playwright CDP capture:

```bash
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bunx playwright install chromium
```

Use `firefox` or `webkit` in that command only when launching those
engines with `--backend playwright --browser <engine>`. The Playwright
installer warns if shared libraries are missing. Install the packages flagged
in the warning before attempting a local Playwright capture run.

### Global installation

To expose the CLI globally, pack the project and install the generated archive
by absolute path:

```bash
bun pm pack
bun install -g "$(pwd)/css-view-<VERSION>.tgz"
```

Add the Bun binary directory (`~/.bun/bin` by default) to `PATH`, so the
`css-view` command resolves everywhere. The package has no browser-download
`postinstall` hook. Install `agent-browser` for the default backend, or install
Playwright browsers manually for local Playwright captures. `bun install -g .`
currently fails on Bun 1.3.11 with an internal dependency-loop error, so avoid
installing directly from the package directory.

When installing from a packaged tarball, provide an absolute path:

```bash
bun install -g "$(pwd)/css-view-<VERSION>.tgz"
```

If a failed `bun install -g .` left the global Bun manifest with an empty
dependency entry, remove the stale global package first with
`bun remove -g css-view`, then remove the bad `""` entry from
`$(dirname "$(bun pm bin -g)")/install/global/package.json`. The helper script
performs both cleanup steps automatically before reinstalling.

The helper script `scripts/install.sh` packs the project, resolves the
absolute archive path, and invokes the global install.

## Running snapshots

```bash
bun run bin/css-view.ts [url] [options]
```

Common options include:

- `--backend agent-browser` or `--backend playwright` to select the browser
  backend. When omitted, `css-view` uses `agent-browser` if it is on `PATH` and
  falls back to Playwright otherwise.
- `--agent-browser-session` to choose the session name used by the
  `agent-browser` backend. The default is `css-view`.
- `--use-current-page` to snapshot the active page in the selected
  `agent-browser` session without navigating.
- `--mode cdp` or `--mode walker` to choose the capture mode. The
  `agent-browser` backend uses CDP; Playwright defaults to walker mode.
- `--props` or `--props-file` to override the computed-style whitelist.
- `--cdp-url` to attach CDP mode to an existing Chromium debugging endpoint
  and bypass backend selection.
- `--inherited` or `--inherited-file` (walker only) to override inheritance
  comparisons.
- `--wait-until` to pick the navigation lifecycle (`load`,
  `domcontentloaded`, or `networkidle`).
- `--output` to write JSON to a file rather than standard output.
- `--pretty` to format JSON for easier inspection.

Refer to `docs/css-view.md` for the full option matrix and payload schema.

## Hello World

The repository includes a tiny fixture page at `tests/fixtures/hello-css`.
Start it with `http-server`:

```bash
PORT=4173
bunx http-server tests/fixtures/hello-css -p "$PORT" -a 127.0.0.1 -c-1
```

Then capture a CDP snapshot:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

The response is JSON. The top-level metadata identifies the capture mode,
browser, URL, and wait policy. The CDP payload contains `nodes[]`; the fixture
heading appears as the node with `attributes.id` set to `title`, and its text
appears in a child text node. The heading's computed styles include
`color: rgb(34, 34, 136)` and `font-size: 32px`.

## Agent-browser bridge

`agent-browser` is the recommended backend on Fedora and Rocky. It is useful
for driving a page through login flows, clicks, forms, and navigation.
`css-view` can then attach to that same browser session and capture computed
CSS from the page state the agent already reached.

When `agent-browser` is on `PATH`, this is the default backend:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

To make the backend and session explicit:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --backend agent-browser \
  --agent-browser-session css-view \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

To snapshot the active page without navigation:

```bash
bun run bin/css-view.ts \
  --backend agent-browser \
  --agent-browser-session css-view \
  --use-current-page \
  --pretty
```

For lower-level workflows, use `agent-browser get cdp-url` to obtain the CDP
endpoint and pass it directly:

```bash
agent-browser --session css-view open "http://127.0.0.1:${PORT}/index.html"
CDP_URL="$(agent-browser --session css-view get cdp-url)"
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --mode cdp \
  --cdp-url "$CDP_URL" \
  --pretty
```

`--cdp-url` accepts browser-level CDP endpoints in these forms:

- `http://127.0.0.1:9222/`
- `https://browser-provider.example/session`
- `ws://127.0.0.1:9222/devtools/browser/<id>`
- `wss://browser-provider.example/devtools/browser/<id>`

When `--cdp-url` is present, `css-view` bypasses backend selection and uses
direct CDP mode with Chromium semantics. The positional `<url>` remains the
page to inspect. If an existing page in the CDP session already has that URL,
`css-view` snapshots it. Otherwise it uses an available page or creates one,
navigates it to the requested URL, waits for the requested lifecycle event, and
then captures the DOM snapshot.

## Local Playwright backend

Use the Playwright backend when walker mode or a browser launched by
Playwright rather than `agent-browser` is needed:

```bash
bunx playwright install chromium firefox webkit
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --backend playwright \
  --mode walker \
  --browser firefox \
  --pretty
```

For local Playwright CDP captures, use Chromium:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --backend playwright \
  --mode cdp \
  --browser chromium \
  --pretty
```

Do not pass untrusted CDP URLs. A CDP endpoint can control the browser, inspect
page content, and interact with authenticated sessions. Keep local debugging
ports bound to loopback interfaces and treat provider-issued WebSocket URLs as
secrets.

## Troubleshooting

- **agent-browser not found:** Install it with
  `npm install -g agent-browser`, run `agent-browser install`, and confirm
  `agent-browser --version` works on `PATH`. If it cannot be installed, pass
  `--backend playwright` and install the needed Playwright browser.
- **Browser download warnings:** For local Playwright captures, install the
  missing system libraries named in the Playwright warning banner, then re-run
  `bunx playwright install ...`.
- **CDP connection failures:** Confirm that `agent-browser get cdp-url` still
  returns a live endpoint and that no firewall or provider policy blocks the
  WebSocket connection.
- **Invalid bridge option combinations:** `--cdp-url` requires `--mode cdp`
  and cannot be combined with `--browser`, because the CDP endpoint already
  selects the browser. `--backend agent-browser` requires CDP mode and cannot
  be combined with `--browser`. `--use-current-page` requires the
  `agent-browser` backend.
- **Navigation timeouts:** Adjust `--timeout` or use `--wait-until load` for
  pages with continuous network chatter.
- **"Event stream closed" on stderr:** When `agent-browser` is starting a cold
  session, the first `open` call can race the event-stream handshake and exit
  non-zero with `"Event stream closed"` on stderr. `css-view` automatically
  retries the `open` command once. You will see a
  `[agent-browser] Transient open failure detected` warning on stderr, followed
  by `[agent-browser] Retry succeeded.` if recovery succeeds. If the retry also
  fails, the second error is reported and `css-view` exits non-zero. Verify
  that the `agent-browser` daemon is running (`agent-browser --version`) and
  retry the command.
- **Large pages:** Use `--max-nodes` (walker) or pare down the property list to
  reduce output size.

## Licensing

`css-view` is distributed under the terms of the [ISC Licence](../LICENSE).
