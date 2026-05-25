/**
 * fetch with bounded retries for transient failures.
 *
 * Retries on:
 *   - thrown fetch errors (network / DNS / TLS)
 *   - HTTP 429 (Too Many Requests) — honors `Retry-After` when present
 *   - HTTP 5xx
 *
 * Other non-2xx responses are returned to the caller as-is.
 */

export interface RetryOptions {
  /** Max number of attempts (including the first). Default 10. */
  maxAttempts?: number;
  /** Base backoff in ms; doubles each retry up to `maxDelayMs`. Default 1000. */
  baseDelayMs?: number;
  /** Cap for any individual backoff. Default 30_000. */
  maxDelayMs?: number;
  /** Cap for honored Retry-After in seconds. Default 60. */
  maxRetryAfterSec?: number;
  /** Optional label used in thrown error messages. */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const asInt = Number(trimmed);
  if (Number.isFinite(asInt)) return Math.max(0, asInt);
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return null;
}

function jitter(ms: number): number {
  // ±25%
  const delta = ms * 0.25;
  return ms - delta + Math.random() * (2 * delta);
}

export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 10;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const maxRetryAfterSec = opts.maxRetryAfterSec ?? 60;
  const label = opts.label ?? "fetch";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        throw new Error(
          `${label}: network error after ${attempt} attempts: ${
            (err as Error).message ?? String(err)
          }`,
        );
      }
      const delay = Math.min(
        baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs,
      );
      await sleep(jitter(delay));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`${label}: HTTP ${res.status}`);
      if (attempt === maxAttempts) {
        throw new Error(
          `${label}: HTTP ${res.status} after ${attempt} attempts`,
        );
      }
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const expDelay = Math.min(
        baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs,
      );
      const waitMs =
        retryAfter !== null
          ? Math.min(retryAfter, maxRetryAfterSec) * 1000
          : jitter(expDelay);
      // drain body so the connection can be reused
      await res.body?.cancel().catch(() => undefined);
      await sleep(waitMs);
      continue;
    }

    return res;
  }

  // Unreachable: every branch above either returns or throws on the last
  // attempt. Keep the type checker happy.
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label}: exhausted retries`);
}
