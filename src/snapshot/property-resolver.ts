import { promises as fs } from "node:fs";

export interface ResolvePropertyListOptions {
  defaults: string[];
  cliProps?: string | string[];
  propsFile?: string;
  readFile?: (path: string) => Promise<string>;
}

function splitProps(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

export async function resolvePropertyList({
  defaults,
  cliProps,
  propsFile,
  readFile = (path: string) => fs.readFile(path, "utf8"),
}: ResolvePropertyListOptions): Promise<string[]> {
  if (propsFile) {
    const raw = await readFile(propsFile);
    const values = dedupe(splitProps(raw));
    return values.length > 0 ? values : defaults;
  }

  if (cliProps && typeof cliProps === "string" && cliProps.trim().length > 0) {
    const values = dedupe(splitProps(cliProps));
    return values.length > 0 ? values : defaults;
  }

  if (Array.isArray(cliProps) && cliProps.length > 0) {
    const values = dedupe(
      cliProps
        .flatMap((value) => value.split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    return values.length > 0 ? values : defaults;
  }

  return defaults;
}
