#!/usr/bin/env -S bun run
import { promises as fs } from "node:fs";
import { Command, Option } from "commander";
import { type SnapshotMode, captureSnapshot } from "../src/snapshot";
import {
  DEFAULT_COMPUTED_PROPERTIES,
  DEFAULT_INHERITED_PROPERTIES,
} from "../src/snapshot/constants";
import { resolvePropertyList } from "../src/snapshot/property-resolver";

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function main() {
  const program = new Command();
  program
    .name("css-view")
    .description("Capture computed CSS snapshots for any page using Playwright")
    .argument("<url>", "Target page to inspect")
    .addOption(
      new Option("-m, --mode <mode>", "Snapshot backend")
        .choices(["cdp", "walker"])
        .default("walker"),
    )
    .addOption(new Option("-b, --browser <browser>", "Playwright browser engine"))
    .option("--props <list>", "Comma or newline separated list of computed CSS properties")
    .option("--props-file <path>", "File with computed CSS properties, one per line")
    .option("--cdp-url <url>", "Attach to an existing Chromium CDP endpoint")
    .option("--inherited <list>", "Walker-only: override inherited property list")
    .option("--inherited-file <path>", "Walker-only: provide inherited props via file")
    .option("--max-nodes <n>", "Walker-only: limit nodes visited", (value) =>
      parseInteger(value, "max-nodes"),
    )
    .option("--text-clip <n>", "Walker-only: truncate captured text", (value) =>
      parseInteger(value, "text-clip"),
    )
    .addOption(
      new Option("--wait-until <state>", "Navigation lifecycle to await")
        .choices(["load", "domcontentloaded", "networkidle"])
        .default("networkidle"),
    )
    .option("--timeout <ms>", "Navigation timeout in milliseconds", (value) =>
      parseInteger(value, "timeout"),
    )
    .option("-o, --output <file>", "Write output JSON to file instead of stdout")
    .option("--pretty", "Pretty-print the JSON response")
    .option("--headful", "Run browsers with UI (headless=false)")
    .parse(process.argv);

  const url = program.args[0];
  if (!url) {
    program.error("A URL is required");
  }

  const opts = program.opts();
  const mode: SnapshotMode = opts.mode;

  const properties = await resolvePropertyList({
    defaults: [...DEFAULT_COMPUTED_PROPERTIES],
    cliProps: opts.props,
    propsFile: opts.propsFile,
  });

  const inheritedProperties = await resolvePropertyList({
    defaults: [...DEFAULT_INHERITED_PROPERTIES],
    cliProps: opts.inherited,
    propsFile: opts.inheritedFile,
  });

  const result = await captureSnapshot({
    url,
    mode,
    browser: opts.browser,
    cdpUrl: opts.cdpUrl,
    headless: !opts.headful,
    waitUntil: opts.waitUntil,
    timeoutMs: opts.timeout,
    properties,
    inheritedProperties,
    maxNodes: opts.maxNodes,
    textClip: opts.textClip,
  });

  const payload = JSON.stringify(result, null, opts.pretty ? 2 : undefined);

  if (opts.output) {
    await fs.writeFile(opts.output, `${payload}\n`, "utf8");
    return;
  }

  process.stdout.write(`${payload}\n`);
}

main().catch((error) => {
  console.error(`[css-view] ${error.message}`);
  process.exitCode = 1;
});
