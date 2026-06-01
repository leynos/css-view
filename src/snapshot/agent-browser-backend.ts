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
}

export const DEFAULT_AGENT_BROWSER_SESSION = "css-view";

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

export class AgentBrowserBackend {
  readonly session: string;
  readonly runner: AgentBrowserCommandRunner;

  constructor(options: AgentBrowserBackendOptions = {}) {
    const session = options.session ?? DEFAULT_AGENT_BROWSER_SESSION;
    if (!session.trim()) {
      throw new Error("agent-browser session name cannot be empty");
    }

    this.session = session;
    this.runner = options.runner ?? defaultAgentBrowserCommandRunner;
  }

  async open(url: string): Promise<void> {
    await this.run("open", ["open", url]);
  }

  async getCdpUrl(): Promise<string> {
    return this.run("get cdp-url", ["get", "cdp-url"]);
  }

  async getCurrentUrl(): Promise<string> {
    return this.run("get url", ["get", "url"]);
  }

  async close(): Promise<void> {
    await this.run("close", ["close"]);
  }

  private async run(label: string, command: readonly string[]): Promise<string> {
    const result = await this.runner(["agent-browser", "--session", this.session, ...command]);

    if (result.exitCode !== 0) {
      throw commandError(label, result);
    }

    return result.stdout.trim();
  }
}
