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
- `--inherited` or `--inherited-file` (walker only) to override inheritance
  comparisons.
- `--viewport-width` / `--viewport-height` to capture with a specific browser
  viewport. If you set only one dimension, the other uses Playwright's default
  `1280x720` value.
- `--display-pixel-resolution` to override the browser device scale factor with
  a whole-number DPR.
- `--wait-until` to pick the navigation lifecycle (`load`,
  `domcontentloaded`, or `networkidle`).
- `--output` to write JSON to a file rather than standard output.
- `--pretty` to format JSON for easier inspection.

Refer to `docs/css-view.md` for the full option matrix and payload schema.

## Troubleshooting

- **Browser download warnings:** Install the missing system libraries named in
  the Playwright warning banner, then re-run `bunx playwright install ...`.
- **Navigation timeouts:** Adjust `--timeout` or use `--wait-until load` for
  pages with continuous network chatter.
- **Large pages:** Use `--max-nodes` (walker) or pare down the property list to
  reduce output size.

## Licensing

`css-view` is distributed under the terms of the [ISC License](../LICENSE).
