import {type Quote} from "../types"

// Simple fetch functions (binace is real and others are mocked)
async function fetchBinance(binanceBid: number, binanceAsk: number): Promise<Quote> {
  return {
    source: "Binance",
    bid: binanceBid,
    ask: binanceAsk,
    liquidity: "tier1",
  };
}

async function fetchMassiveFX(binanceBid: number, binanceAsk: number): Promise<Quote> {
  return {
    source: "MassiveFX",
    bid: Math.round(binanceBid * 0.9999),
    ask: Math.round(binanceAsk * 1.0001),
    liquidity: "tier2",
  };
}

async function fetchCoinGecko(binanceBid: number, binanceAsk: number): Promise<Quote> {
  return {
    source: "CoinGecko",
    bid: Math.round(binanceBid * 0.9998),
    ask: Math.round(binanceAsk * 1.0002),
    liquidity: "tier3",
  };
}

// Simple SOR logic
export async function getBestQuote(
  binanceBid: number,
  binanceAsk: number,
  side: "BUY" | "SELL"
): Promise<{ price: number; bidPrice: number; askPrice: number; source: string; allQuotes: Quote[] }> {
  
  const results = await Promise.allSettled([
    fetchBinance(binanceBid, binanceAsk),
    fetchMassiveFX(binanceBid, binanceAsk),
    fetchCoinGecko(binanceBid, binanceAsk),
  ]);

  const quotes:Quote[] = [];

  for(let i=0; i<results.length; i++){
    if(results[i].status === "fulfilled"){
      quotes.push((results[i] as PromiseFulfilledResult<Quote>).value);
    }
  }

  console.log("quotes arr", quotes);

  if (quotes.length === 0) {
    throw new Error("All pricing sources failed");
  }

  // Pick best
  const best = quotes.sort((a, b) =>
    side === "BUY" ? a.ask - b.ask : b.bid - a.bid
  )[0];

  console.log("Bid", binanceBid);
  console.log("Ask", binanceAsk);
  console.log("side", side);
  console.log("best quote", best);

  return {
    price: side === "BUY" ? best.ask : best.bid,
    bidPrice: best.bid,
    askPrice: best.ask,
    source: best.source,
    allQuotes: quotes,
  };
}
