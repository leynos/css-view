import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { runInstall } from "./helpers/run-install";
import { type SandboxContext, createSandbox, destroySandbox } from "./helpers/sandbox";

/** Serialise a manifest object the way the installer expects to read it. */
function manifest(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe("scripts/install.sh", () => {
  let sandbox: SandboxContext;

  beforeEach(async () => {
    sandbox = await createSandbox();
  });

  afterEach(async () => {
    await destroySandbox(sandbox);
  });

  it("packs and installs the tarball globally", async () => {
    const result = await runInstall(sandbox, {
      "pm pack": { touch: [sandbox.tarballPath] },
      "install -g": {},
    });

    expect(result.exitCode).toBe(0);

    const packIndex = result.log.indexOf("pm pack");
    const binIndex = result.log.indexOf("pm bin -g");
    const installIndex = result.log.indexOf("install -g");
    expect(packIndex).toBeGreaterThanOrEqual(0);
    expect(binIndex).toBeGreaterThan(packIndex);
    expect(installIndex).toBeGreaterThan(binIndex);

    expect(result.stdout).toContain("css-view linked globally");
  });

  it("fails when bun pm pack produces no tarball", async () => {
    const result = await runInstall(sandbox, {
      "pm pack": {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bun pm pack did not emit");
  });

  it("repairs a stale empty-key entry in the global manifest", async () => {
    await writeFile(sandbox.globalManifestPath, manifest({ dependencies: { "": "." } }));

    const result = await runInstall(sandbox, {
      "pm pack": { touch: [sandbox.tarballPath] },
      "--eval": {},
      "install -g": {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.log).toContain("--eval");
    expect(result.log).toContain(sandbox.globalManifestPath);
  });

  it("removes a pre-existing global registration before reinstalling", async () => {
    await writeFile(
      sandbox.globalManifestPath,
      manifest({ dependencies: { [sandbox.packageName]: `file:${sandbox.tarballPath}` } }),
    );

    const result = await runInstall(sandbox, {
      "pm pack": { touch: [sandbox.tarballPath] },
      "remove -g": {},
      "install -g": {},
    });

    expect(result.exitCode).toBe(0);

    const removeIndex = result.log.indexOf(`remove -g ${sandbox.packageName}`);
    const installIndex = result.log.indexOf("install -g");
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeGreaterThan(removeIndex);
  });

  it("propagates a failed global install", async () => {
    const result = await runInstall(sandbox, {
      "pm pack": { touch: [sandbox.tarballPath] },
      "install -g": { exitCode: 1 },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Global install failed");
  });
});
