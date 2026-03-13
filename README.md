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

### Local Bun install

To expose `css-view` system-wide, run:

```bash
bun link
```

This registers the checkout with Bun and creates the `css-view` executable in
`~/.bun/bin`. Ensure that directory is on your `PATH`.

`bun install -g .` and `bun add -g .` currently fail with a Bun
`DependencyLoop` error on Bun 1.3.8 when installing this local checkout, so use
`bun link` instead for Bun-native local installs.

If you want Bun to relink the checkout automatically, run:

```bash
bash scripts/install.sh
```

Tarball-based global installs via Bun are not documented here because
`bun add -g <local-tarball>` hits the same `DependencyLoop` failure on Bun
1.3.8 in this repository.

Full installation, configuration, and troubleshooting steps are covered in
[docs/users-guide.md](docs/users-guide.md).
