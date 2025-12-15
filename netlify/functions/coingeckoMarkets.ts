import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const ids = event.queryStringParameters?.ids || "";
    if (!ids) return { statusCode: 400, body: "Missing ids" };

    const url =
      "https://api.coingecko.com/api/v3/coins/markets?" +
      new URLSearchParams({
        vs_currency: "usd",
        ids,
        order: "market_cap_desc",
        per_page: "250",
        page: "1",
        sparkline: "false",
        price_change_percentage: "24h",
      }).toString();

    const res = await fetch(url, { headers: { "User-Agent": "obsidian-terminal/1.0" } });
    const body = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=30",
        "access-control-allow-origin": "*",
      },
      body,
    };
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || "Server error" }) };
  }
};
