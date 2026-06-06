/**
 * Chromium DevTools Protocol capture implementation.
 *
 * Local captures use Playwright page CDP sessions, while external `--cdp-url`
 * captures use the direct WebSocket client in this module so css-view can
 * attach to agent-browser or provider-managed browser endpoints.
 */
import type { Page } from "playwright";

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
  useCurrentPage?: boolean;
  activePageIndex?: number;
}

interface CdpCommandResponse<T> {
  id: number;
  result?: T;
  error?: { message: string };
}

interface CdpEvent {
  method: string;
  sessionId?: string;
  params?: Record<string, unknown>;
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

interface DomSnapshotParameters extends Record<string, unknown> {
  computedStyles: string[];
  includePaintOrder: boolean;
  includeDOMRects: boolean;
  includeBlendedBackgroundColors: boolean;
  includeTextColorOpacities: boolean;
}

interface DomSnapshotResponse {
  strings?: string[];
  documents: Array<{
    nodes: {
      attributes?: number[][];
      nodeName?: number[];
      nodeType?: Array<number | null>;
      nodeValue?: number[];
      parentIndex?: number[];
    };
    layout: {
      bounds?: number[][];
      nodeIndex?: number[];
      styles?: number[][];
      text?: number[];
    };
  }>;
}

/** Build the DOMSnapshot request for the caller's computed-style whitelist. */
const snapshotParameters = (properties: string[]): DomSnapshotParameters => ({
  computedStyles: properties,
  includePaintOrder: true,
  includeDOMRects: true,
  includeBlendedBackgroundColors: true,
  includeTextColorOpacities: true,
});

/** Minimal CDP WebSocket client with request and event timeout handling. */
class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private readonly eventWaiters: Array<{
    matches(message: CdpEvent): boolean;
    observe?(message: CdpEvent): boolean;
    complete(): void;
    fail(error: Error): void;
  }> = [];

  private constructor(
    private readonly socket: WebSocket,
    private readonly requestTimeoutMs: number,
  ) {
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

  /** Open the CDP WebSocket and fail if the connection handshake times out. */
  static connect(webSocketUrl: string, timeoutMs: number): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to CDP endpoint after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket, timeoutMs));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Failed to connect to CDP endpoint"));
      });
    });
  }

  /** Send one CDP command and reject if its response does not arrive in time. */
  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;

    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP response to ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  /** Wait for one matching CDP event and remove the waiter on completion or timeout. */
  waitForEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.eventWaiters)[number] = {
        matches: (message) =>
          message.method === method && (sessionId === undefined || message.sessionId === sessionId),
        complete: () => {
          clearTimeout(timer);
          resolve();
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.removeEventWaiter(waiter);
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      this.eventWaiters.push(waiter);
    });
  }

  /** Wait until network activity is idle after the supplied lifecycle event. */
  waitForNetworkIdle(
    sessionId: string,
    timeoutMs: number,
    activateAfter: Promise<void>,
    idleMs = 500,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let isActivated = false;
      const inFlightRequests = new Set<string>();

      const clearIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };
      const finish = () => {
        this.removeEventWaiter(waiter);
        clearTimeout(timeoutTimer);
        clearIdleTimer();
        resolve();
      };
      const fail = (error: Error) => {
        this.removeEventWaiter(waiter);
        clearTimeout(timeoutTimer);
        clearIdleTimer();
        reject(error);
      };
      const scheduleIdleCheck = () => {
        clearIdleTimer();
        if (!isActivated || inFlightRequests.size > 0) {
          return;
        }
        idleTimer = setTimeout(finish, idleMs);
      };

      const waiter: (typeof this.eventWaiters)[number] = {
        matches: () => false,
        observe: (message) => {
          if (message.sessionId !== sessionId) {
            return false;
          }

          if (message.method === "Network.requestWillBeSent") {
            const requestId = message.params?.requestId;
            if (typeof requestId === "string") {
              inFlightRequests.add(requestId);
            }
            clearIdleTimer();
            return false;
          }

          if (
            message.method === "Network.loadingFinished" ||
            message.method === "Network.loadingFailed"
          ) {
            const requestId = message.params?.requestId;
            if (typeof requestId === "string") {
              inFlightRequests.delete(requestId);
            }
            scheduleIdleCheck();
          }

          return false;
        },
        complete: finish,
        fail,
      };
      const timeoutTimer = setTimeout(() => {
        fail(new Error("Timed out waiting for CDP network idle"));
      }, timeoutMs);
      this.eventWaiters.push(waiter);

      activateAfter
        .then(() => {
          isActivated = true;
          scheduleIdleCheck();
        })
        .catch(fail);
    });
  }

  /** Close the WebSocket; outstanding requests are rejected by the close handler. */
  close(): void {
    this.socket.close();
  }

  /** Dispatch incoming CDP responses and events to pending requests and waiters. */
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
      for (const waiter of [...this.eventWaiters]) {
        if (waiter.observe?.(message)) {
          this.removeEventWaiter(waiter);
          waiter.complete();
        }
      }

      const waiterIndex = this.eventWaiters.findIndex((waiter) => waiter.matches(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.eventWaiters.splice(waiterIndex, 1);
        waiter?.complete();
      }
    }
  }

  /** Reject all pending work when the CDP transport fails or closes. */
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();

    for (const waiter of this.eventWaiters.splice(0)) {
      waiter.fail(error);
    }
  }

  /** Remove an event waiter if it has not already completed or failed. */
  private removeEventWaiter(waiter: (typeof this.eventWaiters)[number]): void {
    const index = this.eventWaiters.indexOf(waiter);
    if (index >= 0) {
      this.eventWaiters.splice(index, 1);
    }
  }
}

