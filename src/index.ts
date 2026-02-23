import { z } from "zod";
import { AppError, Errors } from "./errors";
import { extractAccountId } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limiter";
import * as priceService from "./services/price.service";
import * as balanceService from "./services/balance.service";
import * as quoteService from "./services/quote.service";
import * as tradeService from "./services/trade.service";
import type { Side } from "./types";

// Bun's built-in router attaches matched path params to the request object.
// This type extends the standard Request to surface them for TypeScript.
type BunRequest = Request & { params: Record<string, string> };

// Zod schemas for request validation

const quoteSchema = z.object({
  baseCurrency: z.enum(["USDT", "EUR", "BTC"]),
  quoteCurrency: z.enum(["USDT", "EUR", "BTC"]),
  side: z.enum(["BUY", "SELL"]),
  amount: z.number().positive(),
});

const marketTradeSchema = z.object({
  type: z.literal("MARKET"),
  baseCurrency: z.enum(["USDT", "EUR", "BTC"]),
  quoteCurrency: z.enum(["USDT", "EUR", "BTC"]),
  side: z.enum(["BUY", "SELL"]),
  amount: z.number().positive(),
});

const rfqTradeSchema = z.object({
  type: z.literal("RFQ"),
  quoteId: z.string().uuid(),
});

const tradeSchema = z.discriminatedUnion("type", [
  marketTradeSchema,
  rfqTradeSchema,
]);

// Error handling helpers

function errorResponse(error: AppError): Response {
  return Response.json(error.toJSON(), { status: error.statusCode });
}

function handleError(err: unknown): Response {
  // Zod validation errors
  if (err instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
        },
      },
      { status: 400 },
    );
  }

  // App errors
  if (err instanceof AppError) {
    return errorResponse(err);
  }

  // Unexpected errors
  console.error("Unhandled error:", err);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 },
  );
}

/**
 * Wrapper for authenticated + rate-limited route handlers.
 * Extracts account ID, applies rate limiting, catches errors.
 */
function authed(
  handler: (req: Request, accountId: string) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      const accountId = extractAccountId(req);
      rateLimiter.check(accountId);
      return await handler(req, accountId);
    } catch (err) {
      return handleError(err);
    }
  };
}

/**
 * Wrapper for public route handlers (no auth, no rate limit).
 */
function pub(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      return handleError(err);
    }
  };
}

// Server entry point

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = Bun.serve({
  port: PORT,

  routes: {
    // Health check
    "/health": () => Response.json({ status: "ok", timestamp: Date.now() }),

    // Prices (public, no auth required)
    "/api/v1/prices": {
      GET: pub(async () => {
        const prices = await priceService.getAllPrices();
        return Response.json({ data: prices });
      }),
    },

    "/api/v1/prices/:pair": {
      GET: pub(async (req) => {
        const price = await priceService.getPrice((req as BunRequest).params.pair);
        return Response.json({ data: price });
      }),
    },

    // Balances (auth required)
    "/api/v1/balances": {
      GET: authed(async (_req, accountId) => {
        const balances = await balanceService.getBalances(accountId);
        return Response.json({ data: balances });
      }),
    },

    // Quotes / RFQ (auth required)
    "/api/v1/quotes": {
      POST: authed(async (req, accountId) => {
        const body = await req.json();
        const parsed = quoteSchema.parse(body);

        if (parsed.baseCurrency === parsed.quoteCurrency) {
          throw Errors.validation("baseCurrency and quoteCurrency must be different");
        }

        const quote = await quoteService.createQuote(
          accountId,
          parsed.baseCurrency,
          parsed.quoteCurrency,
          parsed.side as Side,
          parsed.amount,
        );
        return Response.json({ data: quote }, { status: 201 });
      }),
    },

    "/api/v1/quotes/:id": {
      GET: authed(async (req, accountId) => {
        const quote = await quoteService.getQuote(accountId, (req as BunRequest).params.id);
        return Response.json({ data: quote });
      }),
    },

    // Trades (auth required)
    "/api/v1/trades": {
      GET: authed(async (_req, accountId) => {
        const history = await tradeService.getTradeHistory(accountId);
        return Response.json({ data: history });
      }),
      POST: authed(async (req, accountId) => {
        const body = await req.json();
        const parsed = tradeSchema.parse(body);

        let trade;
        if (parsed.type === "RFQ") {
          trade = await tradeService.executeRfqTrade(accountId, parsed.quoteId);
        } else {
          if (parsed.baseCurrency === parsed.quoteCurrency) {
            throw Errors.validation(
              "baseCurrency and quoteCurrency must be different",
            );
          }
          trade = await tradeService.executeMarketTrade(
            accountId,
            parsed.baseCurrency as string,
            parsed.quoteCurrency as string,
            parsed.side as Side,
            parsed.amount,
          );
        }
        return Response.json({ data: trade }, { status: 201 });
      }),
    },

    "/api/v1/trades/:id": {
      GET: authed(async (req, accountId) => {
        const trade = await tradeService.getTrade(accountId, (req as BunRequest).params.id);
        return Response.json({ data: trade });
      }),
    },
  },

  // Fallback for unmatched routes
  fetch(req) {
    const url = new URL(req.url);
    return Response.json(
      { error: { code: "NOT_FOUND", message: `${req.method} ${url.pathname} not found` } },
      { status: 404 },
    );
  },

  // Global error handler
  error(err) {
    console.error("Unhandled server error:", err);
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 },
    );
  },
});

console.log(`MiniOpenFX running on http://localhost:${server.port}`);
