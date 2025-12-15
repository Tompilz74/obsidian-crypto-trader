import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const symbol = (event.queryStringParameters?.symbol || "").toUpperCase();
    const interval = event.queryStringParameters?.interval || "1h";
    const limit = Math.min(Number(event.queryStringParameters?.limit || 240), 1000);

    if (!symbol || !/^[A-Z0-9]{2,15}$/.test(symbol)) {
      return { statusCode: 400, body: "Missing/invalid symbol" };
    }

    const url =
      "https://api.binance.com/api/v3/klines?" +
      new URLSearchParams({
        symbol: `${symbol}USDT`,
        interval,
        limit: String(limit),
      }).toString();

    const res = await fetch(url, {
      headers: { "User-Agent": "obsidian-terminal/1.0" },
    });

    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        "content-type": "application/json",
        // short cache to reduce rate-limit + speed up UI
        "cache-control": "public, max-age=30",
        "access-control-allow-origin": "*",
      },
      body,
    };
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || "Server error" }) };
  }
};
