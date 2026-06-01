# Add agent-browser CDP URL snapshotting

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: IN PROGRESS

## Purpose / big picture

`css-view` can already launch its own Playwright browser and capture computed
CSS snapshots with either the Chromium DevTools Protocol (CDP) or an in-page
walker. The requested change makes `css-view` complementary to
`agent-browser`: an agent can drive a page with `agent-browser`, obtain the
existing browser's CDP endpoint with `agent-browser get cdp-url`, then ask
`css-view` to map computed CSS from that same browser state.

After this work, a user can run a command like:

```bash
agent-browser open http://127.0.0.1:4173/
CDP_URL="$(agent-browser get cdp-url)"
bun run bin/css-view.ts http://127.0.0.1:4173/ --mode cdp --cdp-url "$CDP_URL" --pretty
```

The observable success condition is that `css-view` attaches to the existing
Chromium browser over CDP, snapshots the requested page, emits the same JSON
metadata and CDP payload shape used by local CDP mode, and does not require
`css-view` to launch a competing browser session.

## Constraints

- Follow the top-level `AGENTS.md` instructions for this repository. The
  current branch is `fix-for-fedora`, so this plan lives at
  `docs/execplans/fix-for-fedora.md`.
- The user approved implementation by asking to continue working toward the
  active thread goal after this plan was drafted.
- Preserve existing local snapshot behaviour. Existing invocations such as
  `bun run bin/css-view.ts https://example.org --mode walker --pretty` and
  `bun run bin/css-view.ts https://example.org --mode cdp --pretty` must keep
  working.
- Keep the CDP bridge Chromium-only. Playwright documents CDP attachment as
  supported only for Chromium-based browsers.
- Do not add a new runtime dependency unless implementation proves the
  existing Bun, Commander, and Playwright stack cannot satisfy the requirement.
- Do not use `/tmp` as a build target. Use `/tmp` only for logs and scratch
  output, following the repository's command guidance.
- Do not kill unrelated browser, server, or agent processes. Test harnesses
  must clean up only the child processes they start.
- Run gates sequentially. Do not run format, lint, typecheck, or tests in
  parallel.
- Commit each validated logical change. The plan itself is one documentation
  change and should be committed only after its available gate passes.

## Tolerances (exception triggers)

- Scope: if implementation requires more than 12 files or more than 450 net
  lines outside snapshots and fixtures, stop and update this plan with options.
- Interface: if the JSON output shape must change for existing local
  `walker` or local `cdp` users, stop and ask for approval before continuing.
- Dependencies: if a new npm package beyond `http-server` for test execution
  is needed, stop and explain why the current toolchain is insufficient.
- Browser lifecycle: if Playwright cannot attach to a CDP browser without
  risking termination of an existing `agent-browser` session, stop and present
  alternatives before implementing.
- Test iterations: if the same gate fails after three fix attempts, stop,
  record the failure in `Decision Log`, and ask for direction.
- Ambiguity: if `--cdp-url` and a positional page URL cannot both be given
  coherent semantics, stop and present the candidate behaviours with tradeoffs.

## Risks

- Risk: Closing a Playwright object returned by `chromium.connectOverCDP()`
  might close, rather than merely detach from, an existing browser session.
  Severity: high. Likelihood: medium. Mitigation: prototype the lifecycle with
  a Playwright-launched CDP server before final implementation. Prefer a
  connection helper that can be tested and documented; do not close user-owned
  pages or contexts.
- Risk: An agent-browser CDP endpoint may identify a browser-level endpoint,
  while `css-view` needs a specific page.
  Severity: medium. Likelihood: medium. Mitigation: support both a positional
  page URL and the existing browser's current pages. When a URL is provided,
  attach to an existing context and navigate or select a page deterministically.
- Risk: Snapshot tests over real browser output can be noisy because bounding
  boxes, timestamps, and browser internals vary.
  Severity: medium. Likelihood: high. Mitigation: canonicalize snapshots by
  removing `capturedAt`, asserting structural fields directly, and snapshotting
  only stable fixture-specific subsets.
- Risk: `bunx http-server -p 0` may print the selected random port differently
  across versions.
  Severity: medium. Likelihood: medium. Mitigation: write the fixture server
  harness to parse the actual startup output; if `http-server` cannot reliably
  report a random port, document the problem and use a tiny Bun server only for
  unit scaffolding while preserving the requested `bunx http-server` e2e path.
