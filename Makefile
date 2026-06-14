# Build driver for the css-view commit gates.
#
# Wraps the Bun + Biome + tsc toolchain (mirroring .github/workflows/ci.yml)
# behind the make targets the commit gates expect. `bunx @biomejs/biome`
# resolves to the pinned 1.9.x devDependency once `node_modules` exists, so
# every target depends on a populated `node_modules` to avoid falling back to
# an incompatible global Biome.

BIOME := bunx @biomejs/biome

.PHONY: all check check-fmt fmt lint typecheck test markdownlint audit install

## Run every commit gate.
all: check

check: check-fmt lint typecheck test

## Verify formatting without modifying files.
check-fmt: node_modules
	$(BIOME) format .

## Apply formatting in place.
fmt: node_modules
	$(BIOME) format --write .

## Lint sources (also enforces formatting and import ordering).
lint: node_modules
	bun run lint

## Type-check without emitting output.
typecheck: node_modules
	bunx tsc --noEmit

## Run the full test suite.
test: node_modules
	bun run test

## Lint Markdown sources.
markdownlint: node_modules
	bunx markdownlint-cli2 README.md docs/**/*.md

## Audit dependencies for advisories.
audit: node_modules
	bun audit

## Install dependencies from the lockfile.
install: node_modules

node_modules: package.json bun.lock
	bun install --frozen-lockfile
	@touch node_modules
