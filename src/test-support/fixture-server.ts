/**
 * Shared fixture-server utilities for browser-backed tests.
 *
 * Tests use this module to serve `tests/fixtures/hello-css` on an available
 * loopback port. The fixture server runs in-process via `Bun.serve`, which
 * binds to an OS-assigned port directly and avoids the race window between
 * a probe socket closing and a child process re-binding.
 */
import { once } from "node:events";
import net from "node:net";
import path from "node:path";

export interface FixtureServer {
  origin: string;
  close(): Promise<void>;
}

/**
 * Reserve and release an available loopback port.
 *
 * Used by tests that need to hand a port to an external child process (such
 * as Chromium's `--remote-debugging-port`). Callers must accept the small
 * race window between release and re-bind. Prefer binding to port `0`
 * in-process when possible.
 */
export async function findAvailablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a loopback port for the fixture server");
  }

  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Start the Hello CSS fixture as an in-process Bun HTTP server.
 *
 * Binding to port `0` lets the kernel assign a free port and report it
 * back synchronously via `server.port`, so there is no window during
 * which another process could claim the same port.
 */
export async function startHelloCssFixtureServer(): Promise<FixtureServer> {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "hello-css");

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;

      // Resolve against the fixture root and refuse anything that escapes it.
      const requested = path.resolve(fixtureRoot, `.${rawPath}`);
      const rootWithSep = fixtureRoot.endsWith(path.sep)
        ? fixtureRoot
        : `${fixtureRoot}${path.sep}`;
      if (requested !== fixtureRoot && !requested.startsWith(rootWithSep)) {
        return new Response("Forbidden", { status: 403 });
      }

      const file = Bun.file(requested);
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(file, {
        headers: {
          "content-type": contentTypeFor(requested),
          "cache-control": "no-store",
        },
      });
    },
  });

  const origin = `http://127.0.0.1:${server.port}`;

  return {
    origin,
    async close() {
      await server.stop(true);
    },
  };
}