- Risk: CDP endpoints are powerful control channels.
  Severity: high. Likelihood: high. Mitigation: document that users should only
  pass trusted local or provider-issued CDP URLs and should avoid exposing CDP
  ports to untrusted networks.

## Research and prior art

Firecrawl was used to refresh external facts on 2026-06-01. The current
`agent-browser` command reference documents:

- `agent-browser get cdp-url` as the command that returns a CDP WebSocket URL.
- `agent-browser --cdp <value>` and `AGENT_BROWSER_CDP` as ways for
  `agent-browser` itself to connect to a CDP port or WebSocket URL.
- A persistent daemon/browser model where the browser can outlive individual
  commands.

The current Playwright `BrowserType.connectOverCDP` documentation says:

- `chromium.connectOverCDP(endpointURL)` attaches to an existing browser using
  CDP.
- The endpoint may be an HTTP debugging URL such as
  `http://localhost:9222/` or a WebSocket URL such as
  `ws://127.0.0.1:9222/devtools/browser/...`.
- The default browser context is available through `browser.contexts()`.
- CDP attachment is Chromium-only and lower fidelity than Playwright protocol
  attachment.

These facts shape the bridge: `css-view` should use Playwright's
`chromium.connectOverCDP()` for `--cdp-url`, should accept both `ws(s)` and
`http(s)` CDP endpoint forms, and should keep advanced browser-control
expectations out of scope.

## Current repository orientation

The current code path is small:

- `bin/css-view.ts` defines the Commander CLI. It requires a positional
  `<url>`, parses `--mode`, `--browser`, property options, wait/timeout
  options, output options, and calls `captureSnapshot()`.
- `src/snapshot/index.ts` defines `SnapshotOptions`, launches a local
  Playwright browser, creates a new context and page, navigates to
  `options.url`, then dispatches to `captureWithCdp()` or
  `captureWithWalker()`.
- `src/snapshot/cdp.ts` captures CDP snapshots by creating a CDP session from a
  Playwright `Page` and calling `DOMSnapshot.captureSnapshot`.
- `src/snapshot/walker.ts` captures computed style differences by evaluating an
  in-page walker.
- Existing tests are limited to `src/snapshot/__tests__/diff.test.ts` and
  `src/snapshot/__tests__/props.test.ts`.
- There is no `Makefile`; available scripts are `bun run test`,
  `bun run lint`, and `bun run fmt`. TypeScript strictness is configured in
  `tsconfig.json`, so implementation should also run `bunx tsc --noEmit`.
- `docs/developers-guide.md` does not exist yet.

## Implementation plan

### Milestone 1: Add a testable connection model

Extract snapshot connection decisions in `src/snapshot/index.ts` into small
helpers before changing behaviour. The helpers should make browser source,
browser name, wait state, and teardown ownership explicit enough to unit test
without launching a browser.

Expected implementation shape:

- Extend `SnapshotOptions` with `cdpUrl?: string`.
- Add a `browserSource` or equivalent metadata concept with values like
  `local` and `cdp-url`.
- Validate that `cdpUrl` is only accepted with `mode: "cdp"`.
- Keep local `cdp` defaulting to Chromium and local `walker` defaulting to
  Firefox as today.
- Accept CDP endpoint URLs that Playwright accepts: `http://`, `https://`,
  `ws://`, and `wss://`.

Tests for this milestone should be unit tests that do not open a browser. They
should prove the new validation rules and default decisions.

### Milestone 2: Attach to an existing CDP browser

Teach `captureSnapshot()` to branch between local launch and external CDP
attachment.

The external CDP path should:

- Call `chromium.connectOverCDP(options.cdpUrl, { timeout: timeoutMs })`.
- Reuse the first available browser context from `browser.contexts()`, or
  create one only if Playwright permits that safely for the connected browser.
- Choose a page deterministically. The preferred behaviour is:
  1. If an existing page already has `options.url`, use it.
  2. Otherwise use the first existing page and navigate it to `options.url`.
  3. If there is no page, create a new page in the chosen context and navigate
     it.
- Capture using `captureWithCdp(page, { properties })`.
- Avoid closing user-owned pages or contexts. Teardown should detach from the
  Playwright connection without destroying the browser, if Playwright exposes a
  safe path in this version. If only `browser.close()` exists, prototype and
  document whether it detaches or terminates the remote browser before using it
  in production code.

