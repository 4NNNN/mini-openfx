import { eq, and, sql, gte } from "drizzle-orm";
import { db } from "../db";
import { balances } from "../db/schema";
import { fromScaled } from "../money";
import { Errors } from "../errors";
import type { BalanceResponse, Currency } from "../types";

// Balance Service — reads and updates account balances

/**
 * Get all balances for an account.
 */
export async function getBalances(accountId: string): Promise<BalanceResponse[]> {
  const rows = await db
    .select()
    .from(balances)
    .where(eq(balances.accountId, accountId));

  return rows.map((row) => ({
    currency: row.currency as Currency,
    amount: fromScaled(row.amount),
  }));
}

/**
 * Get balance for a specific currency. Returns scaled integer.
 * Returns 0 if no balance row exists.
 */
export async function getBalance(
  accountId: string,
  currency: string,
): Promise<number> {
  const [row] = await db
    .select()
    .from(balances)
    .where(
      and(eq(balances.accountId, accountId), eq(balances.currency, currency)),
    );

  return row?.amount ?? 0;
}

/**
 * Debit (subtract) from an account's currency balance.
 * Atomic UPDATE with balance guard in the WHERE clause.
 * If 0 rows affected → insufficient balance, no race window.
 */
export function debit(
  accountId: string,
  currency: string,
  amount: number,
): void {
  const result = db
    .update(balances)
    .set({
      amount: sql`${balances.amount} - ${amount}`,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(balances.accountId, accountId),
        eq(balances.currency, currency),
        gte(balances.amount, amount),
      ),
    )
    .run() as unknown as { changes: number };

  if (result.changes === 0) {
    throw Errors.insufficientBalance(currency);
  }
}

/**
 * Credit (add) to an account's currency balance.
 * Atomic upsert: insert if new, increment if exists.
 */
export function credit(
  accountId: string,
  currency: string,
  amount: number,
): void {
  db.insert(balances)
    .values({
      id: crypto.randomUUID(),
      accountId,
      currency,
      amount,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [balances.accountId, balances.currency],
      set: {
        amount: sql`${balances.amount} + ${amount}`,
        updatedAt: Date.now(),
      },
    })
    .run();
}
