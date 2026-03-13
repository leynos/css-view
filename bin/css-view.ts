#!/usr/bin/env -S bun run
import { promises as fs } from "node:fs";
import { Command, Option } from "commander";
import { type SnapshotExecutionResult, type SnapshotMode, captureSnapshot } from "../src/snapshot";
import {
  DEFAULT_COMPUTED_PROPERTIES,
  DEFAULT_INHERITED_PROPERTIES,
} from "../src/snapshot/constants";
import { resolvePropertyList } from "../src/snapshot/property-resolver";

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

type ReadTextFile = (path: string) => Promise<string>;
type WriteTextFile = (path: string, contents: string) => Promise<void>;

interface CliDependencies {
  captureSnapshot?: typeof captureSnapshot;
  readFile?: ReadTextFile;
  writeFile?: WriteTextFile;
  stdout?: Pick<typeof process.stdout, "write">;
}

function buildProgram(): Command {
  const program = new Command();
  return program
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
    .option("--inherited <list>", "Walker-only: override inherited property list")
    .option("--inherited-file <path>", "Walker-only: provide inherited props via file")
    .option("-W, --viewport-width <px>", "Browser viewport width in CSS pixels", (value) =>
      parsePositiveInteger(value, "viewport-width"),
    )
    .option("-H, --viewport-height <px>", "Browser viewport height in CSS pixels", (value) =>
      parsePositiveInteger(value, "viewport-height"),
    )
    .option(
      "-R, --display-pixel-resolution <dpr>",
      "Browser device scale factor as a whole-number DPR",
      (value) => parsePositiveInteger(value, "display-pixel-resolution"),
    )
    .option("--max-nodes <n>", "Walker-only: limit nodes visited", (value) =>
      parseNonNegativeInteger(value, "max-nodes"),
    )
    .option("--text-clip <n>", "Walker-only: truncate captured text", (value) =>
      parseNonNegativeInteger(value, "text-clip"),
    )
    .addOption(
      new Option("--wait-until <state>", "Navigation lifecycle to await")
        .choices(["load", "domcontentloaded", "networkidle"])
        .default("networkidle"),
    )
    .option("--timeout <ms>", "Navigation timeout in milliseconds", (value) =>
      parseNonNegativeInteger(value, "timeout"),
    )
    .option("-o, --output <file>", "Write output JSON to file instead of stdout")
    .option("--pretty", "Pretty-print the JSON response")
    .option("--headful", "Run browsers with UI (headless=false)");
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<SnapshotExecutionResult> {
  const program = buildProgram();
  program.parse(["bun", "css-view", ...argv]);
  const url = program.args[0];
  if (!url) {
    program.error("A URL is required");
  }

  const readFile = dependencies.readFile ?? ((path) => fs.readFile(path, "utf8"));
  const writeFile = dependencies.writeFile ?? ((path, contents) => fs.writeFile(path, contents));
  const capture = dependencies.captureSnapshot ?? captureSnapshot;
  const stdout = dependencies.stdout ?? process.stdout;
  const opts = program.opts();
  const mode: SnapshotMode = opts.mode;

  const properties = await resolvePropertyList({
    defaults: [...DEFAULT_COMPUTED_PROPERTIES],
    cliProps: opts.props,
    propsFile: opts.propsFile,
    readFile,
  });

  const inheritedProperties = await resolvePropertyList({
    defaults: [...DEFAULT_INHERITED_PROPERTIES],
    cliProps: opts.inherited,
    propsFile: opts.inheritedFile,
    readFile,
  });

  const result = await capture({
    url,
    mode,
    browser: opts.browser,
    headless: !opts.headful,
    waitUntil: opts.waitUntil,
    timeoutMs: opts.timeout,
    properties,
    inheritedProperties,
    maxNodes: opts.maxNodes,
    textClip: opts.textClip,
    viewportWidth: opts.viewportWidth,
    viewportHeight: opts.viewportHeight,
    displayPixelResolution: opts.displayPixelResolution,
  });

  const payload = JSON.stringify(result, null, opts.pretty ? 2 : undefined);

  if (opts.output) {
    await writeFile(opts.output, `${payload}\n`);
    return result;
  }

  stdout.write(`${payload}\n`);
  return result;
}

async function main() {
  await runCli(process.argv.slice(2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[css-view] ${error.message}`);
    process.exitCode = 1;
  });
}
