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
- `src/snapshot/retry-adapter.ts` — injectable resilience adapter
  (`RetryAdapter` interface) abstracting the retry delay and operator logging;
  `defaultRetryAdapter` is the production implementation backed by `Bun.sleep`
  and `console.warn`.
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
- `src/test-support/recording-retry-adapter.ts` —
  `createRecordingRetryAdapter()` test double that records `sleep` durations
  and `warn` messages without blocking, for asserting the retry contract.

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

### Makefile targets

A `Makefile` at the repo root wraps the Bun/Biome/tsc toolchain. Each target
ensures dependencies are installed via `bun install --frozen-lockfile` before
running, so `bunx @biomejs/biome` resolves to the pinned 1.9.x devDependency
rather than an incompatible global Biome.

- `make check` runs every commit gate: check-fmt, lint, typecheck, test,
  markdownlint, and audit.
- `make check-fmt` verifies formatting without modifying files.
- `make fmt` applies formatting in place.
- `make lint` lints sources via Biome.
- `make typecheck` type-checks without emitting output (`tsc --noEmit`).
- `make test` runs the full test suite.
- `make markdownlint` lints Markdown sources.
- `make nixie` validates Mermaid diagrams in Markdown sources.
- `make audit` audits dependencies for advisories.

### Running gates manually

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
the bug.

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
via the `transientOpenFailureDelayMs` option (default 500 ms). Non-transient
failures are surfaced to the caller without retry.

The delay and operator warnings are delegated to an injectable `RetryAdapter`
(constructor option `retryAdapter`, defaulting to `defaultRetryAdapter` from
`src/snapshot/retry-adapter.ts`). This decouples the domain retry policy from
the `Bun.sleep` and `console.warn` infrastructure.

Tests inject `createRecordingRetryAdapter()` (from
`src/test-support/recording-retry-adapter.ts`) in place of
`defaultRetryAdapter`. The recording adapter resolves `sleep` immediately and
captures both the sleep durations and warning messages, so the retry timing and
logging contract can be asserted directly without an actual delay.
