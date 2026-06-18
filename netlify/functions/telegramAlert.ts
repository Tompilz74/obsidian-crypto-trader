import type { Handler } from "@netlify/functions";

function json(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
  };
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Server error";
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return json(503, {
      ok: false,
      setup: "Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Netlify environment variables.",
    });
  }

  try {
    const parsed = JSON.parse(event.body || "{}") as { title?: string; detail?: string; symbol?: string; kind?: string };
    const title = String(parsed.title || "Obsidian crypto alert").slice(0, 120);
    const detail = String(parsed.detail || "").slice(0, 700);
    const symbol = String(parsed.symbol || "").slice(0, 24);
    const kind = String(parsed.kind || "ALERT").slice(0, 40);
    const text = [
      `Obsidian Alert: ${title}`,
      symbol ? `Coin: ${symbol}` : "",
      `Type: ${kind}`,
      detail,
      "",
      "Open the simulator before entering. Check spread, stop, target, and peak risk.",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) {
      return json(502, { ok: false, error: body?.description || `Telegram error ${res.status}` });
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    return json(500, { ok: false, error: errorMessage(e) });
  }
};
