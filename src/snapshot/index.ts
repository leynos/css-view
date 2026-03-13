import {
  type BrowserContextOptions,
  type BrowserType,
  chromium,
  firefox,
  webkit,
} from "playwright";
import { type CdpSnapshotResult, captureWithCdp } from "./cdp";
import { type WalkerSnapshotResult, captureWithWalker } from "./walker";

export type SnapshotMode = "cdp" | "walker";
export type BrowserEngine = "chromium" | "firefox" | "webkit";
export interface ViewportSize {
  width: number;
  height: number;
}

export interface SnapshotOptions {
  url: string;
  mode: SnapshotMode;
  browser?: BrowserEngine;
  headless?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  properties: string[];
  inheritedProperties: string[];
  maxNodes?: number;
  textClip?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  displayPixelResolution?: number;
}

export type SnapshotPayload = CdpSnapshotResult | WalkerSnapshotResult;

export interface SnapshotExecutionResult {
  url: string;
  capturedAt: string;
  mode: SnapshotMode;
  browser: BrowserEngine;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  headless: boolean;
  viewport: ViewportSize | null;
  displayPixelResolution: number | null;
  payload: SnapshotPayload;
}

export interface SnapshotRuntimeSettings {
  browser: BrowserEngine;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  headless: boolean;
  timeoutMs: number;
  contextOptions: BrowserContextOptions;
  viewport: ViewportSize | null;
  displayPixelResolution: number | null;
}

const browserMap: Record<BrowserEngine, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

const DEFAULT_VIEWPORT: ViewportSize = {
  width: 1280,
  height: 720,
};

export function resolveSnapshotRuntimeSettings(options: SnapshotOptions): SnapshotRuntimeSettings {
  const browser: BrowserEngine =
    options.browser ?? (options.mode === "cdp" ? "chromium" : "firefox");

  if (options.mode === "cdp" && browser !== "chromium") {
    throw new Error("CDP snapshots require the Chromium browser");
  }

  const waitUntil = options.waitUntil ?? "networkidle";
  const headless = options.headless ?? true;
  const timeoutMs = options.timeoutMs ?? 45000;

  const hasViewportOverride =
    options.viewportWidth !== undefined || options.viewportHeight !== undefined;
  const viewport = hasViewportOverride
    ? {
        width: options.viewportWidth ?? DEFAULT_VIEWPORT.width,
        height: options.viewportHeight ?? DEFAULT_VIEWPORT.height,
      }
    : null;

  const contextOptions: BrowserContextOptions = {};
  if (viewport) {
    contextOptions.viewport = viewport;
  }
  if (options.displayPixelResolution !== undefined) {
    contextOptions.deviceScaleFactor = options.displayPixelResolution;
  }

  return {
    browser,
    waitUntil,
    headless,
    timeoutMs,
    contextOptions,
    viewport,
    displayPixelResolution: options.displayPixelResolution ?? null,
  };
}

export async function captureSnapshot(options: SnapshotOptions): Promise<SnapshotExecutionResult> {
  const settings = resolveSnapshotRuntimeSettings(options);

  const browserType = browserMap[settings.browser];
  const browser = await browserType.launch({ headless: settings.headless });
  const context = await browser.newContext(settings.contextOptions);
  const page = await context.newPage();

  try {
    await page.goto(options.url, {
      waitUntil: settings.waitUntil,
      timeout: settings.timeoutMs,
    });

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
      browser: settings.browser,
      waitUntil: settings.waitUntil,
      headless: settings.headless,
      viewport: settings.viewport,
      displayPixelResolution: settings.displayPixelResolution,
      payload,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