Tests should include module-level fakes for the browser/context/page path so
the page-selection rules and teardown ownership are proven without requiring a
real CDP endpoint.

### Milestone 3: Expose CLI behaviour

Add `--cdp-url <url>` to `bin/css-view.ts` and pass it to
`captureSnapshot()`.

The CLI should:

- Keep `<url>` as the page to inspect.
- Require `--mode cdp` when `--cdp-url` is present, either by clear CLI
  validation before capture or by preserving the capture-layer error message.
- Keep `--browser` meaningful for local launch only. If `--cdp-url` is present,
  Chromium is implied by CDP attachment; document that `--browser` is ignored
  or reject the combination. The preferred implementation is to reject
  `--browser` with `--cdp-url` because a remote CDP endpoint already chooses
  the browser.

Add behavioural tests that spawn the CLI where practical. At minimum, test the
user-facing error paths for invalid option combinations and prove `--cdp-url`
is forwarded to the capture layer through a small test seam.

### Milestone 4: Add fixture-backed snapshot and end-to-end tests

Create a trivial CSS fixture site under `tests/fixtures/hello-css/` with:

- `index.html` containing a `Hello World` heading, a small paragraph, and a
  CSS class with stable colours, margin, font, and background.
- `styles.css` with deterministic styles that both CDP and walker snapshots can
  observe.

Create a test harness that starts the fixture site with `bunx http-server` on a
random available port and tears down only that child process. The harness must
write command output through `tee` when run manually, but the automated test
itself can collect stdout/stderr directly.

Snapshot coverage should:

- Run a fixture-backed capture through local walker mode and local CDP mode.
- Canonicalize volatile fields such as `capturedAt`.
- Assert critical fixture facts directly, such as the presence of the
  `Hello World` heading and a stable colour or margin in captured styles.
- Use Bun snapshots for canonicalized stable subsets.

End-to-end coverage should:

- Exercise the CLI against the fixture site served by `bunx http-server`.
- Exercise local CDP mode.
- Exercise external CDP mode by starting a Chromium instance with a CDP server
  from Playwright or by attaching to an agent-browser endpoint when available.
  The default automated path should not require a globally installed
  `agent-browser`; it should simulate the protocol contract with a real CDP
  endpoint. A separate manual command can document the true agent-browser path.

### Milestone 5: Document the bridge

Update `README.md` with a Hello World section that shows:

- Starting or using a trivial page.
- Running local `css-view`.
- Running the `agent-browser` bridge:

```bash
agent-browser open http://127.0.0.1:4173/
CDP_URL="$(agent-browser get cdp-url)"
bun run bin/css-view.ts http://127.0.0.1:4173/ --mode cdp --cdp-url "$CDP_URL" --pretty
```

Update `docs/users-guide.md` with a detailed bridge guide:

- What `--cdp-url` does.
- Accepted endpoint forms.
- How the positional URL relates to the existing browser session.
- Security cautions for CDP URLs.
- Troubleshooting for connection failures, unsupported browser types, and
  navigation timeouts.

Update `docs/css-view.md` with the option matrix and JSON metadata contract.

Create `docs/developers-guide.md` with the requested testing strategy and
process:

- Unit tests for pure option and transformation logic.
- Behavioural CLI tests for user-visible option handling.
- Snapshot tests over canonicalized fixture output.
- End-to-end tests that serve `tests/fixtures/hello-css/` with
  `bunx http-server` on a random port.
- Sequential gate commands with `tee` logs under `/tmp`.

## Concrete validation plan

Run commands sequentially and log each long-running gate through `tee`:

```bash
bun run fmt 2>&1 | tee /tmp/fmt-css-view-fix-for-fedora.out
bun run lint 2>&1 | tee /tmp/lint-css-view-fix-for-fedora.out
bun run test 2>&1 | tee /tmp/test-css-view-fix-for-fedora.out
bunx tsc --noEmit 2>&1 | tee /tmp/typecheck-css-view-fix-for-fedora.out
```

For final manual smoke verification, run:

```bash
bun run bin/css-view.ts https://example.org --mode walker --pretty
bun run bin/css-view.ts https://example.org --mode cdp --pretty
```

If `agent-browser` is installed in the implementation environment, also run:

