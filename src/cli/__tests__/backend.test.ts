import { describe, expect, it } from "bun:test";
import type {
  AgentBrowserCommandResult,
  AgentBrowserCommandRunner,
} from "../../snapshot/agent-browser-backend";
import { prepareSnapshotRequest } from "../backend";

function commandResult(
  overrides: Partial<AgentBrowserCommandResult> = {},
): AgentBrowserCommandResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function recordingRunner(results: AgentBrowserCommandResult[]): {
  calls: string[][];
  runner: AgentBrowserCommandRunner;
} {
  const calls: string[][] = [];
  const runner: AgentBrowserCommandRunner = async (args) => {
    calls.push([...args]);
    const next = results.shift();
    if (!next) {
      throw new Error("Unexpected agent-browser command");
    }
    return next;
  };

  return { calls, runner };
}

describe("prepareSnapshotRequest", () => {
  it("uses agent-browser by default when the binary is available", async () => {
    const { calls, runner } = recordingRunner([
      commandResult(),
      commandResult({ stdout: "ws://127.0.0.1:9222/devtools/browser/abc\n" }),
    ]);

    const request = await prepareSnapshotRequest(
      { url: "https://example.test/" },
      {
        isAgentBrowserAvailable: async () => true,
        agentBrowserRunner: runner,
      },
    );

    expect(request).toEqual({
      backend: "agent-browser",
      url: "https://example.test/",
      mode: "cdp",
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view", "open", "https://example.test/"],
      ["agent-browser", "--session", "css-view", "get", "cdp-url"],
    ]);
  });

  it("falls back to Playwright when agent-browser is unavailable", async () => {
    const request = await prepareSnapshotRequest(
      { url: "https://example.test/" },
      { isAgentBrowserAvailable: async () => false },
    );

    expect(request).toEqual({
      backend: "playwright",
      url: "https://example.test/",
      mode: "walker",
      browser: undefined,
    });
  });

  it("honours an explicit Playwright backend without checking agent-browser", async () => {
    let availabilityChecks = 0;

    const request = await prepareSnapshotRequest(
      {
        url: "https://example.test/",
        backend: "playwright",
        mode: "cdp",
        browser: "chromium",
      },
      {
        isAgentBrowserAvailable: async () => {
          availabilityChecks += 1;
          return true;
        },
      },
    );

    expect(availabilityChecks).toBe(0);
    expect(request).toEqual({
      backend: "playwright",
      url: "https://example.test/",
      mode: "cdp",
      browser: "chromium",
    });
  });

  it("uses the configured agent-browser session", async () => {
    const { calls, runner } = recordingRunner([
      commandResult(),
      commandResult({ stdout: "ws://127.0.0.1:9222/devtools/browser/abc\n" }),
    ]);

    await prepareSnapshotRequest(
      {
        url: "https://example.test/",
        backend: "agent-browser",
        agentBrowserSession: "css-view-test",
      },
      {
        isAgentBrowserAvailable: async () => true,
        agentBrowserRunner: runner,
      },
    );

    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view-test", "open", "https://example.test/"],
      ["agent-browser", "--session", "css-view-test", "get", "cdp-url"],
    ]);
  });

  it("can snapshot the current agent-browser page without opening a URL", async () => {
    const { calls, runner } = recordingRunner([
      commandResult({ stdout: "https://example.test/current\n" }),
      commandResult({ stdout: "ws://127.0.0.1:9222/devtools/browser/abc\n" }),
    ]);

    const request = await prepareSnapshotRequest(
      {
        backend: "agent-browser",
        useCurrentPage: true,
        agentBrowserSession: "css-view-current",
      },
      {
        isAgentBrowserAvailable: async () => true,
        agentBrowserRunner: runner,
      },
    );

    expect(request).toEqual({
      backend: "agent-browser",
      url: "https://example.test/current",
      mode: "cdp",
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view-current", "get", "url"],
      ["agent-browser", "--session", "css-view-current", "get", "cdp-url"],
    ]);
  });

  it("keeps direct CDP endpoint capture independent of backend selection", async () => {
    const request = await prepareSnapshotRequest({
      url: "https://example.test/",
      backend: "agent-browser",
      mode: "cdp",
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });

    expect(request).toEqual({
      backend: "cdp-url",
      url: "https://example.test/",
      mode: "cdp",
      browser: undefined,
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
  });

  it("requires agent-browser on PATH for an explicit agent-browser backend", async () => {
    await expect(
      prepareSnapshotRequest(
        { url: "https://example.test/", backend: "agent-browser" },
        { isAgentBrowserAvailable: async () => false },
      ),
    ).rejects.toThrow("agent-browser backend requires agent-browser on PATH");
  });

  it("rejects walker mode for the agent-browser backend", async () => {
    await expect(
      prepareSnapshotRequest(
        {
          url: "https://example.test/",
          backend: "agent-browser",
          mode: "walker",
        },
        { isAgentBrowserAvailable: async () => true },
      ),
    ).rejects.toThrow("--backend agent-browser requires --mode cdp");
  });

  it("rejects current-page snapshots outside the agent-browser backend", async () => {
    await expect(
      prepareSnapshotRequest({
        url: "https://example.test/",
        backend: "playwright",
        useCurrentPage: true,
      }),
    ).rejects.toThrow("--use-current-page requires the agent-browser backend");
  });
});
