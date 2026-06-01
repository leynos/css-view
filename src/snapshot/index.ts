import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
  chromium,
  firefox,
  webkit,
} from "playwright";
import { type CdpSnapshotResult, captureWithCdp } from "./cdp";
import { type WalkerSnapshotResult, captureWithWalker } from "./walker";

export type SnapshotMode = "cdp" | "walker";
export type BrowserEngine = "chromium" | "firefox" | "webkit";

export interface SnapshotOptions {
  url: string;
  mode: SnapshotMode;
  browser?: BrowserEngine;
  cdpUrl?: string;
  headless?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  properties: string[];
  inheritedProperties: string[];
  maxNodes?: number;
  textClip?: number;
}

export type SnapshotPayload = CdpSnapshotResult | WalkerSnapshotResult;

export interface SnapshotExecutionResult {
  url: string;
  capturedAt: string;
  mode: SnapshotMode;
  browser: BrowserEngine;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  headless: boolean;
  payload: SnapshotPayload;
}

export type BrowserSource = "local" | "cdp-url";

export interface SnapshotPlan {
  browser: BrowserEngine;
  browserSource: BrowserSource;
  cdpUrl?: string;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  headless: boolean;
  timeoutMs: number;
}

export interface SnapshotTargetPage {
  url(): string;
  goto(
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number },
  ): Promise<unknown>;
}

export interface SnapshotTargetContext<TPage extends SnapshotTargetPage = SnapshotTargetPage> {
  pages(): readonly TPage[];
  newPage(): Promise<TPage>;
  close(): Promise<void>;
}

export interface SnapshotTargetBrowser<TContext extends SnapshotTargetContext = BrowserContext> {
  contexts(): readonly TContext[];
  newContext(): Promise<TContext>;
  close(): Promise<void>;
}

export interface SnapshotTargetBrowserType<TBrowser> {
  launch?(options: { headless: boolean }): Promise<TBrowser>;
  connectOverCDP?(url: string, options: { timeout: number }): Promise<TBrowser>;
}

export interface SnapshotTarget<
  TPage extends SnapshotTargetPage,
  TContext extends SnapshotTargetContext<TPage>,
  TBrowser extends SnapshotTargetBrowser<TContext>,
> {
  browser: TBrowser;
  context: TContext;
  page: TPage;
  shouldCloseContext: boolean;
  dispose(): Promise<void>;
}

const browserMap: Record<BrowserEngine, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

const supportedCdpProtocols = new Set(["http:", "https:", "ws:", "wss:"]);

function validateCdpUrl(cdpUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(cdpUrl);
  } catch {
    throw new Error("--cdp-url must be a valid URL");
  }

  if (!supportedCdpProtocols.has(parsed.protocol)) {
    throw new Error("--cdp-url must use http:, https:, ws:, or wss:");
  }
}

export function resolveSnapshotPlan(options: SnapshotOptions): SnapshotPlan {
  const waitUntil = options.waitUntil ?? "networkidle";
  const headless = options.headless ?? true;
  const timeoutMs = options.timeoutMs ?? 45000;

  if (options.cdpUrl) {
    if (options.mode !== "cdp") {
      throw new Error("--cdp-url requires --mode cdp");
    }
    if (options.browser) {
      throw new Error("--browser cannot be combined with --cdp-url");
    }

    validateCdpUrl(options.cdpUrl);

    return {
      browser: "chromium",
      browserSource: "cdp-url",
      cdpUrl: options.cdpUrl,
      waitUntil,
      headless,
      timeoutMs,
    };
  }

  const browser: BrowserEngine =
    options.browser ?? (options.mode === "cdp" ? "chromium" : "firefox");

  if (options.mode === "cdp" && browser !== "chromium") {
    throw new Error("CDP snapshots require the Chromium browser");
  }

  return {
    browser,
    browserSource: "local",
    waitUntil,
    headless,
    timeoutMs,
  };
}

async function findOrCreateCdpPage<TPage extends SnapshotTargetPage>(
  context: SnapshotTargetContext<TPage>,
  plan: SnapshotPlan,
  url: string,
): Promise<TPage> {
  const pages = context.pages();
  const existingPage = pages.find((page) => page.url() === url);
  const page = existingPage ?? pages[0] ?? (await context.newPage());

  if (page.url() !== url) {
    await page.goto(url, { waitUntil: plan.waitUntil, timeout: plan.timeoutMs });
  }

  return page;
}

export async function openSnapshotTarget<
  TPage extends SnapshotTargetPage,
  TContext extends SnapshotTargetContext<TPage>,
  TBrowser extends SnapshotTargetBrowser<TContext>,
>({
  plan,
  url,
  browserType,
}: {
  plan: SnapshotPlan;
  url: string;
  browserType: SnapshotTargetBrowserType<TBrowser>;
}): Promise<SnapshotTarget<TPage, TContext, TBrowser>> {
  if (plan.browserSource === "cdp-url") {
    if (!plan.cdpUrl) {
      throw new Error("CDP endpoint URL is required for CDP URL snapshots");
    }
    if (!browserType.connectOverCDP) {
      throw new Error("CDP URL snapshots require a Chromium browser type");
    }

    const browser = await browserType.connectOverCDP(plan.cdpUrl, {
      timeout: plan.timeoutMs,
    });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await findOrCreateCdpPage(context, plan, url);

    return {
      browser,
      context,
      page,
      shouldCloseContext: false,
      async dispose() {
        await browser.close();
      },
    };
  }

  if (!browserType.launch) {
    throw new Error("Local snapshots require a launchable browser type");
  }

  const browser = await browserType.launch({ headless: plan.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: plan.waitUntil, timeout: plan.timeoutMs });

  return {
    browser,
    context,
    page,
    shouldCloseContext: true,
    async dispose() {
      await context.close();
      await browser.close();
    },
  };
}

export async function captureSnapshot(options: SnapshotOptions): Promise<SnapshotExecutionResult> {
  const plan = resolveSnapshotPlan(options);

  const browserType = browserMap[plan.browser];
  const target = await openSnapshotTarget<Page, BrowserContext, Browser>({
    plan,
    url: options.url,
    browserType,
  });

  try {
    const payload: SnapshotPayload =
      options.mode === "cdp"
        ? await captureWithCdp(target.page, { properties: options.properties })
        : await captureWithWalker(target.page, {
            inherited: options.inheritedProperties,
            maxNodes: options.maxNodes ?? 2000,
            textClip: options.textClip ?? 160,
          });

    return {
      url: options.url,
      capturedAt: new Date().toISOString(),
      mode: options.mode,
      browser: plan.browser,
      waitUntil: plan.waitUntil,
      headless: plan.headless,
      payload,
    };
  } finally {
    await target.dispose();
  }
}
