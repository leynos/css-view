import { describe, expect, it } from "bun:test";
import {
  AgentBrowserBackend,
  type AgentBrowserCommandResult,
  type AgentBrowserCommandRunner,
  DEFAULT_AGENT_BROWSER_SESSION,
  isAgentBrowserAvailable,
} from "../agent-browser-backend";

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

describe("AgentBrowserBackend", () => {
  it("defaults to the css-view session", async () => {
    const { calls, runner } = recordingRunner([commandResult()]);
    const backend = new AgentBrowserBackend({ runner });

    expect(backend.session).toBe(DEFAULT_AGENT_BROWSER_SESSION);

    await backend.open("https://example.test");

    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view", "open", "https://example.test"],
    ]);
  });

  it("uses the configured session for navigation and CDP lookup", async () => {
    const { calls, runner } = recordingRunner([
      commandResult(),
      commandResult({
        stdout: "ws://127.0.0.1:9222/devtools/browser/abc\n",
      }),
    ]);
    const backend = new AgentBrowserBackend({
      session: "css-view-test",
      runner,
    });

    await backend.open("https://example.test/page");
    const cdpUrl = await backend.getCdpUrl();

    expect(cdpUrl).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view-test", "open", "https://example.test/page"],
      ["agent-browser", "--session", "css-view-test", "get", "cdp-url"],
    ]);
  });

  it("gets the active URL and closes the selected session", async () => {
    const { calls, runner } = recordingRunner([
      commandResult({ stdout: "https://example.test/current\n" }),
      commandResult(),
    ]);
    const backend = new AgentBrowserBackend({
      session: "css-view-current",
      runner,
    });

    const currentUrl = await backend.getCurrentUrl();
    await backend.close();

    expect(currentUrl).toBe("https://example.test/current");
    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view-current", "get", "url"],
      ["agent-browser", "--session", "css-view-current", "close"],
    ]);
  });

  it("gets the active page tab from the tab list", async () => {
    const { calls, runner } = recordingRunner([
      commandResult({
        stdout: JSON.stringify({
          success: true,
          data: {
            tabs: [
              { active: false, index: 0, type: "page", url: "https://example.test/first" },
              { active: true, index: 1, type: "page", url: "https://example.test/current" },
            ],
          },
          error: null,
        }),
      }),
    ]);
    const backend = new AgentBrowserBackend({
      session: "css-view-current",
      runner,
    });

    const activeTab = await backend.getActiveTab();

    expect(activeTab).toEqual({
      active: true,
      index: 1,
      type: "page",
      url: "https://example.test/current",
    });
    expect(calls).toEqual([
      ["agent-browser", "--session", "css-view-current", "tab", "list", "--json"],
    ]);
  });

  it("requires an active page tab in the tab list", async () => {
    const { runner } = recordingRunner([
      commandResult({
        stdout: JSON.stringify({
          success: true,
          data: {
            tabs: [
              { active: true, index: 0, type: "devtools", url: "devtools://devtools/bundled" },
              { active: false, index: 1, type: "page", url: "https://example.test/first" },
            ],
          },
          error: null,
        }),
      }),
    ]);
    const backend = new AgentBrowserBackend({ runner });

    await expect(backend.getActiveTab()).rejects.toThrow(
      "agent-browser did not report an active page tab",
    );
  });

  it("reports stderr and stdout when a command fails", async () => {
    const { runner } = recordingRunner([
      commandResult({
        exitCode: 7,
        stdout: "partial output\n",
        stderr: "browser failed\n",
      }),
    ]);
    const backend = new AgentBrowserBackend({ runner });

    await expect(backend.open("https://example.test")).rejects.toThrow(
      "agent-browser open failed with exit code 7\nstderr: browser failed\nstdout: partial output",
    );
  });

  it("rejects empty session names", () => {
    expect(() => new AgentBrowserBackend({ session: "  " })).toThrow(
      "agent-browser session name cannot be empty",
    );
  });
});

describe("isAgentBrowserAvailable", () => {
  it("returns true when agent-browser exits successfully", async () => {
    const { calls, runner } = recordingRunner([commandResult()]);

    await expect(isAgentBrowserAvailable(runner)).resolves.toBe(true);
    expect(calls).toEqual([["agent-browser", "--version"]]);
  });

  it("returns false when agent-browser exits non-zero", async () => {
    const { runner } = recordingRunner([commandResult({ exitCode: 1 })]);

    await expect(isAgentBrowserAvailable(runner)).resolves.toBe(false);
  });

  it("returns false when the command cannot be spawned", async () => {
    const runner: AgentBrowserCommandRunner = async () => {
      throw new Error("ENOENT");
    };

    await expect(isAgentBrowserAvailable(runner)).resolves.toBe(false);
  });
});
