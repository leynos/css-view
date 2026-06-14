/**
 * Resilience adapter for retry timing and operator logging.
 *
 * `AgentBrowserBackend` delegates its retry delay and warning output to this
 * adapter so that domain retry policy stays decoupled from the `Bun.sleep` and
 * `console.warn` infrastructure. Tests inject a recording implementation to
 * assert on the retry contract without waiting on a real delay.
 */
export interface RetryAdapter {
  /** Pause for the requested delay before retrying a transient failure. */
  sleep(ms: number): Promise<void>;
  /** Emit an operator-facing message describing retry progress. */
  warn(message: string): void;
}

/** Production adapter backed by `Bun.sleep` and `console.warn`. */
export const defaultRetryAdapter: RetryAdapter = {
  sleep(ms: number): Promise<void> {
    return Bun.sleep(ms);
  },
  warn(message: string): void {
    console.warn(message);
  },
};
