import { type BrowserType, chromium, firefox, webkit } from "playwright";
import { type CdpSnapshotResult, captureWithCdp } from "./cdp";
import { type WalkerSnapshotResult, captureWithWalker } from "./walker";

export type SnapshotMode = "cdp" | "walker";
export type BrowserEngine = "chromium" | "firefox" | "webkit";

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

const browserMap: Record<BrowserEngine, BrowserType> = {
	chromium,
	firefox,
	webkit,
};

export async function captureSnapshot(
	options: SnapshotOptions,
): Promise<SnapshotExecutionResult> {
	const browserName: BrowserEngine =
		options.browser ?? (options.mode === "cdp" ? "chromium" : "firefox");

	if (options.mode === "cdp" && browserName !== "chromium") {
		throw new Error("CDP snapshots require the Chromium browser");
	}

	const waitUntil = options.waitUntil ?? "networkidle";
	const headless = options.headless ?? true;
	const timeoutMs = options.timeoutMs ?? 45000;

	const browserType = browserMap[browserName];
	const browser = await browserType.launch({ headless });
	const context = await browser.newContext();
	const page = await context.newPage();

	try {
		await page.goto(options.url, { waitUntil, timeout: timeoutMs });

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
			browser: browserName,
			waitUntil,
			headless,
			payload,
		};
	} finally {
		await context.close();
		await browser.close();
	}
}
