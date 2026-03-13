import { describe, expect, it } from "bun:test";
import type { SnapshotExecutionResult, SnapshotOptions } from "../../src/snapshot";
import { runCli } from "../css-view";

function buildResult(): SnapshotExecutionResult {
  return {
    url: "https://example.org",
    capturedAt: "2026-03-13T00:00:00.000Z",
    mode: "walker",
    browser: "firefox",
    waitUntil: "networkidle",
    headless: true,
    viewport: { width: 1440, height: 900 },
    displayPixelResolution: 2,
    payload: { mode: "walker", tree: null, meta: { visited: 0, maxNodes: 2000, textClip: 160 } },
  };
}

describe("runCli", () => {
  it("passes short viewport and DPR flags into snapshot capture", async () => {
    const captureCalls: SnapshotOptions[] = [];
    let stdout = "";

    await runCli(["https://example.org", "-W", "1440", "-H", "900", "-R", "2", "--pretty"], {
      captureSnapshot: async (options) => {
        captureCalls.push(options);
        return buildResult();
      },
      writeFile: async () => undefined,
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
    });

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]).toMatchObject({
      url: "https://example.org",
      viewportWidth: 1440,
      viewportHeight: 900,
      displayPixelResolution: 2,
    });
    expect(stdout).toContain('"displayPixelResolution": 2');
    expect(stdout).toContain('"width": 1440');
    expect(stdout).toContain('"height": 900');
  });

  it("accepts the long viewport and DPR flags", async () => {
    const captureCalls: SnapshotOptions[] = [];

    await runCli(
      [
        "https://example.org",
        "--viewport-width",
        "1280",
        "--viewport-height",
        "720",
        "--display-pixel-resolution",
        "3",
      ],
      {
        captureSnapshot: async (options) => {
          captureCalls.push(options);
          return {
            ...buildResult(),
            viewport: { width: 1280, height: 720 },
            displayPixelResolution: 3,
          };
        },
        writeFile: async () => undefined,
        stdout: { write: () => true },
      },
    );

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]).toMatchObject({
      viewportWidth: 1280,
      viewportHeight: 720,
      displayPixelResolution: 3,
    });
  });
});
