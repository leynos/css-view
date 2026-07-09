/**
 * Per-test filesystem sandbox for `scripts/install.sh` integration tests.
 *
 * `install.sh` resolves its own location to derive the repository root, `cd`s
 * there, and reads `package.json` from it. To exercise the script against
 * controlled inputs, the sandbox holds a copy of the script alongside a mock
 * `package.json` and a mock Bun global prefix, so the script operates entirely
 * within the temporary directory and never touches the real repository or a
 * real global install.
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Resolved paths and metadata for one sandbox instance. */
export interface SandboxContext {
  /** Root of the sandbox; the installer treats this as the repository root. */
  root: string;
  /** Package name written to the mock `package.json`. */
  packageName: string;
  /** Package version written to the mock `package.json`. */
  packageVersion: string;
  /** Absolute path to the mock project `package.json`. */
  packageJsonPath: string;
  /** Absolute path to the mock Bun global manifest. */
  globalManifestPath: string;
  /** Absolute path to the mock Bun global bin directory. */
  binDir: string;
  /** Absolute path to the tarball the installer expects `bun pm pack` to emit. */
  tarballPath: string;
}

const SCRIPT_SOURCE = path.resolve(import.meta.dir, "..", "..", "install.sh");
const PACKAGE_NAME = "css-view-test";
const PACKAGE_VERSION = "0.0.0";

/**
 * Create an isolated sandbox with a copy of the installer and mock metadata.
 *
 * The Bun global prefix mirrors the real layout: `bun pm bin -g` resolves to
 * `<root>/bun-global/bin`, whose parent the installer joins with
 * `install/global/package.json` to find the global manifest.
 */
export async function createSandbox(): Promise<SandboxContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), "install-sh-"));

  const packageJsonPath = path.join(root, "package.json");
  await writeFile(
    packageJsonPath,
    `${JSON.stringify({ name: PACKAGE_NAME, version: PACKAGE_VERSION }, null, 2)}\n`,
  );

  const scriptsDir = path.join(root, "scripts");
  await mkdir(scriptsDir, { recursive: true });
  await copyFile(SCRIPT_SOURCE, path.join(scriptsDir, "install.sh"));

  const binDir = path.join(root, "bun-global", "bin");
  await mkdir(binDir, { recursive: true });

  const globalDir = path.join(root, "bun-global", "install", "global");
  await mkdir(globalDir, { recursive: true });
  const globalManifestPath = path.join(globalDir, "package.json");
  await writeFile(globalManifestPath, `${JSON.stringify({ dependencies: {} }, null, 2)}\n`);

  return {
    root,
    packageName: PACKAGE_NAME,
    packageVersion: PACKAGE_VERSION,
    packageJsonPath,
    globalManifestPath,
    binDir,
    tarballPath: path.join(root, `${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`),
  };
}

/** Recursively remove a sandbox created by {@link createSandbox}. */
export async function destroySandbox(sandbox: SandboxContext): Promise<void> {
  await rm(sandbox.root, { recursive: true, force: true });
}
