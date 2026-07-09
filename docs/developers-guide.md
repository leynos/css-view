# Developers guide

This guide describes how to change `css-view` safely and how the test suite is
structured.

## Module map

- `bin/css-view.ts` owns command-line parsing and forwards normalized options
  into the snapshot layer.
- `src/cli/backend.ts` owns CLI backend selection. It defaults to
  `agent-browser` when the binary is on `PATH`, falls back to Playwright when
  it is not, and preserves direct `--cdp-url` capture as an explicit bypass.
- `src/snapshot/agent-browser-backend.ts` owns the shell-out adapter for
  `agent-browser` sessions, including page opening, CDP URL discovery, and
  active page-tab lookup for current-page captures. Non-page tabs, such as
  DevTools or extension targets, must be ignored before CDP target selection.
- `src/snapshot/index.ts` owns snapshot planning, browser target selection, and
  top-level result metadata.
- `src/snapshot/cdp.ts` owns Chromium DevTools Protocol capture. Local CDP
  captures use Playwright's page CDP session. External `--cdp-url` captures use
  a direct CDP WebSocket client so Bun can attach to agent-browser-style
  endpoints without launching another browser.
- `src/snapshot/walker.ts` owns the in-page computed-style walker used by
  walker mode.
- `src/test-support/fixture-server.ts` owns shared fixture-server helpers for
  browser-backed tests.

## Test layers

Use the smallest layer that proves the behaviour being changed.

- **Unit tests** live beside source modules under `src/**/__tests__`. They
  cover pure transformations, option validation, and fake browser target
  selection. Examples include `options.test.ts`, `connection.test.ts`,
  `src/cli/__tests__/backend.test.ts`, and the existing diff/property resolver
  tests.
- **Behavioural tests** exercise user-visible CLI behaviour without requiring a
  real browser when possible. `src/cli/__tests__/css-view.test.ts` spawns the
  CLI and verifies help output and invalid option combinations.
- **Snapshot tests** capture stable subsets of real browser output.
  `src/snapshot/__tests__/fixture-snapshot.test.ts` serves the fixture page,
  captures walker and CDP results, removes volatile fields by construction, and
  stores Bun snapshot baselines under `src/snapshot/__tests__/__snapshots__/`.
- **End-to-end tests** exercise the real CLI and browser protocol path.
  `src/e2e/__tests__/cdp-url.test.ts` starts the fixture, launches Chromium
  with a CDP debugging port, and verifies that `css-view --cdp-url` captures
  the existing page's computed CSS.
- **Script integration tests** exercise `scripts/install.sh` end-to-end
  without a real global Bun environment or network access. The suite lives at
  `scripts/__tests__/install.test.ts`. Each test runs the script inside a
  throwaway sandbox (`scripts/__tests__/helpers/sandbox.ts`) containing a
  mock `package.json` and a mock Bun global prefix. A generated `bun` stub
  is prepended to `PATH`; it records every invocation and replays a
  configured stdout, stderr, and exit status
  (`scripts/__tests__/helpers/stub-bun.ts`,
  `scripts/__tests__/helpers/run-install.ts`). Because `install.sh` deletes
  any stale tarball before re-packing, the `bun pm pack` stub creates the
  tarball itself so the success path is reachable. Covered branches include
  successful install, missing-tarball failure, stale empty-key (`"": "."`)
  manifest repair, pre-existing registration removal, and
  install-failure propagation.

## Fixture server policy

Browser-backed tests use the trivial CSS fixture in
`tests/fixtures/hello-css`. The tests must serve it with `bunx http-server`.
Because `http-server -p 0` does not reliably expose an OS-selected ephemeral
port in version 14.1.1, the helper first reserves a random available loopback
port and then starts:

```bash
bunx http-server tests/fixtures/hello-css -p "$PORT" -a 127.0.0.1 -c-1
```

The helper polls `http://127.0.0.1:$PORT/index.html` until it responds. Tests
must call the returned `close()` method so only their own child process is
terminated.

