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
npm install -g .
```

This package still depends on Bun after installation: the executable runs via
`bun run`, and the package `postinstall` hook invokes `bunx playwright install
chromium firefox webkit`.

Local global installs with `bun install -g .` and `bun add -g .` currently fail
on Bun 1.3.8 with a `DependencyLoop` error in this repository, so use
`npm install -g` for local checkouts.

If you install from a packaged tarball, provide an absolute path:

```bash
npm install -g "$(pwd)/css-view-0.1.0.tgz"
```

The helper script `scripts/install.sh` runs the global install for you from the
repository root.

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
