import { Errors } from "../errors";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../types";

// Sliding window rate limiter — per-account, using plain array. You could use the double ended queue data structure to optimize the time complexity of the check method.

/**
 * Tracks request timestamps per account using a sliding window.
 * Old timestamps are evicted on each check, keeping memory bounded.
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();

  constructor(
    private maxRequests: number = RATE_LIMIT_MAX,
    private windowMs: number = RATE_LIMIT_WINDOW_MS,
  ) {}

  /**
   * Check if a request is allowed for the given account.
   * Returns true if allowed, throws AppError if rate limited.
   */
  check(accountId: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(accountId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(accountId, timestamps);
    }

    // Evict expired timestamps from the front
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      throw Errors.rateLimited();
    }

    timestamps.push(now);
    return true;
  }

  /** Reset limiter for an account (useful for testing) */
  reset(accountId: string): void {
    this.windows.delete(accountId);
  }
}

export const rateLimiter = new RateLimiter();
