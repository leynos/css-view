import type { Page } from "playwright";
import type { Protocol } from "playwright-core/types/protocol";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CdpSnapshotNode {
  index: number;
  nodeType: number | null;
  tagName: string | null;
  attributes: Record<string, string>;
  parentIndex: number | null;
  children: number[];
  textContent: string | null;
  layoutText: string | null;
  boundingBox?: BoundingBox;
  computedStyles: Record<string, string>;
}

export interface CdpSnapshotResult {
  mode: "cdp";
  nodes: CdpSnapshotNode[];
  computedProperties: string[];
}

export interface CdpCaptureOptions {
  properties: string[];
}

interface CdpEndpointCaptureOptions extends CdpCaptureOptions {
  url: string;
  cdpUrl: string;
  timeoutMs: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
}

interface CdpCommandResponse<T> {
  id: number;
  result?: T;
  error?: { message: string };
}

interface CdpEvent {
  method: string;
  sessionId?: string;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface AttachToTargetResult {
  sessionId: string;
}

interface CreateTargetResult {
  targetId: string;
}

interface GetTargetsResult {
  targetInfos: TargetInfo[];
}

const snapshotParameters = (
  properties: string[],
): Protocol.DOMSnapshot.captureSnapshotParameters => ({
  computedStyles: properties,
  includePaintOrder: true,
  includeDOMRects: true,
  includeBlendedBackgroundColors: true,
  includeTextColorOpacities: true,
});

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private readonly eventWaiters: Array<{
    method: string;
    sessionId?: string;
    resolve(): void;
  }> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });
    socket.addEventListener("error", () => {
      this.rejectPending(new Error("CDP WebSocket connection failed"));
    });
    socket.addEventListener("close", () => {
      this.rejectPending(new Error("CDP WebSocket connection closed"));
    });
  }

  static connect(webSocketUrl: string, timeoutMs: number): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to CDP endpoint after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Failed to connect to CDP endpoint"));
      });
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;

    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    this.socket.send(JSON.stringify(message));
    return promise;
  }

  waitForEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);

      this.eventWaiters.push({
        method,
        sessionId,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as CdpCommandResponse<unknown> & CdpEvent;
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.method) {
      const waiterIndex = this.eventWaiters.findIndex(
        (waiter) =>
          waiter.method === message.method &&
          (waiter.sessionId === undefined || waiter.sessionId === message.sessionId),
      );
      if (waiterIndex >= 0) {
        const [waiter] = this.eventWaiters.splice(waiterIndex, 1);
        waiter?.resolve();
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function resolveWebSocketUrl(cdpUrl: string): Promise<string> {
  const parsed = new URL(cdpUrl);
  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
    return cdpUrl;
  }

  const versionUrl = new URL("/json/version", parsed);
  const response = await fetch(versionUrl);
  if (!response.ok) {
    throw new Error(`Could not read CDP version endpoint: HTTP ${response.status}`);
  }
  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error("CDP version endpoint did not include webSocketDebuggerUrl");
  }

  return version.webSocketDebuggerUrl;
}

async function attachToPage(
  connection: CdpConnection,
  url: string,
  timeoutMs: number,
): Promise<string> {
  const targets = await connection.send<GetTargetsResult>("Target.getTargets");
  const pageTargets = targets.targetInfos.filter((target) => target.type === "page");
  const target =
    pageTargets.find((candidate) => candidate.url === url) ??
    pageTargets[0] ??
    (await connection.send<CreateTargetResult>("Target.createTarget", { url: "about:blank" }));
  const targetId = target.targetId;

  const { sessionId } = await connection.send<AttachToTargetResult>("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  const currentUrl = "url" in target ? target.url : "about:blank";
  if (currentUrl !== url) {
    await connection.send("Page.enable", {}, sessionId);
    const loadEvent = connection.waitForEvent("Page.loadEventFired", sessionId, timeoutMs);
    await connection.send("Page.navigate", { url }, sessionId);
    await loadEvent;
  }

  return sessionId;
}

function buildCdpSnapshotResult(
  response: Protocol.DOMSnapshot.captureSnapshotReturnValue,
  properties: string[],
): CdpSnapshotResult {
  const strings = response.strings ?? [];
  const doc = response.documents[0];
  const nodes = doc.nodes;
  const layout = doc.layout;

  const layoutInfoByNode = new Map<
    number,
    {
      computed: Record<string, string>;
      boundingBox?: BoundingBox;
      text?: string | null;
    }
  >();

  const layoutNodeIndexes = layout.nodeIndex ?? [];
  for (let i = 0; i < layoutNodeIndexes.length; i += 1) {
    const nodeIndex = layoutNodeIndexes[i];
    const styleIndexes = layout.styles?.[i] ?? [];
    const computed: Record<string, string> = {};
    for (let propIdx = 0; propIdx < properties.length; propIdx += 1) {
      const stringIndex = styleIndexes[propIdx];
      if (typeof stringIndex === "number" && stringIndex >= 0) {
        computed[properties[propIdx]] = strings[stringIndex];
      }
    }

    const bounds = layout.bounds?.[i];
    const boundingBox =
      bounds && bounds.length >= 4
        ? { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }
        : undefined;

    const textIndex = layout.text?.[i];
    const text = typeof textIndex === "number" ? (strings[textIndex] ?? null) : null;

    layoutInfoByNode.set(nodeIndex, { computed, boundingBox, text });
  }

  const parentIndex = nodes.parentIndex ?? [];
  const childMap = new Map<number, number[]>();
  for (let i = 0; i < parentIndex.length; i += 1) {
    const parent = parentIndex[i];
    if (parent == null || parent === -1) continue;
    if (!childMap.has(parent)) childMap.set(parent, []);
    const bucket = childMap.get(parent);
    if (bucket) bucket.push(i);
  }

  const nodeCount = nodes.nodeName?.length ?? 0;
  const records: CdpSnapshotNode[] = [];

  for (let i = 0; i < nodeCount; i += 1) {
    const nodeType = nodes.nodeType?.[i] ?? null;
    const nodeNameIndex = nodes.nodeName?.[i];
    const tagName =
      typeof nodeNameIndex === "number" ? (strings[nodeNameIndex]?.toLowerCase() ?? null) : null;

    const attributeIndexes = nodes.attributes?.[i] ?? [];
    const attributes: Record<string, string> = {};
    for (let j = 0; j < attributeIndexes.length; j += 2) {
      const name = strings[attributeIndexes[j]];
      const value = strings[attributeIndexes[j + 1]] ?? "";
      if (name) {
        attributes[name] = value;
      }
    }

    const nodeValueIndex = nodes.nodeValue?.[i];
    const textContent =
      typeof nodeValueIndex === "number" && strings[nodeValueIndex]?.trim()
        ? strings[nodeValueIndex]
        : null;

    const layoutInfo = layoutInfoByNode.get(i);

    records.push({
      index: i,
      nodeType,
      tagName,
      attributes,
      parentIndex: parentIndex[i] ?? null,
      children: childMap.get(i) ?? [],
      textContent,
      layoutText: layoutInfo?.text ?? null,
      boundingBox: layoutInfo?.boundingBox,
      computedStyles: layoutInfo?.computed ?? {},
    });
  }

  return { mode: "cdp", nodes: records, computedProperties: properties };
}

export async function captureWithCdpEndpoint({
  cdpUrl,
  url,
  properties,
  timeoutMs,
}: CdpEndpointCaptureOptions): Promise<CdpSnapshotResult> {
  const webSocketUrl = await resolveWebSocketUrl(cdpUrl);
  const connection = await CdpConnection.connect(webSocketUrl, timeoutMs);

  try {
    const sessionId = await attachToPage(connection, url, timeoutMs);
    const response = await connection.send<Protocol.DOMSnapshot.captureSnapshotReturnValue>(
      "DOMSnapshot.captureSnapshot",
      snapshotParameters(properties),
      sessionId,
    );

    return buildCdpSnapshotResult(response, properties);
  } finally {
    connection.close();
  }
}

export async function captureWithCdp(
  page: Page,
  { properties }: CdpCaptureOptions,
): Promise<CdpSnapshotResult> {
  const session = await page.context().newCDPSession(page);
  const response = (await session.send(
    "DOMSnapshot.captureSnapshot",
    snapshotParameters(properties),
  )) as Protocol.DOMSnapshot.captureSnapshotReturnValue;

  return buildCdpSnapshotResult(response, properties);
}
