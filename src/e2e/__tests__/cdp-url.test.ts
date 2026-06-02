import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  type FixtureServer,
  findAvailablePort,
  startHelloCssFixtureServer,
} from "../../test-support/fixture-server";

async function runCssView(args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", "bin/css-view.ts", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function stopProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  proc.kill();
  const exited = proc.exited.then(() => undefined);
  await Promise.race([exited, Bun.sleep(2000)]);
  proc.kill("SIGKILL");
  await Promise.race([exited, Bun.sleep(2000)]);
}

async function waitForCdpPage(cdpPort: number, expectedUrl: string): Promise<void> {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        const pages = (await response.json()) as Array<{ url?: string }>;
        if (pages.some((page) => page.url === expectedUrl)) {
          return;
        }
      }
    } catch {
      // Chrome may still be starting the remote debugging endpoint.
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for Chromium CDP page");
}

describe("css-view --cdp-url end-to-end", () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startHelloCssFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("captures CSS from an existing Chromium CDP session", async () => {
    const cdpPort = await findAvailablePort();
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "css-view-cdp-"));
    const fixtureUrl = `${server.origin}/index.html`;
    const browserProcess = Bun.spawn(
      [
        chromium.executablePath(),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        fixtureUrl,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    try {
      await waitForCdpPage(cdpPort, fixtureUrl);

      const result = await runCssView([
        fixtureUrl,
        "--mode",
        "cdp",
        "--cdp-url",
        `http://127.0.0.1:${cdpPort}`,
        "--props",
        "color,font-size,background-color,display",
        "--wait-until",
        "load",
        "--timeout",
        "10000",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const payload = JSON.parse(result.stdout);
      const title = payload.payload.nodes.find(
        (node: { attributes: Record<string, string> }) => node.attributes.id === "title",
      );
      const titleText = title.children
        .map((index: number) => payload.payload.nodes[index])
        .find((node: { nodeType: number }) => node.nodeType === 3);

      expect(payload.mode).toBe("cdp");
      expect(payload.browser).toBe("chromium");
      expect(titleText.layoutText).toBe("Hello World");
      expect(title.computedStyles.color).toBe("rgb(34, 34, 136)");
      expect(title.computedStyles["font-size"]).toBe("32px");
    } finally {
      await stopProcess(browserProcess);
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }, 30000);

  it("honours networkidle for CDP endpoint navigation", async () => {
    const cdpPort = await findAvailablePort();
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "css-view-cdp-"));
    const initialUrl = `${server.origin}/index.html`;
    const delayedUrl = `${server.origin}/networkidle.html`;
    const browserProcess = Bun.spawn(
      [
        chromium.executablePath(),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        initialUrl,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    try {
      await waitForCdpPage(cdpPort, initialUrl);

      const result = await runCssView([
        delayedUrl,
        "--mode",
        "cdp",
        "--cdp-url",
        `http://127.0.0.1:${cdpPort}`,
        "--props",
        "color",
        "--wait-until",
        "networkidle",
        "--timeout",
        "10000",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const payload = JSON.parse(result.stdout);
      const title = payload.payload.nodes.find(
        (node: { attributes: Record<string, string> }) => node.attributes.id === "delayed-title",
      );

      expect(payload.waitUntil).toBe("networkidle");
      expect(title.computedStyles.color).toBe("rgb(12, 120, 40)");
    } finally {
      await stopProcess(browserProcess);
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }, 30000);
});
