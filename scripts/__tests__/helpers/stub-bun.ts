/**
 * Generate a PATH-injectable `bun` stub for exercising `scripts/install.sh`.
 *
 * The real script shells out to several `bun` sub-commands. Rather than
 * patching the script under test, the tests prepend a directory containing
 * this stub to `PATH`. The stub records every invocation and replays the
 * stdout, stderr, and exit status configured for the matched sub-command,
 * so each branch of the installer can be driven deterministically without a
 * real global Bun environment.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Bun sub-commands the installer invokes, keyed by their leading tokens. */
export type StubSubcommand = "pm pack" | "pm bin -g" | "install -g" | "remove -g" | "--eval";

export interface StubCommandConfig {
  /** Exit status the stub returns for this sub-command (default `0`). */
  exitCode?: number;
  /** Bytes written to stdout before exiting. */
  stdout?: string;
  /** Bytes written to stderr before exiting. */
  stderr?: string;
  /**
   * Absolute paths created (as empty files) when this sub-command runs.
   * `install.sh` deletes any stale tarball and then re-packs, so the success
   * path can only be reached if the `pm pack` stub emits the tarball itself.
   */
  touch?: string[];
}

export type StubBunConfig = Partial<Record<StubSubcommand, StubCommandConfig>>;

export interface StubBun {
  /** Absolute path to the generated `bun` executable. */
  bunPath: string;
  /** Absolute path to the newline-delimited invocation log. */
  logPath: string;
}

/** Quote an arbitrary string for safe embedding in a single-quoted shell word. */
function singleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build the `case` arm that replays one configured sub-command. */
function buildArm(key: StubSubcommand, config: StubCommandConfig): string {
  const lines = [`  ${singleQuote(key)})`];
  for (const file of config.touch ?? []) {
    lines.push(`    mkdir -p ${singleQuote(path.dirname(file))}`);
    lines.push(`    : > ${singleQuote(file)}`);
  }
  if (config.stdout) {
    lines.push(`    printf '%s' ${singleQuote(config.stdout)}`);
  }
  if (config.stderr) {
    lines.push(`    printf '%s' ${singleQuote(config.stderr)} >&2`);
  }
  lines.push(`    exit ${config.exitCode ?? 0}`, "    ;;");
  return lines.join("\n");
}

/**
 * Write an executable `bun` stub into `targetDir`.
 *
 * Returns the path to the stub and to the invocation log it appends to. Each
 * log line holds the space-joined arguments of one invocation, preserving call
 * order for assertions. Unconfigured sub-commands succeed silently so callers
 * only declare the branches a given test cares about.
 */
export async function writeStubBun(targetDir: string, config: StubBunConfig): Promise<StubBun> {
  const bunPath = path.join(targetDir, "bun");
  const logPath = path.join(targetDir, "invocations.log");
  const arms = (Object.keys(config) as StubSubcommand[])
    .map((key) => buildArm(key, config[key] ?? {}))
    .join("\n");

  const script = `#!/usr/bin/env bash
# Generated Bun stub — see scripts/__tests__/helpers/stub-bun.ts.
set -euo pipefail

printf '%s\\n' "$*" >> ${singleQuote(logPath)}

key=""
case "\${1:-}" in
  pm)
    case "\${2:-}" in
      pack) key="pm pack" ;;
      bin) key="pm bin -g" ;;
    esac
    ;;
  install) key="install -g" ;;
  remove) key="remove -g" ;;
  --eval) key="--eval" ;;
esac

case "$key" in
${arms}
  *)
    exit 0
    ;;
esac
`;

  await mkdir(targetDir, { recursive: true });
  await writeFile(bunPath, script);
  await chmod(bunPath, 0o755);
  return { bunPath, logPath };
}
