/**
 * Spawn `scripts/install.sh` inside a sandbox with a stubbed `bun` on `PATH`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxContext } from "./sandbox";
import { type StubBunConfig, writeStubBun } from "./stub-bun";

export interface RunInstallResult {
  /** Process exit status of the installer. */
  exitCode: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** Full contents of the stub invocation log (one invocation per line). */
  log: string;
}

/**
 * Run the sandboxed installer with the given Bun stub configuration.
 *
 * `bun pm bin -g` defaults to the sandbox bin directory so the installer
 * resolves the mock global manifest; callers may override any sub-command.
 * The stub directory is prepended to `PATH` while the rest of the environment
 * is inherited, so system tools the script relies on (`grep`, `sed`, ...)
 * remain available.
 */
export async function runInstall(
  sandbox: SandboxContext,
  stubConfig: StubBunConfig,
): Promise<RunInstallResult> {
  const stubDir = path.join(sandbox.root, "stub-bin");
  const { logPath } = await writeStubBun(stubDir, {
    "pm bin -g": { stdout: `${sandbox.binDir}\n` },
    ...stubConfig,
  });

  const proc = Bun.spawn(["bash", "scripts/install.sh"], {
    cwd: sandbox.root,
    env: {
      ...process.env,
      PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const log = await readFile(logPath, "utf8").catch(() => "");

  return { exitCode, stdout, stderr, log };
}
