import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { toScaled, fromScaled } from "../money";

// Integration tests run against in-memory SQLite
function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  sqlite.exec(`CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  sqlite.exec(`CREATE TABLE balances (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(account_id, currency)
  )`);

  sqlite.exec(`CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    side TEXT NOT NULL,
    base_amount INTEGER NOT NULL,
    quote_amount INTEGER NOT NULL,
    price INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  sqlite.exec(`CREATE TABLE trades (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    quote_id TEXT,
    type TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    side TEXT NOT NULL,
    base_amount INTEGER NOT NULL,
    quote_amount INTEGER NOT NULL,
    price INTEGER NOT NULL,
    executed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  const db = drizzle(sqlite, { schema });

  // Seed test account
  const now = Date.now();
  db.insert(schema.accounts)
    .values({ id: "test-account", name: "Test Trader", createdAt: now })
    .run();

  db.insert(schema.balances)
    .values([
      { id: crypto.randomUUID(), accountId: "test-account", currency: "USDT", amount: toScaled(10000), updatedAt: now },
      { id: crypto.randomUUID(), accountId: "test-account", currency: "EUR", amount: toScaled(5000), updatedAt: now },
      { id: crypto.randomUUID(), accountId: "test-account", currency: "BTC", amount: toScaled(0.5), updatedAt: now },
    ])
    .run();

  return { db, sqlite };
}

describe("Database operations", () => {
  test("balances are seeded correctly", () => {
    const { db } = setupTestDb();
    const rows = db.select().from(schema.balances).all();

    expect(rows).toHaveLength(3);

    const usdt = rows.find(r => r.currency === "USDT");
    expect(usdt).toBeDefined();
    expect(fromScaled(usdt!.amount)).toBe("10000.00000000");

    const eur = rows.find(r => r.currency === "EUR");
    expect(eur).toBeDefined();
    expect(fromScaled(eur!.amount)).toBe("5000.00000000");

    const btc = rows.find(r => r.currency === "BTC");
    expect(btc).toBeDefined();
    expect(fromScaled(btc!.amount)).toBe("0.50000000");
  });

  test("unique constraint on (account_id, currency) prevents duplicates", () => {
    const { db } = setupTestDb();
    const now = Date.now();

    expect(() => {
      db.insert(schema.balances)
        .values({
          id: crypto.randomUUID(),
          accountId: "test-account",
          currency: "USDT",
          amount: toScaled(999),
          updatedAt: now,
        })
        .run();
    }).toThrow();
  });

  test("balance debit and credit via direct DB update", () => {
    const { db } = setupTestDb();

    // Debit 100 USDT
    const [row] = db.select()
      .from(schema.balances)
      .where(and(eq(schema.balances.accountId, "test-account"), eq(schema.balances.currency, "USDT")))
      .all();

    const newAmount = row.amount - toScaled(100);
    db.update(schema.balances)
      .set({ amount: newAmount, updatedAt: Date.now() })
      .where(eq(schema.balances.id, row.id))
      .run();

    const [updated] = db.select()
      .from(schema.balances)
      .where(eq(schema.balances.id, row.id))
      .all();

    expect(fromScaled(updated.amount)).toBe("9900.00000000");
  });

  test("trade record is created correctly", () => {
    const { db } = setupTestDb();
    const now = Date.now();

    db.insert(schema.trades)
      .values({
        id: crypto.randomUUID(),
        accountId: "test-account",
        quoteId: null,
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        baseAmount: toScaled(100),
        quoteAmount: toScaled(117.92),
        price: toScaled(1.1792),
        executedAt: now,
        createdAt: now,
      })
      .run();

    const trades = db.select().from(schema.trades).all();
    expect(trades).toHaveLength(1);
    expect(trades[0].type).toBe("MARKET");
    expect(trades[0].side).toBe("BUY");
    expect(fromScaled(trades[0].baseAmount)).toBe("100.00000000");
  });

  test("quote lifecycle: OPEN → EXECUTED", () => {
    const { db } = setupTestDb();
    const now = Date.now();
    const quoteId = crypto.randomUUID();

    db.insert(schema.quotes)
      .values({
        id: quoteId,
        accountId: "test-account",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        baseAmount: toScaled(100),
        quoteAmount: toScaled(117.92),
        price: toScaled(1.1792),
        expiresAt: now + 30_000,
        status: "OPEN",
        createdAt: now,
      })
      .run();

    // Verify OPEN status
    const [openQuote] = db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).all();
    expect(openQuote.status).toBe("OPEN");

    // Execute
    db.update(schema.quotes)
      .set({ status: "EXECUTED" })
      .where(eq(schema.quotes.id, quoteId))
      .run();

    const [executedQuote] = db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).all();
    expect(executedQuote.status).toBe("EXECUTED");
  });

  test("expired quote is detectable by timestamp", () => {
    const { db } = setupTestDb();
    const pastTime = Date.now() - 60_000; // 1 min ago
    const quoteId = crypto.randomUUID();

    db.insert(schema.quotes)
      .values({
        id: quoteId,
        accountId: "test-account",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        baseAmount: toScaled(100),
        quoteAmount: toScaled(117.92),
        price: toScaled(1.1792),
        expiresAt: pastTime + 30_000, // expired 30s ago
        status: "OPEN",
        createdAt: pastTime,
      })
      .run();

    const [quote] = db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).all();
    const isExpired = Date.now() > quote.expiresAt;
    expect(isExpired).toBe(true);
  });
});
