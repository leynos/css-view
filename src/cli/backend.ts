import type { BrowserEngine, SnapshotMode } from "../snapshot";
import {
  AgentBrowserBackend,
  type AgentBrowserCommandRunner,
  DEFAULT_AGENT_BROWSER_SESSION,
  isAgentBrowserAvailable,
} from "../snapshot/agent-browser-backend";

export type CliBackend = "agent-browser" | "playwright";
export type EffectiveBackend = CliBackend | "cdp-url";

export interface CliBackendInput {
  url?: string;
  backend?: CliBackend;
  mode?: SnapshotMode;
  browser?: BrowserEngine;
  cdpUrl?: string;
  useCurrentPage?: boolean;
  agentBrowserSession?: string;
}

export interface PreparedSnapshotRequest {
  backend: EffectiveBackend;
  url: string;
  mode: SnapshotMode;
  browser?: BrowserEngine;
  cdpUrl?: string;
  useCurrentPage?: boolean;
  activePageIndex?: number;
}

export interface PrepareSnapshotRequestDependencies {
  isAgentBrowserAvailable?: () => Promise<boolean>;
  agentBrowserRunner?: AgentBrowserCommandRunner;
}

function requireUrl(url: string | undefined, message = "A URL is required"): string {
  if (!url) {
    throw new Error(message);
  }

  return url;
}

async function resolveBackend(
  requestedBackend: CliBackend | undefined,
  isAvailable: () => Promise<boolean>,
  hasPlaywrightOnlyOptions = false,
): Promise<CliBackend> {
  if (requestedBackend === "playwright") {
    return "playwright";
  }

  if (requestedBackend === "agent-browser") {
    const hasAgentBrowser = await isAvailable();
    if (!hasAgentBrowser) {
      throw new Error("agent-browser backend requires agent-browser on PATH");
    }

    return "agent-browser";
  }

  if (hasPlaywrightOnlyOptions) {
    return "playwright";
  }

  const hasAgentBrowser = await isAvailable();
  return hasAgentBrowser ? "agent-browser" : "playwright";
}

export async function prepareSnapshotRequest(
  input: CliBackendInput,
  dependencies: PrepareSnapshotRequestDependencies = {},
): Promise<PreparedSnapshotRequest> {
  const agentBrowserSession = input.agentBrowserSession ?? DEFAULT_AGENT_BROWSER_SESSION;
  const checkAgentBrowser =
    dependencies.isAgentBrowserAvailable ??
    (() => isAgentBrowserAvailable(dependencies.agentBrowserRunner));

  if (input.cdpUrl) {
    if (input.useCurrentPage) {
      throw new Error("--use-current-page requires the agent-browser backend");
    }
    if (input.mode !== "cdp") {
      throw new Error("--cdp-url requires --mode cdp");
    }

    return {
      backend: "cdp-url",
      url: requireUrl(input.url),
      mode: "cdp",
      browser: input.browser,
      cdpUrl: input.cdpUrl,
    };
  }

  if (input.backend === "agent-browser") {
    if (input.browser) {
      throw new Error("--browser cannot be combined with --backend agent-browser");
    }
    if (input.mode === "walker") {
      throw new Error("--backend agent-browser requires --mode cdp");
    }
  }

  const hasPlaywrightOnlyOptions = input.mode === "walker" || input.browser !== undefined;
  const backend = await resolveBackend(input.backend, checkAgentBrowser, hasPlaywrightOnlyOptions);

  if (backend === "agent-browser") {
    const agentBrowser = new AgentBrowserBackend({
      session: agentBrowserSession,
      runner: dependencies.agentBrowserRunner,
    });

    const activeTab = input.useCurrentPage ? await agentBrowser.getActiveTab() : undefined;
    const url = activeTab?.url ?? requireUrl(input.url);
    if (!url) {
      throw new Error("agent-browser did not report a current page URL");
    }

    if (!input.useCurrentPage) {
      await agentBrowser.open(url);
    }

    return {
      backend,
      url,
      mode: "cdp",
      cdpUrl: await agentBrowser.getCdpUrl(),
      useCurrentPage: input.useCurrentPage,
      activePageIndex: activeTab?.index,
    };
  }

  if (input.useCurrentPage) {
    throw new Error("--use-current-page requires the agent-browser backend");
  }

  return {
    backend,
    url: requireUrl(input.url),
    mode: input.mode ?? "walker",
    browser: input.browser,
  };
}
