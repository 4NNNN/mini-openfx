import { db, sqlite } from "./index";
import { accounts, balances } from "./schema";
import { toScaled } from "../money";
import { CURRENCIES, type Currency } from "../types";

// Seed script — creates demo account with initial balances

const DEMO_ACCOUNT_ID = "demo-account";

const INITIAL_BALANCES: Record<Currency, number> = {
  USDT: 10_000,
  EUR: 5_000,
  BTC: 0.5,
};

async function seed() {
  const now = Date.now();

  // Create tables if they don't exist
  sqlite.exec(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS balances (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(account_id, currency)
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS quotes (
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

  sqlite.exec(`CREATE TABLE IF NOT EXISTS trades (
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

  // Upsert demo account
  await db
    .insert(accounts)
    .values({ id: DEMO_ACCOUNT_ID, name: "Demo Trader", createdAt: now })
    .onConflictDoNothing();

  // Upsert initial balances
  for (const currency of CURRENCIES) {
    await db
      .insert(balances)
      .values({
        id: crypto.randomUUID(),
        accountId: DEMO_ACCOUNT_ID,
        currency,
        amount: toScaled(INITIAL_BALANCES[currency]),
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  console.log("✓ Seeded demo account with balances:");
  for (const currency of CURRENCIES) {
    console.log(`  ${currency}: ${INITIAL_BALANCES[currency].toLocaleString()}`);
  }
}

seed().catch(console.error);
