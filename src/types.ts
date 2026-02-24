// Supported currencies
export type Currency = "USDT" | "EUR" | "BTC";

// Trade side
export type Side = "BUY" | "SELL";

// Trade execution type
export type TradeType = "MARKET" | "RFQ";

// Quote lifecycle status
export type QuoteStatus = "OPEN" | "EXECUTED" | "EXPIRED";

// One Quote interface for all venues
export interface Quote {
  source: string;
  bid: number;
  ask: number;
  liquidity: "tier1" | "tier2" | "tier3";
}

export interface PriceResponse {
  pair: string;
  bidPrice: string;
  askPrice: string;
  midPrice: string;
  timestamp: number;
}

export interface BalanceResponse {
  currency: Currency;
  amount: string;
}

export interface QuoteRequest {
  baseCurrency: Currency;
  quoteCurrency: Currency;
  side: Side;
  amount: number;
}

export interface QuoteResponse {
  id: string;
  baseCurrency: Currency;
  quoteCurrency: Currency;
  side: Side;
  baseAmount: string;
  quoteAmount: string;
  price: string;
  expiresAt: number;
  status: QuoteStatus;
  createdAt: number;
}

export interface MarketTradeRequest {
  type: "MARKET";
  baseCurrency: Currency;
  quoteCurrency: Currency;
  side: Side;
  amount: number;
}

export interface RfqTradeRequest {
  type: "RFQ";
  quoteId: string;
}

export type TradeRequest = MarketTradeRequest | RfqTradeRequest;

export interface TradeResponse {
  id: string;
  type: TradeType;
  baseCurrency: Currency;
  quoteCurrency: Currency;
  side: Side;
  baseAmount: string;
  quoteAmount: string;
  price: string;
  executedAt: number;
  createdAt: number;
}

// Binance API response shapes
export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

export interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

// Internal config
export interface SupportedPair {
  symbol: string;
  base: Currency;
  quote: Currency;
}

export const SUPPORTED_PAIRS: SupportedPair[] = [
  { symbol: "EURUSDT", base: "EUR", quote: "USDT" },
  { symbol: "BTCUSDT", base: "BTC", quote: "USDT" },
];

export const CURRENCIES: Currency[] = ["USDT", "EUR", "BTC"];

// Quote TTL in milliseconds (30 seconds)
export const QUOTE_TTL_MS = 30_000;

// Spread markup applied on top of Binance bid/ask (0.1%)
export const SPREAD_MARKUP = 0.001;

// Price cache TTL in milliseconds (5 seconds)
export const PRICE_CACHE_TTL_MS = 5_000;

// Rate limiter: max requests per window per account
export const RATE_LIMIT_MAX = 100;

// Rate limiter: sliding window in milliseconds
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Binance base URL (using data-api.binance.vision as it avoids 451 geo-blocks on US/SG cloud servers)
export const BINANCE_BASE_URL = "https://data-api.binance.vision";
