import { describe, test, expect, beforeAll } from "bun:test";

// API integration tests run locally against a live MiniOpenFX server
// Usage:
//   1. Start the server:  bun run dev
//   2. Run these tests:   bun test src/test/api.test.ts

// Requires a live Binance API connection — cannot run in CI.
// They make real HTTP requests to the running server
// and verify correct behavior end-to-end including DB state changes.

const BASE_URL = "https://mini-openfx-production.up.railway.app";
const ACCOUNT_ID = "demo-account";

function api(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Account-Id": ACCOUNT_ID,
      ...options?.headers,
    },
  });
}

function apiPublic(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("Health", () => {
  test("GET /health returns 200", async () => {
    const res = await apiPublic("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeNumber();
  });
});

// ---------------------------------------------------------------------------
// Prices (public, no auth)
// ---------------------------------------------------------------------------

describe("Prices", () => {
  test("GET /api/v1/prices returns all supported pairs", async () => {
    const res = await apiPublic("/api/v1/prices");
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2); // EUR_USDT and BTC_USDT

    for (const price of data) {
      expect(price.pair).toBeDefined();
      expect(price.bidPrice).toBeDefined();
      expect(price.askPrice).toBeDefined();
      expect(price.midPrice).toBeDefined();
      expect(price.timestamp).toBeNumber();

      // Bid should be less than ask (basic sanity)
      expect(parseFloat(price.bidPrice)).toBeLessThan(parseFloat(price.askPrice));
    }
  });

  test("GET /api/v1/prices/:pair returns a single pair", async () => {
    const res = await apiPublic("/api/v1/prices/EUR_USDT");
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data.pair).toBe("EUR_USDT");
    expect(parseFloat(data.bidPrice)).toBeGreaterThan(0);
  });

  test("GET /api/v1/prices/:pair returns 400 for unsupported pair", async () => {
    const res = await apiPublic("/api/v1/prices/XYZ_ABC");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("PAIR_NOT_SUPPORTED");
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("Auth", () => {
  test("Missing X-Account-Id returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balances`);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("Empty X-Account-Id returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balances`, {
      headers: { "X-Account-Id": "   " },
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

describe("Balances", () => {
  test("GET /api/v1/balances returns all currency balances", async () => {
    const res = await api("/api/v1/balances");
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(3); // USDT, EUR, BTC

    const currencies = data.map((b: any) => b.currency);
    expect(currencies).toContain("USDT");
    expect(currencies).toContain("EUR");
    expect(currencies).toContain("BTC");

    // All amounts should be valid decimal strings
    for (const balance of data) {
      const amount = parseFloat(balance.amount);
      expect(isNaN(amount)).toBe(false);
      expect(amount).toBeGreaterThanOrEqual(0);
    }
  });

  test("Nonexistent account returns empty balances", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balances`, {
      headers: { "X-Account-Id": "nonexistent-account-xyz" },
    });
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Quotes / RFQ
// ---------------------------------------------------------------------------

describe("Quotes", () => {
  test("POST /api/v1/quotes creates a new quote", async () => {
    const res = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(201);

    const { data } = await res.json();
    expect(data.id).toBeDefined();
    expect(data.baseCurrency).toBe("EUR");
    expect(data.quoteCurrency).toBe("USDT");
    expect(data.side).toBe("BUY");
    expect(data.status).toBe("OPEN");
    expect(data.expiresAt).toBeGreaterThan(Date.now() - 5000); // sanity: not in the far past

    // Price, baseAmount, quoteAmount should all be valid decimal strings
    expect(parseFloat(data.price)).toBeGreaterThan(0);
    expect(parseFloat(data.baseAmount)).toBeGreaterThan(0);
    expect(parseFloat(data.quoteAmount)).toBeGreaterThan(0);
  });

  test("GET /api/v1/quotes/:id retrieves the quote", async () => {
    // Create first
    const createRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "BTC",
        quoteCurrency: "USDT",
        side: "SELL",
        amount: 0.01,
      }),
    });
    const { data: created } = await createRes.json();

    // Fetch
    const res = await api(`/api/v1/quotes/${created.id}`);
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.status).toBe("OPEN");
  });

  test("POST /api/v1/quotes rejects same base and quote currency", async () => {
    const res = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        quoteCurrency: "EUR",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/v1/quotes rejects invalid body", async () => {
    const res = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        // missing quoteCurrency, side, amount
      }),
    });
    expect(res.status).toBe(400);
  });

  test("Quote from another account returns 404", async () => {
    // Create quote under demo-account
    const createRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 5,
      }),
    });
    const { data: created } = await createRes.json();

    // Try to fetch with a different account
    const res = await fetch(`${BASE_URL}/api/v1/quotes/${created.id}`, {
      headers: { "X-Account-Id": "other-account" },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Trades — Market orders
// ---------------------------------------------------------------------------

describe("Trades - Market", () => {
  let balancesBefore: Record<string, number>;

  test("Snapshot balances before trade", async () => {
    const res = await api("/api/v1/balances");
    const { data } = await res.json();
    balancesBefore = {};
    for (const b of data) {
      balancesBefore[b.currency] = parseFloat(b.amount);
    }
    expect(Object.keys(balancesBefore).length).toBeGreaterThanOrEqual(3);
  });

  test("POST /api/v1/trades (MARKET BUY) executes successfully", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 10, // buy 10 EUR
      }),
    });
    expect(res.status).toBe(201);

    const { data } = await res.json();
    expect(data.id).toBeDefined();
    expect(data.type).toBe("MARKET");
    expect(data.side).toBe("BUY");
    expect(data.baseCurrency).toBe("EUR");
    expect(data.quoteCurrency).toBe("USDT");
    expect(parseFloat(data.baseAmount)).toBeCloseTo(10, 1);
    expect(parseFloat(data.quoteAmount)).toBeGreaterThan(0);
    expect(parseFloat(data.price)).toBeGreaterThan(0);
  });

  test("Balances reflect the BUY trade correctly", async () => {
    const res = await api("/api/v1/balances");
    const { data } = await res.json();
    const after: Record<string, number> = {};
    for (const b of data) {
      after[b.currency] = parseFloat(b.amount);
    }

    // BUY EUR/USDT: EUR should increase, USDT should decrease
    expect(after["EUR"]).toBeGreaterThan(balancesBefore["EUR"]);
    expect(after["USDT"]).toBeLessThan(balancesBefore["USDT"]);

    // BTC should be unchanged
    expect(after["BTC"]).toBeCloseTo(balancesBefore["BTC"], 6);
  });

  test("POST /api/v1/trades (MARKET SELL) executes successfully", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "SELL",
        amount: 5, // sell 5 EUR
      }),
    });
    expect(res.status).toBe(201);

    const { data } = await res.json();
    expect(data.type).toBe("MARKET");
    expect(data.side).toBe("SELL");
  });

  test("MARKET trade rejects unsupported pair", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "BTC",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("PAIR_NOT_SUPPORTED");
  });

  test("MARKET trade rejects same base and quote", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "USDT",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Trades — RFQ flow
// ---------------------------------------------------------------------------

describe("Trades - RFQ", () => {
  test("Full RFQ lifecycle: create quote → execute trade", async () => {
    // Step 1: Get a quote
    const quoteRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "BTC",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 0.001,
      }),
    });
    expect(quoteRes.status).toBe(201);
    const { data: quote } = await quoteRes.json();
    expect(quote.status).toBe("OPEN");

    // Step 2: Execute the trade using the quote
    const tradeRes = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "RFQ",
        quoteId: quote.id,
      }),
    });
    expect(tradeRes.status).toBe(201);

    const { data: trade } = await tradeRes.json();
    expect(trade.type).toBe("RFQ");
    expect(trade.baseCurrency).toBe("BTC");
    expect(trade.quoteCurrency).toBe("USDT");
    expect(trade.side).toBe("BUY");

    // The trade price should match the quoted price
    expect(trade.price).toBe(quote.price);
    expect(trade.baseAmount).toBe(quote.baseAmount);

    // Step 3: Verify the quote is now EXECUTED
    const quoteCheckRes = await api(`/api/v1/quotes/${quote.id}`);
    const { data: updatedQuote } = await quoteCheckRes.json();
    expect(updatedQuote.status).toBe("EXECUTED");
  });

  test("RFQ trade rejects already-executed quote", async () => {
    // Create and execute a quote
    const quoteRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "SELL",
        amount: 1,
      }),
    });
    const { data: quote } = await quoteRes.json();

    await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({ type: "RFQ", quoteId: quote.id }),
    });

    // Try to execute the same quote again
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({ type: "RFQ", quoteId: quote.id }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe("QUOTE_ALREADY_EXECUTED");
  });

  test("RFQ trade rejects nonexistent quoteId", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "RFQ",
        quoteId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(res.status).toBe(404);
  });

  test("RFQ trade rejects quote from another account", async () => {
    // Create quote under demo-account
    const quoteRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 1,
      }),
    });
    const { data: quote } = await quoteRes.json();

    // Try to execute with a different account
    const res = await fetch(`${BASE_URL}/api/v1/trades`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Account-Id": "attacker-account",
      },
      body: JSON.stringify({ type: "RFQ", quoteId: quote.id }),
    });
    expect(res.status).toBe(404);
  });

  test("RFQ trade rejects valid quote after TTL has passed", async () => {
    // Create a quote
    const quoteRes = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "BTC",
        quoteCurrency: "USDT",
        side: "SELL",
        amount: 0.01,
      }),
    });
    const { data: quote } = await quoteRes.json();

    // The TTL for a quote is 30 seconds. Wait 31 seconds to ensure it expires.
    await new Promise((resolve) => setTimeout(resolve, 31000));

    // Attempt to execute the trade using the expired quote
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({ type: "RFQ", quoteId: quote.id }),
    });

    // The API should reject it with 400 and QUOTE_EXPIRED
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("QUOTE_EXPIRED");
  }, 35000); // Give the test 35 seconds to run, as we wait for 31 seconds
});

