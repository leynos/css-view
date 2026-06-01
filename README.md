# css-view

`css-view` is a Bun + Playwright command-line tool that captures computed CSS
snapshots using either the Chromium DevTools Protocol (CDP) or an in-page
walker. It is distributed under the [ISC License](LICENSE).

## Quick start

```bash
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bun install
BUN_INSTALL=/tmp BUN_TMPDIR=/tmp bunx playwright install chromium firefox webkit
bun run bin/css-view.ts https://example.org --mode walker --pretty
```

## Hello World

For a local "Hello World" check, serve the bundled fixture and capture its
computed styles:

```bash
PORT=4173
bunx http-server tests/fixtures/hello-css -p "$PORT" -a 127.0.0.1 -c-1
```

In another shell, run:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --mode cdp \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

The JSON output includes a CDP payload with a node for
`<h1 id="title" class="hero">Hello World</h1>`. That node reports computed
values such as `color: rgb(34, 34, 136)` and `font-size: 32px`.

To map a page already driven by `agent-browser`, pass the browser endpoint from
`agent-browser get cdp-url`:

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

### Global install

To expose `css-view` system-wide, run:

```bash
bun install -g .
```

Ensure `~/.bun/bin` (or the directory reported by `bun pm bin`) is on your
`PATH`, because that is where Bun places the linked executable. The
`postinstall` script automatically downloads the Chromium, Firefox, and WebKit
Playwright browsers so the command works immediately after the global install.

When installing from a packaged tarball (for example a release artefact), Bun
needs an absolute path:

```bash
bun install -g "$(pwd)/css-view-0.1.0.tgz"
```

Run `scripts/install.sh` from the repository root to pack the project and run
the absolute-path install automatically. The script also prints guidance for
trusting the package if Bun blocks the `postinstall` hook. To manually trust a
blocked global install run:

```bash
bun pm -g trust css-view
bun pm -g run postinstall css-view
```

Full installation, configuration, and troubleshooting steps are covered in
[docs/users-guide.md](docs/users-guide.md).
