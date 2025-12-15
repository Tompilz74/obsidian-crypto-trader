import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const id = (event.queryStringParameters?.id || "").trim();

    if (!id) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing id" }),
      };
    }

    const url =
  `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?` +
  new URLSearchParams({
    vs_currency: "usd",
    days: "1", // keep 1; if it returns too few points, set to "2"
  }).toString();


    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
      body: text,
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: e?.message || "Server error" }),
    };
  }
};
