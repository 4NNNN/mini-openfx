// ---------------------------------------------------------------------------
// Custom error class for consistent API error responses
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "QUOTE_EXPIRED"
  | "QUOTE_ALREADY_EXECUTED"
  | "PAIR_NOT_SUPPORTED"
  | "RATE_LIMITED"
  | "PRICE_FETCH_FAILED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers for common errors
// ---------------------------------------------------------------------------

export const Errors = {
  validation: (msg: string) => new AppError("VALIDATION_ERROR", msg, 400),
  unauthorized: (msg = "Missing or invalid X-Account-Id header") =>
    new AppError("UNAUTHORIZED", msg, 401),
  notFound: (resource: string) =>
    new AppError("NOT_FOUND", `${resource} not found`, 404),
  insufficientBalance: (currency: string) =>
    new AppError("INSUFFICIENT_BALANCE", `Insufficient ${currency} balance`, 400),
  quoteExpired: () =>
    new AppError("QUOTE_EXPIRED", "Quote has expired. Request a new quote.", 400),
  quoteAlreadyExecuted: () =>
    new AppError("QUOTE_ALREADY_EXECUTED", "Quote has already been executed.", 409),
  pairNotSupported: (pair: string) =>
    new AppError("PAIR_NOT_SUPPORTED", `Currency pair ${pair} is not supported`, 400),
  rateLimited: () =>
    new AppError("RATE_LIMITED", "Rate limit exceeded. Try again later.", 429),
  priceFetchFailed: (msg: string) =>
    new AppError("PRICE_FETCH_FAILED", msg, 502),
  internal: (msg = "Internal server error") =>
    new AppError("INTERNAL_ERROR", msg, 500),
} as const;
