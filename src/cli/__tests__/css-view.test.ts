import { describe, expect, it } from "bun:test";

async function runCssView(args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", "bin/css-view.ts", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("css-view CLI", () => {
  it("documents the CDP URL bridge option in help output", async () => {
    const result = await runCssView(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--cdp-url <url>");
    expect(result.stdout).toContain("Attach to an existing Chromium CDP endpoint");
  });

  it("rejects CDP URLs outside CDP mode before launching a browser", async () => {
    const result = await runCssView([
      "https://example.test",
      "--cdp-url",
      "ws://127.0.0.1:9222/devtools/browser/abc",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--cdp-url requires --mode cdp");
  });

  it("rejects browser overrides when a CDP URL selects the browser", async () => {
    const result = await runCssView([
      "https://example.test",
      "--mode",
      "cdp",
      "--browser",
      "chromium",
      "--cdp-url",
      "ws://127.0.0.1:9222/devtools/browser/abc",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--browser cannot be combined with --cdp-url");
  });
});
