# css-view

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](
https://deepwiki.com/leynos/css-view)

`css-view` is a Bun command-line tool that captures computed CSS snapshots using
`agent-browser`, a direct Chromium DevTools Protocol (CDP) endpoint, or a
local Playwright browser. It is distributed under the [ISC Licence](LICENSE).

## Quick start

```bash
bun install
npm install -g agent-browser
agent-browser install
bun run bin/css-view.ts https://example.org --pretty
```

On Fedora and Rocky, `agent-browser` is the recommended backend. `css-view`
uses it by default when the `agent-browser` binary is on `PATH`; pass
`--backend playwright` only for a local Playwright browser launch or
walker-mode capture.

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
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

The JSON output includes a CDP payload with a node for
`<h1 id="title" class="hero">Hello World</h1>`. That node reports computed
values such as `color: rgb(34, 34, 136)` and `font-size: 32px`.

To make the backend explicit or reuse a named `agent-browser` session:

```bash
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --backend agent-browser \
  --agent-browser-session css-view \
  --props color,font-size,background-color,display \
  --wait-until load \
  --pretty
```

To snapshot the active page in that session without navigating:

```bash
bun run bin/css-view.ts \
  --backend agent-browser \
  --agent-browser-session css-view \
  --use-current-page \
  --pretty
```

When a CDP endpoint already exists, bypass backend selection with `--cdp-url`:

```bash
CDP_URL="$(agent-browser --session css-view get cdp-url)"
bun run bin/css-view.ts "http://127.0.0.1:${PORT}/index.html" \
  --mode cdp \
  --cdp-url "$CDP_URL" \
  --pretty
```

### Global install

To expose `css-view` system-wide, pack the project and install the generated
archive by absolute path:

```bash
bun pm pack
bun install -g "$(pwd)/css-view-<VERSION>.tgz"
```

Ensure `~/.bun/bin` (or the directory reported by `bun pm bin`) is on your
`PATH` because that is where Bun places the linked executable. The package does
not download Playwright browsers during `postinstall`; install `agent-browser`
for the default backend or install Playwright browsers manually only for local
Playwright captures. `bun install -g .` currently fails on Bun 1.3.11 with an
internal dependency-loop error, so avoid installing directly from the package
directory.

When installing from a packaged tarball, Bun needs an absolute path:

```bash
bun install -g "$(pwd)/css-view-<VERSION>.tgz"
```

If you hit a corrupt global manifest, see
[docs/users-guide.md](docs/users-guide.md) for the recovery steps.

Run `scripts/install.sh` from the repository root to pack the project and run
the absolute-path install automatically.

Full installation, configuration, and troubleshooting steps are covered in
[docs/users-guide.md](docs/users-guide.md).