/** Resolve HTTP(S) CDP endpoints to browser WebSocket URLs with a timeout. */
async function resolveWebSocketUrl(cdpUrl: string, timeoutMs: number): Promise<string> {
  const parsed = new URL(cdpUrl);
  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
    return cdpUrl;
  }

  const versionUrl = new URL(parsed);
  versionUrl.pathname = versionUrl.pathname.replace(/\/?$/, "/json/version");
  versionUrl.search = "";
  versionUrl.hash = "";
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const response = await fetch(versionUrl, { signal: abortController.signal }).finally(() => {
    clearTimeout(timer);
  });
  if (!response.ok) {
    throw new Error(`Could not read CDP version endpoint: HTTP ${response.status}`);
  }
  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error("CDP version endpoint did not include webSocketDebuggerUrl");
  }

  return version.webSocketDebuggerUrl;
}

/** Attach to the requested CDP page and perform navigation when required. */
async function attachToPage(
  connection: CdpConnection,
  {
    url,
    timeoutMs,
    waitUntil,
    useCurrentPage,
    activePageIndex,
  }: {
    url: string;
    timeoutMs: number;
    waitUntil: "load" | "domcontentloaded" | "networkidle";
    useCurrentPage?: boolean;
    activePageIndex?: number;
  },
): Promise<string> {
  const targets = await connection.send<GetTargetsResult>("Target.getTargets");
  const pageTargets = targets.targetInfos.filter((target) => target.type === "page");
  const target = useCurrentPage
    ? pageTargets[activePageIndex ?? 0]
    : (pageTargets.find((candidate) => candidate.url === url) ??
      pageTargets[0] ??
      (await connection.send<CreateTargetResult>("Target.createTarget", { url: "about:blank" })));
  if (!target) {
    throw new Error("No active CDP page target is available for --use-current-page");
  }
  const targetId = target.targetId;

  const { sessionId } = await connection.send<AttachToTargetResult>("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  const currentUrl = "url" in target ? target.url : "about:blank";
  if (!useCurrentPage && currentUrl !== url) {
    await connection.send("Page.enable", {}, sessionId);
    const lifecycleEvent =
      waitUntil === "domcontentloaded" ? "Page.domContentEventFired" : "Page.loadEventFired";
    const lifecycle = connection.waitForEvent(lifecycleEvent, sessionId, timeoutMs);
    const networkIdle =
      waitUntil === "networkidle"
        ? connection.waitForNetworkIdle(sessionId, timeoutMs, lifecycle)
        : undefined;
    if (waitUntil === "networkidle") {
      await connection.send("Network.enable", {}, sessionId);
    }
    await connection.send("Page.navigate", { url }, sessionId);
    await lifecycle;
    await networkIdle;
  }

  return sessionId;
}

/** Convert Chromium DOMSnapshot output into css-view's stable CDP payload. */
function buildCdpSnapshotResult(
  response: DomSnapshotResponse,
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

/** Capture computed styles from an existing browser-level CDP endpoint. */
export async function captureWithCdpEndpoint({
  cdpUrl,
  url,
  properties,
  timeoutMs,
  waitUntil,
  useCurrentPage,
  activePageIndex,
}: CdpEndpointCaptureOptions): Promise<CdpSnapshotResult> {
  const webSocketUrl = await resolveWebSocketUrl(cdpUrl, timeoutMs);
  const connection = await CdpConnection.connect(webSocketUrl, timeoutMs);

  try {
    const sessionId = await attachToPage(connection, {
      url,
      timeoutMs,
      waitUntil,
      useCurrentPage,
      activePageIndex,
    });
    const response = await connection.send<DomSnapshotResponse>(
      "DOMSnapshot.captureSnapshot",
      snapshotParameters(properties),
      sessionId,
    );

    return buildCdpSnapshotResult(response, properties);
  } finally {
    connection.close();
  }
}

/** Capture computed styles from a Playwright page using its CDP session. */
export async function captureWithCdp(
  page: Page,
  { properties }: CdpCaptureOptions,
): Promise<CdpSnapshotResult> {
  const session = await page.context().newCDPSession(page);
  const response = (await session.send(
    "DOMSnapshot.captureSnapshot",
    snapshotParameters(properties),
  )) as DomSnapshotResponse;

  return buildCdpSnapshotResult(response, properties);
}
