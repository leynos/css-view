/**
 * Recording `RetryAdapter` implementation for tests.
 *
 * Mirrors the `recordingRunner` factory pattern: it returns the adapter to
 * inject alongside the recorded data captured during the run. `sleep` resolves
 * immediately so retry tests never block, and `warn` is a no-op aside from
 * recording the message, letting tests assert on the retry timing and logging
 * contract without an actual delay or console output.
 */
import type { RetryAdapter } from "../snapshot/retry-adapter";

export interface RecordingRetryAdapter {
  /** Delays, in milliseconds, passed to each `sleep` call, in order. */
  sleeps: number[];
  /** Messages passed to each `warn` call, in order. */
  warnings: string[];
  /** Adapter to inject via the `retryAdapter` option. */
  adapter: RetryAdapter;
}

/** Create a `RetryAdapter` that records calls without sleeping or logging. */
export function createRecordingRetryAdapter(): RecordingRetryAdapter {
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const adapter: RetryAdapter = {
    async sleep(ms: number): Promise<void> {
      sleeps.push(ms);
    },
    warn(message: string): void {
      warnings.push(message);
    },
  };

  return { sleeps, warnings, adapter };
}
