import type { Page } from "playwright";

export interface WalkerNodeSnapshot {
  tag: string;
  id: string | null;
  classes: string[];
  role: string | null;
  name: string | null;
  text: string | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  styleDiff: Record<string, string>;
  children: WalkerNodeSnapshot[];
}

export interface WalkerSnapshotResult {
  mode: "walker";
  tree: WalkerNodeSnapshot | null;
  meta: { visited: number; maxNodes: number; textClip: number };
}

export interface WalkerCaptureOptions {
  inherited: string[];
  maxNodes: number;
  textClip: number;
}

const walkerEvaluator = ({
  inheritedProps,
  maxNodes,
  textClip,
}: {
  inheritedProps: string[];
  maxNodes: number;
  textClip: number;
}) => {
  const inherited = new Set(inheritedProps);

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:0;visibility:hidden";
  document.documentElement.appendChild(iframe);

  const defaultsCache = new Map<string, Record<string, string>>();
  const readDefaults = (tagName: string) => {
    const upper = tagName.toUpperCase();
    const cached = defaultsCache.get(upper);
    if (cached) return cached;
    const doc = iframe.contentDocument;
    if (!doc || !doc.body) return {};
    const el = doc.createElement(upper);
    doc.body.appendChild(el);
    const cs = iframe.contentWindow?.getComputedStyle(el);
    const record: Record<string, string> = {};
    if (cs) {
      for (const prop of cs) {
        record[prop] = cs.getPropertyValue(prop);
      }
    }
    el.remove();
    defaultsCache.set(upper, record);
    return record;
  };

  const styleToDict = (cs: CSSStyleDeclaration) => {
    const dict: Record<string, string> = {};
    for (const property of cs) {
      dict[property] = cs.getPropertyValue(property);
    }
    return dict;
  };

  let visited = 0;

  const trimText = (node: Element) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return node.value ? node.value.slice(0, textClip) : null;
    }
    const text = node.textContent?.trim() ?? "";
    if (!text) return null;
    return text.slice(0, textClip);
  };

  const collect = (node: Element, parentComputed: Record<string, string> | null) => {
    visited += 1;
    if (visited > maxNodes) return null;

    const cs = getComputedStyle(node);
    const computed = styleToDict(cs);
    const defaults = readDefaults(node.tagName);
    const diffs: Record<string, string> = {};

    for (const [property, value] of Object.entries(computed)) {
      if (value == null) continue;
      if (property.startsWith("--")) {
        const baseline = parentComputed?.[property];
        if (baseline === undefined || baseline !== value) {
          diffs[property] = value;
        }
        continue;
      }

      if (inherited.has(property)) {
        const baseline = parentComputed?.[property] ?? defaults[property];
        if (baseline === undefined || baseline !== value) {
          diffs[property] = value;
        }
      } else {
        const baseline = defaults[property];
        if (baseline === undefined || baseline !== value) {
          diffs[property] = value;
        }
      }
    }

    const rect = node.getBoundingClientRect();

    const snapshot = {
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: node.className ? String(node.className).trim().split(/\s+/).filter(Boolean) : [],
      role: node.getAttribute("role"),
      name: node.getAttribute("name"),
      text: trimText(node),
      bbox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      styleDiff: diffs,
      children: [] as WalkerNodeSnapshot[],
    } as WalkerNodeSnapshot;

    for (const child of Array.from(node.children)) {
      const childSnapshot = collect(child, computed);
      if (childSnapshot) snapshot.children.push(childSnapshot);
    }

    return snapshot;
  };

  const tree = document.documentElement ? collect(document.documentElement, null) : null;
  iframe.remove();
  return { tree, visited };
};

export async function captureWithWalker(
  page: Page,
  options: WalkerCaptureOptions,
): Promise<WalkerSnapshotResult> {
  const result = await page.evaluate(walkerEvaluator, {
    inheritedProps: options.inherited,
    maxNodes: options.maxNodes,
    textClip: options.textClip,
  });

  return {
    mode: "walker",
    tree: result.tree,
    meta: {
      visited: result.visited,
      maxNodes: options.maxNodes,
      textClip: options.textClip,
    },
  };
}
