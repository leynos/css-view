/**
 * Shell-out adapter for the agent-browser CLI.
 *
 * The CLI backend layer uses this module to open pages, discover the browser
 * CDP endpoint, and identify the active page tab in an agent-browser session
 * without coupling snapshot capture to agent-browser process management details.
 */
export interface AgentBrowserCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AgentBrowserCommandRunner = (
  args: readonly string[],
) => Promise<AgentBrowserCommandResult>;

export interface AgentBrowserBackendOptions {
  session?: string;
  runner?: AgentBrowserCommandRunner;
  /** Retry delay applied after a transient `open` failure, in milliseconds. */
  transientOpenFailureDelayMs?: number;
}

export interface AgentBrowserTab {
  active: boolean;
  index: number;
  title?: string;
  type?: string;
  url: string;
}

interface AgentBrowserTabListResponse {
  success?: boolean;
  data?: {
    tabs?: AgentBrowserTab[];
  };
  error?: unknown;
}

export const DEFAULT_AGENT_BROWSER_SESSION = "css-view";
const DEFAULT_TRANSIENT_OPEN_FAILURE_DELAY_MS = 500;

/** Run an agent-browser command and collect stdout, stderr, and exit status. */
export async function defaultAgentBrowserCommandRunner(
  args: readonly string[],
): Promise<AgentBrowserCommandResult> {
  const proc = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

/** Check whether the agent-browser binary is available on PATH. */
export async function isAgentBrowserAvailable(
  runner: AgentBrowserCommandRunner = defaultAgentBrowserCommandRunner,
): Promise<boolean> {
  try {
    const result = await runner(["agent-browser", "--version"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Format a failed agent-browser command with the useful output streams. */
function commandError(label: string, result: AgentBrowserCommandResult): Error {
  const details = [
    result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : undefined,
    result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n");

  return new Error(
    `agent-browser ${label} failed with exit code ${result.exitCode}${
      details ? `\n${details}` : ""
    }`,
  );
}

function isTransientOpenFailure(result: AgentBrowserCommandResult): boolean {
  return result.exitCode !== 0 && result.stderr.includes("Event stream closed");
}

/** Session-scoped facade over the agent-browser commands used by css-view. */
export class AgentBrowserBackend {
  readonly session: string;
  readonly runner: AgentBrowserCommandRunner;
  readonly transientOpenFailureDelayMs: number;

  /** Create an adapter bound to one agent-browser session. */
  constructor(options: AgentBrowserBackendOptions = {}) {
    const session = options.session ?? DEFAULT_AGENT_BROWSER_SESSION;
    if (!session.trim()) {
      throw new Error("agent-browser session name cannot be empty");
    }

    this.session = session;
    this.runner = options.runner ?? defaultAgentBrowserCommandRunner;
    this.transientOpenFailureDelayMs =
      options.transientOpenFailureDelayMs ?? DEFAULT_TRANSIENT_OPEN_FAILURE_DELAY_MS;
  }

  /** Navigate the selected session to the requested URL. */
  async open(url: string): Promise<void> {
    await this.run("open", ["open", url], { retryTransientOpenFailure: true });
  }

  /** Return the browser-level CDP WebSocket URL for the selected session. */
  async getCdpUrl(): Promise<string> {
    return this.run("get cdp-url", ["get", "cdp-url"]);
  }

  /** Return the active page URL reported by agent-browser. */
  async getCurrentUrl(): Promise<string> {
    return this.run("get url", ["get", "url"]);
  }

  /** Return the active page-tab metadata used to disambiguate duplicate URLs. */
  async getActiveTab(): Promise<AgentBrowserTab> {
    const raw = await this.run("tab list", ["tab", "list", "--json"]);
    let response: AgentBrowserTabListResponse;
    try {
      response = JSON.parse(raw) as AgentBrowserTabListResponse;
    } catch (error) {
      throw new Error(
        `agent-browser tab list did not return valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const activeTab = response.data?.tabs?.find((tab) => tab.active && tab.type === "page");
    if (!activeTab || typeof activeTab.index !== "number" || !activeTab.url) {
      throw new Error("agent-browser did not report an active page tab");
    }

    return activeTab;
  }

  /** Close the selected agent-browser session. */
  async close(): Promise<void> {
    await this.run("close", ["close"]);
  }

  /** Execute a session-scoped agent-browser command and return trimmed stdout. */
  private async run(
    label: string,
    command: readonly string[],
    options: { retryTransientOpenFailure?: boolean } = {},
  ): Promise<string> {
    const args = ["agent-browser", "--session", this.session, ...command];
    let result = await this.runner(args);

    if (options.retryTransientOpenFailure && isTransientOpenFailure(result)) {
      console.warn(
        `[agent-browser] Transient open failure detected (stderr: ${result.stderr.trim()}). ` +
          `Retrying in ${this.transientOpenFailureDelayMs} ms…`,
      );
      await Bun.sleep(this.transientOpenFailureDelayMs);
      result = await this.runner(args);
      if (result.exitCode === 0) {
        console.warn("[agent-browser] Retry succeeded.");
      }
    }

    if (result.exitCode !== 0) {
      throw commandError(label, result);
    }

    return result.stdout.trim();
  }
}
