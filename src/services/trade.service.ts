import { eq, desc } from "drizzle-orm";
import { db, sqlite } from "../db";
import { quotes, trades } from "../db/schema";
import * as balanceService from "./balance.service";
import { getMarketPrice } from "./price.service";
import { toScaled, fromScaled, scaledMultiply } from "../money";
import { Errors } from "../errors";
import { SUPPORTED_PAIRS, type Side, type TradeResponse } from "../types";

// Trade Service executes market orders and RFQ trades

/**
 * Execute an RFQ trade using a previously obtained quote.
 *
 * Flow: validate quote → check not expired → check not already executed →
 *       check balance → debit sell currency → credit buy currency →
 *       mark quote executed → create trade record
 */
export async function executeRfqTrade(
  accountId: string,
  quoteId: string,
): Promise<TradeResponse> {
  // Fetch and validate quote
  const [quoteRow] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId));

  if (!quoteRow) throw Errors.notFound("Quote");
  if (quoteRow.accountId !== accountId) throw Errors.notFound("Quote");
  if (quoteRow.status === "EXECUTED") throw Errors.quoteAlreadyExecuted();

  // Check expiry
  if (quoteRow.status === "EXPIRED" || Date.now() > quoteRow.expiresAt) {
    if (quoteRow.status !== "EXPIRED") {
      db.update(quotes)
        .set({ status: "EXPIRED" })
        .where(eq(quotes.id, quoteId))
        .run();
    }
    throw Errors.quoteExpired();
  }

  return executeTrade(
    accountId,
    quoteRow.baseCurrency,
    quoteRow.quoteCurrency,
    quoteRow.side as Side,
    quoteRow.baseAmount,
    quoteRow.price,
    "RFQ",
    quoteId,
  );
}

/**
 * Execute a market order at the current Binance price.
 */
export async function executeMarketTrade(
  accountId: string,
  baseCurrency: string,
  quoteCurrency: string,
  side: Side,
  amount: number, // human-readable decimal
): Promise<TradeResponse> {
  // Validate pair
  const found = SUPPORTED_PAIRS.some(
    (p) =>
      (p.base === baseCurrency && p.quote === quoteCurrency) ||
      (p.quote === baseCurrency && p.base === quoteCurrency),
  );
  if (!found) {
    throw Errors.pairNotSupported(`${baseCurrency}_${quoteCurrency}`);
  }

  const price = await getMarketPrice(baseCurrency, quoteCurrency);
  const baseAmount = toScaled(amount);

  return executeTrade(
    accountId,
    baseCurrency,
    quoteCurrency,
    side,
    baseAmount,
    price,
    "MARKET",
    null,
  );
}

async function executeTrade(
  accountId: string,
  baseCurrency: string,
  quoteCurrency: string,
  side: Side,
  baseAmount: number,   // scaled
  price: number,        // scaled
  type: "MARKET" | "RFQ",
  quoteId: string | null,
): Promise<TradeResponse> {
  const quoteAmount = scaledMultiply(baseAmount, price);
  const now = Date.now();
  const tradeId = crypto.randomUUID();

  executeTradeTx(
    accountId, baseCurrency, quoteCurrency, side,
    baseAmount, quoteAmount, price, type, quoteId,
    tradeId, now,
  );

  return {
    id: tradeId,
    type,
    baseCurrency: baseCurrency as any,
    quoteCurrency: quoteCurrency as any,
    side,
    baseAmount: fromScaled(baseAmount),
    quoteAmount: fromScaled(quoteAmount),
    price: fromScaled(price),
    executedAt: now,
    createdAt: now,
  };
}

/**
 * Core trade execution — atomic debit + credit inside a SQLite transaction.
 *
 * BUY side:  debit quoteCurrency (pay),  credit baseCurrency (receive)
 * SELL side: debit baseCurrency (pay),   credit quoteCurrency (receive)
 *
 * All operations use Drizzle's .run() (synchronous in bun:sqlite).
 * sqlite.transaction() auto-rolls-back on any thrown error.
 */
const executeTradeTx = sqlite.transaction(
  (
    accountId: string,
    baseCurrency: string,
    quoteCurrency: string,
    side: Side,
    baseAmount: number,
    quoteAmount: number,
    price: number,
    type: "MARKET" | "RFQ",
    quoteId: string | null,
    tradeId: string,
    now: number,
  ) => {
    const debitCurrency = side === "BUY" ? quoteCurrency : baseCurrency;
    const debitAmount = side === "BUY" ? quoteAmount : baseAmount;
    const creditCurrency = side === "BUY" ? baseCurrency : quoteCurrency;
    const creditAmount = side === "BUY" ? baseAmount : quoteAmount;

    // Debit (throws INSUFFICIENT_BALANCE if not enough)
    balanceService.debit(accountId, debitCurrency, debitAmount);

    // Credit (atomic upsert)
    balanceService.credit(accountId, creditCurrency, creditAmount);

    // Mark quote as executed if RFQ
    if (quoteId) {
      db.update(quotes)
        .set({ status: "EXECUTED" })
        .where(eq(quotes.id, quoteId))
        .run();
    }

    // Create trade record
    db.insert(trades)
      .values({
        id: tradeId,
        accountId,
        quoteId,
        type,
        baseCurrency,
        quoteCurrency,
        side,
        baseAmount,
        quoteAmount,
        price,
        executedAt: now,
        createdAt: now,
      })
      .run();
  },
);

/**
 * Get trade history for an account.
 */
export async function getTradeHistory(
  accountId: string,
): Promise<TradeResponse[]> {
  const rows = await db
    .select()
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .orderBy(desc(trades.executedAt));

  return rows.map((row) => ({
    id: row.id,
    type: row.type as "MARKET" | "RFQ",
    baseCurrency: row.baseCurrency as any,
    quoteCurrency: row.quoteCurrency as any,
    side: row.side as Side,
    baseAmount: fromScaled(row.baseAmount),
    quoteAmount: fromScaled(row.quoteAmount),
    price: fromScaled(row.price),
    executedAt: row.executedAt,
    createdAt: row.createdAt,
  }));
}

/**
 * Get a single trade by ID.
 */
export async function getTrade(
  accountId: string,
  tradeId: string,
): Promise<TradeResponse> {
  const [row] = await db
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId));

  if (!row || row.accountId !== accountId) {
    throw Errors.notFound("Trade");
  }

  return {
    id: row.id,
    type: row.type as "MARKET" | "RFQ",
    baseCurrency: row.baseCurrency as any,
    quoteCurrency: row.quoteCurrency as any,
    side: row.side as Side,
    baseAmount: fromScaled(row.baseAmount),
    quoteAmount: fromScaled(row.quoteAmount),
    price: fromScaled(row.price),
    executedAt: row.executedAt,
    createdAt: row.createdAt,
  };
}
