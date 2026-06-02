import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type FixtureServer, startHelloCssFixtureServer } from "../../test-support/fixture-server";
import type { CdpSnapshotNode } from "../cdp";
import { captureSnapshot } from "../index";
import type { WalkerNodeSnapshot } from "../walker";

const computedProperties = ["color", "font-size", "background-color", "margin-top", "display"];

function findWalkerNode(
  node: WalkerNodeSnapshot | null,
  id: string,
): WalkerNodeSnapshot | undefined {
  if (!node) {
    return undefined;
  }
  if (node.id === id) {
    return node;
  }

  for (const child of node.children) {
    const found = findWalkerNode(child, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findWalkerNodeByClass(
  node: WalkerNodeSnapshot | null,
  className: string,
): WalkerNodeSnapshot | undefined {
  if (!node) {
    return undefined;
  }
  if (node.classes.includes(className)) {
    return node;
  }

  for (const child of node.children) {
    const found = findWalkerNodeByClass(child, className);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findCdpNode(nodes: CdpSnapshotNode[], id: string): CdpSnapshotNode | undefined {
  return nodes.find((node) => node.attributes.id === id);
}

describe("fixture-backed snapshots", () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startHelloCssFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("captures a stable walker snapshot subset for the Hello World fixture", async () => {
    const result = await captureSnapshot({
      url: `${server.origin}/index.html`,
      mode: "walker",
      browser: "chromium",
      waitUntil: "load",
      properties: computedProperties,
      inheritedProperties: ["color", "font-family", "font-size"],
    });

    if (result.payload.mode !== "walker") {
      throw new Error("Expected walker payload");
    }

    const title = findWalkerNode(result.payload.tree, "title");
    const card = findWalkerNodeByClass(result.payload.tree, "card");

    expect(title?.text).toBe("Hello World");
    expect(title?.styleDiff.color).toBe("rgb(34, 34, 136)");
    expect(title?.styleDiff["font-size"]).toBe("32px");

    expect({
      mode: result.mode,
      browser: result.browser,
      payloadMode: result.payload.mode,
      card: {
        tag: card?.tag,
        classes: card?.classes,
        background: card?.styleDiff["background-color"],
        borderTopWidth: card?.styleDiff["border-top-width"],
      },
      title: {
        tag: title?.tag,
        id: title?.id,
        classes: title?.classes,
        text: title?.text,
        color: title?.styleDiff.color,
        fontSize: title?.styleDiff["font-size"],
      },
    }).toMatchSnapshot();
  });

  it("captures a stable CDP snapshot subset for the Hello World fixture", async () => {
    const result = await captureSnapshot({
      url: `${server.origin}/index.html`,
      mode: "cdp",
      waitUntil: "load",
      properties: computedProperties,
      inheritedProperties: [],
    });

    if (result.payload.mode !== "cdp") {
      throw new Error("Expected CDP payload");
    }

    const title = findCdpNode(result.payload.nodes, "title");
    const titleText =
      title?.children
        .map((index) => result.payload.mode === "cdp" && result.payload.nodes[index])
        .find((node) => node && node.nodeType === 3) || undefined;
    const card = result.payload.nodes.find((node) => node.attributes.class === "card");

    expect(titleText?.layoutText).toBe("Hello World");
    expect(title?.computedStyles.color).toBe("rgb(34, 34, 136)");
    expect(title?.computedStyles["font-size"]).toBe("32px");

    expect({
      mode: result.mode,
      browser: result.browser,
      payloadMode: result.payload.mode,
      computedProperties: result.payload.computedProperties,
      card: {
        tagName: card?.tagName,
        className: card?.attributes.class,
        backgroundColor: card?.computedStyles["background-color"],
        display: card?.computedStyles.display,
      },
      title: {
        tagName: title?.tagName,
        id: title?.attributes.id,
        className: title?.attributes.class,
        layoutText: titleText?.layoutText,
        color: title?.computedStyles.color,
        fontSize: title?.computedStyles["font-size"],
      },
    }).toMatchSnapshot();
  });
});