// ---------------------------------------------------------------------------
// Trade History
// ---------------------------------------------------------------------------

describe("Trade History", () => {
  test("GET /api/v1/trades returns trade list", async () => {
    const res = await api("/api/v1/trades");
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1); // we made trades above

    // Verify shape of each trade
    for (const trade of data) {
      expect(trade.id).toBeDefined();
      expect(["MARKET", "RFQ"]).toContain(trade.type);
      expect(["BUY", "SELL"]).toContain(trade.side);
      expect(parseFloat(trade.baseAmount)).toBeGreaterThan(0);
      expect(parseFloat(trade.quoteAmount)).toBeGreaterThan(0);
      expect(parseFloat(trade.price)).toBeGreaterThan(0);
      expect(trade.executedAt).toBeNumber();
      expect(trade.createdAt).toBeNumber();
    }

    // Verify descending order (most recent first)
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].executedAt).toBeGreaterThanOrEqual(data[i].executedAt);
    }
  });

  test("GET /api/v1/trades/:id returns a single trade", async () => {
    const listRes = await api("/api/v1/trades");
    const { data: trades } = await listRes.json();
    const tradeId = trades[0].id;

    const res = await api(`/api/v1/trades/${tradeId}`);
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data.id).toBe(tradeId);
  });

  test("GET /api/v1/trades/:id returns 404 for nonexistent trade", async () => {
    const res = await api("/api/v1/trades/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  test("Trade from another account returns 404", async () => {
    const listRes = await api("/api/v1/trades");
    const { data: trades } = await listRes.json();
    const tradeId = trades[0].id;

    const res = await fetch(`${BASE_URL}/api/v1/trades/${tradeId}`, {
      headers: { "X-Account-Id": "other-account" },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Insufficient balance
// ---------------------------------------------------------------------------

describe("Insufficient Balance", () => {
  test("MARKET trade fails when balance is too low", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "BTC",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 999_999, // way more BTC than we can afford
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("INSUFFICIENT_BALANCE");
  });
});

// ---------------------------------------------------------------------------
// Balance integrity — the most important check
// ---------------------------------------------------------------------------

describe("Balance Integrity", () => {
  test("Total value is conserved across a BUY+SELL roundtrip", async () => {
    // Snapshot before
    const beforeRes = await api("/api/v1/balances");
    const { data: before } = await beforeRes.json();
    const beforeMap: Record<string, number> = {};
    for (const b of before) beforeMap[b.currency] = parseFloat(b.amount);

    // BUY 5 EUR
    await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 5,
      }),
    });

    // SELL 5 EUR back
    await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "SELL",
        amount: 5,
      }),
    });

    // Snapshot after
    const afterRes = await api("/api/v1/balances");
    const { data: after } = await afterRes.json();
    const afterMap: Record<string, number> = {};
    for (const b of after) afterMap[b.currency] = parseFloat(b.amount);

    // EUR should be back to the same amount (bought 5, sold 5)
    expect(afterMap["EUR"]).toBeCloseTo(beforeMap["EUR"], 6);

    // USDT might differ slightly due to market price movement between the two
    // trades, but should not drift by more than a few percent of the trade size
    const usdtDrift = Math.abs(afterMap["USDT"] - beforeMap["USDT"]);
    expect(usdtDrift).toBeLessThan(5); // less than $5 drift on a ~$5 trade

    // BTC should be completely untouched
    expect(afterMap["BTC"]).toBeCloseTo(beforeMap["BTC"], 8);
  });

  test("No negative balances are possible", async () => {
    const res = await api("/api/v1/balances");
    const { data } = await res.json();

    for (const balance of data) {
      expect(parseFloat(balance.amount)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe("404 Handling", () => {
  test("Unknown route returns 404", async () => {
    const res = await api("/api/v1/nonexistent");
    expect(res.status).toBe(404);
  });

  test("Unknown method on valid route returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/prices`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("Request Validation", () => {
  test("POST /api/v1/trades rejects invalid type", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "LIMIT", // not a valid type
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/v1/trades rejects negative amount", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: -10,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/v1/trades rejects zero amount", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "MARKET",
        baseCurrency: "EUR",
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/v1/quotes rejects invalid currency", async () => {
    const res = await api("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        baseCurrency: "GBP", // not supported
        quoteCurrency: "USDT",
        side: "BUY",
        amount: 10,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/v1/trades rejects RFQ with invalid UUID", async () => {
    const res = await api("/api/v1/trades", {
      method: "POST",
      body: JSON.stringify({
        type: "RFQ",
        quoteId: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
  });
});