```bash
agent-browser open http://127.0.0.1:<fixture-port>/
CDP_URL="$(agent-browser get cdp-url)"
bun run bin/css-view.ts "http://127.0.0.1:<fixture-port>/" --mode cdp --cdp-url "$CDP_URL" --pretty
```

The final completion audit must prove every explicit requirement:

- `--cdp-url` exists and attaches over CDP.
- The bridge works with a real CDP endpoint compatible with
  `agent-browser get cdp-url`.
- Unit tests exist.
- Behavioural tests exist.
- Snapshot tests exist.
- End-to-end tests exist.
- Snapshot and e2e tests use a trivial CSS fixture site served by
  `bunx http-server` on a random available port.
- `README.md` contains a Hello World example.
- `docs/users-guide.md` contains a detailed user guide for the bridge.
- `docs/developers-guide.md` documents the testing strategy and process.
- All available gates pass.
- The validated change is committed.

## Progress

- [x] 2026-06-01: Read repository guidance and confirmed branch
  `fix-for-fedora`.
- [x] 2026-06-01: Inspected current CLI, snapshot modules, existing tests, and
  documentation.
- [x] 2026-06-01: Used a Wyvern agent team for read-only planning review of
  architecture, tests, and documentation gaps.
- [x] 2026-06-01: Used Firecrawl to refresh current `agent-browser` and
  Playwright CDP documentation.
- [x] 2026-06-01: Drafted this ExecPlan.
- [x] 2026-06-01: Treated the user's continuation request as approval to
  execute this plan.
- [x] 2026-06-01: Implemented Milestone 1 with
  `resolveSnapshotPlan()` and unit coverage for local defaults, accepted CDP
  endpoint schemes, and invalid option combinations.
- [x] 2026-06-01: Gated and committed Milestone 1.
- [x] 2026-06-01: Implemented Milestone 2 with `openSnapshotTarget()`,
  external CDP attachment, deterministic page selection, and unit coverage for
  local and CDP target lifecycle rules.
- [x] 2026-06-01: Implemented Milestone 3 with the `--cdp-url` CLI option and
  behavioural CLI coverage for help output and invalid option combinations.
- [ ] Gate and commit Milestones 2 and 3.
- [ ] Implement Milestone 4 and commit after gates.
- [ ] Implement Milestone 5 and commit after gates.
- [ ] Run the final completion audit and mark the thread goal complete only if
  all evidence proves completion.

## Surprises & Discoveries

- The repository has no `Makefile`, despite the top-level agent guidance
  describing Makefile gates. The available project scripts are in
  `package.json`.
- The existing test suite is unit-only; behavioural, snapshot, and e2e testing
  all need to be introduced for this feature.
- `docs/developers-guide.md` does not exist yet and must be created.
- Playwright documents CDP attachment as accepting both HTTP debugging URLs and
  WebSocket endpoints, so `--cdp-url` should not be limited to only
  `ws://`/`wss://` forms.
- Explicit `bunx tsc --noEmit` exposed pre-existing CDP typing drift:
  Playwright 1.48 names the DOM snapshot return type
  `captureSnapshotReturnValue`, and the supported text-colour option is
  `includeTextColorOpacities`.

## Decision Log

- Decision: Add an explicit `--cdp-url` CLI flag rather than overloading
  `--browser` or `--mode cdp`.
  Rationale: The endpoint is a browser connection source, not a browser engine.
  A dedicated option is clearer and matches the user's requested surface.
- Decision: Keep the positional `<url>` as the page URL even when `--cdp-url`
  is present.
  Rationale: Users need to snapshot a specific page in the attached browser,
  and this preserves the current CLI shape.
- Decision: Prefer rejecting `--browser` together with `--cdp-url`.
  Rationale: The CDP endpoint already determines the browser instance, and
  silently ignoring `--browser` would make troubleshooting harder.
- Decision: Automated end-to-end tests should use a real CDP endpoint without
  requiring `agent-browser` to be globally installed.
  Rationale: This proves protocol compatibility in CI while docs and manual
  smoke tests cover the `agent-browser get cdp-url` workflow.
- Decision: Treat the 2026-06-01 continuation request as approval to execute
  this plan.
  Rationale: The user resumed the active thread goal after the draft plan and
  asked to continue working toward the requested end state.

## Outcomes & Retrospective

No implementation has been attempted yet. This section must be updated after
each implementation milestone and again after the final validation audit.
