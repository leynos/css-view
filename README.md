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

### Global install

To expose `css-view` system-wide, run:

```bash
npm install -g .
```

This project still requires Bun at runtime: the generated `css-view` executable
uses `bun run`, and the package `postinstall` hook invokes `bunx playwright
install chromium firefox webkit`.

`bun install -g .` and `bun add -g .` currently fail with a Bun
`DependencyLoop` error on Bun 1.3.8 when installing this local checkout, so use
`npm install -g` for local global installs.

When installing from a packaged tarball (for example a release artefact), Bun
needs an absolute path:

```bash
npm install -g "$(pwd)/css-view-0.1.0.tgz"
```

Run `scripts/install.sh` from the repository root to perform the global
installation automatically.

Full installation, configuration, and troubleshooting steps are covered in
[docs/users-guide.md](docs/users-guide.md).
