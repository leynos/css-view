import { type BrowserType, chromium, firefox, webkit } from "playwright";
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

export async function captureSnapshot(options: SnapshotOptions): Promise<SnapshotExecutionResult> {
  const plan = resolveSnapshotPlan(options);

  const browserType = browserMap[plan.browser];
  const browser = await browserType.launch({ headless: plan.headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(options.url, { waitUntil: plan.waitUntil, timeout: plan.timeoutMs });

    const payload: SnapshotPayload =
      options.mode === "cdp"
        ? await captureWithCdp(page, { properties: options.properties })
        : await captureWithWalker(page, {
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
    await context.close();
    await browser.close();
  }
}
