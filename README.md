# MiniOpenFX

[![CI](https://github.com/4NNNN/mini-openfx/actions/workflows/ci.yml/badge.svg)](https://github.com/4NNNN/mini-openfx/actions/workflows/ci.yml)

A minimal FX quoting and trading API. Correct, readable, and deliberately simple.

---

## Quick Start

```bash
bun install
bun run db:seed    # creates tables + demo account
bun run dev
```

Requires [Bun](https://bun.sh) v1.0+. SQLite is bundled — no external database needed.

---

## Why This Stack

The standard playbook for a service like this is Express + Postgres + Redis + JWT. I deliberately did not do that.

This is a five-route API with two currency pairs. A framework, a connection pool, a cache server, and an auth library would each add more surface area than the core logic itself. Instead:

- **Bun** handles HTTP natively via `Bun.serve`. No Node, no Express.
- **SQLite** (WAL mode) serializes writes at the DB level. For a single-server deployment it handles thousands of writes per second — more than enough, and zero ops overhead.
- **Drizzle** gives type-safe SQL without hiding what queries actually run. Important for financial logic where you need to reason about atomicity.
- **In-memory cache** for prices (5s TTL) and rate limiting (sliding window, per account) — both are plain `Map`s. No Redis needed when there's one process.
- **No JWT** — auth is a stub (`X-Account-Id` header) so the trading logic stays readable. Production would swap in token verification without touching anything else.

The goal was to keep every abstraction proportional to the actual problem.

---

## Architecture

```
Bun.serve
  ├── /health                 (no auth)
  ├── Rate limiter (60 req / 60s, per account)
  └── Router
        ├── GET  /api/v1/prices
        ├── GET  /api/v1/prices/:pair
        ├── GET  /api/v1/balances
        ├── POST /api/v1/quotes
        ├── GET  /api/v1/quotes/:id
        ├── POST /api/v1/trades
        ├── GET  /api/v1/trades
        └── GET  /api/v1/trades/:id
```

### Key design decisions

**Money is stored as scaled integers** (`amount × 10^8`). No floats in the DB, no IEEE 754 rounding errors. BigInt is used for intermediate multiplication to avoid overflow on large positions.

**Quotes lock a price for 30 seconds** with a 0.1% spread markup applied at creation. The spread is revenue — BUY trades pay slightly above ask, SELL trades receive slightly below bid. Quote statuses flow `OPEN → EXECUTED` or `OPEN → EXPIRED`.

**Trades are wrapped in a SQLite transaction.** Debit + credit + trade insert are all Drizzle ORM calls inside `sqlite.transaction()` — either all commit or all roll back.

**Balance debit is a single atomic UPDATE** (via Drizzle ORM's `update().where(gte(…)).run()`). If `changes === 0`, the balance was insufficient — no separate read, no race window.

**Quote execution validates before transacting.** The service reads the quote, checks ownership/status/expiry in application code, then runs the trade inside `sqlite.transaction()`. If the quote is expired or already executed, the trade is rejected before any balance changes occur.

---

## API Reference

All responses: `{ "data": {...} }` or `{ "error": { "code": "...", "message": "..." } }`

Auth header required on all endpoints except `/health` and `/api/v1/prices`. 

For testing, use the pre-seeded account ID from the database:
```
X-Account-Id: demo-account
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/prices` | All pair prices |
| `GET` | `/api/v1/prices/:pair` | Price for one pair (e.g. `EUR_USDT`) |
| `GET` | `/api/v1/balances` | Your balances |
| `POST` | `/api/v1/quotes` | Request a locked quote (RFQ) |
| `GET` | `/api/v1/quotes/:id` | Fetch quote by ID |
| `POST` | `/api/v1/trades` | Execute a market or RFQ trade |
| `GET` | `/api/v1/trades` | Trade history |
| `GET` | `/api/v1/trades/:id` | Single trade by ID |

**Supported pairs:** `EUR_USDT`, `BTC_USDT`

### POST /api/v1/quotes
```json
{ "baseCurrency": "EUR", "quoteCurrency": "USDT", "side": "BUY", "amount": 100 }
```

### POST /api/v1/trades
```json
// Market order
{ "type": "MARKET", "baseCurrency": "EUR", "quoteCurrency": "USDT", "side": "BUY", "amount": 100 }

// RFQ order (uses a quote)
{ "type": "RFQ", "quoteId": "550e8400-e29b-41d4-a716-446655440000" }
```

### Error codes
| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad request body |
| `UNAUTHORIZED` | 401 | Missing account header |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `INSUFFICIENT_BALANCE` | 400 | Not enough funds |
| `QUOTE_EXPIRED` | 400 | Quote TTL passed |
| `QUOTE_ALREADY_EXECUTED` | 409 | Quote already used |
| `PAIR_NOT_SUPPORTED` | 400 | Unsupported currency pair |
| `RATE_LIMITED` | 429 | Too many requests |
| `PRICE_FETCH_FAILED` | 502 | Binance unreachable |

---

## Tests

Two tiers:

| File | What it tests | Needs server? |
|---|---|---|
| `money.test.ts` | Scaled integer arithmetic | No |
| `services.test.ts` | Balance/quote/trade DB operations (in-memory SQLite) | No |
| `api.test.ts` | Full HTTP round-trips via live server | Yes |

**Run unit + service tests (standalone):**
```bash
bun test src/test/money.test.ts src/test/services.test.ts
```

**Run all tests including API tests:**
```bash
bun run db:seed
bun run dev &
bun test src/test/api.test.ts
```

**CI** (GitHub Actions) runs all three automatically on every push — it seeds the DB, starts the server in the background, waits for the `/health` endpoint, then runs the API test suite. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Known Limitations

- Rate limiter and price cache are in-memory — they reset on restart and don't work across replicas. Redis would fix both.
- Auth is a stub — token verification would slot in without touching trading logic.
- Scaling beyond a single server would warrant moving to Postgres (`SELECT FOR UPDATE`) and a shared Redis cache. For early-stage single-server traffic, the atomic UPDATE approach above is sufficient.