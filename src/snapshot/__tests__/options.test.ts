import { describe, expect, it } from "bun:test";
import { resolveSnapshotPlan } from "../index";

const baseOptions = {
  url: "https://example.test",
  properties: ["display", "color"],
  inheritedProperties: ["color"],
};

describe("resolveSnapshotPlan", () => {
  it("keeps existing browser defaults for local snapshot modes", () => {
    expect(resolveSnapshotPlan({ ...baseOptions, mode: "walker" })).toEqual({
      browser: "firefox",
      browserSource: "local",
      headless: true,
      timeoutMs: 45000,
      waitUntil: "networkidle",
    });

    expect(resolveSnapshotPlan({ ...baseOptions, mode: "cdp" })).toEqual({
      browser: "chromium",
      browserSource: "local",
      headless: true,
      timeoutMs: 45000,
      waitUntil: "networkidle",
    });
  });

  it("accepts Playwright CDP endpoint URL forms for CDP mode", () => {
    for (const cdpUrl of [
      "http://127.0.0.1:9222/",
      "https://browser.example.test/session",
      "ws://127.0.0.1:9222/devtools/browser/abc",
      "wss://browser.example.test/devtools/browser/abc",
    ]) {
      expect(resolveSnapshotPlan({ ...baseOptions, mode: "cdp", cdpUrl })).toEqual({
        browser: "chromium",
        browserSource: "cdp-url",
        cdpUrl,
        headless: true,
        timeoutMs: 45000,
        waitUntil: "networkidle",
      });
    }
  });

  it("rejects CDP endpoints for walker mode", () => {
    expect(() =>
      resolveSnapshotPlan({
        ...baseOptions,
        mode: "walker",
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      }),
    ).toThrow("--cdp-url requires --mode cdp");
  });

  it("rejects browser overrides for CDP endpoint captures", () => {
    expect(() =>
      resolveSnapshotPlan({
        ...baseOptions,
        mode: "cdp",
        browser: "chromium",
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      }),
    ).toThrow("--browser cannot be combined with --cdp-url");
  });

  it("rejects unsupported CDP endpoint schemes", () => {
    expect(() =>
      resolveSnapshotPlan({
        ...baseOptions,
        mode: "cdp",
        cdpUrl: "ftp://127.0.0.1:9222/devtools/browser/abc",
      }),
    ).toThrow("--cdp-url must use http:, https:, ws:, or wss:");
  });

  it("preserves explicit local snapshot options", () => {
    expect(
      resolveSnapshotPlan({
        ...baseOptions,
        mode: "walker",
        browser: "webkit",
        headless: false,
        timeoutMs: 1200,
        waitUntil: "load",
      }),
    ).toEqual({
      browser: "webkit",
      browserSource: "local",
      headless: false,
      timeoutMs: 1200,
      waitUntil: "load",
    });
  });
});
