import { eq } from "drizzle-orm";
import { db } from "../db";
import { quotes } from "../db/schema";
import { getExecutionPrice } from "./price.service";
import { toScaled, fromScaled, scaledMultiply } from "../money";
import { Errors } from "../errors";
import {
  QUOTE_TTL_MS,
  SUPPORTED_PAIRS,
  type QuoteResponse,
  type QuoteStatus,
  type Side,
} from "../types";

// Quote Service — RFQ (Request for Quote) lifecycle

/**
 * Validate that a currency pair is supported.
 */
function validatePair(baseCurrency: string, quoteCurrency: string): void {
  const found = SUPPORTED_PAIRS.some(
    (p) =>
      (p.base === baseCurrency && p.quote === quoteCurrency) ||
      (p.quote === baseCurrency && p.base === quoteCurrency),
  );
  if (!found) {
    throw Errors.pairNotSupported(`${baseCurrency}_${quoteCurrency}`);
  }
}

/**
 * Create a new RFQ quote with a 30-second TTL.
 */
export async function createQuote(
  accountId: string,
  baseCurrency: string,
  quoteCurrency: string,
  side: Side,
  amount: number,
): Promise<QuoteResponse> {
  validatePair(baseCurrency, quoteCurrency);

  const { price } = await getExecutionPrice(
    baseCurrency,
    quoteCurrency,
    side,
  );

  const now = Date.now();
  const baseAmount = toScaled(amount);
  const quoteAmount = scaledMultiply(baseAmount, price);
  const id = crypto.randomUUID();

  await db.insert(quotes).values({
    id,
    accountId,
    baseCurrency,
    quoteCurrency,
    side,
    baseAmount,
    quoteAmount,
    price,
    expiresAt: now + QUOTE_TTL_MS,
    status: "OPEN",
    createdAt: now,
  });

  return {
    id,
    baseCurrency: baseCurrency as any,
    quoteCurrency: quoteCurrency as any,
    side,
    baseAmount: fromScaled(baseAmount),
    quoteAmount: fromScaled(quoteAmount),
    price: fromScaled(price),
    expiresAt: now + QUOTE_TTL_MS,
    status: "OPEN",
    createdAt: now,
  };
}

/**
 * Get a quote by ID, auto-expiring if past TTL.
 * Enforces account ownership — returns NOT_FOUND for quotes belonging to other accounts.
 */
export async function getQuote(accountId: string, quoteId: string): Promise<QuoteResponse> {
  const [row] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId));

  if (!row || row.accountId !== accountId) throw Errors.notFound("Quote");

  // Auto-expire if past TTL
  if (row.status === "OPEN" && Date.now() > row.expiresAt) {
    await db
      .update(quotes)
      .set({ status: "EXPIRED" })
      .where(eq(quotes.id, quoteId));
    row.status = "EXPIRED";
  }

  return {
    id: row.id,
    baseCurrency: row.baseCurrency as any,
    quoteCurrency: row.quoteCurrency as any,
    side: row.side as Side,
    baseAmount: fromScaled(row.baseAmount),
    quoteAmount: fromScaled(row.quoteAmount),
    price: fromScaled(row.price),
    expiresAt: row.expiresAt,
    status: row.status as QuoteStatus,
    createdAt: row.createdAt,
  };
}

/**
 * Mark a quote as executed (called by trade service).
 */
export async function markQuoteExecuted(quoteId: string): Promise<void> {
  await db
    .update(quotes)
    .set({ status: "EXECUTED" })
    .where(eq(quotes.id, quoteId));
}
