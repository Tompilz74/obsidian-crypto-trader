import type { Handler } from "@netlify/functions";

type Candle1h = { h: number; l: number };

export const handler: Handler = async (event) => {
  try {
    const symbolRaw = (event.queryStringParameters?.symbol ?? "").toUpperCase().trim();
    const limitRaw = Number(event.queryStringParameters?.limit ?? 240);

    // Basic validation (BTC, SOL, ETH, etc.)
    if (!symbolRaw || !/^[A-Z0-9]{2,15}$/.test(symbolRaw)) {
      return json(400, { error: "Missing/invalid symbol" });
    }

    const limit = Math.max(10, Math.min(isFinite(limitRaw) ? limitRaw : 240, 300)); // Coinbase max is typically 300
    const productId = `${symbolRaw}-USD`; // Coinbase uses e.g. SOL-USD

    // Coinbase Exchange candles (public)
    // Returns array rows: [ time, low, high, open, close, volume ]
    const url =
      "https://api.exchange.coinbase.com/products/" +
      encodeURIComponent(productId) +
      "/candles?granularity=3600&limit=" +
      encodeURIComponent(String(limit));

    const res = await fetch(url, {
      headers: {
        "User-Agent": "obsidian-terminal/1.0",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(502, {
        error: `Coinbase candles error ${res.status}`,
        details: text.slice(0, 300),
        productId,
      });
    }

    const rows = (await res.json()) as any[];

    // Coinbase returns newest-first; normalize oldest-first
    const candles: Candle1h[] = rows
      .map((r) => {
        const low = Number(r?.[1]);
        const high = Number(r?.[2]);
        return { l: low, h: high };
      })
      .filter((c) => isFinite(c.h) && isFinite(c.l))
      .reverse();

    if (!candles.length) {
      return json(404, { error: "No candle data returned", productId });
    }

    return json(200, { symbol: symbolRaw, productId, candles });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unhandled error" });
  }
};

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}
