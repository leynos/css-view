# User guide

This guide explains how to install, configure, and run `css-view` while
adhering to the documentation style set out in
`docs/documentation-style-guide.md`.

## Overview

`css-view` launches a Playwright browser via Bun and emits a JSON snapshot of
computed Cascading Style Sheets (CSS) data. Two capture modes are available:

- `cdp` contacts the Chromium DevTools Protocol (CDP) to retrieve DOM snapshots
  with explicitly whitelisted properties.
- `walker` runs an in-page script that diffs `getComputedStyle` output against
  inherited values and user agent defaults.

See `docs/css-view.md` for the architectural background and option reference.

## Requirements

- Bun 1.3 or newer.
- Playwright 1.48 or newer.
- Chromium, Firefox, and WebKit browser binaries downloaded via Playwright.
- Linux systems must provide ICU, JPEG, WebP, and FFI libraries as listed in
  the Playwright dependency validator.

## Installation

```bash
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bun install
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bunx playwright install chromium firefox webkit
```

The Playwright installer warns if shared libraries are missing. Install the
packages flagged in the warning before attempting a capture run.

### Global installation

You can expose the CLI globally with:

```bash
bun install -g .
```

Add the Bun binary directory (`~/.bun/bin` by default) to your `PATH`, so the
`css-view` command resolves everywhere. The package `postinstall` hook runs
`playwright install chromium firefox webkit` automatically to ensure browser
binaries exist after the global install.

If you install from a packaged tarball, provide an absolute path:

```bash
bun install -g "$(pwd)/css-view-0.1.0.tgz"
```

The helper script `scripts/install.sh` packs the project, resolves the
absolute archive path, and invokes the global install for you. Bun may block
the `postinstall` hook on untrusted packages; inspect the queue with
`bun pm -g untrusted`, then trust and rerun the hook:

```bash
bun pm -g trust css-view
bun pm -g run postinstall css-view
```

## Running snapshots

```bash
bun run bin/css-view.ts <url> --mode <cdp|walker> [options]
```

Common options include:

- `--props` or `--props-file` to override the computed-style whitelist.
- `--cdp-url` to attach CDP mode to an existing Chromium debugging endpoint
  instead of launching a new browser.
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
  --mode cdp \
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

`agent-browser` is useful for driving a page through login flows, clicks,
forms, and navigation. `css-view` can then attach to that same browser session
and capture computed CSS from the page state the agent already reached.

Use `agent-browser get cdp-url` to obtain the Chromium DevTools Protocol
endpoint:

```bash
agent-browser open "http://127.0.0.1:${PORT}/index.html"
CDP_URL="$(agent-browser get cdp-url)"
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --mode cdp \
  --cdp-url "$CDP_URL" \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

`--cdp-url` accepts browser-level CDP endpoints in these forms:

- `http://127.0.0.1:9222/`
- `https://browser-provider.example/session`
- `ws://127.0.0.1:9222/devtools/browser/<id>`
- `wss://browser-provider.example/devtools/browser/<id>`

When `--cdp-url` is present, `css-view` uses CDP mode and Chromium semantics.
The positional `<url>` remains the page to inspect. If an existing page in the
CDP session already has that URL, `css-view` snapshots it. Otherwise it uses an
available page or creates one, navigates it to the requested URL, waits for the
requested lifecycle event, and then captures the DOM snapshot.

Do not pass untrusted CDP URLs. A CDP endpoint can control the browser, inspect
page content, and interact with authenticated sessions. Keep local debugging
ports bound to loopback interfaces and treat provider-issued WebSocket URLs as
secrets.

## Troubleshooting

- **Browser download warnings:** Install the missing system libraries named in
  the Playwright warning banner, then re-run `bunx playwright install ...`.
- **CDP connection failures:** Confirm that `agent-browser get cdp-url` still
  returns a live endpoint and that no firewall or provider policy blocks the
  WebSocket connection.
- **Invalid bridge option combinations:** `--cdp-url` requires `--mode cdp`.
  It cannot be combined with `--browser`, because the CDP endpoint already
  selects the browser.
- **Navigation timeouts:** Adjust `--timeout` or use `--wait-until load` for
  pages with continuous network chatter.
- **Large pages:** Use `--max-nodes` (walker) or pare down the property list to
  reduce output size.

## Licensing

`css-view` is distributed under the terms of the [ISC License](../LICENSE).
