import {
  BINANCE_BASE_URL,
  PRICE_CACHE_TTL_MS,
  SUPPORTED_PAIRS,
  SPREAD_MARKUP,
  type BinanceBookTicker,
  type BinanceTickerPrice,
  type PriceResponse,
  type SupportedPair,
} from "../types";
import { parsePrice } from "../money";
import { getBestQuote } from "./sor.service";
import { Errors } from "../errors";

// In-memory TTL cache for price data
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class PriceCache<K, V> {
  private store = new Map<K, CacheEntry<V>>();

  constructor(private defaultTTL: number = PRICE_CACHE_TTL_MS) {}

  get(key: K): V | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: K, value: V, ttl: number = this.defaultTTL): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }
}

// Price Service fetches from Binance, caches results
const bookTickerCache = new PriceCache<string, BinanceBookTicker>();
const priceCache = new PriceCache<string, BinanceTickerPrice>();

/**
 * Fetch the best bid/ask from Binance for a given symbol.
 */
async function fetchBookTicker(symbol: string): Promise<BinanceBookTicker> {
  const cached = bookTickerCache.get(symbol);
  if (cached) return cached;

  const res = await fetch(
    `${BINANCE_BASE_URL}/api/v3/ticker/bookTicker?symbol=${symbol}`,
  );
  if (!res.ok) {
    throw Errors.priceFetchFailed(
      `Binance bookTicker failed for ${symbol}: ${res.status}`,
    );
  }

  const data: BinanceBookTicker = await res.json();
  bookTickerCache.set(symbol, data);
  return data;
}

/**
 * Fetch the last trade price from Binance for a given symbol.
 */
async function fetchTickerPrice(symbol: string): Promise<BinanceTickerPrice> {
  const cached = priceCache.get(symbol);
  if (cached) return cached;

  const res = await fetch(
    `${BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${symbol}`,
  );
  if (!res.ok) {
    throw Errors.priceFetchFailed(
      `Binance ticker/price failed for ${symbol}: ${res.status}`,
    );
  }

  const data: BinanceTickerPrice = await res.json();
  priceCache.set(symbol, data);
  return data;
}

/**
 * Find the supported pair config for a given pair string (e.g. "EUR_USDT").
 */
function findPair(pairStr: string): SupportedPair | undefined {
  const normalized = pairStr.toUpperCase().replace(/[_\/\-]/g, "");
  return SUPPORTED_PAIRS.find(
    (p) =>
      p.symbol === normalized ||
      `${p.base}${p.quote}` === normalized ||
      `${p.quote}${p.base}` === normalized,
  );
}

/**
 * Get price for a single pair.
 */
export async function getPrice(pairStr: string): Promise<PriceResponse> {
  const pair = findPair(pairStr);
  if (!pair) throw Errors.pairNotSupported(pairStr);

  const bookTicker = await fetchBookTicker(pair.symbol);

  return {
    pair: `${pair.base}_${pair.quote}`,
    bidPrice: bookTicker.bidPrice,
    askPrice: bookTicker.askPrice,
    midPrice: (
      (parseFloat(bookTicker.bidPrice) + parseFloat(bookTicker.askPrice)) /
      2
    ).toFixed(8),
    timestamp: Date.now(),
  };
}

/**
 * Get prices for all supported pairs.
 */
export async function getAllPrices(): Promise<PriceResponse[]> {
  return Promise.all(SUPPORTED_PAIRS.map((p) => getPrice(p.symbol)));
}

/**
 * Get the execution price for a trade.
 * BUY → uses ask + spread markup
 * SELL → uses bid - spread markup
 *
 * Returns the price as a scaled integer.
 */
export async function getExecutionPrice(
  baseCurrency: string,
  quoteCurrency: string,
  side: "BUY" | "SELL",
): Promise<{ price: number; bidPrice: number; askPrice: number }> {
  const pairStr = `${baseCurrency}${quoteCurrency}`;
  const pair = findPair(pairStr);
  if (!pair) throw Errors.pairNotSupported(`${baseCurrency}_${quoteCurrency}`);

  const bookTicker = await fetchBookTicker(pair.symbol);
  const binanceBid = parsePrice(bookTicker.bidPrice);
  const binanceAsk = parsePrice(bookTicker.askPrice);
  const { price, bidPrice, askPrice } = await getBestQuote(binanceBid, binanceAsk, side);

  return { price, bidPrice, askPrice };
}

/**
 * Get the mid-market price for a pair (used for market orders).
 * Returns scaled integer.
 */
export async function getMarketPrice(
  baseCurrency: string,
  quoteCurrency: string,
): Promise<number> {
  const pairStr = `${baseCurrency}${quoteCurrency}`;
  const pair = findPair(pairStr);
  if (!pair) throw Errors.pairNotSupported(`${baseCurrency}_${quoteCurrency}`);

  const ticker = await fetchTickerPrice(pair.symbol);
  return parsePrice(ticker.price);
}
