type AiPayload = {
  goalPlan?: unknown;
  market?: unknown[];
  scannerBest?: unknown[];
  holdings?: unknown[];
  simHistory?: unknown[];
  simStats?: unknown;
  selectedSymbol?: string;
  liveNewsMode?: boolean;
};

type FunctionEvent = {
  httpMethod: string;
  body: string | null;
};

function json(statusCode: number, body: unknown) {
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

function compactPayload(payload: AiPayload) {
  return {
    goalPlan: payload.goalPlan ?? null,
    selectedSymbol: payload.selectedSymbol ?? null,
    market: (payload.market ?? []).slice(0, 10),
    scannerBest: (payload.scannerBest ?? []).slice(0, 5),
    holdings: (payload.holdings ?? []).slice(0, 8),
    simHistory: (payload.simHistory ?? []).slice(-10),
    simStats: payload.simStats ?? null,
  };
}

const advisorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    marketBrief: {
      type: "object",
      additionalProperties: false,
        properties: {
          headline: { type: "string" },
          regime: { type: "string" },
          summary: { type: "string" },
          catalysts: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                url: { type: "string" },
              },
              required: ["title", "url"],
            },
          },
          risks: { type: "array", items: { type: "string" } },
          avoid: { type: "array", items: { type: "string" } },
        },
      required: ["headline", "regime", "summary", "catalysts", "sources", "risks", "avoid"],
    },
    tradeIdeas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          action: { type: "string", enum: ["BUY_TEST", "WATCH", "HOLD", "SELL", "AVOID"] },
          confidence: { type: "number" },
          thesis: { type: "string" },
          planFit: { type: "string" },
          entryZone: { type: "string" },
          stop: { type: "string" },
          target: { type: "string" },
          holdTime: { type: "string" },
          allocationUsd: { type: "number" },
          reasons: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: [
          "symbol",
          "action",
          "confidence",
          "thesis",
          "planFit",
          "entryZone",
          "stop",
          "target",
          "holdTime",
          "allocationUsd",
          "reasons",
          "warnings",
        ],
      },
    },
    portfolioReview: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        actions: { type: "array", items: { type: "string" } },
        holdings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              symbol: { type: "string" },
              action: { type: "string", enum: ["SELL", "HOLD", "REDUCE", "INCREASE", "FREE_CAPITAL"] },
              confidence: { type: "number" },
              reason: { type: "string" },
              goalImpact: { type: "string" },
              replacementIdea: { type: "string" },
            },
            required: ["symbol", "action", "confidence", "reason", "goalImpact", "replacementIdea"],
          },
        },
      },
      required: ["summary", "actions", "holdings"],
    },
    disclaimer: { type: "string" },
  },
  required: ["marketBrief", "tradeIdeas", "portfolioReview", "disclaimer"],
};

function extractOutputText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

export const handler = async (event: FunctionEvent) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(501, {
      error: "OPENAI_API_KEY is not configured on the server.",
      setup: "Add OPENAI_API_KEY to your Netlify/local environment and restart the dev server.",
    });
  }

  try {
    const payload = JSON.parse(event.body || "{}") as AiPayload;
    const compact = compactPayload(payload);
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const useWebSearch = payload.liveNewsMode === true || process.env.OPENAI_ENABLE_WEB_SEARCH === "true";

    const prompt = [
      "You are Obsidian AI Trader, a crypto market decision-support assistant.",
      "Analyze only the supplied scanner, market, simulator, and plan data.",
      "Do not promise profit. Do not imply certainty. If evidence is weak, say to wait.",
      useWebSearch
        ? "Use web search for current crypto market news/events, then connect those events to the supplied scanner movement where evidence supports it."
        : "Do not claim live news access. Treat catalysts as scanner/price-action inferences unless URLs are supplied. Keep sources empty when no source is available.",
      "If a cause is only inferred from price/volume data, label it as an inference.",
      "Include source URLs for any news/event catalysts.",
      "For every open holding, include a portfolioReview.holdings item deciding SELL, HOLD, REDUCE, INCREASE, or FREE_CAPITAL.",
      "When recommending SELL/FREE_CAPITAL, name what stronger setup or goal constraint justifies freeing capital.",
      "Return concise structured guidance for a simulator-first trader. Keep every string short.",
      JSON.stringify(compact, null, 2),
    ].join("\n\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        tools: useWebSearch ? [{ type: "web_search" }] : [],
        tool_choice: "auto",
        reasoning: { effort: "low" },
        max_output_tokens: 2200,
        input: prompt,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "obsidian_ai_advisor",
            strict: true,
            schema: advisorSchema,
          },
        },
      }),
    });
    clearTimeout(timeout);

    const raw = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return json(res.status, { error: "OpenAI request failed", details: raw });

    const outputText = extractOutputText(raw);
    const parsed = outputText ? JSON.parse(outputText) : raw;
    return json(200, { ...parsed, model, generatedAtIso: new Date().toISOString() });
  } catch (e: unknown) {
    return json(500, { error: errorMessage(e) });
  }
};
