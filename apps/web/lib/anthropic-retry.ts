// Shared retry-with-backoff for Anthropic calls. Wraps any async
// function and retries on transient capacity errors (529 overloaded,
// 503 unavailable, 429 rate-limited). Surfaces a clean user-facing
// error message after the final attempt — the raw SDK message is
// '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
// which is useless to a non-engineer.
//
// Use at every messages.create() site we'd rather not have user
// flows depend on Anthropic's exact uptime — analysis, designer
// read, matcher ranker.

interface RetryOptions {
  /** Label for log lines, e.g. "vision" / "designer" / "matcher". */
  label: string;
  /** Backoff schedule in ms. Length = max attempts. First attempt
   *  fires immediately (delay 0). Default: 3 attempts at 0/2s/5s. */
  delaysMs?: number[];
}

interface MaybeStatused {
  status?: number;
  response?: { status?: number };
  error?: { type?: string };
  type?: string;
  message?: string;
}

/** True if the error looks like a transient capacity problem worth retrying. */
function isRetryable(err: unknown): boolean {
  const e = err as MaybeStatused;
  const status = e?.status ?? e?.response?.status;
  const errorType = e?.error?.type ?? e?.type;
  if (status === 529 || status === 503 || status === 429) return true;
  if (errorType === 'overloaded_error' || errorType === 'rate_limit_error') return true;
  // SDK sometimes surfaces only a message; sniff for "overloaded".
  if (typeof e?.message === 'string' && /overload|rate.?limit|temporar/i.test(e.message)) return true;
  return false;
}

/** Map a final-attempt error into a friendly user-facing Error. */
function friendlyError(err: unknown, label: string): Error {
  const e = err as MaybeStatused;
  const status = e?.status ?? e?.response?.status;
  const errorType = e?.error?.type ?? e?.type;
  if (status === 529 || errorType === 'overloaded_error') {
    return new Error(
      `Claude is temporarily overloaded — please try again in a minute. (${label})`,
    );
  }
  if (status === 429 || errorType === 'rate_limit_error') {
    return new Error(
      `Too many requests in a short window — please try again in a minute. (${label})`,
    );
  }
  if (status === 503) {
    return new Error(
      `Claude is briefly unavailable — please try again in a minute. (${label})`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function withAnthropicRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const delays = options.delaysMs ?? [0, 2000, 5000];
  let lastErr: unknown;
  for (let i = 0; i < delays.length; i++) {
    const wait = delays[i] ?? 0;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryable(err);
      const isLast = i === delays.length - 1;
      if (!retryable || isLast) {
        if (!retryable) throw err;
        // Last attempt and still failing — surface the friendly version
        // so the upstream API route doesn't spit raw JSON at the user.
        throw friendlyError(err, options.label);
      }
      const nextWait = delays[i + 1] ?? 0;
      console.warn(
        `[anthropic-retry] ${options.label} attempt ${i + 1} failed (retryable) — retrying after ${nextWait}ms`,
      );
    }
  }
  throw friendlyError(lastErr, options.label);
}
