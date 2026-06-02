/**
 * Shared fixture-server utilities for browser-backed tests.
 *
 * Tests use this module to serve `tests/fixtures/hello-css` on an available
 * loopback port and to close only the child process started for that fixture.
 */
import { once } from "node:events";
import net from "node:net";
import path from "node:path";

export interface FixtureServer {
  origin: string;
  close(): Promise<void>;
}

/** Reserve and release an available loopback port for a fixture server. */
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

/** Poll the fixture origin until http-server is ready to serve index.html. */
async function waitForServer(origin: string): Promise<void> {
  const deadline = Date.now() + 10000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/index.html`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Fixture server did not become ready: ${String(lastError)}`);
}

/** Terminate a child process without allowing cleanup to consume a whole test timeout. */
async function stopProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  proc.kill();
  const exited = proc.exited.then(() => undefined);
  await Promise.race([exited, Bun.sleep(2000)]);
  proc.kill("SIGKILL");
  await Promise.race([exited, Bun.sleep(2000)]);
}

/** Start the Hello CSS fixture and return its origin plus a bounded close hook. */
export async function startHelloCssFixtureServer(): Promise<FixtureServer> {
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "hello-css");
  const proc = Bun.spawn(
    ["bunx", "http-server", fixturePath, "-p", String(port), "-a", "127.0.0.1", "-c-1"],
    {
      cwd: process.cwd(),
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  try {
    await waitForServer(origin);
  } catch (error) {
    await stopProcess(proc);
    throw error;
  }

  return {
    origin,
    async close() {
      await stopProcess(proc);
    },
  };
}
