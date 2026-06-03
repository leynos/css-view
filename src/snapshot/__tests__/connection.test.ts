import { describe, expect, it } from "bun:test";
import { openSnapshotTarget, resolveSnapshotPlan } from "../index";

interface GotoCall {
  url: string;
  options: { waitUntil: string; timeout: number };
}

class FakePage {
  readonly gotoCalls: GotoCall[] = [];

  constructor(private currentUrl: string) {}

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string, options: GotoCall["options"]): Promise<void> {
    this.currentUrl = url;
    this.gotoCalls.push({ url, options });
  }
}

class FakeContext {
  readonly createdPages: FakePage[] = [];
  closeCalls = 0;

  constructor(private readonly pageList: FakePage[] = []) {}

  pages(): FakePage[] {
    return this.pageList;
  }

  async newPage(): Promise<FakePage> {
    const page = new FakePage("about:blank");
    this.pageList.push(page);
    this.createdPages.push(page);
    return page;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeBrowser {
  closeCalls = 0;
  createdContexts = 0;

  constructor(private readonly contextList: FakeContext[] = []) {}

  contexts(): FakeContext[] {
    return this.contextList;
  }

  async newContext(): Promise<FakeContext> {
    this.createdContexts += 1;
    const context = new FakeContext();
    this.contextList.push(context);
    return context;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

describe("openSnapshotTarget", () => {
  it("launches a local browser and owns the created context", async () => {
    const browser = new FakeBrowser();
    const browserType = {
      launchCalls: [] as Array<{ headless: boolean }>,
      async launch(options: { headless: boolean }) {
        this.launchCalls.push(options);
        return browser;
      },
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "walker",
      properties: [],
      inheritedProperties: [],
      headless: false,
    });

    const target = await openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
      plan,
      url: "https://example.test/",
      browserType,
    });

    expect(browserType.launchCalls).toEqual([{ headless: false }]);
    expect(browser.createdContexts).toBe(1);
    expect(target.page.url()).toBe("https://example.test/");
    expect(target.shouldCloseContext).toBe(true);

    await target.dispose();

    expect(target.context.closeCalls).toBe(1);
    expect(browser.closeCalls).toBe(1);
  });

  it("attaches over CDP and reuses an existing page at the requested URL", async () => {
    const page = new FakePage("https://example.test/");
    const context = new FakeContext([page]);
    const browser = new FakeBrowser([context]);
    const browserType = {
      connectCalls: [] as Array<{ url: string; timeout: number }>,
      async connectOverCDP(url: string, options: { timeout: number }) {
        this.connectCalls.push({ url, timeout: options.timeout });
        return browser;
      },
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "cdp",
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      properties: [],
      inheritedProperties: [],
      timeoutMs: 1200,
    });

    const target = await openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
      plan,
      url: "https://example.test/",
      browserType,
    });

    expect(browserType.connectCalls).toEqual([
      { url: "ws://127.0.0.1:9222/devtools/browser/abc", timeout: 1200 },
    ]);
    expect(target.page).toBe(page);
    expect(page.gotoCalls).toEqual([]);
    expect(target.shouldCloseContext).toBe(false);

    await target.dispose();

    expect(context.closeCalls).toBe(0);
    expect(browser.closeCalls).toBe(1);
  });

  it("navigates the first existing CDP page when no URL matches", async () => {
    const page = new FakePage("about:blank");
    const context = new FakeContext([page]);
    const browser = new FakeBrowser([context]);
    const browserType = {
      async connectOverCDP() {
        return browser;
      },
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "cdp",
      cdpUrl: "http://127.0.0.1:9222/",
      properties: [],
      inheritedProperties: [],
      waitUntil: "load",
      timeoutMs: 1200,
    });

    const target = await openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
      plan,
      url: "https://example.test/",
      browserType,
    });

    expect(target.page).toBe(page);
    expect(page.gotoCalls).toEqual([
      { url: "https://example.test/", options: { waitUntil: "load", timeout: 1200 } },
    ]);
  });

  it("creates and navigates a CDP page when the browser has no pages", async () => {
    const context = new FakeContext();
    const browser = new FakeBrowser([context]);
    const browserType = {
      async connectOverCDP() {
        return browser;
      },
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "cdp",
      cdpUrl: "http://127.0.0.1:9222/",
      properties: [],
      inheritedProperties: [],
      waitUntil: "domcontentloaded",
      timeoutMs: 1200,
    });

    const target = await openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
      plan,
      url: "https://example.test/",
      browserType,
    });

    expect(context.createdPages).toEqual([target.page]);
    expect(target.page.gotoCalls).toEqual([
      {
        url: "https://example.test/",
        options: { waitUntil: "domcontentloaded", timeout: 1200 },
      },
    ]);
  });

  it("closes a CDP browser when page setup fails", async () => {
    const page = new FakePage("about:blank");
    const context = new FakeContext([page]);
    const browser = new FakeBrowser([context]);
    const browserType = {
      async connectOverCDP() {
        return browser;
      },
    };
    page.goto = async () => {
      throw new Error("navigation failed");
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "cdp",
      cdpUrl: "http://127.0.0.1:9222/",
      properties: [],
      inheritedProperties: [],
    });

    await expect(
      openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
        plan,
        url: "https://example.test/",
        browserType,
      }),
    ).rejects.toThrow("navigation failed");

    expect(browser.closeCalls).toBe(1);
    expect(context.closeCalls).toBe(0);
  });

  it("closes local browser resources when page setup fails", async () => {
    const page = new FakePage("about:blank");
    const context = new FakeContext([page]);
    const browser = new FakeBrowser([context]);
    const browserType = {
      async launch() {
        browser.newContext = async () => context;
        context.newPage = async () => page;
        return browser;
      },
    };
    page.goto = async () => {
      throw new Error("navigation failed");
    };
    const plan = resolveSnapshotPlan({
      url: "https://example.test/",
      mode: "walker",
      properties: [],
      inheritedProperties: [],
    });

    await expect(
      openSnapshotTarget<FakePage, FakeContext, FakeBrowser>({
        plan,
        url: "https://example.test/",
        browserType,
      }),
    ).rejects.toThrow("navigation failed");

    expect(context.closeCalls).toBe(1);
    expect(browser.closeCalls).toBe(1);
  });
});
