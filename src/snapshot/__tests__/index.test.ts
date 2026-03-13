import { describe, expect, it } from "bun:test";
import { resolveSnapshotRuntimeSettings } from "../index";

describe("resolveSnapshotRuntimeSettings", () => {
  it("builds viewport and DPR context settings when provided", () => {
    const settings = resolveSnapshotRuntimeSettings({
      url: "https://example.org",
      mode: "walker",
      properties: ["display"],
      inheritedProperties: ["color"],
      viewportWidth: 1440,
      viewportHeight: 900,
      displayPixelResolution: 2,
    });

    expect(settings).toMatchObject({
      browser: "firefox",
      headless: true,
      waitUntil: "networkidle",
      timeoutMs: 45000,
      contextOptions: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    });
  });

  it("leaves viewport settings unset when no overrides are provided", () => {
    const settings = resolveSnapshotRuntimeSettings({
      url: "https://example.org",
      mode: "cdp",
      properties: ["display"],
      inheritedProperties: ["color"],
    });

    expect(settings).toMatchObject({
      browser: "chromium",
      headless: true,
      waitUntil: "networkidle",
      timeoutMs: 45000,
    });
    expect(settings.contextOptions).toEqual({});
  });
});