## Snapshot maintenance

Snapshot tests must assert important fixture facts directly before matching a
snapshot. Keep snapshots focused on stable subsets rather than full browser
payloads. Do not snapshot `capturedAt`, raw bounding boxes, or full page trees
unless the change specifically requires that contract.

When a deliberate output change affects snapshots, update them with:

```bash
bun test --update-snapshots src/snapshot/__tests__/fixture-snapshot.test.ts
```

Review the snapshot diff before committing. A snapshot update is acceptable
only when the changed output is part of the intended behaviour.

## Gate commands

Run gates sequentially and log output through `tee`:

```bash
bun run lint 2>&1 | tee /tmp/lint-css-view-$(git branch --show).out
bun run test 2>&1 | tee /tmp/test-css-view-$(git branch --show).out
bunx tsc --noEmit 2>&1 | tee /tmp/typecheck-css-view-$(git branch --show).out
```

Use `bun run fmt` when Biome reports formatting differences:

```bash
bun run fmt 2>&1 | tee /tmp/fmt-css-view-$(git branch --show).out
```

The `Makefile` provides convenience wrappers over the above commands,
mirroring the CI order:

```bash
make check-fmt   # verify formatting without modifying files
make lint        # lint and verify import organisation
make typecheck   # type-check TypeScript sources and tests
make test        # run the full test suite
make fmt         # apply formatting in place
make check       # run all gates in CI order (check-fmt lint typecheck test)
```

The default runtime backend uses `agent-browser`. For local smoke testing of
that path, install:

```bash
npm install -g agent-browser
agent-browser install
```

Browser-backed tests that launch Chromium directly require Playwright's
Chromium browser. Install it with the project toolchain when the cache is
empty:

```bash
bunx playwright install chromium
```

Do not run these gates in parallel. The browser cache, Bun cache, and
http-server child processes are shared host resources.

`bun run test` intentionally runs e2e, CLI, and snapshot/unit suites in
separate serial Bun invocations. Keeping process-heavy browser suites isolated
prevents a previous suite's child-process state from affecting later CLI
subprocess assertions.

## Build and tooling

### Bun version requirement

Bun >= 1.3.11 is required. The `engines` field in `package.json` enforces this.
`bun install -g .` fails on Bun 1.3.11 due to an internal dependency-loop bug;
use `scripts/install.sh` for global installs. The helper packs the project with
`bun pm pack` and installs the resulting tarball by absolute path, which avoids
the bug. The script's behaviour is covered by the script integration tests
described in the "Test layers" section above.

### TypeScript configuration

`tsconfig.json` uses `moduleResolution: "bundler"` and lists `@types/bun` in
the `types` array for Bun ambient types. Do not revert to `"node"` or
`"node10"` resolution; both are deprecated in TypeScript 5 and break Bun's
package-export resolution.

### CI workflow

GitHub Actions runs on `ubuntu-latest`. The workflow installs Bun via the
`oven-sh/setup-bun` action, restores a frozen lockfile with
`bun install --frozen-lockfile`, installs Playwright Chromium for browser-backed
tests, and then runs format, lint, typecheck, Markdown lint, tests, and
`bun audit` in sequence. The workflow does not cache `node_modules` — it always
restores from the lockfile so that CI catches lockfile drift. A top-level
`concurrency` block cancels any in-progress run for the same ref when a new
event triggers.

### Transient retry mechanism

`AgentBrowserBackend.run()` retries the `open` command once when it detects
exit code != 0 and stderr containing `"Event stream closed"`. This handles a
cold-start race in `agent-browser` where the first command after starting a
session can race the event-stream handshake. The retry delay is configurable
via the `transientOpenFailureDelayMs` option (default 500 ms). Suppress the
delay in tests by passing `transientOpenFailureDelayMs: 0`. Non-transient
failures are surfaced to the caller without retry. Both the retry decision and
a successful retry are logged to stderr via `console.warn`.
