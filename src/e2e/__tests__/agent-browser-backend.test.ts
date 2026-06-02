import { afterAll, describe, expect, it } from "bun:test";
import { isAgentBrowserAvailable } from "../../snapshot/agent-browser-backend";
import { type FixtureServer, startHelloCssFixtureServer } from "../../test-support/fixture-server";

async function runCommand(args: string[]) {
  const proc = Bun.spawn(args, {
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

async function runCssView(args: string[]) {
  return runCommand([process.execPath, "run", "bin/css-view.ts", ...args]);
}

async function closeAgentBrowserSession(session: string): Promise<void> {
  await runCommand(["agent-browser", "--session", session, "close"]);
}

function uniqueSession(label: string): string {
  return `css-view-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function expectHelloWorldPayload(stdout: string): void {
  const payload = JSON.parse(stdout);
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
}

describe("css-view agent-browser backend end-to-end", () => {
  let server: FixtureServer | undefined;

  afterAll(async () => {
    await server?.close();
  });

  it("uses agent-browser as the default backend when available", async () => {
    if (!(await isAgentBrowserAvailable())) {
      console.warn("Skipping agent-browser backend e2e: agent-browser is not on PATH");
      return;
    }

    server ??= await startHelloCssFixtureServer();
    const session = uniqueSession("default");
    const fixtureUrl = `${server.origin}/index.html`;

    try {
      const result = await runCssView([
        fixtureUrl,
        "--agent-browser-session",
        session,
        "--props",
        "color,font-size,background-color,display",
        "--wait-until",
        "load",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expectHelloWorldPayload(result.stdout);
    } finally {
      await closeAgentBrowserSession(session);
    }
  }, 30000);

  it("snapshots the current agent-browser page without navigation", async () => {
    if (!(await isAgentBrowserAvailable())) {
      console.warn("Skipping agent-browser current-page e2e: agent-browser is not on PATH");
      return;
    }

    server ??= await startHelloCssFixtureServer();
    const session = uniqueSession("current");
    const fixtureUrl = `${server.origin}/index.html`;

    try {
      const openResult = await runCommand([
        "agent-browser",
        "--session",
        session,
        "open",
        fixtureUrl,
      ]);
      expect(openResult.exitCode).toBe(0);

      const result = await runCssView([
        "--backend",
        "agent-browser",
        "--agent-browser-session",
        session,
        "--use-current-page",
        "--props",
        "color,font-size,background-color,display",
        "--wait-until",
        "load",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const payload = JSON.parse(result.stdout);
      expect(payload.url).toBe(fixtureUrl);
      expectHelloWorldPayload(result.stdout);
    } finally {
      await closeAgentBrowserSession(session);
    }
  }, 30000);
});
