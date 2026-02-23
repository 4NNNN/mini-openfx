import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// Database schema — Drizzle ORM + SQLite

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const balances = sqliteTable(
  "balances",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(), // scaled by 10^8
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("balances_account_currency_idx").on(t.accountId, t.currency)],
);

export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  baseCurrency: text("base_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  side: text("side").notNull(),           // BUY | SELL
  baseAmount: integer("base_amount").notNull(),   // scaled
  quoteAmount: integer("quote_amount").notNull(),  // scaled
  price: integer("price").notNull(),      // scaled
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull(),       // OPEN | EXECUTED | EXPIRED
  createdAt: integer("created_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  quoteId: text("quote_id"),              // null for market orders
  type: text("type").notNull(),           // MARKET | RFQ
  baseCurrency: text("base_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  side: text("side").notNull(),
  baseAmount: integer("base_amount").notNull(),
  quoteAmount: integer("quote_amount").notNull(),
  price: integer("price").notNull(),
  executedAt: integer("executed_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
