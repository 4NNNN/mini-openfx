import { Errors } from "../errors";

// Auth middleware, extracts X-Account-Id from request headers

/**
 * Extracts and validates the account ID from the request.
 * In a real system this would verify JWT / API keys.
 */
export function extractAccountId(req: Request): string {
  const accountId = req.headers.get("X-Account-Id");
  if (!accountId || accountId.trim() === "") {
    throw Errors.unauthorized();
  }
  return accountId.trim();
}
