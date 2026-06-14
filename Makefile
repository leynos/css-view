# Code quality gates for css-view.
#
# Thin wrappers over the project's Bun and Biome tooling so the standard
# check-fmt, lint, typecheck, and test targets are available. These mirror the
# commit gates exercised in .github/workflows/ci.yml.

.PHONY: all check fmt check-fmt lint typecheck test

all: check

# Run every code gate in the order CI does.
check: check-fmt lint typecheck test

# Apply formatting in place.
fmt:
	bunx @biomejs/biome format --write .

# Verify formatting without modifying files.
check-fmt:
	bunx @biomejs/biome format .

# Lint and verify import organisation.
lint:
	bun run lint

# Type-check the TypeScript sources and tests.
typecheck:
	bunx tsc --noEmit

# Run the full test suite.
test:
	bun run test
