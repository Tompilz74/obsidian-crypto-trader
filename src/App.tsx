import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * OBSIDIAN CRYPTO TRADER — Phase 2A + 2B + 3 (Structure Engine)
 *
 * ✅ Live market snapshot (CoinGecko) — via Netlify function proxy
 * ✅ Session Guard: daily commitment + auto STOP + manual END SESSION
 * ✅ Micro-journal + R-multiple trade logging
 *
 * Phase 2B:
 * ✅ Entry Quality Engine:
 *    - Flags EXTENDED / NO EDGE after violent moves (CoinGecko hourly 24h) — via Netlify proxy
 *    - Shows “WHY NOT TRADE”
 *
 * Phase 3 (Structure Engine):
 * ✅ Coinbase 1h candles — via Netlify proxy
 * ✅ Support / resistance pivots (zoned)
 * ✅ Room-to-2R HARD BLOCK (NO EDGE if < 2R)
 * ✅ Clear labels (STRUCTURE: OK / WAIT / NO EDGE)
 */

type TabKey = "dashboard" | "scanner" | "journal" | "history" | "plan" | "simulator" | "accuracy" | "pro";
type SessionStatus = "TRADE" | "SELECTIVE" | "WAIT";
type TradeSide = "LONG" | "SHORT";
type SimTradeMode = "NORMAL" | "SCALP";

const MARKET_REFRESH_MS = 90 * 1000;
const MARKET_REFRESH_LABEL = "90s";

type MarketRow = {
  symbol: string;
  cgId?: string;
  name?: string;
  priceUsd?: number;
  change24h?: number;
  volume24hUsd?: number;
};

type SetupRow = {
  symbol: string;
  combinedScore: number;
  score15m: number;
  score1h: number;
  volFactor: number;
  change24h?: number;
  priceUsd?: number;
  why: string[];

  // Phase 2B: entry quality layer (separate from activity)
  entryQuality: "VALID" | "EXTENDED" | "NO_EDGE";
  whyNot: string[];
  ret1h?: number;
  ret4h?: number;
  dropFromHigh6h?: number;
  spikeFromLow6h?: number;

  // Phase 3: structure engine
  structureLabel: "OK" | "WAIT" | "NO_EDGE";
  structureWhy: string[];
  support?: number;
  resistance?: number;
  roomTo2R?: number;
  structureSource?: "BINANCE_1H" | "MISSING";
};

type SessionInfo = {
  session: string;
  status: SessionStatus;
  note: string;
  color: string;
  nextChangeAt: Date;
  countdown: string;
};

type CommitConfig = {
  dayKey: string; // YYYY-MM-DD
  committedAtIso: string;
  maxTrades: number;
  maxDailyLossR: number;
  maxConsecutiveLosses: number;
  riskPct: number;
  allowAsia: boolean;
  allowEurope: boolean;
  allowUS: boolean;
  allowOverlap: boolean;
  allowOffPeak: boolean;
};
type CommitSessionKey = "allowAsia" | "allowEurope" | "allowUS" | "allowOverlap" | "allowOffPeak";

type TradeRecord = {
  id: string;
  tsIso: string;
  symbol: string;
  side: TradeSide;
  entry: number;
  stop: number;
  exit: number;
  r: number;
  rulesFollowed: boolean;
  note?: string;
};

type DayState = {
  dayKey: string;
  locked: boolean;
  lockedReason?: string;
  trades: TradeRecord[];
};

type SimPosition = {
  id: string;
  openedAtIso: string;
  symbol: string;
  side: TradeSide;
  mode?: SimTradeMode;
  entry: number;
  qty: number;
  notionalUsd: number;
  stop?: number;
  takeProfit?: number;
  thesis?: string;
  source: string;
};

type SimClosedTrade = SimPosition & {
  closedAtIso: string;
  exit: number;
  pnlUsd: number;
  pnlPct: number;
  exitReason?: "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT";
};

type SimState = {
  startedAtIso: string;
  startingCashUsd: number;
  cashUsd: number;
  positions: SimPosition[];
  history: SimClosedTrade[];
};

type GoalPeriod = "day" | "week" | "month";
type StrategyProfile = "Scalp" | "Day Trade" | "Swing" | "Capital Defense";

type GoalPlanDraft = {
  goalName: string;
  targetReturnPct: number;
  targetPeriod: GoalPeriod;
  startingEquityUsd: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  riskPerTradePct: number;
  minConfidence: number;
  notes: string;
};

type GoalPlan = GoalPlanDraft & {
  id: string;
  createdAtIso: string;
  acceptedAtIso: string;
  horizonDays: number;
  dailyTargetPct: number;
  strategyProfile: StrategyProfile;
  requiredWinRatePct: number;
  acceptedRisk: true;
};
type GoalPlanNumberKey = Exclude<keyof GoalPlanDraft, "goalName" | "notes" | "targetPeriod">;
const GOAL_PLAN_NUMBER_KEYS: GoalPlanNumberKey[] = [
  "targetReturnPct",
  "startingEquityUsd",
  "maxDailyLossPct",
  "maxTradesPerDay",
  "maxOpenPositions",
  "riskPerTradePct",
  "minConfidence",
];

type AiTradeIdea = {
  symbol: string;
  action: "BUY_TEST" | "WATCH" | "HOLD" | "SELL" | "AVOID";
  confidence: number;
  thesis: string;
  planFit: string;
  entryZone: string;
  stop: string;
  target: string;
  holdTime: string;
  allocationUsd: number;
  reasons: string[];
  warnings: string[];
};

type AiAdvisorResponse = {
  generatedAtIso?: string;
  model?: string;
  marketBrief: {
    headline: string;
    regime: string;
    summary: string;
    catalysts: string[];
    sources: { title: string; url: string }[];
    risks: string[];
    avoid: string[];
  };
  tradeIdeas: AiTradeIdea[];
  portfolioReview: {
    summary: string;
    actions: string[];
    holdings: {
      symbol: string;
      action: "SELL" | "HOLD" | "REDUCE" | "INCREASE" | "FREE_CAPITAL";
      confidence: number;
      reason: string;
      goalImpact: string;
      replacementIdea: string;
    }[];
  };
  disclaimer: string;
};

type AiSignalRecord = {
  id: string;
  tsIso: string;
  symbol: string;
  action: string;
  confidence: number;
  entry: number;
  score: number;
  verdict?: "WIN" | "LOSS" | "OPEN";
  checkedAtIso?: string;
  resultPct?: number;
};

type ScalpSignal = {
  symbol: string;
  price: number;
  burstScore: number;
  legsScore: number;
  peakRiskScore: number;
  action: "SCALP_TEST" | "WATCH" | "TOO_LATE" | "NO_LIQUIDITY";
  tone: string;
  speedLabel: string;
  legsLabel: string;
  stop: number;
  target: number;
  holdWindow: string;
  suggestedUsd: number;
  reasons: string[];
  warnings: string[];
  setup: SetupRow;
};

type MicroMetrics = {
  ret1h: number;
  ret4h: number;
  dropFromHigh6h: number;
  spikeFromLow6h: number;
  entryQuality: "VALID" | "EXTENDED" | "NO_EDGE";
  whyNot: string[];
};

type MicroMap = Record<string, MicroMetrics>;
type PriceHistoryMap = Record<string, number[]>;

// ===== Phase 3 types =====
type StructureLabel = "OK" | "WAIT" | "NO_EDGE";
type StructureResult = {
  ok: boolean;
  label: StructureLabel;
  reasons: string[];
  support?: number;
  resistance?: number;
  roomTo2R?: number;
  source: "BINANCE_1H" | "MISSING";
};

type Candle1h = { h: number; l: number };

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const fmtUsd = (n?: number) =>
  typeof n === "number" && isFinite(n)
    ? n >= 1
      ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : `$${n.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
    : "—";
const fmtPct = (n?: number) => (typeof n === "number" && isFinite(n) ? `${n.toFixed(2)}%` : "—");
const fmtR = (r?: number) =>
  typeof r === "number" && isFinite(r) ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : "—";
const confidencePct = (n?: number) => {
  if (typeof n !== "number" || !isFinite(n)) return 0;
  return Math.round(clamp(n <= 1 ? n * 100 : n, 0, 100));
};

function CoinPerformanceChart({ prices }: { prices: number[] }) {
  const clean = prices.filter((p) => typeof p === "number" && isFinite(p) && p > 0);
  if (clean.length < 2) {
    return (
      <div style={{ height: 180, display: "grid", placeItems: "center", color: "#64748b", fontWeight: 800 }}>
        Chart loading with next market refresh.
      </div>
    );
  }

  const width = 720;
  const height = 180;
  const pad = 10;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(max - min, max * 0.001);
  const points = clean.map((price, i) => {
    const x = pad + (i / Math.max(1, clean.length - 1)) * (width - pad * 2);
    const y = height - pad - ((price - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const fill = `${line} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`;
  const changePct = ((clean[clean.length - 1] - clean[0]) / clean[0]) * 100;
  const stroke = changePct >= 0 ? "#059669" : "#dc2626";

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24 hour coin price chart" style={{ width: "100%", height, display: "block" }}>
        {[0.25, 0.5, 0.75].map((level) => (
          <line key={level} x1={pad} x2={width - pad} y1={height * level} y2={height * level} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        <path d={fill} fill={changePct >= 0 ? "rgba(16,185,129,0.12)" : "rgba(220,38,38,0.10)"} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="4" fill={stroke} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "#64748b", fontSize: "0.78rem", fontWeight: 800 }}>
        <span>24h low {fmtUsd(min)}</span>
        <span style={{ color: stroke }}>24h path {changePct >= 0 ? "+" : ""}{fmtPct(changePct)}</span>
        <span>24h high {fmtUsd(max)}</span>
      </div>
    </div>
  );
}

function useInterval(callback: () => void, delayMs: number | null) {
  const savedRef = useRef(callback);
  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => savedRef.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function msToCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function dayKeyLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
}

/**
 * Session windows heuristic (LOCAL MACHINE TIME)
 * - FIJI DAYTIME: weak on normal weekdays, based on simulator learning
 * - EUROPE: 16:00–21:00
 * - OVERLAP:21:00–01:00
 * - US:     01:00–06:00
 * - US WEEKEND: weekend + Fiji Monday morning exception
 */
function computeSession(now: Date): SessionInfo {
  const h = now.getHours();
  const m = now.getMinutes();
  const curMinutes = h * 60 + m;
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const isMondayMorning = day === 1 && curMinutes < 12 * 60;

  const B_ASIA = 7 * 60;
  const B_EU = 16 * 60;
  const B_OVERLAP = 21 * 60;
  const B_0100 = 1 * 60;
  const B_US_END = 6 * 60;
  const B_OFF_END = 7 * 60;

  let session = "OFF-PEAK";
  let status: SessionStatus = "WAIT";
  let note = "Low quality window. Prefer waiting for Europe/US activity.";
  let nextChangeAt = new Date(now);

  const makeNext = (targetHour: number, targetMin = 0, addDays = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + addDays);
    d.setHours(targetHour, targetMin, 0, 0);
    return d;
  };

  if ((isWeekend || isMondayMorning) && curMinutes >= B_OFF_END && curMinutes < B_EU) {
    session = "US WEEKEND";
    status = "SELECTIVE";
    note = "Weekend / US-Sunday flow. Crypto can move, but liquidity is thinner; scalp only clean legs-left setups.";
    nextChangeAt = makeNext(16, 0, 0);
  } else if (curMinutes >= B_ASIA && curMinutes < B_EU) {
    session = "ASIA";
    status = "WAIT";
    note = "Your simulator learning says Fiji daytime is a weak trading window. Prefer afternoon onward unless a rare clean scalp appears.";
    nextChangeAt = makeNext(16, 0, 0);
  } else if (curMinutes >= B_EU && curMinutes < B_OVERLAP) {
    session = "EUROPE";
    status = "TRADE";
    note = "Preferred window starts here. Better liquidity than Fiji daytime; trade A+ setups only.";
    nextChangeAt = makeNext(21, 0, 0);
  } else if (curMinutes >= B_OVERLAP || curMinutes < B_0100) {
    session = "EUROPE + US OVERLAP";
    status = "TRADE";
    note = "Best liquidity/volatility. Highest quality breakouts often occur here.";
    nextChangeAt = curMinutes >= B_OVERLAP ? makeNext(1, 0, 1) : makeNext(1, 0, 0);
  } else if (curMinutes >= B_0100 && curMinutes < B_US_END) {
    session = "US";
    status = "TRADE";
    note = "Strong activity. Good window, but don’t overtrade.";
    nextChangeAt = makeNext(6, 0, 0);
  } else if (curMinutes >= B_US_END && curMinutes < B_OFF_END) {
    session = isWeekend || isMondayMorning ? "US WEEKEND" : "OFF-PEAK";
    status = isWeekend || isMondayMorning ? "SELECTIVE" : "WAIT";
    note =
      isWeekend || isMondayMorning
        ? "US weekend tail. Selective only; wait for momentum with legs left."
        : "Thin/awkward window. Avoid forcing trades; wait for afternoon liquidity.";
    nextChangeAt = makeNext(7, 0, 0);
  } else {
    session = "OFF-PEAK";
    status = "WAIT";
    note = "Low quality window. Prefer waiting for afternoon Europe/US activity.";
    nextChangeAt = curMinutes < B_ASIA ? makeNext(isWeekend || isMondayMorning ? 7 : 16, 0, 0) : makeNext(16, 0, 0);
  }

  const color = status === "TRADE" ? "#047857" : status === "SELECTIVE" ? "#111827" : "#b91c1c";
  const countdown = msToCountdown(nextChangeAt.getTime() - now.getTime());
  return { session, status, note, color, nextChangeAt, countdown };
}

/** CoinGecko markets snapshot — via Netlify function proxy */
async function fetchCoinGeckoMarkets(ids: string[]) {
  const url =
    "/.netlify/functions/coingeckoMarkets?" +
    new URLSearchParams({
      ids: ids.join(","),
    }).toString();

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`CoinGecko proxy error ${res.status}`);
  return (await res.json()) as Array<{
    id: string;
    symbol: string;
    name: string;
    current_price: number;
    price_change_percentage_24h: number | null;
    total_volume: number | null;
  }>;
}

async function fetchCoinGeckoMarketsBatched(ids: string[], batchSize = 75) {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));
  const results = await Promise.all(batches.map((batch) => fetchCoinGeckoMarkets(batch)));
  return results.flat();
}

/** Phase 2B: Hourly chart (24h) — via Netlify function proxy */
async function fetchCoinGeckoHourly24h(coinId: string) {
  const url =
    "/.netlify/functions/coingeckoHourly?" +
    new URLSearchParams({ id: coinId }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko hourly proxy error ${res.status}`);
  const data = (await res.json()) as { prices: [number, number][] };
  return data.prices.map((p) => p[1]).filter((x) => typeof x === "number" && isFinite(x));
}

function computeMicro(prices: number[]): MicroMetrics {
  const n = prices.length;
  const last = prices[n - 1] ?? NaN;

  const p1h = prices[Math.max(0, n - 2)] ?? NaN;
  const p4h = prices[Math.max(0, n - 5)] ?? NaN;
  const window6h = prices.slice(Math.max(0, n - 7));

  const high6h = Math.max(...window6h);
  const low6h = Math.min(...window6h);

  const ret1h = ((last - p1h) / p1h) * 100;
  const ret4h = ((last - p4h) / p4h) * 100;

  const dropFromHigh6h = ((last - high6h) / high6h) * 100;
  const spikeFromLow6h = ((last - low6h) / low6h) * 100;

  const whyNot: string[] = [];
  let entryQuality: MicroMetrics["entryQuality"] = "VALID";

  // NO EDGE: true fast dump (hard block)
  if (ret1h <= -3) {
    entryQuality = "NO_EDGE";
    whyNot.push(`Fast dump: ${ret1h.toFixed(2)}% in ~1h`);
    whyNot.push("Wait for base or reclaim before considering entry.");
  }
  // WAIT-ish: pullback from high → EXTENDED (not NO_EDGE)
  else if (dropFromHigh6h <= -4) {
    entryQuality = "EXTENDED";
    whyNot.push(`Pullback: ${dropFromHigh6h.toFixed(2)}% from 6h high`);
    whyNot.push("WAIT for base / reclaim — avoid guessing.");
  }
  // EXTENDED: fast pump from recent low
  else if (spikeFromLow6h >= 6) {
    entryQuality = "EXTENDED";
    whyNot.push(`Extended: +${spikeFromLow6h.toFixed(2)}% from 6h low`);
    whyNot.push("Don’t chase. Wait for pullback + retest.");
  }

  return { ret1h, ret4h, dropFromHigh6h, spikeFromLow6h, entryQuality, whyNot };
}

/** Proxy scoring until deeper candle logic (Phase 2C+) */
function scoreSetup(row: MarketRow, baselineVol: number) {
  const ch = row.change24h ?? 0;
  const vol = row.volume24hUsd ?? 0;
  const volFactor = baselineVol > 0 ? vol / baselineVol : 1;

  const changeScore = clamp(50 + ch * 4, 0, 100);
  const volScore = clamp(50 + Math.log10(Math.max(1, volFactor)) * 25, 0, 100);

  const score15m = clamp(changeScore * 0.55 + volScore * 0.45 + 4, 0, 100);
  const score1h = clamp(changeScore * 0.65 + volScore * 0.35, 0, 100);
  const combined = clamp(score15m * 0.48 + score1h * 0.52, 0, 100);

  const why: string[] = [];
  if (combined >= 80) why.push("High participation + strong tape");
  if (combined >= 65 && combined < 80) why.push("Tradable activity");
  if (volFactor >= 1.3) why.push("Volume elevated vs baseline");
  if (ch >= 3) why.push("Positive 24h trend");
  if (ch < 0) why.push("24h negative — be selective");

  return { combinedScore: combined, score15m, score1h, volFactor, why };
}

/** Compute R multiple */
function computeR(side: "LONG" | "SHORT", entry: number, stop: number, exit: number) {
  if (![entry, stop, exit].every((x) => typeof x === "number" && isFinite(x))) return NaN;

  if (side === "LONG") {
    const risk = entry - stop;
    if (risk <= 0) return NaN;
    return (exit - entry) / risk;
  } else {
    const risk = stop - entry;
    if (risk <= 0) return NaN;
    return (entry - exit) / risk;
  }
}

/** Local persistence */
const LS_COMMIT = "ob:commit";
const LS_DAYSTATE = "ob:daystate";
const LS_PRO_PASS = "ob:pro-pass";
const LS_LEADS = "ob:leads";
const LS_SIM = "ob:simulator";
const LS_GOAL_PLAN = "ob:goal-plan";
const LS_AI_SIGNALS = "ob:ai-signals";
const CHECKOUT_URL =
  (import.meta.env.VITE_CHECKOUT_URL as string | undefined) ||
  "mailto:you@example.com?subject=Obsidian%20Pro%20access&body=I%20want%20Obsidian%20Crypto%20Trader%20Pro.";
const PRO_PRICE = "$29/mo";
const COMMIT_SESSION_OPTIONS: Array<[CommitSessionKey, string]> = [
  ["allowAsia", "Asia"],
  ["allowEurope", "Europe"],
  ["allowOverlap", "Europe+US overlap"],
  ["allowUS", "US"],
  ["allowOffPeak", "Off-peak"],
];

function loadCommit(dayKey: string): CommitConfig | null {
  try {
    const raw = localStorage.getItem(LS_COMMIT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommitConfig;
    return parsed?.dayKey === dayKey ? parsed : null;
  } catch {
    return null;
  }
}
function saveCommit(cfg: CommitConfig) {
  localStorage.setItem(LS_COMMIT, JSON.stringify(cfg));
}

function defaultCommit(dayKey: string): CommitConfig {
  return {
    dayKey,
    committedAtIso: new Date().toISOString(),
    maxTrades: 2,
    maxDailyLossR: 2,
    maxConsecutiveLosses: 2,
    riskPct: 2,
    allowAsia: false,
    allowEurope: true,
    allowUS: true,
    allowOverlap: true,
    allowOffPeak: false,
  };
}

function loadDayState(dayKey: string): DayState {
  try {
    const raw = localStorage.getItem(LS_DAYSTATE);
    if (!raw) return { dayKey, locked: false, trades: [] };
    const parsed = JSON.parse(raw) as DayState;
    if (!parsed || parsed.dayKey !== dayKey) return { dayKey, locked: false, trades: [] };
    return parsed;
  } catch {
    return { dayKey, locked: false, trades: [] };
  }
}
function saveDayState(st: DayState) {
  localStorage.setItem(LS_DAYSTATE, JSON.stringify(st));
}

function defaultSimState(): SimState {
  return { startedAtIso: new Date().toISOString(), startingCashUsd: 10000, cashUsd: 10000, positions: [], history: [] };
}

function loadSimState(): SimState {
  try {
    const raw = localStorage.getItem(LS_SIM);
    if (!raw) return defaultSimState();
    const parsed = JSON.parse(raw) as SimState;
    if (!parsed || typeof parsed.cashUsd !== "number" || !Array.isArray(parsed.positions) || !Array.isArray(parsed.history)) {
      return defaultSimState();
    }
    return { ...parsed, startedAtIso: parsed.startedAtIso ?? new Date().toISOString() };
  } catch {
    return defaultSimState();
  }
}

function saveSimState(st: SimState) {
  localStorage.setItem(LS_SIM, JSON.stringify(st));
}

function goalPeriodDays(period: GoalPeriod) {
  if (period === "day") return 1;
  if (period === "week") return 7;
  return 30;
}

function strategyFromGoal(targetReturnPct: number, targetPeriod: GoalPeriod): {
  profile: StrategyProfile;
  dailyTargetPct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  riskPerTradePct: number;
  minConfidence: number;
  notes: string;
} {
  const horizonDays = goalPeriodDays(targetPeriod);
  const dailyTargetPct = targetReturnPct / horizonDays;

  if (dailyTargetPct >= 2) {
    return {
      profile: "Scalp",
      dailyTargetPct,
      maxDailyLossPct: Math.min(2, Math.max(1, dailyTargetPct * 0.55)),
      maxTradesPerDay: 4,
      maxOpenPositions: 1,
      riskPerTradePct: 0.75,
      minConfidence: 82,
      notes: "Aggressive awake-only scalp target. Trade only while watching the screen, use the cleanest scanner setups, keep size small, and close stale trades before they become overnight holds.",
    };
  }

  if (dailyTargetPct >= 0.65) {
    return {
      profile: "Day Trade",
      dailyTargetPct,
      maxDailyLossPct: Math.min(1.5, Math.max(0.75, dailyTargetPct * 0.75)),
      maxTradesPerDay: 3,
      maxOpenPositions: 2,
      riskPerTradePct: 1,
      minConfidence: 76,
      notes: "Active day-trading target. Focus on VALID timing, Structure OK, and close positions before sleep unless they are deliberately moved into the long-term study lane.",
    };
  }

  if (dailyTargetPct >= 0.15) {
    return {
      profile: "Swing",
      dailyTargetPct,
      maxDailyLossPct: 0.8,
      maxTradesPerDay: 2,
      maxOpenPositions: 3,
      riskPerTradePct: 1.25,
      minConfidence: 72,
      notes: "Moderate goal. Allow fewer, higher-quality trades and let winners work longer instead of forcing daily action.",
    };
  }

  return {
    profile: "Capital Defense",
    dailyTargetPct,
    maxDailyLossPct: 0.5,
    maxTradesPerDay: 1,
    maxOpenPositions: 2,
    riskPerTradePct: 0.75,
    minConfidence: 78,
    notes: "Low daily target. Protect cash, wait for strict signals, and prioritize drawdown control.",
  };
}

function defaultGoalPlanDraft(startingEquityUsd = 10000): GoalPlanDraft {
  const strategy = strategyFromGoal(3, "day");
  return {
    goalName: "3% daily profit challenge",
    targetReturnPct: 3,
    targetPeriod: "day",
    startingEquityUsd,
    maxDailyLossPct: strategy.maxDailyLossPct,
    maxTradesPerDay: strategy.maxTradesPerDay,
    maxOpenPositions: strategy.maxOpenPositions,
    riskPerTradePct: strategy.riskPerTradePct,
    minConfidence: strategy.minConfidence,
    notes: strategy.notes,
  };
}

function loadGoalPlan(): GoalPlan | null {
  try {
    const raw = localStorage.getItem(LS_GOAL_PLAN);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoalPlan & { horizonDays?: number; targetPeriod?: GoalPeriod };
    if (!parsed || !parsed.acceptedRisk || typeof parsed.targetReturnPct !== "number") return null;
    const targetPeriod: GoalPeriod =
      parsed.targetPeriod === "day" || parsed.targetPeriod === "week" || parsed.targetPeriod === "month"
        ? parsed.targetPeriod
        : (parsed.horizonDays ?? 1) <= 1
          ? "day"
          : (parsed.horizonDays ?? 7) <= 7
            ? "week"
            : "month";
    const horizonDays = goalPeriodDays(targetPeriod);
    const strategy = strategyFromGoal(parsed.targetReturnPct, targetPeriod);
    return {
      ...parsed,
      targetPeriod,
      horizonDays,
      dailyTargetPct: parsed.dailyTargetPct ?? strategy.dailyTargetPct,
      strategyProfile: parsed.strategyProfile ?? strategy.profile,
      requiredWinRatePct: parsed.requiredWinRatePct ?? clamp(48 + parsed.targetReturnPct * 6 - parsed.riskPerTradePct * 3, 35, 88),
    };
  } catch {
    return null;
  }
}

function saveGoalPlan(plan: GoalPlan | null) {
  if (!plan) localStorage.removeItem(LS_GOAL_PLAN);
  else localStorage.setItem(LS_GOAL_PLAN, JSON.stringify(plan));
}

function goalPlanNumberText(draft: GoalPlanDraft): Record<GoalPlanNumberKey, string> {
  return GOAL_PLAN_NUMBER_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: String(draft[key]) }),
    {} as Record<GoalPlanNumberKey, string>
  );
}

function loadProPass() {
  try {
    return localStorage.getItem(LS_PRO_PASS) === "active";
  } catch {
    return false;
  }
}

function loadAiSignals(): AiSignalRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_AI_SIGNALS) || "[]") as AiSignalRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAiSignals(signals: AiSignalRecord[]) {
  localStorage.setItem(LS_AI_SIGNALS, JSON.stringify(signals.slice(0, 500)));
}

function getErrorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

/** ===== Phase 3: Coinbase structure (via Netlify function proxy) ===== */

async function fetchCoinbase1hCandles(symbol: string, limit = 240): Promise<Candle1h[]> {
  const url =
    "/.netlify/functions/coinbaseCandles?" +
    new URLSearchParams({
      symbol: symbol.toUpperCase(),
      limit: String(limit),
    }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Coinbase function error ${res.status}`);

  const data = (await res.json()) as { candles: Candle1h[] };
  if (!data?.candles?.length) throw new Error("No candles returned from Coinbase function");
  return data.candles;
}


function computePivotLevels1h(candles: Candle1h[]) {
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].h;
    const l = candles[i].l;

    if (h > candles[i - 1].h && h > candles[i + 1].h) resistances.push(h);
    if (l < candles[i - 1].l && l < candles[i + 1].l) supports.push(l);
  }

  // zone rounding (simple, stable)
  const zone = (x: number) => {
    if (x >= 1000) return Math.round(x / 10) * 10;
    if (x >= 100) return Math.round(x / 1) * 1;
    if (x >= 1) return Math.round(x / 0.01) * 0.01;
    return Math.round(x / 0.000001) * 0.000001;
  };

  const countZones = (arr: number[]) => {
    const map = new Map<number, number>();
    for (const p of arr) map.set(zone(p), (map.get(zone(p)) ?? 0) + 1);
    return [...map.entries()].map(([price, strength]) => ({ price, strength }));
  };

  return {
    supports: countZones(supports),
    resistances: countZones(resistances),
  };
}

function evaluateStructure(lastPrice: number, levels: ReturnType<typeof computePivotLevels1h>): StructureResult {
  const reasons: string[] = [];
  const supportsBelow = levels.supports.filter((x) => x.price < lastPrice).sort((a, b) => b.price - a.price);
  const resistAbove = levels.resistances.filter((x) => x.price > lastPrice).sort((a, b) => a.price - b.price);

  if (!supportsBelow.length) {
    return { ok: false, label: "WAIT", reasons: ["No support below — stop is guesswork."], source: "BINANCE_1H" };
  }

  const support = supportsBelow[0].price;
  const risk = lastPrice - support;
  if (!(risk > 0)) {
    return { ok: false, label: "NO_EDGE", reasons: ["Invalid structure: support not below price."], support, source: "BINANCE_1H" };
  }

  // Pick the first resistance that gives >=2R within a reasonable distance; else nearest.
  const maxTargetDistance = lastPrice * 0.15;
  const candidates = resistAbove.filter((r) => r.price - lastPrice <= maxTargetDistance);
  const chosen = candidates.find((r) => (r.price - lastPrice) / risk >= 2) ?? candidates[0];

  if (!chosen) {
    return { ok: false, label: "WAIT", reasons: ["No resistance above — target unclear."], support, source: "BINANCE_1H" };
  }

  const resistance = chosen.price;
  const roomTo2R = (resistance - lastPrice) / risk;

  // HARD BLOCK
  if (roomTo2R < 2) {
    return {
      ok: false,
      label: "NO_EDGE",
      reasons: [`Room-to-2R fails: only ${roomTo2R.toFixed(2)}R available.`],
      support,
      resistance,
      roomTo2R,
      source: "BINANCE_1H",
    };
  }

  // Soft warning only (do NOT block)
  const strengthS = supportsBelow[0]?.strength ?? 0;
  const strengthR = chosen?.strength ?? 0;
  if (strengthS < 2 || strengthR < 2) reasons.push("Levels are weak (low touches). Be extra selective.");

  return { ok: true, label: "OK", reasons, support, resistance, roomTo2R, source: "BINANCE_1H" };
}

type CoinDef = { symbol: string; cgId?: string; name?: string };

/** Original app universe plus a broader Revolut UK candidate universe (best-effort CoinGecko ids). */
const BASE_COINS: CoinDef[] = [
  { symbol: "BTC", cgId: "bitcoin", name: "Bitcoin" },
  { symbol: "ETH", cgId: "ethereum", name: "Ethereum" },
  { symbol: "SOL", cgId: "solana", name: "Solana" },
  { symbol: "XRP", cgId: "ripple", name: "XRP" },
  { symbol: "USDC", cgId: "usd-coin", name: "USD Coin" },

  { symbol: "MOODENG", cgId: "moodeng", name: "Moodeng" },
  { symbol: "FIS", cgId: "stafi", name: "StaFi" },
  { symbol: "SPA", cgId: "sperax", name: "Sperax" },
  { symbol: "SHIB", cgId: "shiba-inu", name: "Shiba Inu" },
  { symbol: "JASMY", cgId: "jasmycoin", name: "JasmyCoin" },
  { symbol: "TRUMP", cgId: "official-trump", name: "Official TRUMP" },
  { symbol: "XYO", cgId: "xyo-network", name: "XYO" },
  { symbol: "HBAR", cgId: "hedera-hashgraph", name: "Hedera" },
  { symbol: "LQTY", cgId: "liquity", name: "Liquity" },
  { symbol: "XLM", cgId: "stellar", name: "Stellar" },
  { symbol: "XCN", cgId: "onyxcoin", name: "Onyxcoin" },
  { symbol: "OMNI", cgId: "omni-network", name: "Omni Network" },
  { symbol: "AUCTION", cgId: "bounce-token", name: "Bounce Token" },
  { symbol: "KNC", cgId: "kyber-network-crystal", name: "Kyber Network" },
  { symbol: "GST", cgId: "green-satoshi-token", name: "Green Satoshi Token" },
  { symbol: "WEN", cgId: "wen-4", name: "Wen" },
  { symbol: "API3", cgId: "api3", name: "API3" },
  { symbol: "ALCX", cgId: "alchemix", name: "Alchemix" },
  { symbol: "MINA", cgId: "mina-protocol", name: "Mina" },
  { symbol: "ATH", cgId: "aethir", name: "Aethir" },
  { symbol: "SEI", cgId: "sei-network", name: "Sei" },
  { symbol: "PENGU", cgId: "pudgy-penguins", name: "Pudgy Penguins" },
  { symbol: "AERGO", cgId: "aergo", name: "Aergo" },
  { symbol: "1INCH", cgId: "1inch", name: "1inch" },
  { symbol: "MOG", cgId: "mog-coin", name: "Mog Coin" },
  { symbol: "PERP", cgId: "perpetual-protocol", name: "Perpetual Protocol" },
  { symbol: "JUP", cgId: "jupiter-exchange-solana", name: "Jupiter" },
  { symbol: "BLZ", cgId: "bluzelle", name: "Bluzelle" },
  { symbol: "GIGA", cgId: "gigachad-2", name: "Gigachad" },
  { symbol: "LMWR", cgId: "limewire", name: "LimeWire" },
  { symbol: "YFI", cgId: "yearn-finance", name: "Yearn" },
  { symbol: "TRX", cgId: "tron", name: "Tron" },
  { symbol: "KRL", cgId: "kryll", name: "Kryll" },
  { symbol: "IDEX", cgId: "idex", name: "Idex" },
  { symbol: "BTRST", cgId: "braintrust", name: "Braintrust" },
  { symbol: "QNT", cgId: "quant-network", name: "Quant" },
  { symbol: "FORT", cgId: "forta", name: "Forta" },
  { symbol: "AIOZ", cgId: "aioz-network", name: "AIOZ Network" },
  { symbol: "POLS", cgId: "polkastarter", name: "Polkastarter" },
  { symbol: "CELO", cgId: "celo", name: "Celo" },
  { symbol: "HONEY", cgId: "hivemapper", name: "Hivemapper" },
  { symbol: "PYTH", cgId: "pyth-network", name: "Pyth Network" },
  { symbol: "CHZ", cgId: "chiliz", name: "Chiliz" },
  { symbol: "PRIME", cgId: "echelon-prime", name: "Echelon Prime" },
  { symbol: "SKL", cgId: "skale", name: "SKALE" },
  { symbol: "ACS", cgId: "access-protocol", name: "Access Protocol" },
  { symbol: "SD", cgId: "stader", name: "Stader" },
  { symbol: "DIMO", cgId: "dimo", name: "DIMO" },
  { symbol: "ADA", cgId: "cardano", name: "Cardano" },
  { symbol: "VINU", cgId: "vita-inu", name: "Vita Inu" },
  { symbol: "GLM", cgId: "golem", name: "Golem" },
  { symbol: "DRIFT", cgId: "drift-protocol", name: "Drift" },
  { symbol: "ME", cgId: "magic-eden", name: "Magic Eden" },
  { symbol: "GFI", cgId: "goldfinch", name: "Goldfinch" },
  { symbol: "ABT", cgId: "arcblock", name: "Arcblock" },
  { symbol: "COMP", cgId: "compound-governance-token", name: "Compound" },
  { symbol: "CVC", cgId: "civic", name: "Civic" },
  { symbol: "MAGIC", cgId: "magic", name: "Treasure" },
  { symbol: "SUSHI", cgId: "sushi", name: "SushiSwap" },
  { symbol: "OCEAN", cgId: "ocean-protocol", name: "Ocean Protocol" },
  { symbol: "TAI", cgId: "tars-ai", name: "TARS AI" },
  { symbol: "RAD", cgId: "radicle", name: "Radicle" },
  { symbol: "UNI", cgId: "uniswap", name: "Uniswap" },
  { symbol: "DYDX", cgId: "dydx", name: "dYdX" },
  { symbol: "NKN", cgId: "nkn", name: "NKN" },
  { symbol: "ASM", cgId: "assemble-protocol", name: "Assemble AI" },
  { symbol: "INJ", cgId: "injective-protocol", name: "Injective" },
  { symbol: "DASH", cgId: "dash", name: "Dash" },
  { symbol: "COOKIE", cgId: "cookie", name: "Cookie DAO" },
  { symbol: "ARB", cgId: "arbitrum", name: "Arbitrum" },
  { symbol: "POND", cgId: "marlin", name: "Marlin" },
  { symbol: "EIGEN", cgId: "eigenlayer", name: "EigenLayer" },
  { symbol: "LINK", cgId: "chainlink", name: "Chainlink" },
  { symbol: "APE", cgId: "apecoin", name: "ApeCoin" },
  { symbol: "WOO", cgId: "woo-network", name: "WOO" },
  { symbol: "CRV", cgId: "curve-dao-token", name: "Curve" },
  { symbol: "AKT", cgId: "akash-network", name: "Akash Network" },
  { symbol: "IOTX", cgId: "iotex", name: "IoTeX" },
  { symbol: "MKR", cgId: "maker", name: "Maker" },
  { symbol: "BONK", cgId: "bonk", name: "Bonk" },
  { symbol: "KAVA", cgId: "kava", name: "Kava" },
  { symbol: "GRASS", cgId: "grass", name: "Grass" },
  { symbol: "TNSR", cgId: "tensor", name: "Tensor" },
  { symbol: "LRC", cgId: "loopring", name: "Loopring" },
  { symbol: "CAT", cgId: "simons-cat", name: "Simon's Cat" },
  { symbol: "MORPHO", cgId: "morpho", name: "Morpho" },
  { symbol: "LDO", cgId: "lido-dao", name: "Lido" },
  { symbol: "SUI", cgId: "sui", name: "Sui" },
  { symbol: "MSOL", cgId: "marinade-staked-sol", name: "Marinade Staked SOL" },
  { symbol: "ENA", cgId: "ethena", name: "Ethena" },
  { symbol: "SUPER", cgId: "superverse", name: "SuperVerse" },
  { symbol: "METIS", cgId: "metis-token", name: "Metis" },
  { symbol: "RSR", cgId: "reserve-rights-token", name: "Reserve Rights" },
  { symbol: "ALEPH", cgId: "aleph-im", name: "Aleph Cloud" },
  { symbol: "BAT", cgId: "basic-attention-token", name: "BAT" },
  { symbol: "VOXEL", cgId: "voxies", name: "Voxies" },
  { symbol: "SPX", cgId: "spx6900", name: "SPX6900" },
  { symbol: "TOKEN", cgId: "tokenfi", name: "TokenFi" },
];

const REVOLUT_UK_CANDIDATES: CoinDef[] = [
  { symbol: "DOGE", cgId: "dogecoin", name: "Dogecoin" },
  { symbol: "DOT", cgId: "polkadot", name: "Polkadot" },
  { symbol: "AVAX", cgId: "avalanche-2", name: "Avalanche" },
  { symbol: "TON", cgId: "the-open-network", name: "Toncoin" },
  { symbol: "BCH", cgId: "bitcoin-cash", name: "Bitcoin Cash" },
  { symbol: "LTC", cgId: "litecoin", name: "Litecoin" },
  { symbol: "NEAR", cgId: "near", name: "NEAR Protocol" },
  { symbol: "ICP", cgId: "internet-computer", name: "Internet Computer" },
  { symbol: "APT", cgId: "aptos", name: "Aptos" },
  { symbol: "ETC", cgId: "ethereum-classic", name: "Ethereum Classic" },
  { symbol: "RENDER", cgId: "render-token", name: "Render" },
  { symbol: "VET", cgId: "vechain", name: "VeChain" },
  { symbol: "FIL", cgId: "filecoin", name: "Filecoin" },
  { symbol: "ATOM", cgId: "cosmos", name: "Cosmos" },
  { symbol: "OP", cgId: "optimism", name: "Optimism" },
  { symbol: "IMX", cgId: "immutable-x", name: "Immutable" },
  { symbol: "THETA", cgId: "theta-token", name: "Theta Network" },
  { symbol: "TAO", cgId: "bittensor", name: "Bittensor" },
  { symbol: "STX", cgId: "blockstack", name: "Stacks" },
  { symbol: "MNT", cgId: "mantle", name: "Mantle" },
  { symbol: "ALGO", cgId: "algorand", name: "Algorand" },
  { symbol: "POL", cgId: "polygon-ecosystem-token", name: "Polygon Ecosystem Token" },
  { symbol: "AAVE", cgId: "aave", name: "Aave" },
  { symbol: "FTM", cgId: "fantom", name: "Fantom" },
  { symbol: "GRT", cgId: "the-graph", name: "The Graph" },
  { symbol: "JTO", cgId: "jito-governance-token", name: "Jito" },
  { symbol: "W", cgId: "wormhole", name: "Wormhole" },
  { symbol: "FLOKI", cgId: "floki", name: "FLOKI" },
  { symbol: "WLD", cgId: "worldcoin-wld", name: "Worldcoin" },
  { symbol: "VIRTUAL", cgId: "virtual-protocol", name: "Virtuals Protocol" },
  { symbol: "RAY", cgId: "raydium", name: "Raydium" },
  { symbol: "ONDO", cgId: "ondo-finance", name: "Ondo" },
  { symbol: "GALA", cgId: "gala", name: "Gala" },
  { symbol: "SAND", cgId: "the-sandbox", name: "The Sandbox" },
  { symbol: "MANA", cgId: "decentraland", name: "Decentraland" },
  { symbol: "AXS", cgId: "axie-infinity", name: "Axie Infinity" },
  { symbol: "BEAM", cgId: "beam-2", name: "Beam" },
  { symbol: "PENDLE", cgId: "pendle", name: "Pendle" },
  { symbol: "AERO", cgId: "aerodrome-finance", name: "Aerodrome Finance" },
  { symbol: "RPL", cgId: "rocket-pool", name: "Rocket Pool" },
  { symbol: "ENS", cgId: "ethereum-name-service", name: "Ethereum Name Service" },
  { symbol: "ZEC", cgId: "zcash", name: "Zcash" },
  { symbol: "XTZ", cgId: "tezos", name: "Tezos" },
  { symbol: "NEO", cgId: "neo", name: "NEO" },
  { symbol: "EOS", cgId: "eos", name: "EOS" },
  { symbol: "IOTA", cgId: "iota", name: "IOTA" },
  { symbol: "FLOW", cgId: "flow", name: "Flow" },
  { symbol: "FXS", cgId: "frax-share", name: "Frax Share" },
  { symbol: "CKB", cgId: "nervos-network", name: "Nervos Network" },
  { symbol: "HNT", cgId: "helium", name: "Helium" },
  { symbol: "ZIL", cgId: "zilliqa", name: "Zilliqa" },
  { symbol: "JST", cgId: "just", name: "JUST" },
  { symbol: "ZRX", cgId: "0x", name: "0x Protocol" },
  { symbol: "ANKR", cgId: "ankr", name: "Ankr" },
  { symbol: "UMA", cgId: "uma", name: "UMA" },
  { symbol: "SC", cgId: "siacoin", name: "Siacoin" },
  { symbol: "RVN", cgId: "ravencoin", name: "Ravencoin" },
  { symbol: "ONT", cgId: "ontology", name: "Ontology" },
  { symbol: "MASK", cgId: "mask-network", name: "Mask Network" },
  { symbol: "TRAC", cgId: "origintrail", name: "OriginTrail" },
  { symbol: "TRB", cgId: "tellor", name: "Tellor" },
  { symbol: "T", cgId: "threshold-network-token", name: "Threshold" },
  { symbol: "BAND", cgId: "band-protocol", name: "Band Protocol" },
  { symbol: "CTSI", cgId: "cartesi", name: "Cartesi" },
  { symbol: "REQ", cgId: "request-network", name: "Request" },
  { symbol: "STORJ", cgId: "storj", name: "Storj" },
  { symbol: "CHR", cgId: "chromaway", name: "Chromia" },
  { symbol: "SNT", cgId: "status", name: "Status" },
  { symbol: "POWR", cgId: "power-ledger", name: "Powerledger" },
  { symbol: "SYN", cgId: "synapse-2", name: "Synapse" },
  { symbol: "BAL", cgId: "balancer", name: "Balancer" },
  { symbol: "TIA", cgId: "celestia", name: "Celestia" },
  { symbol: "MANTA", cgId: "manta-network", name: "Manta Network" },
  { symbol: "STRK", cgId: "starknet", name: "Starknet" },
  { symbol: "ZK", cgId: "zksync", name: "ZKsync" },
  { symbol: "ZRO", cgId: "layerzero", name: "LayerZero" },
  { symbol: "ETHFI", cgId: "ether-fi", name: "Ether.fi" },
  { symbol: "ALT", cgId: "altlayer", name: "AltLayer" },
  { symbol: "AEVO", cgId: "aevo-exchange", name: "Aevo" },
  { symbol: "SAGA", cgId: "saga-2", name: "Saga" },
  { symbol: "IO", cgId: "io", name: "io.net" },
  { symbol: "ZETA", cgId: "zetachain", name: "ZetaChain" },
  { symbol: "DYM", cgId: "dymension", name: "Dymension" },
  { symbol: "PIXEL", cgId: "pixels", name: "Pixels" },
  { symbol: "PORTAL", cgId: "portal-2", name: "Portal" },
  { symbol: "PEPE", cgId: "pepe", name: "Pepe" },
  { symbol: "WIF", cgId: "dogwifcoin", name: "dogwifhat" },
  { symbol: "BRETT", cgId: "brett-2", name: "Brett" },
  { symbol: "MEW", cgId: "cat-in-a-dogs-world", name: "cat in a dogs world" },
  { symbol: "BOME", cgId: "book-of-meme", name: "Book of Meme" },
  { symbol: "POPCAT", cgId: "popcat", name: "Popcat" },
  { symbol: "TURBO", cgId: "turbo", name: "Turbo" },
  { symbol: "PNUT", cgId: "peanut-the-squirrel", name: "Peanut the Squirrel" },
  { symbol: "GOAT", cgId: "goatseus-maximus", name: "Goatseus Maximus" },
  { symbol: "ORDI", cgId: "ordi", name: "ORDI" },
  { symbol: "SATS", cgId: "sats-ordinals", name: "SATS" },
  { symbol: "RUNE", cgId: "thorchain", name: "THORChain" },
  { symbol: "KAS", cgId: "kaspa", name: "Kaspa" },
  { symbol: "XMR", cgId: "monero", name: "Monero" },
  { symbol: "ROSE", cgId: "oasis-network", name: "Oasis Network" },
  { symbol: "WAXP", cgId: "wax", name: "WAX" },
  { symbol: "KSM", cgId: "kusama", name: "Kusama" },
  { symbol: "ONE", cgId: "harmony", name: "Harmony" },
  { symbol: "QTUM", cgId: "qtum", name: "Qtum" },
  { symbol: "ICX", cgId: "icon", name: "ICON" },
  { symbol: "DCR", cgId: "decred", name: "Decred" },
  { symbol: "ZEN", cgId: "zencash", name: "Horizen" },
  { symbol: "XEM", cgId: "nem", name: "NEM" },
  { symbol: "LSK", cgId: "lisk", name: "Lisk" },
  { symbol: "NANO", cgId: "nano", name: "Nano" },
  { symbol: "DGB", cgId: "digibyte", name: "DigiByte" },
  { symbol: "STEEM", cgId: "steem", name: "Steem" },
  { symbol: "AR", cgId: "arweave", name: "Arweave" },
  { symbol: "KDA", cgId: "kadena", name: "Kadena" },
  { symbol: "MINA", cgId: "mina-protocol", name: "Mina" },
  { symbol: "SSV", cgId: "ssv-network", name: "SSV Network" },
  { symbol: "LPT", cgId: "livepeer", name: "Livepeer" },
  { symbol: "AUDIO", cgId: "audius", name: "Audius" },
  { symbol: "RLC", cgId: "iexec-rlc", name: "iExec RLC" },
  { symbol: "OXT", cgId: "orchid-protocol", name: "Orchid" },
  { symbol: "NMR", cgId: "numeraire", name: "Numeraire" },
  { symbol: "COTI", cgId: "coti", name: "COTI" },
  { symbol: "DENT", cgId: "dent", name: "Dent" },
  { symbol: "ARPA", cgId: "arpa", name: "ARPA" },
  { symbol: "MDT", cgId: "measurable-data-token", name: "Measurable Data Token" },
  { symbol: "PUNDIX", cgId: "pundi-x-2", name: "Pundi X" },
  { symbol: "C98", cgId: "coin98", name: "Coin98" },
  { symbol: "LINA", cgId: "linear", name: "Linear" },
  { symbol: "ALPHA", cgId: "alpha-finance", name: "Stella" },
  { symbol: "REEF", cgId: "reef", name: "Reef" },
  { symbol: "DODO", cgId: "dodo", name: "DODO" },
  { symbol: "BAKE", cgId: "bakerytoken", name: "BakerySwap" },
  { symbol: "CAKE", cgId: "pancakeswap-token", name: "PancakeSwap" },
  { symbol: "GMX", cgId: "gmx", name: "GMX" },
  { symbol: "SNX", cgId: "havven", name: "Synthetix" },
  { symbol: "KSM", cgId: "kusama", name: "Kusama" },
  { symbol: "LUNC", cgId: "terra-luna", name: "Terra Classic" },
  { symbol: "LUNA", cgId: "terra-luna-2", name: "Terra" },
  { symbol: "OSMO", cgId: "osmosis", name: "Osmosis" },
  { symbol: "XEC", cgId: "ecash", name: "eCash" },
  { symbol: "CFX", cgId: "conflux-token", name: "Conflux" },
  { symbol: "KLAY", cgId: "klay-token", name: "Kaia" },
  { symbol: "GNO", cgId: "gnosis", name: "Gnosis" },
  { symbol: "SAFE", cgId: "safe", name: "Safe" },
  { symbol: "CSPR", cgId: "casper-network", name: "Casper" },
  { symbol: "WEMIX", cgId: "wemix-token", name: "WEMIX" },
  { symbol: "XDC", cgId: "xdce-crowd-sale", name: "XDC Network" },
  { symbol: "ELF", cgId: "aelf", name: "aelf" },
  { symbol: "GAS", cgId: "gas", name: "Gas" },
  { symbol: "VTHO", cgId: "vethor-token", name: "VeThor" },
  { symbol: "SXP", cgId: "swipe", name: "Solar" },
  { symbol: "WIN", cgId: "wink", name: "WINkLink" },
  { symbol: "SUN", cgId: "sun-token", name: "Sun" },
  { symbol: "BTT", cgId: "bittorrent", name: "BitTorrent" },
  { symbol: "GMT", cgId: "stepn", name: "STEPN" },
  { symbol: "ACH", cgId: "alchemy-pay", name: "Alchemy Pay" },
  { symbol: "CELR", cgId: "celer-network", name: "Celer Network" },
  { symbol: "CRO", cgId: "crypto-com-chain", name: "Cronos" },
  { symbol: "OKB", cgId: "okb", name: "OKB" },
  { symbol: "BGB", cgId: "bitget-token", name: "Bitget Token" },
  { symbol: "GT", cgId: "gatechain-token", name: "GateToken" },
  { symbol: "LEO", cgId: "leo-token", name: "UNUS SED LEO" },
  { symbol: "USDT", cgId: "tether", name: "Tether" },
  { symbol: "DAI", cgId: "dai", name: "Dai" },
  { symbol: "FDUSD", cgId: "first-digital-usd", name: "First Digital USD" },
  { symbol: "PYUSD", cgId: "paypal-usd", name: "PayPal USD" },
];

const COINS: CoinDef[] = Array.from(
  [...BASE_COINS, ...REVOLUT_UK_CANDIDATES]
    .reduce((acc, coin) => {
      const key = coin.symbol.toUpperCase();
      if (!acc.has(key)) acc.set(key, { ...coin, symbol: key });
      return acc;
    }, new Map<string, CoinDef>())
    .values()
);

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [overrideGuard, setOverrideGuard] = useState(false);
  const [proPass, setProPass] = useState(() => loadProPass());
  const [leadEmail, setLeadEmail] = useState("");
  const [leadSaved, setLeadSaved] = useState(false);
  const [aiAdvisor, setAiAdvisor] = useState<AiAdvisorResponse | null>(null);
  const [aiAdvisorLoading, setAiAdvisorLoading] = useState(false);
  const [aiAdvisorError, setAiAdvisorError] = useState<string | null>(null);
  const [aiSignals, setAiSignals] = useState<AiSignalRecord[]>(() => loadAiSignals());
  const [liveNewsMode, setLiveNewsMode] = useState(false);

  const [, setClockTick] = useState(0);

  const [market, setMarket] = useState<MarketRow[]>([]);
  const [microMap, setMicroMap] = useState<MicroMap>({});
  const [priceHistoryMap, setPriceHistoryMap] = useState<PriceHistoryMap>({});
  const [structMap, setStructMap] = useState<Record<string, StructureResult>>({});

  const [focusSymbol, setFocusSymbol] = useState<string>("SOL");

  // Risk / sizing
  const [accountUsd, setAccountUsd] = useState(1000);
  const [riskPct, setRiskPct] = useState(2);
  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [stopPrice, setStopPrice] = useState<number>(0);
  const [simState, setSimState] = useState<SimState>(() => loadSimState());
  const [goalPlan, setGoalPlan] = useState<GoalPlan | null>(() => loadGoalPlan());
  const [goalPlanDraft, setGoalPlanDraft] = useState<GoalPlanDraft>(() => {
    const active = loadGoalPlan();
    if (active) {
      const { goalName, targetReturnPct, targetPeriod, startingEquityUsd, maxDailyLossPct, maxTradesPerDay, maxOpenPositions, riskPerTradePct, minConfidence, notes } = active;
      return { goalName, targetReturnPct, targetPeriod, startingEquityUsd, maxDailyLossPct, maxTradesPerDay, maxOpenPositions, riskPerTradePct, minConfidence, notes };
    }
    return defaultGoalPlanDraft(loadSimState().startingCashUsd);
  });
  const [goalPlanInputText, setGoalPlanInputText] = useState<Record<GoalPlanNumberKey, string>>(() => goalPlanNumberText(goalPlanDraft));
  const [goalRiskAccepted, setGoalRiskAccepted] = useState(false);
  const [simSymbol, setSimSymbol] = useState("SOL");
  const [simTradeMode, setSimTradeMode] = useState<SimTradeMode>("SCALP");
  const [simCoinSearch, setSimCoinSearch] = useState("");
  const [simBuyUsd, setSimBuyUsd] = useState("250");
  const [simStopLossInput, setSimStopLossInput] = useState("");
  const [simTakeProfitInput, setSimTakeProfitInput] = useState("");
  const [simThesis, setSimThesis] = useState("");

  // Trade logging modal state
  const [logOpen, setLogOpen] = useState(false);
  const [logSide, setLogSide] = useState<TradeSide>("LONG");
  const [logEntry, setLogEntry] = useState<number>(0);
  const [logStop, setLogStop] = useState<number>(0);
  const [logExit, setLogExit] = useState<number>(0);
  const [logRulesFollowed, setLogRulesFollowed] = useState(true);
  const [logNote, setLogNote] = useState("");

  const todayKey = dayKeyLocal(new Date());
  const [commit, setCommit] = useState<CommitConfig | null>(() => loadCommit(dayKeyLocal(new Date())));
  const [dayState, setDayState] = useState<DayState>(() => loadDayState(dayKeyLocal(new Date())));

  // Roll over daily state automatically
  useEffect(() => {
    const dk = dayKeyLocal(new Date());
    if (dayState.dayKey !== dk) {
      setDayState(loadDayState(dk));
      setCommit(loadCommit(dk));
      setOverrideGuard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey]);

  useEffect(() => saveDayState(dayState), [dayState]);
  useEffect(() => saveSimState(simState), [simState]);
  useEffect(() => saveGoalPlan(goalPlan), [goalPlan]);
  useEffect(() => saveAiSignals(aiSignals), [aiSignals]);

  useInterval(() => setClockTick((x) => x + 1), 1000);

  const localTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sessionInfo = computeSession(new Date());

  const coinIds = useMemo(() => COINS.map((c) => c.cgId).filter(Boolean) as string[], []);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchCoinGeckoMarketsBatched(coinIds);
      const byId = new Map(rows.map((r) => [r.id, r]));

      const merged: MarketRow[] = COINS.map((c) => {
        const r = c.cgId ? byId.get(c.cgId) : undefined;
        return {
          symbol: c.symbol.toUpperCase(),
          cgId: c.cgId,
          name: c.name ?? r?.name,
          priceUsd: r?.current_price,
          change24h: typeof r?.price_change_percentage_24h === "number" ? r!.price_change_percentage_24h : undefined,
          volume24hUsd: typeof r?.total_volume === "number" ? r!.total_volume : undefined,
        };
      });

      setMarket(merged);
      setLastUpdated(Date.now());

      // Autofill entry/stop if not set yet
      const picked = merged.find((m) => m.symbol === focusSymbol);
      if (picked?.priceUsd && entryPrice === 0) setEntryPrice(picked.priceUsd);
      if (picked?.priceUsd && stopPrice === 0) setStopPrice(picked.priceUsd * 0.985);

      // ---- Baseline vol median (for scoring) ----
      const baselineVolTemp = (() => {
        const vols = merged
          .map((m) => m.volume24hUsd ?? 0)
          .filter((v) => v > 0)
          .sort((a, b) => a - b);
        return vols.length ? vols[Math.floor(vols.length / 2)] : 1;
      })();

      // Rank top candidates (limit work: <= 10)
      const rankedTemp = merged
        .map((m) => {
          const s = scoreSetup(m, baselineVolTemp);
          return { symbol: m.symbol, cgId: m.cgId, combined: s.combinedScore };
        })
        .filter((x) => !!x.cgId)
        .sort((a, b) => b.combined - a.combined)
        .slice(0, 10);

      const scalpRankedTemp = merged
        .map((m) => {
          const vol = m.volume24hUsd ?? 0;
          const volFactor = baselineVolTemp > 0 ? vol / baselineVolTemp : 1;
          const ch = m.change24h ?? 0;
          const scalpPriority = Math.max(0, ch) * 7 + Math.log10(Math.max(1, volFactor)) * 28;
          return { symbol: m.symbol, cgId: m.cgId, scalpPriority };
        })
        .filter((x) => !!x.cgId && x.scalpPriority > 8)
        .sort((a, b) => b.scalpPriority - a.scalpPriority)
        .slice(0, 14);

      // ---- Phase 2B: micro entry-quality (CoinGecko hourly)
      try {
        const pairs = await Promise.all(
          rankedTemp.map(async (x) => {
            const prices = await fetchCoinGeckoHourly24h(x.cgId!);
            return [x.symbol, computeMicro(prices), prices] as const;
          })
        );
        const next: MicroMap = {};
        const nextHistory: PriceHistoryMap = {};
        for (const [sym, metrics, prices] of pairs) {
          next[sym] = metrics;
          nextHistory[sym] = prices;
        }
        setMicroMap((prev) => ({ ...prev, ...next }));
        setPriceHistoryMap((prev) => ({ ...prev, ...nextHistory }));
      } catch {
        // keep previous microMap if chart calls fail
      }

      // ---- Quick scalp micro refresh: prioritize fresh 1h/4h acceleration for fast movers
      try {
        const scalpTargets = scalpRankedTemp.filter((x) => !rankedTemp.some((r) => r.symbol === x.symbol)).slice(0, 8);
        const scalpPairs = await Promise.all(
          scalpTargets.map(async (x) => {
            const prices = await fetchCoinGeckoHourly24h(x.cgId!);
            return [x.symbol, computeMicro(prices), prices] as const;
          })
        );
        const next: MicroMap = {};
        const nextHistory: PriceHistoryMap = {};
        for (const [sym, metrics, prices] of scalpPairs) {
          next[sym] = metrics;
          nextHistory[sym] = prices;
        }
        setMicroMap((prev) => ({ ...prev, ...next }));
        setPriceHistoryMap((prev) => ({ ...prev, ...nextHistory }));
      } catch {
        // keep previous scalp micro data if chart calls fail
      }

      // ---- Phase 3: structure engine (Coinbase 1h) for TOP candidates only
      try {
        const structPairs = await Promise.all(
          rankedTemp.map(async (x) => {
            const price = merged.find((mm) => mm.symbol === x.symbol)?.priceUsd;
            if (!price || !isFinite(price)) {
              return [
                x.symbol,
                { ok: false, label: "WAIT", reasons: ["No price for structure calc."], source: "MISSING" } as StructureResult,
              ] as const;
            }

            try {
              const candles = await fetchCoinbase1hCandles(x.symbol, 240);

              const levels = computePivotLevels1h(candles);
              const res = evaluateStructure(price, levels);
              return [x.symbol, res] as const;
            } catch {
              return [
                x.symbol,
                {
                  ok: false,
                  label: "WAIT",
                  reasons: ["Structure unavailable (Coinbase pair missing)."],
                  source: "MISSING",
                } as StructureResult,
              ] as const;
            }
          })
        );

        const nextStruct: Record<string, StructureResult> = {};
        for (const [sym, res] of structPairs) nextStruct[sym] = res;
        setStructMap((prev) => ({ ...prev, ...nextStruct }));
      } catch {
        // keep previous structMap
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to fetch market data."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(() => {
    if (autoRefresh) refresh();
  }, autoRefresh ? MARKET_REFRESH_MS : null);

  useEffect(() => {
    if (!simSymbol || priceHistoryMap[simSymbol]?.length) return;
    const coin = COINS.find((c) => c.symbol.toUpperCase() === simSymbol);
    if (!coin?.cgId) return;

    let cancelled = false;
    fetchCoinGeckoHourly24h(coin.cgId)
      .then((prices) => {
        if (cancelled || prices.length < 2) return;
        setPriceHistoryMap((prev) => ({ ...prev, [simSymbol]: prices }));
        setMicroMap((prev) => ({ ...prev, [simSymbol]: computeMicro(prices) }));
      })
      .catch(() => {
        // Chart is opportunistic; keep the rest of the simulator usable if this call fails.
      });

    return () => {
      cancelled = true;
    };
  }, [priceHistoryMap, simSymbol]);

  const commitRequired = !commit || commit.dayKey !== todayKey;

  // Metrics
  const tradesToday = dayState.trades.length;
  const rToday = useMemo(
    () => dayState.trades.reduce((acc, t) => acc + (isFinite(t.r) ? t.r : 0), 0),
    [dayState.trades]
  );
  const consecutiveLosses = useMemo(() => {
    let c = 0;
    for (let i = dayState.trades.length - 1; i >= 0; i--) {
      if (dayState.trades[i].r < 0) c++;
      else break;
    }
    return c;
  }, [dayState.trades]);

  // Allowed sessions from commitment
  const sessionAllowedByCommit = useMemo(() => {
    if (!commit) return false;
    const s = sessionInfo.session;
    if (s === "ASIA") return commit.allowAsia;
    if (s === "EUROPE") return commit.allowEurope;
    if (s === "US") return commit.allowUS;
    if (s === "EUROPE + US OVERLAP") return commit.allowOverlap;
    if (s === "US WEEKEND") return true;
    return commit.allowOffPeak;
  }, [commit, sessionInfo.session]);

  // Trade allowed logic:
  const tradingAllowed = useMemo(() => {
    if (commitRequired) return false;
    if (dayState.locked && !overrideGuard) return false;

    const waitBlocks = sessionInfo.status === "WAIT" && !overrideGuard;
    const commitBlocks = !sessionAllowedByCommit && !overrideGuard;

    if (waitBlocks) return false;
    if (commitBlocks) return false;

    return true;
  }, [commitRequired, dayState.locked, sessionInfo.status, overrideGuard, sessionAllowedByCommit]);

  // Auto-lock when limits hit
  useEffect(() => {
    if (commitRequired) return;
    if (dayState.locked) return;
    if (!commit) return;

    if (tradesToday >= commit.maxTrades) {
      setDayState((s) => ({ ...s, locked: true, lockedReason: `Max trades reached (${commit.maxTrades}). Session complete.` }));
      return;
    }

    if (rToday <= -Math.abs(commit.maxDailyLossR)) {
      setDayState((s) => ({
        ...s,
        locked: true,
        lockedReason: `Daily loss limit hit (${fmtR(rToday)} ≤ -${Math.abs(commit.maxDailyLossR)}R). Stop trading.`,
      }));
      return;
    }

    if (consecutiveLosses >= commit.maxConsecutiveLosses) {
      setDayState((s) => ({
        ...s,
        locked: true,
        lockedReason: `Consecutive losses hit (${consecutiveLosses}). Stop trading.`,
      }));
      return;
    }
  }, [commitRequired, dayState.locked, commit, tradesToday, rToday, consecutiveLosses]);

  // Sync calculator risk % from commitment
  useEffect(() => {
    if (commit && commit.dayKey === todayKey) setRiskPct(commit.riskPct);
  }, [commit, todayKey]);

  // Search filter
  const marketUniverse = useMemo<MarketRow[]>(
    () =>
      market.length
        ? market
        : COINS.map((c) => ({
            symbol: c.symbol.toUpperCase(),
            cgId: c.cgId,
            name: c.name,
          })),
    [market]
  );
  const universeStats = useMemo(() => {
    const live = marketUniverse.filter((m) => typeof m.priceUsd === "number" && isFinite(m.priceUsd)).length;
    const missing = Math.max(0, COINS.length - live);
    return { total: COINS.length, live, missing };
  }, [marketUniverse]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return marketUniverse;
    return marketUniverse.filter(
      (m) => (m.symbol ?? "").toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q)
    );
  }, [marketUniverse, query]);

  const baselineVol = useMemo(() => {
    const vols = filteredMarket
      .map((m) => m.volume24hUsd ?? 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (!vols.length) return 0;
    return vols[Math.floor(vols.length / 2)];
  }, [filteredMarket]);

  const setups = useMemo<SetupRow[]>(() => {
    return filteredMarket
      .map((m) => {
        const s = scoreSetup(m, baselineVol || 1);
        const micro = microMap[m.symbol];
        const st = structMap[m.symbol];

        return {
          symbol: m.symbol,
          priceUsd: m.priceUsd,
          change24h: m.change24h,
          combinedScore: s.combinedScore,
          score15m: s.score15m,
          score1h: s.score1h,
          volFactor: s.volFactor,
          why: s.why,

          entryQuality: micro?.entryQuality ?? "VALID",
          whyNot: micro?.whyNot ?? [],
          ret1h: micro?.ret1h,
          ret4h: micro?.ret4h,
          dropFromHigh6h: micro?.dropFromHigh6h,
          spikeFromLow6h: micro?.spikeFromLow6h,

          structureLabel: st?.label ?? "WAIT",
          structureWhy: st?.reasons ?? (st ? [] : ["Structure not loaded yet."]),
          support: st?.support,
          resistance: st?.resistance,
          roomTo2R: st?.roomTo2R,
          structureSource: st?.source ?? "MISSING",
        };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }, [filteredMarket, baselineVol, microMap, structMap]);

  // Strict: best list only includes VALID entry-quality AND Structure OK
  const scannerBest = useMemo(
    () =>
      setups
        .filter((s) => s.entryQuality === "VALID")
        .filter((s) => s.structureLabel === "OK")
        .filter((s) => s.combinedScore >= 70 && s.score1h >= 65 && s.volFactor >= 1.3)
        .slice(0, 8),
    [setups]
  );

  const bestSetup = scannerBest[0] ?? setups[0];

  const blockedSetups = useMemo(
    () => setups.filter((s) => s.entryQuality !== "VALID" || s.structureLabel !== "OK"),
    [setups]
  );
  const watchlistHealth = useMemo(() => {
    const tradable = scannerBest.length;
    const scanned = setups.length;
    const blocked = blockedSetups.length;
    const avgScore = scanned ? setups.reduce((acc, s) => acc + s.combinedScore, 0) / scanned : 0;
    return { tradable, scanned, blocked, avgScore };
  }, [blockedSetups.length, scannerBest.length, setups]);
  const edgeGrade = useMemo(() => {
    if (scannerBest.length >= 3) return { label: "HOT", color: "#047857", note: "Multiple strict candidates. Pick one, size small." };
    if (scannerBest.length >= 1) return { label: "SELECTIVE", color: "#111827", note: "One or two candidates. Demand clean execution." };
    return { label: "COLD", color: "#b91c1c", note: "No strict edge. Waiting is the trade." };
  }, [scannerBest.length]);

  // Position sizing / TP SL
  const riskAmount = useMemo(() => (accountUsd * riskPct) / 100, [accountUsd, riskPct]);
  const stopDistanceLong = useMemo(() => Math.max(0, entryPrice - stopPrice), [entryPrice, stopPrice]);
  const stopDistanceShort = useMemo(() => Math.max(0, stopPrice - entryPrice), [entryPrice, stopPrice]);
  const positionSizeLong = useMemo(
    () => (stopDistanceLong <= 0 ? 0 : riskAmount / stopDistanceLong),
    [riskAmount, stopDistanceLong]
  );
  const positionSizeShort = useMemo(
    () => (stopDistanceShort <= 0 ? 0 : riskAmount / stopDistanceShort),
    [riskAmount, stopDistanceShort]
  );

  const tp1Long = useMemo(() => (stopDistanceLong > 0 ? entryPrice + stopDistanceLong * 1 : 0), [entryPrice, stopDistanceLong]);
  const tp2Long = useMemo(() => (stopDistanceLong > 0 ? entryPrice + stopDistanceLong * 2 : 0), [entryPrice, stopDistanceLong]);
  const tp1Short = useMemo(() => (stopDistanceShort > 0 ? entryPrice - stopDistanceShort * 1 : 0), [entryPrice, stopDistanceShort]);
  const tp2Short = useMemo(() => (stopDistanceShort > 0 ? entryPrice - stopDistanceShort * 2 : 0), [entryPrice, stopDistanceShort]);

  const getSimPrice = useCallback((symbol: string) => {
    const live = market.find((m) => m.symbol === symbol)?.priceUsd;
    if (typeof live === "number" && isFinite(live)) return live;
    if (symbol === focusSymbol && entryPrice > 0) return entryPrice;
    return 0;
  }, [entryPrice, focusSymbol, market]);

  const simSelectedSetup = setups.find((s) => s.symbol === simSymbol);
  const simulatorPrice = getSimPrice(simSymbol) || simSelectedSetup?.priceUsd || 0;
  const selectedPriceHistory = priceHistoryMap[simSymbol] ?? [];
  const simCanBuySelected = simulatorPrice > 0 && isFinite(simulatorPrice);
  const simStopLoss = Number(simStopLossInput);
  const simTakeProfit = Number(simTakeProfitInput);
  const simStopLossValid = simCanBuySelected && Number.isFinite(simStopLoss) && simStopLoss > 0 && simStopLoss < simulatorPrice;
  const simTakeProfitValid = simCanBuySelected && Number.isFinite(simTakeProfit) && simTakeProfit > simulatorPrice;
  const simPlannedLossPct = simStopLossValid ? ((simulatorPrice - simStopLoss) / simulatorPrice) * 100 : 0;
  const simPlannedGainPct = simTakeProfitValid ? ((simTakeProfit - simulatorPrice) / simulatorPrice) * 100 : 0;
  const simRewardRisk = simPlannedLossPct > 0 && simPlannedGainPct > 0 ? simPlannedGainPct / simPlannedLossPct : 0;
  const scalpSignals = useMemo<ScalpSignal[]>(() => {
    return setups
      .map((s) => {
        const price = getSimPrice(s.symbol) || s.priceUsd || 0;
        const ch24 = s.change24h ?? 0;
        const hasMicro = typeof s.ret1h === "number" && typeof s.ret4h === "number";
        const fastMove = typeof s.ret1h === "number" ? s.ret1h : ch24 * 0.16;
        const move4h = typeof s.ret4h === "number" ? s.ret4h : ch24 * 0.38;
        const acceleration = fastMove - move4h / 4;
        const volumeScore = clamp(Math.log10(Math.max(1, s.volFactor)) * 36 + 42, 0, 100);
        const momentumScore = clamp(42 + fastMove * 17 + acceleration * 14 + Math.max(0, move4h) * 3 + Math.max(0, ch24) * 0.9, 0, 100);
        const liquidityOk = s.volFactor >= 1.15 && price > 0;
        const spike6h = s.spikeFromLow6h ?? Math.max(0, move4h);
        const dropFromHigh = s.dropFromHigh6h ?? 0;
        const latestWeak = hasMicro && fastMove <= 0;
        const stalling = hasMicro && fastMove < 0.18 && acceleration <= 0.28;
        const rollingOver = latestWeak || (dropFromHigh <= -1.2 && acceleration <= 0.28) || (spike6h >= 5 && stalling);
        const continuationOk = hasMicro && fastMove > 0.18 && acceleration > 0.05 && dropFromHigh > -1.8;
        const peakRiskScore = Math.round(clamp(
          spike6h * 6 +
            Math.max(0, ch24 - 12) * 3 +
            Math.max(0, -acceleration) * 18 +
            Math.max(0, -dropFromHigh - 1.5) * 8 +
            (rollingOver ? 30 : 0) +
            (latestWeak ? 18 : 0),
          0,
          100
        ));
        const legsScore = Math.round(clamp(
          58 +
            acceleration * 18 +
            Math.max(0, fastMove) * 8 +
            Math.max(0, move4h) * 2 -
            peakRiskScore * 0.55 +
            (liquidityOk ? 8 : -10) -
            (rollingOver ? 24 : 0) -
            (latestWeak ? 16 : 0),
          0,
          100
        ));
        const peakRisk = peakRiskScore >= 58 || (spike6h >= 8 && acceleration <= 0.15);
        const tooLate = peakRisk || rollingOver || (s.spikeFromLow6h ?? 0) >= 11 || (fastMove >= 4.2 && acceleration <= 0) || ch24 >= 24;
        const dumpRisk = (s.dropFromHigh6h ?? 0) <= -3.2 || fastMove <= -1.4 || ch24 <= -5;
        const earlyBurst = hasMicro && !rollingOver && fastMove >= 0.35 && acceleration > 0.08 && spike6h < 8 && legsScore >= 55;
        const warming = hasMicro && !rollingOver && fastMove >= 0.1 && acceleration > 0 && move4h > 0;
        const structurePenalty = s.structureLabel === "NO_EDGE" ? 18 : s.structureLabel === "WAIT" ? 8 : 0;
        const freshnessBonus = hasMicro ? 10 : -8;
        const burstScore = Math.round(clamp(momentumScore * 0.58 + volumeScore * 0.25 + legsScore * 0.17 + (earlyBurst ? 12 : warming ? 6 : 0) + freshnessBonus - (tooLate ? 30 : 0) - (dumpRisk ? 22 : 0) - structurePenalty, 0, 100));
        const stopPct = clamp(Math.max(0.45, Math.min(1.55, Math.abs(fastMove) * 0.18 + Math.abs(move4h) * 0.045)), 0.45, 1.55);
        const targetPct = clamp(stopPct * (earlyBurst ? 2.05 : tooLate ? 1.1 : 1.65), 0.85, 3.4);
        const stop = price ? price * (1 - stopPct / 100) : 0;
        const target = price ? price * (1 + targetPct / 100) : 0;
        const action: ScalpSignal["action"] = !liquidityOk ? "NO_LIQUIDITY" : tooLate ? "TOO_LATE" : burstScore >= 68 && legsScore >= 55 && continuationOk && (earlyBurst || fastMove > 0.25) ? "SCALP_TEST" : burstScore >= 54 || warming ? "WATCH" : "NO_LIQUIDITY";
        const tone = action === "SCALP_TEST" ? "#047857" : action === "TOO_LATE" ? "#b91c1c" : "#92400e";
        const speedLabel = hasMicro ? (rollingOver ? "FADING" : earlyBurst ? "EARLY BURST" : continuationOk ? "ACCELERATING" : "WATCHING") : "NEEDS MICRO";
        const legsLabel = peakRiskScore >= 58 ? "PEAK RISK" : legsScore >= 70 && continuationOk ? "HAS LEGS" : legsScore >= 50 && !rollingOver ? "MAYBE LEGS" : "NO LEGS";
        const holdWindow = action === "SCALP_TEST" ? (earlyBurst ? "2 to 12 minutes. Take profit fast or trail manually." : "3 to 20 minutes, exit at stop/target or if momentum fades.") : "Wait for a cleaner burst; do not force entry.";
        const suggestedUsd = action === "SCALP_TEST" ? Math.max(25, Math.min(simState.cashUsd, Math.round(simState.cashUsd * (earlyBurst ? 0.07 : 0.05)), earlyBurst ? 140 : 100)) : 0;
        const reasons = [
          `Burst score ${burstScore}/100`,
          hasMicro ? `1h ${fastMove >= 0 ? "+" : ""}${fastMove.toFixed(2)}%` : `24h proxy ${fastMove >= 0 ? "+" : ""}${fastMove.toFixed(2)}%`,
          `Accel ${acceleration >= 0 ? "+" : ""}${acceleration.toFixed(2)}`,
          `Legs ${legsScore}/100`,
          `Volume ${s.volFactor.toFixed(2)}x baseline`,
        ];
        const warnings: string[] = [];
        if (!hasMicro) warnings.push("Waiting for fresh hourly micro data; advice may lag.");
        if (latestWeak) warnings.push("Latest 1h is red; wait for reclaim before entering.");
        if (rollingOver && !latestWeak) warnings.push("Rolling over from recent high; do not buy the first red turn.");
        if (peakRisk) warnings.push(`Peak risk: +${spike6h.toFixed(2)}% from 6h low with limited fresh acceleration.`);
        if (tooLate && !peakRisk) warnings.push("Move looks extended or momentum is fading; likely late chase risk.");
        if (dumpRisk) warnings.push("Recent pullback/dump risk or fast 1h weakness is active.");
        if (!liquidityOk) warnings.push("Not enough live price/volume confirmation for quick scalp.");
        if (s.structureLabel === "NO_EDGE") warnings.push("Structure engine says no clean edge.");
        return { symbol: s.symbol, price, burstScore, legsScore, peakRiskScore, action, tone, speedLabel, legsLabel, stop, target, holdWindow, suggestedUsd, reasons, warnings, setup: s };
      })
      .filter((s) => s.price > 0)
      .sort((a, b) => b.burstScore - a.burstScore)
      .slice(0, 12);
  }, [getSimPrice, setups, simState.cashUsd]);
  const selectedScalpSignal = scalpSignals.find((s) => s.symbol === simSymbol);
  const scalpModeCanBuy = simTradeMode === "SCALP" && selectedScalpSignal?.action === "SCALP_TEST";
  const scalpSignalBySymbol = useMemo(() => new Map(scalpSignals.map((s) => [s.symbol, s])), [scalpSignals]);
  const simCoinChoices = useMemo(() => {
    const q = simCoinSearch.trim().toLowerCase();
    const base = setups.length ? setups : COINS.map((c) => ({
      symbol: c.symbol,
      priceUsd: undefined,
      change24h: undefined,
      combinedScore: 0,
      score15m: 0,
      score1h: 0,
      volFactor: 0,
      why: [],
      entryQuality: "VALID" as const,
      whyNot: [],
      structureLabel: "WAIT" as const,
      structureWhy: ["Live scanner data loading."],
      structureSource: "MISSING" as const,
    }));
    return base.filter((s) => !q || s.symbol.toLowerCase().includes(q));
  }, [setups, simCoinSearch]);
  const simOpenPnl = simState.positions.reduce((acc, p) => {
    const price = getSimPrice(p.symbol) || p.entry;
    const pnl = (price - p.entry) * p.qty;
    return acc + pnl;
  }, 0);
  const simEquity = simState.cashUsd + simState.positions.reduce((acc, p) => acc + p.notionalUsd, 0) + simOpenPnl;
  const simRealizedPnl = simState.history.reduce((acc, t) => acc + t.pnlUsd, 0);
  const simReturnPct = ((simEquity - simState.startingCashUsd) / simState.startingCashUsd) * 100;
  const simElapsedDays = Math.max(0, (Date.now() - new Date(simState.startedAtIso).getTime()) / (24 * 60 * 60 * 1000));
  const simChallengeDay = Math.min(7, Math.floor(simElapsedDays) + 1);
  const simDaysLeft = Math.max(0, 7 - simElapsedDays);
  const simSelectedHolding = simState.positions.find((p) => p.symbol === simSymbol);
  const simScalpPositions = useMemo(
    () => simState.positions.filter((p) => p.mode === "SCALP" || p.source.startsWith("SCALP")),
    [simState.positions]
  );
  const simLongStudyPositions = useMemo(
    () => simState.positions.filter((p) => p.mode !== "SCALP" && !p.source.startsWith("SCALP")),
    [simState.positions]
  );
  const simSelectedHoldingPnl = simSelectedHolding
    ? ((getSimPrice(simSelectedHolding.symbol) || simSelectedHolding.entry) - simSelectedHolding.entry) * simSelectedHolding.qty
    : 0;
  const simStats = useMemo(() => {
    const wins = simState.history.filter((t) => t.pnlUsd > 0);
    const losses = simState.history.filter((t) => t.pnlUsd < 0);
    const winRate = simState.history.length ? (wins.length / simState.history.length) * 100 : 0;
    const avgWinPct = wins.length ? wins.reduce((acc, t) => acc + t.pnlPct, 0) / wins.length : 0;
    const avgLossPct = losses.length ? Math.abs(losses.reduce((acc, t) => acc + t.pnlPct, 0) / losses.length) : 0;
    const expectancyPct = simState.history.length ? simState.history.reduce((acc, t) => acc + t.pnlPct, 0) / simState.history.length : 0;
    const payoffRatio = avgLossPct > 0 ? avgWinPct / avgLossPct : avgWinPct > 0 ? 99 : 0;
    return { wins: wins.length, losses: losses.length, winRate, avgWinPct, avgLossPct, expectancyPct, payoffRatio };
  }, [simState.history]);
  const simScalpStats = useMemo(() => {
    const trades = simState.history.filter((t) => t.mode === "SCALP" || t.source.startsWith("SCALP"));
    const wins = trades.filter((t) => t.pnlUsd > 0).length;
    const pnlUsd = trades.reduce((acc, t) => acc + t.pnlUsd, 0);
    const winRate = trades.length ? (wins / trades.length) * 100 : 0;
    const expectancyPct = trades.length ? trades.reduce((acc, t) => acc + t.pnlPct, 0) / trades.length : 0;
    return { trades: trades.length, wins, pnlUsd, winRate, expectancyPct };
  }, [simState.history]);

  useEffect(() => {
    if (!simCanBuySelected || !simulatorPrice) return;
    const setupStop = simSelectedSetup?.support && simSelectedSetup.support < simulatorPrice ? simSelectedSetup.support : simulatorPrice * 0.985;
    const risk = Math.max(simulatorPrice - setupStop, simulatorPrice * 0.008);
    setSimStopLossInput((v) => (v.trim() ? v : setupStop.toPrecision(8)));
    setSimTakeProfitInput((v) => (v.trim() ? v : (simulatorPrice + risk * 2).toPrecision(8)));
  }, [simCanBuySelected, simSelectedSetup?.support, simSymbol, simulatorPrice]);

  useEffect(() => {
    setSimState((s) => {
      const closedAtIso = new Date().toISOString();
      const closed: SimClosedTrade[] = [];
      const positions: SimPosition[] = [];
      let cashToReturn = 0;

      for (const position of s.positions) {
        const price = getSimPrice(position.symbol);
        const hitStop = typeof position.stop === "number" && price > 0 && price <= position.stop;
        const hitTarget = typeof position.takeProfit === "number" && price > 0 && price >= position.takeProfit;

        if (!hitStop && !hitTarget) {
          positions.push(position);
          continue;
        }

        const pnlUsd = (price - position.entry) * position.qty;
        cashToReturn += position.notionalUsd + pnlUsd;
        closed.push({
          ...position,
          closedAtIso,
          exit: price,
          pnlUsd,
          pnlPct: (pnlUsd / position.notionalUsd) * 100,
          exitReason: hitStop ? "STOP_LOSS" : "TAKE_PROFIT",
        });
      }

      if (!closed.length) return s;
      return {
        ...s,
        cashUsd: s.cashUsd + cashToReturn,
        positions,
        history: [...closed, ...s.history].slice(0, 250),
      };
    });
  }, [getSimPrice, market]);

  const signalCalibration = useMemo(() => {
    const checked = aiSignals.map((s) => {
      const now = getSimPrice(s.symbol);
      const resultPct = now && s.entry ? ((now - s.entry) / s.entry) * 100 : s.resultPct;
      const verdict = typeof resultPct === "number" ? (resultPct > 0.35 ? "WIN" : resultPct < -0.35 ? "LOSS" : "OPEN") : (s.verdict ?? "OPEN");
      return { ...s, resultPct, verdict };
    });
    const resolved = checked.filter((s) => s.verdict === "WIN" || s.verdict === "LOSS");
    const wins = resolved.filter((s) => s.verdict === "WIN").length;
    const winRate = resolved.length ? (wins / resolved.length) * 100 : 0;
    const avgConfidence = resolved.length ? resolved.reduce((acc, s) => acc + s.confidence, 0) / resolved.length : 0;
    const confidenceGap = resolved.length ? avgConfidence - winRate : 0;
    const adjustment = resolved.length >= 5 ? clamp(-confidenceGap * 0.35, -16, 8) : simStats.expectancyPct < 0 ? -5 : 0;
    const buckets = [60, 70, 80, 90].map((floor) => {
      const bucket = resolved.filter((s) => s.confidence >= floor && s.confidence < floor + 10);
      const bucketWins = bucket.filter((s) => s.verdict === "WIN").length;
      return { floor, count: bucket.length, winRate: bucket.length ? (bucketWins / bucket.length) * 100 : 0 };
    });
    return { checked, resolved, wins, winRate, avgConfidence, confidenceGap, adjustment, buckets };
  }, [aiSignals, getSimPrice, simStats.expectancyPct]);

  const scannerReplay = useMemo(() => {
    const rows = setups
      .filter((s) => typeof s.priceUsd === "number")
      .slice(0, 24)
      .map((s) => {
        const micro = microMap[s.symbol];
        const strict = s.entryQuality === "VALID" && s.structureLabel === "OK" && s.combinedScore >= 70;
        const proxyReturnPct = micro?.ret4h ?? (s.change24h ?? 0) * 0.18;
        const afterCostsPct = proxyReturnPct - 0.28;
        const result = strict ? afterCostsPct : 0;
        return { symbol: s.symbol, strict, score: s.combinedScore, proxyReturnPct, afterCostsPct, result };
      });
    const trades = rows.filter((r) => r.strict);
    const wins = trades.filter((r) => r.result > 0).length;
    const winRate = trades.length ? (wins / trades.length) * 100 : 0;
    const expectancyPct = trades.length ? trades.reduce((acc, r) => acc + r.result, 0) / trades.length : 0;
    const best = [...trades].sort((a, b) => b.result - a.result)[0];
    const worst = [...trades].sort((a, b) => a.result - b.result)[0];
    return { rows, trades, wins, winRate, expectancyPct, best, worst };
  }, [microMap, setups]);

  const todaySimProgress = useMemo(() => {
    const realizedToday = simState.history
      .filter((t) => dayKeyLocal(new Date(t.closedAtIso)) === todayKey)
      .reduce((acc, t) => acc + t.pnlUsd, 0);
    const openToday = simState.positions
      .filter((p) => dayKeyLocal(new Date(p.openedAtIso)) === todayKey)
      .reduce((acc, p) => {
        const price = getSimPrice(p.symbol) || p.entry;
        return acc + (price - p.entry) * p.qty;
      }, 0);
    const pnlUsd = realizedToday + openToday;
    const basis = Math.max(100, simEquity - pnlUsd);
    return { basis, pnlUsd, realizedToday, openToday };
  }, [getSimPrice, simEquity, simState.history, simState.positions, todayKey]);

  const planProgress = useMemo(() => {
    const targetReturnPct = goalPlan?.targetReturnPct ?? 3;
    const isDailyPlan = (goalPlan?.targetPeriod ?? "day") === "day";
    const horizonDays = isDailyPlan ? 1 : Math.max(1, goalPlan?.horizonDays ?? 7);
    const maxDailyLossPct = goalPlan?.maxDailyLossPct ?? 1.5;
    const basis = isDailyPlan ? todaySimProgress.basis : goalPlan?.startingEquityUsd ?? simState.startingCashUsd;
    const targetUsd = basis * (targetReturnPct / 100);
    const maxLossUsd = basis * (maxDailyLossPct / 100);
    const pnlUsd = isDailyPlan ? todaySimProgress.pnlUsd : simEquity - simState.startingCashUsd;
    const progressPct = targetUsd > 0 ? clamp((pnlUsd / targetUsd) * 100, -100, 200) : 0;
    const lossUsedPct = maxLossUsd > 0 ? clamp((Math.max(0, -pnlUsd) / maxLossUsd) * 100, 0, 200) : 0;
    const dailyTargetUsd = targetUsd / horizonDays;
    const status =
      pnlUsd >= targetUsd
        ? "GOAL HIT"
        : -pnlUsd >= maxLossUsd
          ? "STOP HIT"
          : progressPct >= 70
            ? "NEAR GOAL"
            : "ACTIVE";
    return { targetReturnPct, horizonDays, maxDailyLossPct, basis, targetUsd, maxLossUsd, pnlUsd, progressPct, lossUsedPct, dailyTargetUsd, status, isDailyPlan };
  }, [goalPlan, simEquity, simState.startingCashUsd, todaySimProgress.basis, todaySimProgress.pnlUsd]);

  const advancedAi = useMemo(() => {
    const score = simSelectedSetup?.combinedScore ?? 0;
    const entryOk = simSelectedSetup?.entryQuality === "VALID";
    const structureOk = simSelectedSetup?.structureLabel === "OK";
    const hasPrice = simCanBuySelected;
    const minConfidence = goalPlan?.minConfidence ?? 70;
    const maxOpenPositions = goalPlan?.maxOpenPositions ?? 3;
    const maxDailyLossPct = goalPlan?.maxDailyLossPct ?? 3;
    const tradablePressure = watchlistHealth.scanned ? watchlistHealth.tradable / watchlistHealth.scanned : 0;
    const rawConfidence = clamp(
      Math.round(score * 0.46 + (entryOk ? 18 : -14) + (structureOk ? 20 : -18) + tradablePressure * 12 + (hasPrice ? 4 : 0)),
      0,
      100
    );
    const confidence = clamp(Math.round(rawConfidence + signalCalibration.adjustment), 0, 100);
    const marketRegime =
      watchlistHealth.tradable >= 3 && watchlistHealth.avgScore >= 62
        ? "MOMENTUM"
        : watchlistHealth.tradable >= 1
          ? "SELECTIVE"
          : "DEFENSIVE";
    const feeDragPct = 0.28;
    const structureBonus = structureOk ? 0.45 : -0.75;
    const entryBonus = entryOk ? 0.35 : -0.65;
    const scannerEdgePct = clamp((score - 62) * 0.055 + structureBonus + entryBonus - feeDragPct, -2.5, 4.5);
    const estimatedMovePct = clamp(Math.max(0.35, Math.abs(simSelectedSetup?.change24h ?? 0) * 0.18), 0.35, 3.6);
    const stopPct = clamp(estimatedMovePct * 0.55, 0.55, 2.4);
    const targetPct = clamp(stopPct * 2.05, 1.15, 5.5);
    const requiredWinRate = clamp((stopPct + feeDragPct) / (targetPct + stopPct) * 100, 18, 68);
    const drawdownPct = ((simEquity - simState.startingCashUsd) / simState.startingCashUsd) * 100;
    const riskState =
      drawdownPct <= -Math.abs(maxDailyLossPct)
        ? "RED"
        : drawdownPct <= -Math.abs(maxDailyLossPct) * 0.5 || simState.positions.length >= maxOpenPositions
          ? "YELLOW"
          : "GREEN";
    const baseRiskPctOfEquity = goalPlan?.riskPerTradePct ?? (confidence >= 82 ? 4 : confidence >= 72 ? 2.5 : 1);
    const riskPctOfEquity = riskState === "RED" ? 0 : riskState === "YELLOW" ? Math.min(baseRiskPctOfEquity, 1.25) : baseRiskPctOfEquity;
    const riskBudgetUsd = Math.round(simEquity * (riskPctOfEquity / 100));
    const maxTradeUsd = Math.max(0, Math.min(simState.cashUsd, riskBudgetUsd));
    const blockers: string[] = [];
    if (!goalPlan) blockers.push("No accepted goal plan yet. Create one in Plan before letting AI size trades.");
    if (planProgress.status === "GOAL HIT") blockers.push("Goal target already hit. Protect the result instead of forcing more trades.");
    if (planProgress.status === "STOP HIT") blockers.push("Plan loss cap is hit. Stop trading and review.");
    if (!hasPrice) blockers.push("No live price available for this coin.");
    if (!entryOk) blockers.push("Entry quality is not valid; avoid chasing or catching a fast dump.");
    if (!structureOk) blockers.push("Structure does not have a clean 2R map.");
    if (confidence < minConfidence) blockers.push(`AI confidence is below your plan minimum of ${minConfidence}%.`);
    if (riskState === "RED") blockers.push("Simulator drawdown guard is active; stop trading and review.");
    if (simState.positions.length >= maxOpenPositions) blockers.push(`Plan allows only ${maxOpenPositions} open sim holding${maxOpenPositions === 1 ? "" : "s"}.`);
    if (simSelectedHolding && simSelectedHoldingPnl < 0) blockers.push(`Already holding losing ${simSymbol}; do not average down.`);
    const shouldTrade = blockers.length === 0 && scannerEdgePct > 0.2;
    const executionRules = [
      goalPlan ? `${goalPlan.strategyProfile}: +${goalPlan.targetReturnPct.toFixed(2)}% per ${goalPlan.targetPeriod}` : "Create and accept a goal plan first",
      `Max sim size: ${fmtUsd(maxTradeUsd)}`,
      `Planned stop: ~${stopPct.toFixed(2)}%`,
      `Target: ~${targetPct.toFixed(2)}%`,
      `Required win rate: ${requiredWinRate.toFixed(0)}%+ after estimated costs`,
    ];
    return {
      confidence,
      rawConfidence,
      marketRegime,
      feeDragPct,
      scannerEdgePct,
      estimatedMovePct,
      stopPct,
      targetPct,
      requiredWinRate,
      riskState,
      riskPctOfEquity,
      riskBudgetUsd,
      maxTradeUsd,
      blockers,
      shouldTrade,
      executionRules,
    };
  }, [
    goalPlan,
    planProgress.status,
    simCanBuySelected,
    simEquity,
    simSelectedHolding,
    simSelectedHoldingPnl,
    simSelectedSetup,
    simState.cashUsd,
    simState.positions.length,
    simState.startingCashUsd,
    simSymbol,
    signalCalibration.adjustment,
    watchlistHealth.avgScore,
    watchlistHealth.scanned,
    watchlistHealth.tradable,
  ]);
  const aiTradeBrief = useMemo(() => {
    const entryOk = simSelectedSetup?.entryQuality === "VALID";
    const structureOk = simSelectedSetup?.structureLabel === "OK";
    const hasPrice = simCanBuySelected;
    const hasHolding = !!simSelectedHolding;
    const confidence = advancedAi.confidence;

    const reasons: string[] = [];
    if (!hasPrice) reasons.push("Waiting for live market price before simulation can buy.");
    if (entryOk) reasons.push("Entry quality is valid; no fast dump/chase flag active.");
    else reasons.push(`Entry quality is ${simSelectedSetup?.entryQuality ?? "loading"}; be careful with timing.`);
    if (structureOk) reasons.push("Structure check is OK with a cleaner 2R map.");
    else reasons.push(`Structure is ${simSelectedSetup?.structureLabel ?? "loading"}; treat as practice-only.`);
    reasons.push(`Market regime is ${advancedAi.marketRegime}; estimated edge is ${advancedAi.scannerEdgePct.toFixed(2)}% after estimated fees/slippage.`);
    if (hasHolding) reasons.push(`You already hold ${simSymbol}; review P/L before adding more.`);
    if (advancedAi.blockers.length) reasons.push(`Blockers: ${advancedAi.blockers.join(" ")}`);

    let action = "WAIT";
    let tone = "#111827";
    let headline = "Let the scanner finish loading";
    if (advancedAi.shouldTrade) {
      action = hasHolding ? "MANAGE" : "BUY TEST";
      tone = "#047857";
      headline = hasHolding ? "Manage the open position" : "Positive edge sim trade candidate";
    } else if (hasPrice && confidence >= 62 && advancedAi.riskState !== "RED") {
      action = "WATCH";
      headline = "Interesting, but blockers remain";
    } else if (hasPrice) {
      action = "SKIP";
      tone = "#b91c1c";
      headline = advancedAi.riskState === "RED" ? "Risk guard says stop trading" : "Weak edge for this coin right now";
    }

    const suggestedUsd = advancedAi.shouldTrade ? Math.max(25, Math.min(simState.cashUsd, advancedAi.maxTradeUsd)) : 0;
    return { action, confidence, headline, reasons, suggestedUsd, tone };
  }, [advancedAi, simCanBuySelected, simSelectedHolding, simSelectedSetup, simState.cashUsd, simSymbol]);
  const simBuyAllowed =
    simCanBuySelected &&
    simStopLossValid &&
    simTakeProfitValid;
  const simTradeWarningActive = simTradeMode === "SCALP" ? !scalpModeCanBuy : !advancedAi.shouldTrade;
  const simBuyBlocker =
    simTradeMode === "SCALP"
      ? selectedScalpSignal?.warnings[0] ?? "Quick scalp needs a SCALP TEST signal."
      : advancedAi.blockers[0] ?? "setup does not have enough estimated edge.";

  const aiAdvice = useMemo(() => {
    const candidate =
      scannerBest[0] ??
      setups.find((s) => s.entryQuality === "VALID" && s.structureLabel !== "NO_EDGE" && s.combinedScore >= 65) ??
      setups[0];
    const symbol = candidate?.symbol ?? simSymbol;
    const price = (candidate ? getSimPrice(candidate.symbol) || candidate.priceUsd : 0) || 0;
    const strict = !!candidate && scannerBest.some((s) => s.symbol === candidate.symbol);
    const validTiming = candidate?.entryQuality === "VALID";
    const validStructure = candidate?.structureLabel === "OK";
    const sessionOk = sessionInfo.status !== "WAIT" || overrideGuard;
    const confidence = clamp(
      Math.round((candidate?.combinedScore ?? 0) * 0.5 + (validTiming ? 18 : -12) + (validStructure ? 18 : -16) + (sessionOk ? 8 : -10)),
      0,
      100
    );
    const stopPctForAdvice = clamp(Math.max(0.55, Math.abs(candidate?.change24h ?? 0) * 0.12), 0.55, 2.2);
    const targetPctForAdvice = stopPctForAdvice * 2.1;
    const entryLow = price ? price * (1 - stopPctForAdvice * 0.25 / 100) : 0;
    const entryHigh = price ? price * (1 + stopPctForAdvice * 0.15 / 100) : 0;
    const stop = candidate?.support ?? (price ? price * (1 - stopPctForAdvice / 100) : 0);
    const target = candidate?.resistance ?? (price ? price * (1 + targetPctForAdvice / 100) : 0);
    const holdWindow =
      strict && confidence >= 78
        ? (candidate?.change24h ?? 0) >= 5
          ? "30 minutes to 3 hours, then reassess momentum."
          : "2 to 8 hours, unless target/stop hits first."
        : "Do not hold. Wait for a cleaner scanner pass.";
    const action =
      strict && sessionOk && confidence >= 78
        ? "BUY TEST"
        : validTiming && confidence >= 62
          ? "WAIT FOR CONFIRMATION"
          : "DO NOT BUY";
    const when =
      action === "BUY TEST"
        ? "Buy in the simulator only if price stays inside the entry zone and the scanner still says VALID + Structure OK."
        : action === "WAIT FOR CONFIRMATION"
          ? "Wait for Structure OK, confidence above 78%, and no fresh dump/chase warning."
          : "Skip it until the scanner produces a strict candidate.";
    const invalidation = [
      `Price loses stop area near ${fmtUsd(stop)}.`,
      "Entry quality flips away from VALID.",
      "Structure loses 2R room or turns NO EDGE.",
      "You already have 3 open holdings or hit your daily loss limit.",
    ];
    return {
      symbol,
      price,
      setup: candidate,
      action,
      when,
      holdWindow,
      entryLow,
      entryHigh,
      stop,
      target,
      confidence,
      invalidation,
      loadable: !!candidate,
    };
  }, [getSimPrice, overrideGuard, scannerBest, sessionInfo.status, setups, simSymbol]);

  const holdingReviews = useMemo(() => {
    const drawdownPct = ((simEquity - simState.startingCashUsd) / simState.startingCashUsd) * 100;
    const bestAlternative = scannerBest.find((s) => !simState.positions.some((p) => p.symbol === s.symbol));
    return simState.positions.map((p) => {
      const now = getSimPrice(p.symbol) || p.entry;
      const value = now * p.qty;
      const pnlUsd = (now - p.entry) * p.qty;
      const pnlPct = (pnlUsd / p.notionalUsd) * 100;
      const ageHours = Math.max(0, (Date.now() - new Date(p.openedAtIso).getTime()) / (60 * 60 * 1000));
      const setup = setups.find((s) => s.symbol === p.symbol);
      const strict = !!setup && setup.entryQuality === "VALID" && setup.structureLabel === "OK" && setup.combinedScore >= 70;
      const weakSetup = !setup || setup.entryQuality === "NO_EDGE" || setup.structureLabel === "NO_EDGE";
      const hitStop = typeof p.stop === "number" && now <= p.stop;
      const hitTarget = typeof p.takeProfit === "number" && now >= p.takeProfit;
      const isScalp = p.mode === "SCALP" || p.source.startsWith("SCALP");
      const canAdd =
        strict &&
        pnlPct > 0.35 &&
        pnlPct < 3.5 &&
        simState.cashUsd >= 50 &&
        simState.positions.length < 3 &&
        drawdownPct > -1.5;
      let action: "SELL" | "HOLD" | "INCREASE" = "HOLD";
      let tone = "#111827";
      const reasons: string[] = [];

      if (isScalp && ageHours >= 0.5 && pnlPct < 0.5) {
        action = "SELL";
        tone = "#b91c1c";
        reasons.push("Scalp has gone stale; close it while you are awake instead of letting it become a hold.");
      } else if (hitStop) {
        action = "SELL";
        tone = "#b91c1c";
        reasons.push("Price has reached or lost the planned stop.");
      } else if (weakSetup && pnlPct < 0.25) {
        action = "SELL";
        tone = "#b91c1c";
        reasons.push("Scanner/structure no longer supports the position.");
      } else if (pnlPct <= -2) {
        action = "SELL";
        tone = "#b91c1c";
        reasons.push("Loss is getting too large for a day-trade simulation.");
      } else if (hitTarget || pnlPct >= 4) {
        action = "SELL";
        tone = "#047857";
        reasons.push("Target or strong profit zone reached; bank the sim win.");
      } else if (canAdd) {
        action = "INCREASE";
        tone = "#047857";
        reasons.push("Position is working and scanner still supports the setup.");
      } else {
        reasons.push(strict ? "Hold while scanner remains VALID + Structure OK." : "Hold only if your original thesis is still intact.");
      }

      if (isScalp && ageHours >= 0.25) reasons.push("Scalp review timer active: either target, stop, or close manually.");
      if (!isScalp && ageHours >= 8 && pnlPct < 1) reasons.push("Long-term study hold with weak progress; consider freeing capital.");
      if (simState.positions.length >= 3) reasons.push("Portfolio already has max open holdings; no adding.");
      if (drawdownPct <= -1.5) reasons.push("Account drawdown guard is active; no adding.");
      if (bestAlternative && (!setup || bestAlternative.combinedScore - setup.combinedScore >= 12) && pnlPct < 1.25) {
        if (action !== "SELL") {
          action = "SELL";
          tone = "#b91c1c";
        }
        reasons.push(`${bestAlternative.symbol} is a stronger current scanner setup; free capital if your thesis is stale.`);
      }

      const addUsd = Math.max(0, Math.min(simState.cashUsd, Math.round(value * 0.35), 250));
      return {
        id: p.id,
        symbol: p.symbol,
        action,
        tone,
        now,
        value,
        pnlUsd,
        pnlPct,
        ageHours,
        setup,
        canAdd,
        addUsd,
        bestAlternative: bestAlternative?.symbol,
        reasons,
      };
    });
  }, [getSimPrice, scannerBest, setups, simEquity, simState.cashUsd, simState.positions, simState.startingCashUsd]);

  const holdingSummary = useMemo(() => {
    const sell = holdingReviews.filter((r) => r.action === "SELL").length;
    const hold = holdingReviews.filter((r) => r.action === "HOLD").length;
    const increase = holdingReviews.filter((r) => r.action === "INCREASE").length;
    const headline = sell ? "Reduce risk" : increase ? "One add candidate" : hold ? "Hold and monitor" : "No holdings";
    return { sell, hold, increase, headline };
  }, [holdingReviews]);

  const regimeDiagnostics = useMemo(() => {
    const priced = setups.filter((s) => typeof s.change24h === "number");
    const breadth = priced.length ? (priced.filter((s) => (s.change24h ?? 0) > 0).length / priced.length) * 100 : 0;
    const avgChange = priced.length ? priced.reduce((acc, s) => acc + (s.change24h ?? 0), 0) / priced.length : 0;
    const avgVolFactor = priced.length ? priced.reduce((acc, s) => acc + s.volFactor, 0) / priced.length : 0;
    const strictRate = watchlistHealth.scanned ? (watchlistHealth.tradable / watchlistHealth.scanned) * 100 : 0;
    const label =
      breadth >= 58 && avgChange > 1.2 && strictRate >= 3
        ? "Risk-on rotation"
        : breadth <= 42 || avgChange < -1
          ? "Defensive / sell pressure"
          : avgVolFactor > 1.2
            ? "Volatile selective tape"
            : "Choppy / wait-heavy";
    const action =
      label === "Risk-on rotation"
        ? "Let only top strict setups compete for capital."
        : label === "Defensive / sell pressure"
          ? "Cut weak holdings quickly and reduce new buys."
          : label === "Volatile selective tape"
            ? "Use smaller size and faster review windows."
            : "Avoid forcing trades; demand VALID + Structure OK.";
    return { label, breadth, avgChange, avgVolFactor, strictRate, action };
  }, [setups, watchlistHealth.scanned, watchlistHealth.tradable]);

  const tradeGrades = useMemo(() => {
    return simState.history.slice(0, 12).map((t) => {
      const setup = setups.find((s) => s.symbol === t.symbol);
      const followedScanner = t.source.includes("AI") || t.source.includes("Scanner") || t.thesis?.toLowerCase().includes("ai");
      const cleanStructure = setup?.entryQuality === "VALID" && setup?.structureLabel === "OK";
      const score = clamp(Math.round(52 + t.pnlPct * 7 + (followedScanner ? 14 : -5) + (cleanStructure ? 12 : -8)), 0, 100);
      const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
      const lesson =
        grade === "A"
          ? "Repeat this pattern, but do not increase size until it repeats."
          : grade === "B"
            ? "Good enough; tighten entry or exit discipline."
            : grade === "C"
              ? "Mixed trade. Review timing and stop discipline."
              : "Do not scale this setup type until evidence improves.";
      return { id: t.id, symbol: t.symbol, pnlPct: t.pnlPct, pnlUsd: t.pnlUsd, grade, score, lesson };
    });
  }, [setups, simState.history]);

  const learningReview = useMemo(() => {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const recent = simState.history.filter((t) => new Date(t.closedAtIso).getTime() >= cutoff);
    const trades = recent.length ? recent : simState.history;
    const summarize = (label: string, rows: SimClosedTrade[]) => {
      const wins = rows.filter((t) => t.pnlUsd > 0);
      const losses = rows.filter((t) => t.pnlUsd < 0);
      const pnlUsd = rows.reduce((acc, t) => acc + t.pnlUsd, 0);
      const expectancyPct = rows.length ? rows.reduce((acc, t) => acc + t.pnlPct, 0) / rows.length : 0;
      const avgWinPct = wins.length ? wins.reduce((acc, t) => acc + t.pnlPct, 0) / wins.length : 0;
      const avgLossPct = losses.length ? Math.abs(losses.reduce((acc, t) => acc + t.pnlPct, 0) / losses.length) : 0;
      return { label, rows, count: rows.length, wins: wins.length, losses: losses.length, pnlUsd, winRate: rows.length ? (wins.length / rows.length) * 100 : 0, expectancyPct, avgWinPct, avgLossPct };
    };

    const normal = summarize("Long-term study", trades.filter((t) => t.mode !== "SCALP" && !t.source.startsWith("SCALP")));
    const scalp = summarize("Quick scalp", trades.filter((t) => t.mode === "SCALP" || t.source.startsWith("SCALP")));
    const all = summarize(recent.length ? "Last 3 days" : "All sim data", trades);
    const stopLosses = trades.filter((t) => t.exitReason === "STOP_LOSS");
    const takeProfits = trades.filter((t) => t.exitReason === "TAKE_PROFIT");
    const manualTrades = trades.filter((t) => t.exitReason === "MANUAL" || !t.exitReason);
    const manualLosers = manualTrades.filter((t) => t.pnlUsd < 0);
    const scoreFromSource = (source: string) => {
      const match = source.match(/(\d+)\s*$/);
      return match ? Number(match[1]) : undefined;
    };
    const winningScores = trades.map((t) => ({ t, score: scoreFromSource(t.source) })).filter((x) => x.t.pnlUsd > 0 && typeof x.score === "number") as Array<{ t: SimClosedTrade; score: number }>;
    const losingScores = trades.map((t) => ({ t, score: scoreFromSource(t.source) })).filter((x) => x.t.pnlUsd < 0 && typeof x.score === "number") as Array<{ t: SimClosedTrade; score: number }>;
    const avgWinningScore = winningScores.length ? winningScores.reduce((acc, x) => acc + x.score, 0) / winningScores.length : 0;
    const avgLosingScore = losingScores.length ? losingScores.reduce((acc, x) => acc + x.score, 0) / losingScores.length : 0;
    const suggestedMinScore = losingScores.length ? Math.max(70, Math.ceil(avgLosingScore + 5)) : 72;
    const symbolPnl = trades.reduce<Record<string, { symbol: string; pnlUsd: number; count: number }>>((acc, t) => {
      const row = acc[t.symbol] ?? { symbol: t.symbol, pnlUsd: 0, count: 0 };
      row.pnlUsd += t.pnlUsd;
      row.count += 1;
      acc[t.symbol] = row;
      return acc;
    }, {});
    const repeatLosers = Object.values(symbolPnl).filter((s) => s.count >= 2 && s.pnlUsd < 0).sort((a, b) => a.pnlUsd - b.pnlUsd).slice(0, 3);

    const recommendations: string[] = [];
    if (all.count < 6) recommendations.push("Keep trading in sim until you have at least 6-10 closed trades; current evidence is still thin.");
    if (scalp.count >= 2 && normal.count >= 2) {
      recommendations.push(
        scalp.expectancyPct > normal.expectancyPct
          ? `Quick scalp is currently outperforming long-term study trades by ${(scalp.expectancyPct - normal.expectancyPct).toFixed(2)}% expectancy; keep size small but prioritize SCALP TEST cards.`
          : `Long-term study trades are outperforming quick scalps by ${(normal.expectancyPct - scalp.expectancyPct).toFixed(2)}% expectancy; reduce scalp size or require burst score 80+.`
      );
    }
    if (stopLosses.length > takeProfits.length && trades.length >= 3) recommendations.push("More stops than targets are being hit; require cleaner entry timing and avoid buying if price is already extended.");
    if (manualLosers.length >= 2) recommendations.push("Manual exits are producing repeated losers; use the stop/target auto-exit more and avoid manually holding through invalidation.");
    if (repeatLosers.length) recommendations.push(`Temporary blacklist: ${repeatLosers.map((s) => s.symbol).join(", ")} until they produce a clean scanner setup again.`);
    if (losingScores.length >= 2 && avgLosingScore >= 70) recommendations.push(`Raise minimum score toward ${suggestedMinScore}+ because losing trades are still coming from decent-looking scores.`);
    if (signalCalibration.resolved.length >= 5 && signalCalibration.confidenceGap > 10) recommendations.push("AI confidence has been too optimistic versus resolved outcomes; keep the current confidence haircut and demand more confirmation.");
    if (!recommendations.length) recommendations.push("No strong negative pattern yet. Keep collecting sim trades and avoid changing too many rules at once.");

    return {
      sampleLabel: recent.length ? "last 3 days" : "all saved sim trades",
      all,
      normal,
      scalp,
      stopLosses: stopLosses.length,
      takeProfits: takeProfits.length,
      manualLosers: manualLosers.length,
      avgWinningScore,
      avgLosingScore,
      suggestedMinScore,
      repeatLosers,
      recommendations,
    };
  }, [signalCalibration.confidenceGap, signalCalibration.resolved.length, simState.history]);

  const accuracyScore = useMemo(() => {
    const simScore = simState.history.length ? clamp(50 + simStats.expectancyPct * 9 + (simStats.winRate - 50) * 0.45, 0, 100) : 45;
    const replayScore = scannerReplay.trades.length ? clamp(50 + scannerReplay.expectancyPct * 11 + (scannerReplay.winRate - 50) * 0.35, 0, 100) : 42;
    const calibrationScore = signalCalibration.resolved.length ? clamp(100 - Math.abs(signalCalibration.confidenceGap) * 1.5, 0, 100) : 55;
    const evidenceWeight = clamp((simState.history.length + scannerReplay.trades.length + signalCalibration.resolved.length) / 30, 0.2, 1);
    const score = Math.round((simScore * 0.35 + replayScore * 0.4 + calibrationScore * 0.25) * evidenceWeight);
    return { score, simScore, replayScore, calibrationScore, evidenceWeight };
  }, [scannerReplay.expectancyPct, scannerReplay.trades.length, scannerReplay.winRate, signalCalibration.confidenceGap, signalCalibration.resolved.length, simState.history.length, simStats.expectancyPct, simStats.winRate]);

  const requestAiAdvisor = async () => {
    setAiAdvisorLoading(true);
    setAiAdvisorError(null);
    try {
      const slimSetup = (s: SetupRow) => ({
        symbol: s.symbol,
        score: Math.round(s.combinedScore),
        priceUsd: s.priceUsd,
        change24h: s.change24h,
        volumeFactor: Number(s.volFactor.toFixed(2)),
        entryQuality: s.entryQuality,
        structureLabel: s.structureLabel,
        support: s.support,
        resistance: s.resistance,
        roomTo2R: s.roomTo2R,
        why: s.why.slice(0, 3),
        blockers: [...s.whyNot, ...s.structureWhy].slice(0, 4),
      });
      const holdings = simState.positions.map((p) => {
        const now = getSimPrice(p.symbol) || p.entry;
        const pnlUsd = (now - p.entry) * p.qty;
        return {
          symbol: p.symbol,
          entry: p.entry,
          now,
          valueUsd: now * p.qty,
          pnlUsd,
          pnlPct: (pnlUsd / p.notionalUsd) * 100,
          thesis: p.thesis,
        };
      });

      const res = await fetch("/.netlify/functions/aiAdvisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalPlan,
          selectedSymbol: simSymbol,
          market: setups.slice(0, 15).map(slimSetup),
          scannerBest: scannerBest.map(slimSetup),
          holdings,
          simHistory: simState.history.slice(0, 20),
          simStats: { simStats, planProgress, regimeDiagnostics, accuracyScore, scannerReplay },
          liveNewsMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.setup || data?.error || "AI advisor request failed.");
      setAiAdvisor(data as AiAdvisorResponse);
      const ideas = ((data as AiAdvisorResponse).tradeIdeas ?? []).filter((idea) => idea.action === "BUY_TEST" || idea.action === "WATCH");
      if (ideas.length) {
        setAiSignals((prev) => [
          ...ideas.slice(0, 5).map((idea) => {
            const setup = setups.find((s) => s.symbol === idea.symbol.toUpperCase());
            return {
              id: uuid(),
              tsIso: new Date().toISOString(),
              symbol: idea.symbol.toUpperCase(),
              action: idea.action,
              confidence: confidencePct(idea.confidence),
              entry: getSimPrice(idea.symbol.toUpperCase()) || setup?.priceUsd || 0,
              score: setup?.combinedScore ?? 0,
              verdict: "OPEN" as const,
            };
          }),
          ...prev,
        ].slice(0, 500));
      }
    } catch (e: unknown) {
      setAiAdvisorError(getErrorMessage(e, "AI advisor failed."));
    } finally {
      setAiAdvisorLoading(false);
    }
  };

  const loadAiIdeaIntoTicket = (idea: AiTradeIdea) => {
    const symbol = idea.symbol.toUpperCase();
    const setup = setups.find((s) => s.symbol === symbol);
    const price = getSimPrice(symbol) || setup?.priceUsd || 0;
    setSimSymbol(symbol);
    setFocusSymbol(symbol);
    if (price) {
      setEntryPrice(price);
      setStopPrice(setup?.support ?? price * 0.985);
      const defaultStop = setup?.support && setup.support < price ? setup.support : price * 0.985;
      setSimStopLossInput(defaultStop.toPrecision(8));
      setSimTakeProfitInput((price + Math.max(price - defaultStop, price * 0.008) * 2).toPrecision(8));
    }
    if (idea.allocationUsd > 0) setSimBuyUsd(String(Math.min(simState.cashUsd, Math.round(idea.allocationUsd))));
    setSimThesis(`Real AI ${idea.action}: ${idea.thesis} Plan fit: ${idea.planFit}`);
  };

  const buySimCrypto = (symbol = simSymbol, buyUsd = Number(simBuyUsd)) => {
    const price = getSimPrice(symbol) || (symbol === simSymbol ? simulatorPrice : 0);
    const notional = Number.isFinite(buyUsd) ? buyUsd : 0;
    if (!price || !isFinite(price)) {
      alert("No price available yet. Refresh market data first.");
      return;
    }
    if (notional <= 0) {
      alert("Enter a buy amount first.");
      return;
    }
    if (notional > simState.cashUsd) {
      alert("Buy amount is larger than your simulator cash.");
      return;
    }
    if (!simStopLossValid || !simTakeProfitValid) {
      alert("Set a stop loss below the current price and a take profit above the current price before buying.");
      return;
    }
    const setup = setups.find((s) => s.symbol === symbol);
    const position: SimPosition = {
      id: uuid(),
      openedAtIso: new Date().toISOString(),
      symbol,
      side: "LONG",
      mode: simTradeMode,
      entry: price,
      qty: notional / price,
      notionalUsd: notional,
      stop: simStopLossValid ? simStopLoss : undefined,
      takeProfit: simTakeProfitValid ? simTakeProfit : undefined,
      thesis: simThesis.trim() || undefined,
      source:
        `${simTradeWarningActive ? "WARN / " : ""}${
          simTradeMode === "SCALP" && selectedScalpSignal
            ? `SCALP / ${selectedScalpSignal.action} / ${selectedScalpSignal.burstScore}`
            : setup
              ? `${setup.entryQuality} / ${setup.structureLabel} / ${Math.round(setup.combinedScore)}`
              : edgeGrade.label
        }`,
    };
    setSimState((s) => ({ ...s, cashUsd: s.cashUsd - notional, positions: [position, ...s.positions] }));
    setSimSymbol(symbol);
    setFocusSymbol(symbol);
    if (price) {
      setEntryPrice(price);
      setStopPrice(price * 0.985);
      setSimStopLossInput((price * 0.985).toPrecision(8));
      setSimTakeProfitInput((price * 1.03).toPrecision(8));
    }
    setSimThesis("");
  };

  const sellSimHolding = (id: string) => {
    setSimState((s) => {
      const position = s.positions.find((p) => p.id === id);
      if (!position) return s;
      const exit = getSimPrice(position.symbol) || position.entry;
      const pnlUsd = (exit - position.entry) * position.qty;
      const closed: SimClosedTrade = {
        ...position,
        closedAtIso: new Date().toISOString(),
        exit,
        pnlUsd,
        pnlPct: (pnlUsd / position.notionalUsd) * 100,
        exitReason: "MANUAL",
      };
      return {
        ...s,
        cashUsd: s.cashUsd + position.notionalUsd + pnlUsd,
        positions: s.positions.filter((p) => p.id !== id),
        history: [closed, ...s.history].slice(0, 250),
      };
    });
  };

  const updateSimHoldingExit = (id: string, field: "stop" | "takeProfit", raw: string) => {
    const next = Number(raw);
    setSimState((s) => {
      const position = s.positions.find((p) => p.id === id);
      if (!position) return s;
      const now = getSimPrice(position.symbol) || position.entry;
      if (!Number.isFinite(next) || next <= 0) {
        return {
          ...s,
          positions: s.positions.map((p) => (p.id === id ? { ...p, [field]: undefined } : p)),
        };
      }
      if (field === "stop" && next >= now) {
        alert("Stop loss must be below the current market price.");
        return s;
      }
      if (field === "takeProfit" && next <= now) {
        alert("Take profit must be above the current market price.");
        return s;
      }
      return {
        ...s,
        positions: s.positions.map((p) => (p.id === id ? { ...p, [field]: next } : p)),
      };
    });
  };

  const resetSimulator = () => {
    if (!confirm("Reset simulator cash, holdings, and buy/sell history?")) return;
    setSimState(defaultSimState());
  };

  // Per-coin action gating: strict safety first
  const coinActionAllowed = (s: SetupRow) => {
    if (!tradingAllowed) return false;
    if (overrideGuard) return true;

    // Hard blocks:
    if (s.entryQuality === "NO_EDGE") return false;
    if (s.structureLabel !== "OK") return false;

    return true;
  };

  // Trust messaging
  const processMessage = useMemo(() => {
    if (commitRequired) return { tone: "#b91c1c", text: "Commit today’s rules before you trade." };
    if (dayState.locked && overrideGuard) return { tone: "#92400e", text: "Lock override active — simulator/testing only. Keep size tiny." };
    if (dayState.locked) return { tone: "#b91c1c", text: dayState.lockedReason ?? "Session locked — stop trading." };
    if (sessionInfo.status === "WAIT" && !overrideGuard) return { tone: "#b91c1c", text: "WAIT window — protect capital. Don’t force entries." };
    if (!sessionAllowedByCommit && !overrideGuard) return { tone: "#b91c1c", text: "This session isn’t in your plan. Wait for your allowed window." };
    if (sessionInfo.status === "SELECTIVE") return { tone: "#111827", text: "Selective window — A+ only. One clean setup beats five weak ones." };
    return { tone: "#047857", text: "Trade window — execute your rules, not your emotions." };
  }, [commitRequired, dayState.locked, dayState.lockedReason, sessionInfo.status, overrideGuard, sessionAllowedByCommit]);

  // Log helpers
  const openLogFromCurrent = () => {
    setLogSide("LONG");
    setLogEntry(entryPrice);
    setLogStop(stopPrice);
    setLogExit(entryPrice);
    setLogRulesFollowed(true);
    setLogNote("");
    setLogOpen(true);
  };

  const addTrade = () => {
    const r = computeR(logSide, logEntry, logStop, logExit);
    if (!isFinite(r)) {
      alert("Invalid trade inputs. Check Entry/Stop/Exit and Side.");
      return;
    }
    const trade: TradeRecord = {
      id: uuid(),
      tsIso: new Date().toISOString(),
      symbol: focusSymbol,
      side: logSide,
      entry: logEntry,
      stop: logStop,
      exit: logExit,
      r,
      rulesFollowed: logRulesFollowed,
      note: logNote.trim() ? logNote.trim() : undefined,
    };
    setDayState((s) => ({ ...s, trades: [...s.trades, trade] }));
    setLogOpen(false);
  };

  const endSessionNow = () => {
    setDayState((s) => ({ ...s, locked: true, lockedReason: "Manual END SESSION — you chose capital protection." }));
  };

  const unlockSessionNow = () => {
    if (!confirm("Override today's lock? Your trade log stays intact, but the guard will allow more testing.")) return;
    setDayState((s) => ({ ...s, locked: false, lockedReason: undefined }));
  };

  // Commitment UI state
  const [commitDraft, setCommitDraft] = useState<CommitConfig>(() => defaultCommit(todayKey));
  useEffect(() => setCommitDraft(defaultCommit(todayKey)), [todayKey]);

  const commitToday = () => {
    const c: CommitConfig = {
      ...commitDraft,
      dayKey: todayKey,
      committedAtIso: new Date().toISOString(),
      riskPct: clamp(commitDraft.riskPct, 0.1, 5),
      maxTrades: Math.max(1, Math.floor(commitDraft.maxTrades)),
      maxDailyLossR: Math.max(0.5, commitDraft.maxDailyLossR),
      maxConsecutiveLosses: Math.max(1, Math.floor(commitDraft.maxConsecutiveLosses)),
    };
    saveCommit(c);
    setCommit(c);
    setRiskPct(c.riskPct);
  };

  const clearToday = () => {
    if (!confirm("Reset today's session state? (Trades + lock state)")) return;
    const fresh: DayState = { dayKey: todayKey, locked: false, trades: [] };
    setDayState(fresh);
    saveDayState(fresh);
  };

  const activateDemoPass = () => {
    localStorage.setItem(LS_PRO_PASS, "active");
    setProPass(true);
  };

  const saveLead = () => {
    const email = leadEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("Enter a valid email first.");
      return;
    }

    const lead = {
      email,
      tsIso: new Date().toISOString(),
      edgeGrade: edgeGrade.label,
      strictSignals: scannerBest.length,
      source: "app-pro-card",
    };
    const current = JSON.parse(localStorage.getItem(LS_LEADS) || "[]") as Array<typeof lead>;
    localStorage.setItem(LS_LEADS, JSON.stringify([lead, ...current].slice(0, 250)));
    setLeadEmail("");
    setLeadSaved(true);
    setTimeout(() => setLeadSaved(false), 3000);
  };

  const openCheckout = () => {
    window.open(CHECKOUT_URL, "_blank", "noopener,noreferrer");
  };

  const exportJournalCsv = () => {
    const header = "time,symbol,side,entry,stop,exit,r,rules_followed,note";
    const lines = dayState.trades.map((t) =>
      [
        t.tsIso,
        t.symbol,
        t.side,
        t.entry,
        t.stop,
        t.exit,
        t.r.toFixed(4),
        t.rulesFollowed ? "yes" : "no",
        `"${(t.note ?? "").replaceAll('"', '""')}"`,
      ].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `obsidian-journal-${todayKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ===== Styles =====
  const appWrap: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg, #f6f8fb 0%, #eef3f7 48%, #e7edf3 100%)",
    color: "#172033",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  };

  const topbar: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 10,
    padding: "10px 18px",
    borderBottom: "1px solid #d8e0ea",
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(18px)",
    boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
  };

  const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
  const brand: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontWeight: 950, letterSpacing: 0.4, minWidth: 250, color: "#0f172a" };
  const dot: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 5,
    background: "#0f766e",
    boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.38)",
  };

  const tabsWrap: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "9px 12px",
    borderRadius: 7,
    border: active ? "1px solid #0f766e" : "1px solid #d8e0ea",
    background: active ? "#0f766e" : "#ffffff",
    color: active ? "#ffffff" : "#475569",
    fontWeight: 800,
    cursor: "pointer",
    userSelect: "none",
    boxShadow: active ? "0 8px 18px rgba(15,118,110,0.18)" : "none",
  });

  const shell: React.CSSProperties = { padding: "14px 18px 24px", maxWidth: 1500, margin: "0 auto" };

  const commandHero: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #d8e0ea",
    background:
      "linear-gradient(135deg, #ffffff 0%, #f8fafc 58%, #eef7f5 100%)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    padding: 18,
    overflow: "hidden",
    position: "relative",
  };

  const heroGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1.2fr 0.8fr",
    gap: 18,
    alignItems: "stretch",
  };

  const heroKicker: React.CSSProperties = {
    color: "#0f766e",
    fontSize: "0.76rem",
    fontWeight: 950,
    letterSpacing: 1.4,
  };

  const heroTitle: React.CSSProperties = {
    margin: "7px 0 0",
    color: "#0f172a",
    fontSize: "clamp(2rem, 3.6vw, 4.1rem)",
    lineHeight: 0.98,
    fontWeight: 950,
    letterSpacing: 0,
  };

  const heroMetric: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #d8e0ea",
    background: "#ffffff",
    padding: 12,
    minHeight: 88,
    boxShadow: "0 8px 22px rgba(15,23,42,0.05)",
  };

  const pill: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid #d8e0ea",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.78rem",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  const banner: React.CSSProperties = {
    marginTop: 10,
    border: "1px solid #d8e0ea",
    background: "#f8fafc",
    borderRadius: 8,
    padding: "10px 12px",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    color: "#475569",
    fontSize: "0.85rem",
    flexWrap: "wrap",
  };

  const grid3: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1.15fr 0.95fr 0.9fr",
    gap: 14,
    marginTop: 14,
  };

  const grid2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginTop: 14,
  };

  const panel: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #d8e0ea",
    background: "#ffffff",
    boxShadow: "0 16px 34px rgba(15,23,42,0.07)",
    padding: 16,
    overflow: "hidden",
  };

  const btn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid #0f766e",
    background: "#0f766e",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  };

  const btnDanger: React.CSSProperties = {
    ...btn,
    border: "1px solid #b91c1c",
    background: "#b91c1c",
    color: "#ffffff",
  };

  const btnDisabled: React.CSSProperties = {
    ...btn,
    opacity: 0.45,
    cursor: "not-allowed",
    border: "1px solid #cbd5e1",
    background: "#e2e8f0",
    color: "#64748b",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 10px",
    borderRadius: 7,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    outline: "none",
  };

  const subtle: React.CSSProperties = { color: "#64748b", fontSize: "0.82rem", lineHeight: 1.45 };
  const statCard: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    padding: 12,
  };
  const proPanel: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #b7d8d3",
    background: "#eef7f5",
    padding: 14,
  };
  const sectionTitle: React.CSSProperties = { color: "#0f766e", fontWeight: 950, letterSpacing: 0.6, fontSize: "0.78rem" };
  const emptyState: React.CSSProperties = {
    borderRadius: 8,
    border: "1px dashed #cbd5e1",
    background: "#f8fafc",
    padding: 14,
    color: "#64748b",
    fontSize: "0.84rem",
    lineHeight: 1.5,
  };

  function ScorePill({ score }: { score: number }) {
    let bg = "rgba(255, 90, 90, 0.20)";
    let border = "rgba(255, 90, 90, 0.35)";
    let text = "#b91c1c";
    if (score >= 80) {
      bg = "rgba(212, 199, 161, 0.22)";
      border = "rgba(212, 199, 161, 0.8)";
      text = "#111827";
    } else if (score >= 65) {
      bg = "rgba(70, 220, 140, 0.16)";
      border = "rgba(70, 220, 140, 0.32)";
      text = "#047857";
    }
    return (
      <span
        style={{
          padding: "6px 10px",
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: bg,
          color: text,
          fontWeight: 900,
          fontSize: "0.78rem",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
        }}
      >
        {Math.round(score)}/100
      </span>
    );
  }

  function ProBadge() {
    return (
      <span
        style={{
          ...pill,
          borderColor: proPass ? "rgba(130,240,185,0.45)" : "rgba(212,199,161,0.45)",
          color: proPass ? "#047857" : "#111827",
        }}
      >
        {proPass ? "PRO ACTIVE" : `PRO ${PRO_PRICE}`}
      </span>
    );
  }

  function EntryQualityBadge({ s }: { s: SetupRow }) {
    if (s.entryQuality === "VALID") return null;
    const isNoEdge = s.entryQuality === "NO_EDGE";
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 950, color: isNoEdge ? "#b91c1c" : "#111827" }}>
          {isNoEdge ? "🚫 NO EDGE — WAIT" : "⚠️ EXTENDED — DON’T CHASE"}
        </div>
        {!!s.whyNot?.length && (
          <div style={{ marginTop: 6, color: "#64748b", fontSize: "0.82rem", lineHeight: 1.4 }}>
            {s.whyNot.slice(0, 2).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  function StructureBadge({ s }: { s: SetupRow }) {
    if (s.structureLabel === "OK") return null;

    const isNoEdge = s.structureLabel === "NO_EDGE";
    const title = isNoEdge ? "🚫 STRUCTURE NO EDGE — NO 2R ROOM" : "⏳ STRUCTURE WAIT — NO CLEAN MAP";
    const tone = isNoEdge ? "#b91c1c" : "#111827";

    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 950, color: tone }}>{title}</div>
        {!!s.structureWhy?.length && (
          <div style={{ marginTop: 6, color: "#64748b", fontSize: "0.82rem", lineHeight: 1.4 }}>
            {s.structureWhy.slice(0, 2).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  function HeatTile({ s }: { s: SetupRow }) {
    let bg = "rgba(110, 20, 20, 0.55)";
    let border = "rgba(255, 90, 90, 0.35)";
    let shadow = "none";

    if (s.combinedScore >= 80) {
      bg = "rgba(212, 198, 161, 0.45)";
      border = "rgba(212, 198, 161, 0.85)";
      shadow = "0 0 22px rgba(212, 198, 161, 0.25)";
    } else if (s.combinedScore >= 65) {
      bg = "rgba(40, 120, 70, 0.50)";
      border = "rgba(70, 220, 140, 0.35)";
      shadow = "0 0 18px rgba(70, 220, 140, 0.12)";
    }

    const allowed = coinActionAllowed(s);
    const blocked = !overrideGuard && (s.entryQuality === "NO_EDGE" || s.structureLabel !== "OK");

    return (
      <div
        onClick={() => {
          if (!allowed) return;
          setFocusSymbol(s.symbol);
          if (s.priceUsd) {
            setEntryPrice(s.priceUsd);
            setStopPrice(s.priceUsd * 0.985);
          }
        }}
        style={{
          borderRadius: 12,
          border: `1px solid ${border}`,
          background: bg,
          padding: "10px 8px",
          cursor: allowed ? "pointer" : "not-allowed",
          boxShadow: shadow,
          textAlign: "center",
          userSelect: "none",
          opacity: allowed ? 1 : 0.55,
          position: "relative",
        }}
        title={
          blocked ? "Blocked: needs VALID + Structure OK" : !tradingAllowed ? "Trading locked (commit + session guard)" : "Click to focus"
        }
      >
        {(s.entryQuality !== "VALID" || s.structureLabel !== "OK") && (
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              fontSize: "0.7rem",
              fontWeight: 950,
              color: s.entryQuality === "NO_EDGE" || s.structureLabel === "NO_EDGE" ? "#991b1b" : "#111827",
              background: "#f1f5f9",
              border: "1px solid #d8e0ea",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {s.entryQuality === "NO_EDGE" || s.structureLabel === "NO_EDGE" ? "NO EDGE" : "WAIT"}
          </div>
        )}

        <div style={{ fontWeight: 950, fontSize: "0.78rem", color: "#0b0b0c" }}>{s.symbol}</div>
        <div style={{ fontSize: "0.72rem", marginTop: 2, color: "#0b0b0c", fontWeight: 900 }}>{Math.round(s.combinedScore)}</div>
      </div>
    );
  }

  const endSessionDisabled = dayState.locked;

  // Commitment summary
  const bannerLeft = (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ ...pill, borderColor: "rgba(212,199,161,0.35)" }}>{sessionInfo.session}</span>
      <span style={{ ...pill, borderColor: "#d8e0ea", color: sessionInfo.color }}>
        {sessionInfo.status === "TRADE" ? "TRADE WINDOW" : sessionInfo.status === "SELECTIVE" ? "BE SELECTIVE" : "WAIT"}
      </span>
      <span style={{ color: processMessage.tone, fontWeight: 900 }}>{processMessage.text}</span>
    </div>
  );

  const bannerRight = (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={pill}>
        Next change: <b style={{ color: "#111827" }}>{sessionInfo.countdown}</b>
      </span>

      {(sessionInfo.status === "WAIT" || !sessionAllowedByCommit || dayState.locked) && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#b91c1c", fontWeight: 900 }}>
          <input type="checkbox" checked={overrideGuard} onChange={(e) => setOverrideGuard(e.target.checked)} />
          Override guard (not recommended)
        </label>
      )}

      {dayState.locked && (
        <button style={btnDanger} onClick={unlockSessionNow}>
          Unlock Session
        </button>
      )}

      <span style={pill}>
        Trades: <b style={{ color: "#111827" }}>{tradesToday}</b> · R:{" "}
        <b style={{ color: rToday >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(rToday)}</b>
      </span>

      {lastUpdated ? (
        <span style={pill}>
          Updated:{" "}
          <b style={{ color: "#111827" }}>
            {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </b>
        </span>
      ) : null}
      <ProBadge />
    </div>
  );

  const commitmentPanel = (
    <div style={{ ...panel, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>DAILY PRE-COMMITMENT</div>
          <div style={{ ...subtle, marginTop: 4 }}>
            Commit once, then execute calmly. The guard stops you when your edge is statistically exhausted.
          </div>
        </div>
        <button style={btn} onClick={commitToday}>
          Commit Today
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <div>
          <div style={subtle}>Max trades today</div>
          <input
            style={input}
            type="number"
            value={commitDraft.maxTrades}
            onChange={(e) => setCommitDraft((c) => ({ ...c, maxTrades: Number(e.target.value) }))}
          />
        </div>
        <div>
          <div style={subtle}>Max daily loss (R)</div>
          <input
            style={input}
            type="number"
            step="0.5"
            value={commitDraft.maxDailyLossR}
            onChange={(e) => setCommitDraft((c) => ({ ...c, maxDailyLossR: Number(e.target.value) }))}
          />
        </div>
        <div>
          <div style={subtle}>Max consecutive losses</div>
          <input
            style={input}
            type="number"
            value={commitDraft.maxConsecutiveLosses}
            onChange={(e) => setCommitDraft((c) => ({ ...c, maxConsecutiveLosses: Number(e.target.value) }))}
          />
        </div>

        <div>
          <div style={subtle}>Risk per trade (%)</div>
          <input
            style={input}
            type="number"
            step="0.1"
            value={commitDraft.riskPct}
            onChange={(e) => setCommitDraft((c) => ({ ...c, riskPct: Number(e.target.value) }))}
          />
        </div>

        <div style={{ gridColumn: "span 2" }}>
          <div style={subtle}>Allowed sessions (your plan)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, color: "#64748b", fontWeight: 800 }}>
            {COMMIT_SESSION_OPTIONS.map(([k, label]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={commitDraft[k]}
                  onChange={(e) => setCommitDraft((c) => ({ ...c, [k]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          <div style={{ ...subtle, marginTop: 8 }}>
            Recommended default: <b style={{ color: "#111827" }}>Afternoon onward: Europe + Overlap + US</b>. Fiji daytime is weak except weekend / Monday morning US-weekend flow.
          </div>
        </div>
      </div>
    </div>
  );

  const todaysCommitSummary = commit ? (
    <div style={{ ...panel, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>TODAY’S COMMITMENT</div>
          <div style={{ ...subtle, marginTop: 4 }}>
            Max trades: <b style={{ color: "#111827" }}>{commit.maxTrades}</b> · Max loss:{" "}
            <b style={{ color: "#111827" }}>-{commit.maxDailyLossR}R</b> · Consecutive losses:{" "}
            <b style={{ color: "#111827" }}>{commit.maxConsecutiveLosses}</b> · Risk:{" "}
            <b style={{ color: "#111827" }}>{commit.riskPct}%</b>
          </div>
        </div>
        <button
          style={btn}
          onClick={() => {
            setCommit(null);
            localStorage.removeItem(LS_COMMIT);
          }}
        >
          Re-commit
        </button>
      </div>
    </div>
  ) : null;

  // Pages
  const Dashboard = () => (
    <>
      <div style={{ ...proPanel, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ color: edgeGrade.color, fontWeight: 950, letterSpacing: 0.8 }}>EDGE MODE: {edgeGrade.label}</div>
              <ProBadge />
            </div>
            <div style={{ ...subtle, marginTop: 6 }}>
              {edgeGrade.note} Strict candidates: <b style={{ color: "#111827" }}>{watchlistHealth.tradable}</b> · Blocked traps:{" "}
              <b style={{ color: "#b91c1c" }}>{watchlistHealth.blocked}</b> · Avg activity:{" "}
              <b style={{ color: "#111827" }}>{Math.round(watchlistHealth.avgScore)}</b>/100
            </div>
            <div style={{ ...subtle, marginTop: 6 }}>
              AI brief: <b style={{ color: aiTradeBrief.tone }}>{aiTradeBrief.action}</b> · confidence{" "}
              <b style={{ color: "#111827" }}>{aiTradeBrief.confidence}%</b> · {proPass ? "full decision chain active" : "Basic shows preview, Pro unlocks full brief"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => setTab("scanner")}>
              Open Scanner
            </button>
            <button style={btn} onClick={() => setTab("simulator")}>
              Practice
            </button>
            <button style={proPass ? btn : btnDanger} onClick={() => (proPass ? setTab("pro") : openCheckout())}>
              {proPass ? "Manage Pro" : `Unlock Pro ${PRO_PRICE}`}
            </button>
          </div>
        </div>
      </div>

      <div style={grid3}>
        {/* COL 1 — Market + Top Momentum */}
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>MARKET OVERVIEW</div>
              <div style={{ ...subtle, marginTop: 2 }}>
                Live snapshot (CoinGecko). Entry Quality + Structure protect you from bad timing.
              </div>
            </div>
            <button style={btn} onClick={refresh} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh now"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            {["BTC", "ETH", "SOL"].map((sym) => {
              const m = market.find((x) => x.symbol === sym);
              return (
                <div
                  key={sym}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "#f8fafc",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#64748b" }}>{sym}</div>
                  <div style={{ marginTop: 6, fontWeight: 950, fontSize: "1.05rem" }}>{fmtUsd(m?.priceUsd)}</div>
                  <div style={{ marginTop: 4, color: (m?.change24h ?? 0) >= 0 ? "#047857" : "#b91c1c", fontWeight: 900 }}>
                    {m?.change24h === undefined ? "—" : `${m.change24h >= 0 ? "+" : ""}${fmtPct(m.change24h)}`}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>TOP ACTIVITY</div>
            <div style={{ ...subtle }}>Now includes Entry Quality + Structure (2R hard block)</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
            {setups.slice(0, 9).map((s) => {
              const allowed = coinActionAllowed(s);
              return (
                <div
                  key={s.symbol}
                  onClick={() => {
                    if (!allowed) return;
                    setFocusSymbol(s.symbol);
                    if (s.priceUsd) {
                      setEntryPrice(s.priceUsd);
                      setStopPrice(s.priceUsd * 0.985);
                    }
                  }}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "#f8fafc",
                    padding: 12,
                    cursor: allowed ? "pointer" : "not-allowed",
                    opacity: allowed ? 1 : 0.55,
                  }}
                  title={!allowed ? "Blocked: needs VALID + Structure OK (or override)" : "Click to focus"}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 950 }}>{s.symbol}</div>
                    <ScorePill score={s.combinedScore} />
                  </div>
                  <div style={{ ...subtle, marginTop: 8 }}>
                    15m: {Math.round(s.score15m)} · 1h: {Math.round(s.score1h)} · Vol: {s.volFactor.toFixed(2)}x
                  </div>

                  <EntryQualityBadge s={s} />
                  <StructureBadge s={s} />

                  {s.structureLabel === "OK" && typeof s.roomTo2R === "number" && isFinite(s.roomTo2R) && (
                    <div style={{ ...subtle, marginTop: 8 }}>
                      Structure: <b style={{ color: "#047857" }}>OK</b> · Room:{" "}
                      <b style={{ color: "#111827" }}>{(s.roomTo2R ?? 0).toFixed(2)}R</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ ...subtle, marginTop: 12 }}>
            Tip: a coin can be “active” but still <b style={{ color: "#b91c1c" }}>NO EDGE</b> if it fails 2R room or dumps fast. That’s intentional — it protects you.
          </div>
        </div>

        {/* COL 2 — TP/SL + sizing + LOG */}
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>POSITION SIZING + TP/SL</div>
              <div style={{ ...subtle, marginTop: 4 }}>
                Stops must be structural. The calculator helps size; you decide structure.
              </div>
            </div>
            <button style={tradingAllowed ? btn : btnDisabled} disabled={!tradingAllowed} onClick={openLogFromCurrent}>
              Log Trade
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div>
              <div style={subtle}>Account Size (USD)</div>
              <input style={input} type="number" value={accountUsd} onChange={(e) => setAccountUsd(Number(e.target.value))} />
            </div>
            <div>
              <div style={subtle}>Risk per Trade (%)</div>
              <input style={input} type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} />
            </div>
            <div>
              <div style={subtle}>Entry (USD) — {focusSymbol}</div>
              <input style={input} type="number" value={entryPrice} onChange={(e) => setEntryPrice(Number(e.target.value))} />
            </div>
            <div>
              <div style={subtle}>Stop (USD)</div>
              <input style={input} type="number" value={stopPrice} onChange={(e) => setStopPrice(Number(e.target.value))} />
            </div>
          </div>

          <div style={{ marginTop: 12, borderRadius: 14, border: "1px dashed #cbd5e1", background: "#f8fafc", padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={{ fontWeight: 900, color: "#0f766e" }}>LONG PLAN</div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  Stop Dist: <b style={{ color: "#111827" }}>{stopDistanceLong > 0 ? fmtUsd(stopDistanceLong) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  Size: <b style={{ color: "#111827" }}>{positionSizeLong > 0 ? `${positionSizeLong.toFixed(6)} ${focusSymbol}` : "—"}</b>
                </div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  TP1: <b style={{ color: "#111827" }}>{tp1Long > 0 ? fmtUsd(tp1Long) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  TP2: <b style={{ color: "#111827" }}>{tp2Long > 0 ? fmtUsd(tp2Long) : "—"}</b>
                </div>
                {stopDistanceLong <= 0 && <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 900 }}>Long invalid: Stop must be below Entry</div>}
              </div>

              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={{ fontWeight: 900, color: "#0f766e" }}>SHORT PLAN</div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  Stop Dist: <b style={{ color: "#111827" }}>{stopDistanceShort > 0 ? fmtUsd(stopDistanceShort) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  Size: <b style={{ color: "#111827" }}>{positionSizeShort > 0 ? `${positionSizeShort.toFixed(6)} ${focusSymbol}` : "—"}</b>
                </div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  TP1: <b style={{ color: "#111827" }}>{tp1Short > 0 ? fmtUsd(tp1Short) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  TP2: <b style={{ color: "#111827" }}>{tp2Short > 0 ? fmtUsd(tp2Short) : "—"}</b>
                </div>
                {stopDistanceShort <= 0 && <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 900 }}>Short invalid: Stop must be above Entry</div>}
              </div>
            </div>

            <div style={{ marginTop: 10, ...subtle }}>
              Risk Amount: <b style={{ color: "#111827" }}>{fmtUsd(riskAmount)}</b> · If you can’t define a structural stop, you don’t have a trade.
            </div>
          </div>
        </div>

        {/* COL 3 — Session Guard + Rules */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={panel}>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>SESSION GUARD</div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={subtle}>Trades today</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem" }}>
                  {tradesToday} / {commitRequired ? "—" : commit?.maxTrades}
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={subtle}>R today</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem", color: rToday >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(rToday)}</div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={subtle}>Consecutive losses</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem" }}>{consecutiveLosses}</div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 10 }}>
                <div style={subtle}>Status</div>
                <div style={{ fontWeight: 950, fontSize: "1.05rem", color: dayState.locked ? "#b91c1c" : "#111827" }}>
                  {dayState.locked ? "SESSION COMPLETE" : "ACTIVE"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, borderRadius: 12, border: "1px solid #e2e8f0", padding: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 900, color: processMessage.tone }}>{processMessage.text}</div>
              {dayState.locked && dayState.lockedReason && <div style={{ ...subtle, marginTop: 6 }}>{dayState.lockedReason}</div>}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button style={endSessionDisabled ? btnDisabled : btnDanger} disabled={endSessionDisabled} onClick={endSessionNow}>
                END SESSION
              </button>
              <button style={btn} onClick={clearToday}>
                Reset day
              </button>
            </div>
          </div>

          <div style={panel}>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>RULES (BASICS)</div>
            <div style={{ ...subtle, marginTop: 10, lineHeight: 1.6 }}>
              <b style={{ color: "#111827" }}>A+ only</b>
              <br />
              VALID entry · Structure OK · Score ≥ 70 · Vol ≥ 1.3x · Clear 2R room
              <br />
              <br />
              <b style={{ color: "#111827" }}>Risk stays small</b>
              <br />
              1–2% per trade · Stop after 2 losses or -2R
              <br />
              <br />
              <b style={{ color: "#111827" }}>Stop is structural</b>
              <br />
              Swing low / failed retest — never random %
              <br />
              <br />
              <b style={{ color: "#111827" }}>Do not chase</b>
              <br />
              EXTENDED / STRUCTURE WAIT / NO EDGE means WAIT for base, pullback, or reclaim
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row — Watchlist + Heatmap */}
      <div style={grid2}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>WATCHLIST (RANKED)</div>
              <div style={{ ...subtle, marginTop: 4 }}>
                Revolut UK candidate universe: {universeStats.total} coins · live data {universeStats.live} · missing {universeStats.missing}
              </div>
            </div>
            <span style={pill}>UK universe</span>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input style={input} placeholder="Search coins (symbol or name)…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontWeight: 800 }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto ({MARKET_REFRESH_LABEL})
            </label>
          </div>

          <div style={{ marginTop: 10, overflow: "auto", maxHeight: 420 }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px" }}>
              <thead>
                <tr style={{ color: "#64748b", fontSize: "0.78rem", textAlign: "left" }}>
                  <th style={{ paddingLeft: 8 }}>Coin</th>
                  <th>Price</th>
                  <th>24h</th>
                  <th>Vol</th>
                  <th>Entry</th>
                  <th>Structure</th>
                  <th style={{ textAlign: "right", paddingRight: 8 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {setups.slice(0, 60).map((s) => {
                  const allowed = coinActionAllowed(s);
                  return (
                    <tr
                      key={s.symbol}
                      onClick={() => {
                        if (!allowed) return;
                        setFocusSymbol(s.symbol);
                        if (s.priceUsd) {
                          setEntryPrice(s.priceUsd);
                          setStopPrice(s.priceUsd * 0.985);
                        }
                      }}
                      style={{
                        background: "#f8fafc",
                        cursor: allowed ? "pointer" : "not-allowed",
                        opacity: allowed ? 1 : 0.55,
                      }}
                      title={!allowed ? "Blocked: needs VALID + Structure OK (or override)" : "Click to focus"}
                    >
                      <td style={{ padding: "10px 8px", fontWeight: 950 }}>{s.symbol}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 800 }}>{fmtUsd(s.priceUsd)}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 900, color: (s.change24h ?? 0) >= 0 ? "#047857" : "#b91c1c" }}>
                        {s.change24h === undefined ? "—" : `${s.change24h >= 0 ? "+" : ""}${fmtPct(s.change24h)}`}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#64748b", fontWeight: 800 }}>
                        {isFinite(s.volFactor) ? `${s.volFactor.toFixed(2)}x` : "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontWeight: 950,
                          color: s.entryQuality === "VALID" ? "#047857" : s.entryQuality === "EXTENDED" ? "#111827" : "#b91c1c",
                        }}
                      >
                        {s.entryQuality}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontWeight: 950,
                          color: s.structureLabel === "OK" ? "#047857" : s.structureLabel === "WAIT" ? "#111827" : "#b91c1c",
                        }}
                      >
                        {s.structureLabel}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        <ScorePill score={s.combinedScore} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ ...subtle, marginTop: 10 }}>
            Focus: <b style={{ color: "#111827" }}>{focusSymbol}</b> · Tradable requires <b style={{ color: "#047857" }}>VALID</b> +{" "}
            <b style={{ color: "#047857" }}>Structure OK</b>.
          </div>
        </div>

        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>MARKET HEATMAP</div>
            <span style={pill}>Gold ≥ 80 · Green ≥ 65</span>
          </div>

          <div style={{ ...subtle, marginTop: 8 }}>
            Heatmap shows activity score. Entry Quality + Structure prevent chase-trading and “no 2R room”.
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
            {setups.slice(0, 24).map((s) => (
              <HeatTile key={s.symbol} s={s} />
            ))}
          </div>

          {bestSetup && (
            <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid #e2e8f0", padding: 12, background: "#f8fafc" }}>
              <div style={{ fontWeight: 950, color: "#111827" }}>Best right now (strict): {bestSetup.symbol}</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                Entry:{" "}
                <b style={{ color: bestSetup.entryQuality === "VALID" ? "#047857" : bestSetup.entryQuality === "EXTENDED" ? "#111827" : "#b91c1c" }}>
                  {bestSetup.entryQuality}
                </b>
                {" · "}
                Structure:{" "}
                <b style={{ color: bestSetup.structureLabel === "OK" ? "#047857" : bestSetup.structureLabel === "WAIT" ? "#111827" : "#b91c1c" }}>
                  {bestSetup.structureLabel}
                </b>
                {bestSetup.roomTo2R !== undefined && (
                  <>
                    {" · "}Room: <b style={{ color: "#111827" }}>{bestSetup.roomTo2R.toFixed(2)}R</b>
                  </>
                )}
              </div>

              {bestSetup.entryQuality !== "VALID" && bestSetup.whyNot?.length ? (
                <div style={{ ...subtle, marginTop: 8 }}>{bestSetup.whyNot.slice(0, 2).join(" · ")}</div>
              ) : bestSetup.structureLabel !== "OK" && bestSetup.structureWhy?.length ? (
                <div style={{ ...subtle, marginTop: 8 }}>{bestSetup.structureWhy.slice(0, 2).join(" · ")}</div>
              ) : (
                <div style={{ ...subtle, marginTop: 8 }}>Still: only trade if you have structure + stop + 2R path.</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, ...subtle, textAlign: "center" }}>
        This tool reads public data and helps decision-making. Crypto is high risk — always use a stop and size properly.
      </div>
    </>
  );

  const Scanner = () => (
    <>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>BEST TO CONSIDER NOW (STRICT)</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              Filter: EntryQuality=VALID · Structure=OK · Combined ≥ 70 · 1h ≥ 65 · Vol ≥ 1.3x.
            </div>
          </div>
          <button style={btn} onClick={refresh} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
          {scannerBest.map((s) => {
            const allowed = coinActionAllowed(s);
            return (
              <div
                key={s.symbol}
                onClick={() => {
                  if (!allowed) return;
                  setFocusSymbol(s.symbol);
                  setTab("dashboard");
                  if (s.priceUsd) {
                    setEntryPrice(s.priceUsd);
                    setStopPrice(s.priceUsd * 0.985);
                  }
                }}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(212,199,161,0.5)",
                  background: "rgba(212,199,161,0.15)",
                  padding: 12,
                  cursor: allowed ? "pointer" : "not-allowed",
                  opacity: allowed ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 950 }}>{s.symbol}</div>
                  <ScorePill score={s.combinedScore} />
                </div>

                <div style={{ ...subtle, marginTop: 8 }}>
                  1h: {Math.round(s.score1h)} · 15m: {Math.round(s.score15m)} · Vol: {s.volFactor.toFixed(2)}x
                </div>
                <div style={{ ...subtle, marginTop: 8 }}>
                  Room: <b style={{ color: "#111827" }}>{(s.roomTo2R ?? 0).toFixed(2)}R</b>
                </div>
              </div>
            );
          })}
        </div>

        {scannerBest.length === 0 && <div style={{ ...subtle, marginTop: 10 }}>No VALID + Structure OK candidates right now — waiting is a position.</div>}
      </div>

      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>FULL SCANNER</div>
            <div style={{ ...subtle, marginTop: 6 }}>Includes Entry Quality + Structure reasons so you don’t chase.</div>
          </div>
          <input style={input} placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div style={{ marginTop: 12, overflow: "auto", maxHeight: 560 }}>
          {setups.slice(0, 150).map((s) => {
            const allowed = coinActionAllowed(s);
            return (
              <div
                key={s.symbol}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "#f8fafc",
                  padding: 12,
                  marginBottom: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  opacity: allowed ? 1 : 0.55,
                }}
              >
                <div>
                  <div style={{ fontWeight: 950 }}>
                    {s.symbol} <span style={{ ...subtle }}>· {fmtUsd(s.priceUsd)} · {fmtPct(s.change24h)}</span>
                  </div>
                  <div style={{ ...subtle, marginTop: 6 }}>
                    15m {Math.round(s.score15m)} · 1h {Math.round(s.score1h)} · Vol {s.volFactor.toFixed(2)}x · Entry{" "}
                    <b style={{ color: s.entryQuality === "VALID" ? "#047857" : s.entryQuality === "EXTENDED" ? "#111827" : "#b91c1c" }}>
                      {s.entryQuality}
                    </b>
                    {" · "}Structure{" "}
                    <b style={{ color: s.structureLabel === "OK" ? "#047857" : s.structureLabel === "WAIT" ? "#111827" : "#b91c1c" }}>
                      {s.structureLabel}
                    </b>
                    {s.roomTo2R !== undefined && (
                      <>
                        {" · "}Room <b style={{ color: "#111827" }}>{s.roomTo2R.toFixed(2)}R</b>
                      </>
                    )}
                  </div>

                  <EntryQualityBadge s={s} />
                  <StructureBadge s={s} />
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <ScorePill score={s.combinedScore} />
                  <button
                    style={allowed ? btn : btnDisabled}
                    disabled={!allowed}
                    onClick={() => {
                      if (!allowed) return;
                      setFocusSymbol(s.symbol);
                      setTab("dashboard");
                      if (s.priceUsd) {
                        setEntryPrice(s.priceUsd);
                        setStopPrice(s.priceUsd * 0.985);
                      }
                    }}
                  >
                    Use
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  const Journal = () => (
    <div style={panel}>
      <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>TRADE JOURNAL (TODAY)</div>
      <div style={{ ...subtle, marginTop: 8 }}>
        Your job is to follow rules. Outcomes vary. The journal restores trust through evidence.
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 12 }}>
          <div style={subtle}>Trades</div>
          <div style={{ fontWeight: 950, fontSize: "1.3rem" }}>{tradesToday}</div>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 12 }}>
          <div style={subtle}>R today</div>
          <div style={{ fontWeight: 950, fontSize: "1.3rem", color: rToday >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(rToday)}</div>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", padding: 12 }}>
          <div style={subtle}>Rules followed</div>
          <div style={{ fontWeight: 950, fontSize: "1.3rem" }}>
            {dayState.trades.filter((t) => t.rulesFollowed).length}/{dayState.trades.length || 0}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={tradingAllowed ? btn : btnDisabled} disabled={!tradingAllowed} onClick={openLogFromCurrent}>
          Log Trade
        </button>
        <button style={btn} onClick={exportJournalCsv} disabled={!dayState.trades.length}>
          Export CSV
        </button>
        <button style={btnDanger} onClick={endSessionNow} disabled={dayState.locked}>
          END SESSION
        </button>
      </div>

      <div style={{ marginTop: 14, overflow: "auto", maxHeight: 520 }}>
        {dayState.trades.length === 0 ? (
          <div style={{ ...subtle, marginTop: 10 }}>No trades logged today yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 10px" }}>
            <thead>
              <tr style={{ color: "#64748b", fontSize: "0.78rem", textAlign: "left" }}>
                <th style={{ paddingLeft: 8 }}>Time</th>
                <th>Coin</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Exit</th>
                <th>R</th>
                <th>Rules</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {dayState.trades
                .slice()
                .reverse()
                .map((t) => (
                  <tr key={t.id} style={{ background: "#f8fafc" }}>
                    <td style={{ padding: "10px 8px" }}>
                      {new Date(t.tsIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 8px", fontWeight: 950 }}>{t.symbol}</td>
                    <td style={{ padding: "10px 8px" }}>{t.side}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.entry)}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.stop)}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.exit)}</td>
                    <td style={{ padding: "10px 8px", fontWeight: 950, color: t.r >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(t.r)}</td>
                    <td style={{ padding: "10px 8px", fontWeight: 900, color: t.rulesFollowed ? "#047857" : "#b91c1c" }}>
                      {t.rulesFollowed ? "YES" : "NO"}
                    </td>
                    <td style={{ padding: "10px 8px", color: "#64748b" }}>{t.note ?? ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const History = () => {
    const wins = dayState.trades.filter((t) => t.r > 0).length;
    const losses = dayState.trades.filter((t) => t.r < 0).length;
    const ruleBreaks = dayState.trades.filter((t) => !t.rulesFollowed);
    const ruleBreakCost = ruleBreaks.reduce((acc, t) => acc + t.r, 0);
    const expectancy = dayState.trades.length ? rToday / dayState.trades.length : 0;
    const winRate = dayState.trades.length ? (wins / dayState.trades.length) * 100 : 0;

    return (
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>PERFORMANCE COCKPIT</div>
            <div style={{ ...subtle, marginTop: 6 }}>Today’s evidence: expectancy, discipline cost, and whether the system kept you out of bad trades.</div>
          </div>
          <button style={btn} onClick={exportJournalCsv} disabled={!dayState.trades.length}>
            Export CSV
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          <div style={statCard}>
            <div style={subtle}>Expectancy</div>
            <div style={{ fontWeight: 950, fontSize: "1.4rem", color: expectancy >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(expectancy)}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Win rate</div>
            <div style={{ fontWeight: 950, fontSize: "1.4rem" }}>{winRate.toFixed(0)}%</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Wins / losses</div>
            <div style={{ fontWeight: 950, fontSize: "1.4rem" }}>{wins} / {losses}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Rule-break cost</div>
            <div style={{ fontWeight: 950, fontSize: "1.4rem", color: ruleBreakCost >= 0 ? "#047857" : "#b91c1c" }}>{fmtR(ruleBreakCost)}</div>
          </div>
        </div>

        <div style={{ ...proPanel, marginTop: 14 }}>
          <div style={{ color: "#111827", fontWeight: 950 }}>Pro insight</div>
          <div style={{ ...subtle, marginTop: 8 }}>
            {proPass
              ? `Scanner blocked ${watchlistHealth.blocked} risky-looking setups today. That is the product: fewer forced trades, cleaner sizing, and exportable evidence.`
              : `Unlock Pro to turn this into a sellable command center: strict signal alerts, CSV exports, lead capture, and checkout-ready access at ${PRO_PRICE}.`}
          </div>
          {!proPass && (
            <button style={{ ...btnDanger, marginTop: 12 }} onClick={() => setTab("pro")}>
              See Pro
            </button>
          )}
        </div>
      </div>
    );
  };

  const Plan = () => {
    const targetUsd = goalPlanDraft.startingEquityUsd * (goalPlanDraft.targetReturnPct / 100);
    const horizonDays = goalPeriodDays(goalPlanDraft.targetPeriod);
    const generatedStrategy = strategyFromGoal(goalPlanDraft.targetReturnPct, goalPlanDraft.targetPeriod);
    const maxLossUsd = goalPlanDraft.startingEquityUsd * (goalPlanDraft.maxDailyLossPct / 100);
    const targetPerTradePct = goalPlanDraft.maxTradesPerDay > 0 ? generatedStrategy.dailyTargetPct / goalPlanDraft.maxTradesPerDay : generatedStrategy.dailyTargetPct;
    const requiredWinRatePct = clamp(48 + generatedStrategy.dailyTargetPct * 10 - goalPlanDraft.riskPerTradePct * 3, 35, 88);
    const riskTone =
      generatedStrategy.dailyTargetPct >= 2 || goalPlanDraft.maxDailyLossPct >= 2
        ? { label: "AGGRESSIVE", color: "#b91c1c" }
        : generatedStrategy.dailyTargetPct >= 0.65
          ? { label: "ACTIVE", color: "#92400e" }
          : { label: "CONTROLLED", color: "#047857" };
    const updateDraftNumber = (key: GoalPlanNumberKey, value: string) => {
      const clean = value.replace(/[^\d.]/g, "");
      setGoalPlanInputText((prev) => ({ ...prev, [key]: clean }));
      if (!clean.trim() || clean === ".") return;
      const parsed = Number(clean);
      if (Number.isFinite(parsed)) setGoalPlanDraft((prev) => ({ ...prev, [key]: Math.max(0, parsed) }));
    };
    const normalizeDraftNumber = (key: GoalPlanNumberKey) => {
      setGoalPlanInputText((prev) => ({ ...prev, [key]: String(goalPlanDraft[key]) }));
    };
    const periodButton = (period: GoalPeriod): React.CSSProperties => ({
      ...(goalPlanDraft.targetPeriod === period ? btn : { ...btn, background: "#ffffff", color: "#0f766e" }),
      width: "100%",
      padding: "10px 12px",
    });
    const applyGeneratedStrategy = () => {
      const nextDraft = {
        ...goalPlanDraft,
        maxDailyLossPct: generatedStrategy.maxDailyLossPct,
        maxTradesPerDay: generatedStrategy.maxTradesPerDay,
        maxOpenPositions: generatedStrategy.maxOpenPositions,
        riskPerTradePct: generatedStrategy.riskPerTradePct,
        minConfidence: generatedStrategy.minConfidence,
        notes: generatedStrategy.notes,
      };
      setGoalPlanDraft((prev) => ({
        ...prev,
        maxDailyLossPct: generatedStrategy.maxDailyLossPct,
        maxTradesPerDay: generatedStrategy.maxTradesPerDay,
        maxOpenPositions: generatedStrategy.maxOpenPositions,
        riskPerTradePct: generatedStrategy.riskPerTradePct,
        minConfidence: generatedStrategy.minConfidence,
        notes: generatedStrategy.notes,
      }));
      setGoalPlanInputText(goalPlanNumberText(nextDraft));
    };
    const acceptPlan = () => {
      const next: GoalPlan = {
        ...goalPlanDraft,
        targetReturnPct: clamp(goalPlanDraft.targetReturnPct, 0.1, 25),
        horizonDays,
        dailyTargetPct: generatedStrategy.dailyTargetPct,
        strategyProfile: generatedStrategy.profile,
        startingEquityUsd: Math.max(100, goalPlanDraft.startingEquityUsd || simState.startingCashUsd),
        maxDailyLossPct: clamp(goalPlanDraft.maxDailyLossPct, 0.1, 20),
        maxTradesPerDay: Math.max(1, Math.round(goalPlanDraft.maxTradesPerDay || 1)),
        maxOpenPositions: Math.max(1, Math.round(goalPlanDraft.maxOpenPositions || 1)),
        riskPerTradePct: clamp(goalPlanDraft.riskPerTradePct, 0.1, 10),
        minConfidence: clamp(goalPlanDraft.minConfidence, 50, 95),
        id: `plan-${Date.now()}`,
        createdAtIso: goalPlan?.createdAtIso ?? new Date().toISOString(),
        acceptedAtIso: new Date().toISOString(),
        requiredWinRatePct,
        acceptedRisk: true,
      };
      setGoalPlan(next);
      setAccountUsd(next.startingEquityUsd);
      setRiskPct(next.riskPerTradePct);
      setGoalRiskAccepted(false);
      setTab("simulator");
    };

    return (
      <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 14 }}>
        <div style={panel}>
          <div style={sectionTitle}>COMMITMENT PLAN</div>
          <div style={{ ...subtle, marginTop: 6 }}>
            Set the exact outcome you want, accept the risk, then the simulator AI uses these rules to size, block, and review trades.
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <label>
              <div style={subtle}>Goal name</div>
              <input
                style={input}
                value={goalPlanDraft.goalName}
                onChange={(e) => setGoalPlanDraft((prev) => ({ ...prev, goalName: e.target.value }))}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                <div style={subtle}>Profit target (%)</div>
                <input
                  style={input}
                  inputMode="decimal"
                  value={goalPlanInputText.targetReturnPct}
                  onChange={(e) => updateDraftNumber("targetReturnPct", e.target.value)}
                  onBlur={() => normalizeDraftNumber("targetReturnPct")}
                />
              </label>
              <div>
                <div style={subtle}>Target period</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  {[
                    ["day", "Day"],
                    ["week", "Week"],
                    ["month", "Month"],
                  ].map(([period, label]) => (
                    <button
                      key={period}
                      type="button"
                      style={periodButton(period as GoalPeriod)}
                      onClick={() => setGoalPlanDraft((prev) => ({ ...prev, targetPeriod: period as GoalPeriod }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label>
                <div style={subtle}>Starting equity ($)</div>
                <input
                  style={input}
                  inputMode="decimal"
                  value={goalPlanInputText.startingEquityUsd}
                  onChange={(e) => updateDraftNumber("startingEquityUsd", e.target.value)}
                  onBlur={() => normalizeDraftNumber("startingEquityUsd")}
                />
              </label>
              <label>
                <div style={subtle}>Max daily loss (%)</div>
                <input
                  style={input}
                  inputMode="decimal"
                  value={goalPlanInputText.maxDailyLossPct}
                  onChange={(e) => updateDraftNumber("maxDailyLossPct", e.target.value)}
                  onBlur={() => normalizeDraftNumber("maxDailyLossPct")}
                />
              </label>
              <label>
                <div style={subtle}>Max trades/day</div>
                <input
                  style={input}
                  inputMode="numeric"
                  value={goalPlanInputText.maxTradesPerDay}
                  onChange={(e) => updateDraftNumber("maxTradesPerDay", e.target.value)}
                  onBlur={() => normalizeDraftNumber("maxTradesPerDay")}
                />
              </label>
              <label>
                <div style={subtle}>Max open holdings</div>
                <input
                  style={input}
                  inputMode="numeric"
                  value={goalPlanInputText.maxOpenPositions}
                  onChange={(e) => updateDraftNumber("maxOpenPositions", e.target.value)}
                  onBlur={() => normalizeDraftNumber("maxOpenPositions")}
                />
              </label>
              <label>
                <div style={subtle}>Risk per trade (%)</div>
                <input
                  style={input}
                  inputMode="decimal"
                  value={goalPlanInputText.riskPerTradePct}
                  onChange={(e) => updateDraftNumber("riskPerTradePct", e.target.value)}
                  onBlur={() => normalizeDraftNumber("riskPerTradePct")}
                />
              </label>
              <label>
                <div style={subtle}>Minimum AI confidence</div>
                <input
                  style={input}
                  inputMode="numeric"
                  value={goalPlanInputText.minConfidence}
                  onChange={(e) => updateDraftNumber("minConfidence", e.target.value)}
                  onBlur={() => normalizeDraftNumber("minConfidence")}
                />
              </label>
            </div>
            <div style={{ ...proPanel }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950, color: "#111827" }}>Generated strategy: {generatedStrategy.profile}</div>
                  <div style={{ ...subtle, marginTop: 6 }}>
                    {goalPlanDraft.targetReturnPct}% per {goalPlanDraft.targetPeriod} equals about {generatedStrategy.dailyTargetPct.toFixed(2)}% per day.
                  </div>
                </div>
                <button style={btn} onClick={applyGeneratedStrategy}>
                  Use Suggested Rules
                </button>
              </div>
              <div style={{ ...subtle, marginTop: 10 }}>{generatedStrategy.notes}</div>
            </div>
            <label>
              <div style={subtle}>Notes</div>
              <input
                style={input}
                value={goalPlanDraft.notes}
                onChange={(e) => setGoalPlanDraft((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </label>
          </div>
        </div>

        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>RISK ACCEPTANCE</div>
              <div style={{ ...subtle, marginTop: 6 }}>The app turns the goal into trade rules. The stop rules override the profit target.</div>
            </div>
            <span style={{ ...pill, color: riskTone.color }}>{riskTone.label}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
            <div style={statCard}>
              <div style={subtle}>Target / {goalPlanDraft.targetPeriod}</div>
              <div style={{ fontWeight: 950, color: "#047857" }}>{fmtUsd(targetUsd)}</div>
            </div>
            <div style={statCard}>
              <div style={subtle}>Loss cap</div>
              <div style={{ fontWeight: 950, color: "#b91c1c" }}>{fmtUsd(maxLossUsd)}</div>
            </div>
            <div style={statCard}>
              <div style={subtle}>Needed/trade/day</div>
              <div style={{ fontWeight: 950 }}>{targetPerTradePct.toFixed(2)}%</div>
            </div>
            <div style={statCard}>
              <div style={subtle}>Req. win rate</div>
              <div style={{ fontWeight: 950 }}>{requiredWinRatePct.toFixed(0)}%+</div>
            </div>
          </div>

          <div style={{ ...proPanel, marginTop: 14 }}>
            <div style={{ fontWeight: 950, color: "#111827" }}>AI operating rules after acceptance</div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {[
                `Only buy when scanner confidence is at least ${goalPlanDraft.minConfidence}%.`,
                `Stop new buys if open holdings reach ${goalPlanDraft.maxOpenPositions}.`,
                `Use about ${goalPlanDraft.riskPerTradePct}% of equity as the max AI sizing budget.`,
                `Stop trading if sim P/L reaches -${goalPlanDraft.maxDailyLossPct}%.`,
                `Protect the result once the plan reaches +${goalPlanDraft.targetReturnPct}% per ${goalPlanDraft.targetPeriod}.`,
              ].map((rule) => (
                <div key={rule} style={{ ...statCard, background: "#ffffff" }}>
                  <div style={{ fontWeight: 900, color: "#111827" }}>{rule}</div>
                </div>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, color: "#475569", lineHeight: 1.5 }}>
            <input type="checkbox" checked={goalRiskAccepted} onChange={(e) => setGoalRiskAccepted(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              I accept that this is simulator decision support, not financial advice. The target may be unrealistic, losses can happen fast, and the AI must stop when the plan risk cap is hit.
            </span>
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button style={goalRiskAccepted ? btnDanger : btnDisabled} disabled={!goalRiskAccepted} onClick={acceptPlan}>
              Accept Risk + Generate Plan
            </button>
            <button
              style={btn}
              onClick={() => {
                setGoalPlan(null);
                setGoalRiskAccepted(false);
              }}
            >
              Clear Active Plan
            </button>
          </div>

          {goalPlan && (
            <div style={{ ...statCard, marginTop: 14, borderColor: "#99f6e4", background: "#f0fdfa" }}>
              <div style={{ fontWeight: 950, color: "#047857" }}>Active plan: {goalPlan.goalName}</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {goalPlan.strategyProfile} strategy: +{goalPlan.targetReturnPct}% per {goalPlan.targetPeriod}, about +{goalPlan.dailyTargetPct.toFixed(2)}% per day, with a -{goalPlan.maxDailyLossPct}% stop. Simulator AI is now enforcing it.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const Simulator = () => (
    <>
      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={sectionTitle}>7-DAY SIM TRADING ACCOUNT</div>
            <div style={{ ...subtle, marginTop: 6 }}>Choose a coin, buy with simulated cash, sell when your plan says sell, then review the week.</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn} onClick={refresh} disabled={isLoading}>
              {isLoading ? "Loading..." : "Refresh Market"}
            </button>
            <button style={btnDanger} onClick={resetSimulator}>
              Reset Week
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
          <div
            style={{
              width: `${clamp((simElapsedDays / 7) * 100, 0, 100)}%`,
              height: "100%",
              background: simReturnPct >= 0 ? "linear-gradient(90deg, #047857, #0f766e)" : "linear-gradient(90deg, #b91c1c, #0f766e)",
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          <div style={statCard}>
            <div style={subtle}>Account Value</div>
            <div style={{ fontWeight: 950, fontSize: "1.35rem", color: simEquity >= simState.startingCashUsd ? "#047857" : "#b91c1c" }}>
              {fmtUsd(simEquity)}
            </div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Cash</div>
            <div style={{ fontWeight: 950, fontSize: "1.35rem" }}>{fmtUsd(simState.cashUsd)}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Holding P/L</div>
            <div style={{ fontWeight: 950, fontSize: "1.35rem", color: simOpenPnl >= 0 ? "#047857" : "#b91c1c" }}>{fmtUsd(simOpenPnl)}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Realized P/L</div>
            <div style={{ fontWeight: 950, fontSize: "1.35rem", color: simRealizedPnl >= 0 ? "#047857" : "#b91c1c" }}>{fmtUsd(simRealizedPnl)}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Week {simChallengeDay}/7</div>
            <div style={{ fontWeight: 950, fontSize: "1.35rem", color: simReturnPct >= 0 ? "#047857" : "#b91c1c" }}>
              {simReturnPct >= 0 ? "+" : ""}
              {simReturnPct.toFixed(2)}%
            </div>
          </div>
        </div>

        <div style={{ ...proPanel, marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14, alignItems: "center" }}>
            <div>
              <div style={sectionTitle}>{goalPlan ? "GOAL PLAN ACTIVE" : "NO ACCEPTED GOAL PLAN"}</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {goalPlan
                  ? `${goalPlan.goalName}: ${goalPlan.strategyProfile} mode targeting +${goalPlan.targetReturnPct}% per ${goalPlan.targetPeriod} while respecting a -${goalPlan.maxDailyLossPct}% stop.`
                  : "Create a commitment plan first. The AI will block new buys until a risk plan is accepted."}
              </div>
              {goalPlan && planProgress.isDailyPlan && (
                <div style={{ ...subtle, marginTop: 6 }}>
                  Daily reset is active for {todayKey}: today P/L {fmtUsd(todaySimProgress.pnlUsd)} from realized {fmtUsd(todaySimProgress.realizedToday)} and open {fmtUsd(todaySimProgress.openToday)}.
                </div>
              )}
              <div style={{ marginTop: 12, height: 8, borderRadius: 999, background: "#dbeafe", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${clamp(Math.max(0, planProgress.progressPct), 0, 100)}%`,
                    height: "100%",
                    background: planProgress.status === "STOP HIT" ? "#b91c1c" : "linear-gradient(90deg, #0f766e, #047857)",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ ...statCard, background: "#ffffff" }}>
                <div style={subtle}>Goal progress</div>
                <div style={{ fontWeight: 950, color: planProgress.pnlUsd >= 0 ? "#047857" : "#b91c1c" }}>
                  {planProgress.progressPct.toFixed(0)}%
                </div>
              </div>
              <div style={{ ...statCard, background: "#ffffff" }}>
                <div style={subtle}>Need</div>
                <div style={{ fontWeight: 950 }}>{fmtUsd(planProgress.targetUsd)}</div>
              </div>
              <div style={{ ...statCard, background: "#ffffff" }}>
                <div style={subtle}>Status</div>
                <div style={{ fontWeight: 950, color: planProgress.status === "STOP HIT" ? "#b91c1c" : planProgress.status === "GOAL HIT" ? "#047857" : "#111827" }}>
                  {planProgress.status}
                </div>
              </div>
            </div>
          </div>
          {!goalPlan && (
            <button style={{ ...btnDanger, marginTop: 12 }} onClick={() => setTab("plan")}>
              Build Commitment Plan
            </button>
          )}
        </div>

        <div style={{ ...panel, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>REAL AI DAILY MARKET BRIEF</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                Uses the OpenAI API through a server function to read the scanner, plan, holdings, and sim history.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#475569", fontWeight: 900 }}>
                <input type="checkbox" checked={liveNewsMode} onChange={(e) => setLiveNewsMode(e.target.checked)} />
                Live news
              </label>
              <button style={aiAdvisorLoading ? btnDisabled : btnDanger} disabled={aiAdvisorLoading} onClick={requestAiAdvisor}>
                {aiAdvisorLoading ? "Thinking..." : liveNewsMode ? "Generate Live Brief" : "Generate AI Brief"}
              </button>
            </div>
          </div>

          {aiAdvisorError && (
            <div style={{ ...statCard, marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
              <div style={{ fontWeight: 950, color: "#b91c1c" }}>AI not connected</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {aiAdvisorError} The UI is ready, but no real AI brief can be generated until `OPENAI_API_KEY` is added to the server env and the dev server is restarted.
              </div>
            </div>
          )}

          {!aiAdvisor && !aiAdvisorError && (
            <div style={{ ...emptyState, marginTop: 12 }}>
              Generate a brief to get actual AI commentary on today’s trend, likely market-data catalysts, trade ideas, and portfolio actions.
            </div>
          )}

          {aiAdvisor && (
            <>
              <div style={{ ...proPanel, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 950, color: "#111827", fontSize: "1.15rem" }}>{aiAdvisor.marketBrief.headline}</div>
                    <div style={{ ...subtle, marginTop: 6 }}>
                      Regime: <b style={{ color: "#111827" }}>{aiAdvisor.marketBrief.regime}</b>
                      {aiAdvisor.model ? ` · Model: ${aiAdvisor.model}` : ""}
                    </div>
                  </div>
                  {aiAdvisor.generatedAtIso && <span style={pill}>{new Date(aiAdvisor.generatedAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
                <div style={{ ...subtle, marginTop: 10 }}>{aiAdvisor.marketBrief.summary}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
                  <div style={{ ...statCard, background: "#ffffff" }}>
                    <div style={{ fontWeight: 950, color: "#047857" }}>What is moving it</div>
                    <div style={{ ...subtle, marginTop: 8 }}>{aiAdvisor.marketBrief.catalysts.join(" ") || "No clear catalyst from supplied data."}</div>
                    {aiAdvisor.marketBrief.sources.length > 0 && (
                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                        {aiAdvisor.marketBrief.sources.slice(0, 3).map((source) => (
                          <a key={source.url} href={source.url} target="_blank" rel="noreferrer" style={{ color: "#0f766e", fontWeight: 900, fontSize: "0.78rem" }}>
                            {source.title || source.url}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ ...statCard, background: "#ffffff" }}>
                    <div style={{ fontWeight: 950, color: "#b91c1c" }}>Risks</div>
                    <div style={{ ...subtle, marginTop: 8 }}>{aiAdvisor.marketBrief.risks.join(" ") || "No risk notes returned."}</div>
                  </div>
                  <div style={{ ...statCard, background: "#ffffff" }}>
                    <div style={{ fontWeight: 950, color: "#111827" }}>Avoid</div>
                    <div style={{ ...subtle, marginTop: 8 }}>{aiAdvisor.marketBrief.avoid.join(" ") || "No avoid list returned."}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14, marginTop: 14 }}>
                <div>
                  <div style={sectionTitle}>AI TRADE IDEAS</div>
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {aiAdvisor.tradeIdeas.length === 0 ? (
                      <div style={emptyState}>AI returned no trade ideas. That usually means wait.</div>
                    ) : (
                      aiAdvisor.tradeIdeas.map((idea) => (
                        <div key={`${idea.symbol}-${idea.action}`} style={statCard}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 950, color: idea.action === "BUY_TEST" ? "#047857" : idea.action === "AVOID" || idea.action === "SELL" ? "#b91c1c" : "#111827" }}>
                                {idea.action.replace("_", " ")} {idea.symbol} · {confidencePct(idea.confidence)}%
                              </div>
                              <div style={{ ...subtle, marginTop: 6 }}>{idea.thesis}</div>
                            </div>
                            <button style={idea.action === "BUY_TEST" || idea.action === "WATCH" ? btn : btnDisabled} disabled={idea.action !== "BUY_TEST" && idea.action !== "WATCH"} onClick={() => loadAiIdeaIntoTicket(idea)}>
                              Load Into Sim
                            </button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                            <div><div style={subtle}>Entry</div><div style={{ fontWeight: 900 }}>{idea.entryZone}</div></div>
                            <div><div style={subtle}>Stop</div><div style={{ fontWeight: 900, color: "#b91c1c" }}>{idea.stop}</div></div>
                            <div><div style={subtle}>Target</div><div style={{ fontWeight: 900, color: "#047857" }}>{idea.target}</div></div>
                            <div><div style={subtle}>Hold</div><div style={{ fontWeight: 900 }}>{idea.holdTime}</div></div>
                          </div>
                          <div style={{ ...subtle, marginTop: 10 }}>
                            Plan fit: {idea.planFit} {idea.reasons.join(" ")} {idea.warnings.length ? `Warnings: ${idea.warnings.join(" ")}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div style={proPanel}>
                  <div style={sectionTitle}>AI PORTFOLIO REVIEW</div>
                  <div style={{ marginTop: 10, fontWeight: 950, color: "#111827" }}>{aiAdvisor.portfolioReview.summary}</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {aiAdvisor.portfolioReview.actions.map((action) => (
                      <div key={action} style={{ ...statCard, background: "#ffffff" }}>
                        <div style={{ fontWeight: 900 }}>{action}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ ...subtle, marginTop: 10 }}>{aiAdvisor.disclaimer}</div>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ ...proPanel, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>SHORT-TERM / LONG-TERM HOLDINGS</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {simState.positions.length
                  ? `${simScalpPositions.length} scalp holding${simScalpPositions.length === 1 ? "" : "s"} · ${simLongStudyPositions.length} long-term study holding${simLongStudyPositions.length === 1 ? "" : "s"}.`
                  : "Nothing bought yet. Short-term scalps stay separate from long-term study ideas."}
              </div>
            </div>
            <span style={{ ...pill, color: simState.positions.length ? "#047857" : "#111827" }}>
              Scalp {simScalpPositions.length} / Study {simLongStudyPositions.length}
            </span>
          </div>
        </div>

        <div style={{ ...panel, marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 14, alignItems: "stretch" }}>
            <div>
              <div style={sectionTitle}>AI ADVICE</div>
              <div style={{ marginTop: 8, fontSize: "1.45rem", fontWeight: 950, color: aiAdvice.action === "BUY TEST" ? "#047857" : aiAdvice.action === "DO NOT BUY" ? "#b91c1c" : "#111827" }}>
                {aiAdvice.action}: {aiAdvice.symbol}
              </div>
              <div style={{ ...subtle, marginTop: 8 }}>
                {aiAdvice.when}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
                <div style={statCard}>
                  <div style={subtle}>Entry Zone</div>
                  <div style={{ fontWeight: 950 }}>{aiAdvice.price ? `${fmtUsd(aiAdvice.entryLow)} - ${fmtUsd(aiAdvice.entryHigh)}` : "Loading"}</div>
                </div>
                <div style={statCard}>
                  <div style={subtle}>Stop</div>
                  <div style={{ fontWeight: 950, color: "#b91c1c" }}>{aiAdvice.stop ? fmtUsd(aiAdvice.stop) : "Loading"}</div>
                </div>
                <div style={statCard}>
                  <div style={subtle}>Target</div>
                  <div style={{ fontWeight: 950, color: "#047857" }}>{aiAdvice.target ? fmtUsd(aiAdvice.target) : "Loading"}</div>
                </div>
                <div style={statCard}>
                  <div style={subtle}>Hold Time</div>
                  <div style={{ fontWeight: 950 }}>{aiAdvice.holdWindow}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  style={aiAdvice.loadable ? btn : btnDisabled}
                  disabled={!aiAdvice.loadable}
                  onClick={() => {
                    if (!aiAdvice.setup) return;
                    setSimSymbol(aiAdvice.setup.symbol);
                    setFocusSymbol(aiAdvice.setup.symbol);
                    if (aiAdvice.price) {
                      setEntryPrice(aiAdvice.price);
                      setStopPrice(aiAdvice.stop || aiAdvice.price * 0.985);
                    }
                    setSimBuyUsd(String(Math.max(0, aiTradeBrief.suggestedUsd || advancedAi.maxTradeUsd || 100)));
                    setSimThesis(`AI advice: ${aiAdvice.action} ${aiAdvice.symbol}. ${aiAdvice.when}`);
                  }}
                >
                  Load Advice Into Ticket
                </button>
                <span style={{ ...pill, color: aiAdvice.confidence >= 78 ? "#047857" : "#b91c1c" }}>Advice confidence: {aiAdvice.confidence}%</span>
              </div>
            </div>

            <div style={proPanel}>
              <div style={sectionTitle}>SELL / INVALIDATE IF</div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {aiAdvice.invalidation.map((rule) => (
                  <div key={rule} style={{ ...statCard, background: "#ffffff" }}>
                    <div style={{ fontWeight: 900, color: "#111827" }}>{rule}</div>
                  </div>
                ))}
              </div>
              <div style={{ ...subtle, marginTop: 10 }}>
                This is simulator guidance, not a promise. The app is deliberately built to block weak trades and force a stop/target/hold plan before you buy.
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...panel, marginTop: 14, background: "#f8fafc" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center" }}>
            <div>
              <div style={sectionTitle}>AI COMMAND BRIEF</div>
              <div style={{ marginTop: 8, fontSize: "1.25rem", fontWeight: 950, color: aiTradeBrief.tone }}>
                {aiTradeBrief.action}: {aiTradeBrief.headline}
              </div>
              <div style={{ ...subtle, marginTop: 8 }}>
                {proPass
                  ? aiTradeBrief.reasons.join(" ")
                  : `${aiTradeBrief.reasons[0]} Unlock Pro for the full decision chain, alerts, and weekly review.`}
              </div>
              {simSelectedHolding && (
                <div style={{ ...subtle, marginTop: 8 }}>
                  Current {simSymbol} holding P/L:{" "}
                  <b style={{ color: simSelectedHoldingPnl >= 0 ? "#047857" : "#b91c1c" }}>{fmtUsd(simSelectedHoldingPnl)}</b>
                </div>
              )}
            </div>
            <div style={{ minWidth: 170, ...statCard }}>
              <div style={subtle}>Confidence</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 950, color: aiTradeBrief.tone }}>{aiTradeBrief.confidence}%</div>
              <div style={{ ...subtle, marginTop: 4 }}>Suggested sim size: {fmtUsd(aiTradeBrief.suggestedUsd)}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div style={panel}>
            <div style={sectionTitle}>ADVANCED AI EDGE ENGINE</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              This is a stricter model: it estimates whether the setup still has edge after costs, then blocks trades that fail timing, structure, confidence, or exposure rules.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
              <div style={statCard}>
                <div style={subtle}>Regime</div>
                <div style={{ fontWeight: 950, color: advancedAi.marketRegime === "DEFENSIVE" ? "#b91c1c" : "#047857" }}>
                  {advancedAi.marketRegime}
                </div>
              </div>
              <div style={statCard}>
                <div style={subtle}>Edge After Costs</div>
                <div style={{ fontWeight: 950, color: advancedAi.scannerEdgePct > 0 ? "#047857" : "#b91c1c" }}>
                  {advancedAi.scannerEdgePct >= 0 ? "+" : ""}
                  {advancedAi.scannerEdgePct.toFixed(2)}%
                </div>
              </div>
              <div style={statCard}>
                <div style={subtle}>Risk State</div>
                <div style={{ fontWeight: 950, color: advancedAi.riskState === "GREEN" ? "#047857" : advancedAi.riskState === "YELLOW" ? "#111827" : "#b91c1c" }}>
                  {advancedAi.riskState}
                </div>
              </div>
              <div style={statCard}>
                <div style={subtle}>Max Trade</div>
                <div style={{ fontWeight: 950, color: "#111827" }}>{fmtUsd(advancedAi.maxTradeUsd)}</div>
              </div>
            </div>

            <div style={{ ...proPanel, marginTop: 12 }}>
              <div style={{ color: advancedAi.shouldTrade ? "#047857" : "#b91c1c", fontWeight: 950 }}>
                {advancedAi.shouldTrade ? "AI says this is tradable in the simulator." : "AI says do not buy yet."}
              </div>
              <div style={{ ...subtle, marginTop: 8 }}>
                {advancedAi.blockers.length
                  ? advancedAi.blockers.join(" ")
                  : "No hard blockers. Still use the simulator first and respect the max trade size."}
              </div>
            </div>
          </div>

          <div style={panel}>
            <div style={sectionTitle}>EXECUTION PLAN</div>
            <div style={{ ...subtle, marginTop: 6 }}>The AI converts the scanner read into a repeatable trade plan instead of a guess.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              {advancedAi.executionRules.map((rule) => (
                <div key={rule} style={statCard}>
                  <div style={{ fontWeight: 900, color: "#111827" }}>{rule}</div>
                </div>
              ))}
            </div>
            <div style={{ ...statCard, marginTop: 12 }}>
              <div style={subtle}>Your sim evidence</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                <div>
                  <div style={subtle}>Win Rate</div>
                  <div style={{ fontWeight: 950 }}>{simStats.winRate.toFixed(0)}%</div>
                </div>
                <div>
                  <div style={subtle}>Expectancy</div>
                  <div style={{ fontWeight: 950, color: simStats.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>
                    {simStats.expectancyPct >= 0 ? "+" : ""}
                    {simStats.expectancyPct.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div style={subtle}>Payoff</div>
                  <div style={{ fontWeight: 950 }}>{simStats.payoffRatio >= 10 ? "10+" : simStats.payoffRatio.toFixed(2)}x</div>
                </div>
                <div>
                  <div style={subtle}>Trades</div>
                  <div style={{ fontWeight: 950 }}>
                    {simStats.wins}/{simStats.losses}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={sectionTitle}>SHORT-TERM SCALP / MOMENTUM BURST</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              Main trading lane: awake-only, short holds, mandatory stop/target, and no overnight drift.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={simTradeMode === "NORMAL" ? btnDanger : btn} onClick={() => setSimTradeMode("NORMAL")}>
              Long-Term Study
            </button>
            <button style={simTradeMode === "SCALP" ? btnDanger : btn} onClick={() => setSimTradeMode("SCALP")}>
              Short-Term Scalp
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(220px, 1fr))", gap: 10, marginTop: 12, overflowX: "auto", paddingBottom: 4 }}>
          {scalpSignals.length === 0 ? (
            <div style={{ ...emptyState, gridColumn: "1 / -1" }}>No burst candidates loaded yet. Refresh Market to scan the universe.</div>
          ) : (
            scalpSignals.slice(0, 8).map((signal) => (
              <div
                key={signal.symbol}
                style={{
                  ...statCard,
                  background: signal.symbol === simSymbol && simTradeMode === "SCALP" ? "#eef7f5" : "#ffffff",
                  borderColor: signal.symbol === simSymbol && simTradeMode === "SCALP" ? "#0f766e" : "#e2e8f0",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 950, color: "#111827" }}>{signal.symbol}</div>
                    <div style={{ ...subtle, marginTop: 4 }}>{fmtUsd(signal.price)}</div>
                  </div>
                  <span style={{ ...pill, color: signal.tone }}>{signal.burstScore}/100</span>
                </div>
                <div style={{ marginTop: 10, fontWeight: 950, color: signal.tone }}>{signal.action.replace("_", " ")} · {signal.speedLabel} · {signal.legsLabel}</div>
                <div style={{ ...subtle, marginTop: 6 }}>{signal.reasons.join(" · ")}</div>
                {signal.warnings.length > 0 && <div style={{ ...subtle, marginTop: 6, color: "#92400e" }}>{signal.warnings[0]}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                  <div>
                    <div style={subtle}>Legs</div>
                    <div style={{ fontWeight: 900, color: signal.legsScore >= 55 ? "#047857" : "#b91c1c" }}>{signal.legsScore}</div>
                  </div>
                  <div>
                    <div style={subtle}>Peak</div>
                    <div style={{ fontWeight: 900, color: signal.peakRiskScore >= 58 ? "#b91c1c" : "#047857" }}>{signal.peakRiskScore}</div>
                  </div>
                  <div>
                    <div style={subtle}>Stop</div>
                    <div style={{ fontWeight: 900, color: "#b91c1c", overflowWrap: "anywhere" }}>{fmtUsd(signal.stop)}</div>
                  </div>
                  <div>
                    <div style={subtle}>Target</div>
                    <div style={{ fontWeight: 900, color: "#047857", overflowWrap: "anywhere" }}>{fmtUsd(signal.target)}</div>
                  </div>
                </div>
                <button
                  style={{ ...(signal.action === "SCALP_TEST" ? btnDanger : btn), width: "100%", marginTop: 10 }}
                  onClick={() => {
                    setSimTradeMode("SCALP");
                    setSimSymbol(signal.symbol);
                    setFocusSymbol(signal.symbol);
                    setEntryPrice(signal.price);
                    setStopPrice(signal.stop);
                    setSimStopLossInput(signal.stop.toPrecision(8));
                    setSimTakeProfitInput(signal.target.toPrecision(8));
                    setSimBuyUsd(String(signal.suggestedUsd || 50));
                    setSimThesis(`Quick scalp ${signal.speedLabel} ${signal.legsLabel}: legs ${signal.legsScore}/100, peak risk ${signal.peakRiskScore}/100. ${signal.reasons.join(" ")} ${signal.warnings.join(" ")}`);
                  }}
                >
                  Load Scalp Ticket
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
          <div style={statCard}>
            <div style={subtle}>Scalp trades</div>
            <div style={{ fontWeight: 950 }}>{simScalpStats.trades}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Scalp win rate</div>
            <div style={{ fontWeight: 950 }}>{simScalpStats.trades ? `${simScalpStats.winRate.toFixed(0)}%` : "No data"}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Scalp P/L</div>
            <div style={{ fontWeight: 950, color: simScalpStats.pnlUsd >= 0 ? "#047857" : "#b91c1c" }}>{fmtUsd(simScalpStats.pnlUsd)}</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Scalp expectancy</div>
            <div style={{ fontWeight: 950, color: simScalpStats.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>
              {simScalpStats.trades ? `${simScalpStats.expectancyPct >= 0 ? "+" : ""}${simScalpStats.expectancyPct.toFixed(2)}%` : "No data"}
            </div>
          </div>
        </div>

        <div style={{ ...subtle, marginTop: 10 }}>
          Scalp rules: smaller size, mandatory stop, mandatory target, and exit fast while you are awake. If a scalp is still open later, treat it as stale unless the setup clearly re-accelerates.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.15fr", gap: 14, marginTop: 14 }}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>BUY TICKET</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {simTradeMode === "SCALP" ? "Short-term scalp ticket: small size, fast exit, no late chases, no overnight holds." : "Long-term study ticket: research the idea separately from your scalp lane."}
              </div>
            </div>
            <span style={{ ...pill, color: simTradeMode === "SCALP" ? "#b91c1c" : "#047857" }}>
              {simTradeMode === "SCALP" ? "SHORT-TERM SCALP" : "LONG-TERM STUDY"}
            </span>
          </div>

          <div style={{ ...proPanel, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, fontSize: "1.6rem", color: "#111827" }}>{simSymbol}</div>
                <div style={{ ...subtle, marginTop: 4 }}>
                  Price: <b style={{ color: "#111827" }}>{fmtUsd(simulatorPrice)}</b>
                </div>
              </div>
              <ScorePill score={simSelectedSetup?.combinedScore ?? 0} />
            </div>

            <div style={{ ...statCard, marginTop: 12, background: "#ffffff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950, color: "#111827" }}>24h Performance</div>
                  <div style={{ ...subtle, marginTop: 3 }}>Hourly path from CoinGecko for the inspected coin.</div>
                </div>
                <span style={{ ...pill, color: selectedPriceHistory.length >= 2 ? "#047857" : "#92400e" }}>
                  {selectedPriceHistory.length >= 2 ? `${selectedPriceHistory.length} points` : "Loading"}
                </span>
              </div>
              <div style={{ marginTop: 10 }}>
                <CoinPerformanceChart prices={selectedPriceHistory} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div style={statCard}>
                <div style={subtle}>Entry</div>
                <div style={{ fontWeight: 950, color: simSelectedSetup?.entryQuality === "VALID" ? "#047857" : "#111827" }}>
                  {simSelectedSetup?.entryQuality ?? "LOADING"}
                </div>
              </div>
              <div style={statCard}>
                <div style={subtle}>Structure</div>
                <div style={{ fontWeight: 950, color: simSelectedSetup?.structureLabel === "OK" ? "#047857" : "#111827" }}>
                  {simSelectedSetup?.structureLabel ?? "LOADING"}
                </div>
              </div>
            </div>

            {simSelectedSetup?.structureWhy.length ? <div style={{ ...subtle, marginTop: 10 }}>{simSelectedSetup.structureWhy[0]}</div> : null}
            {simTradeMode === "SCALP" && selectedScalpSignal && (
              <div style={{ ...statCard, marginTop: 10, background: "#ffffff", borderColor: selectedScalpSignal.action === "SCALP_TEST" ? "#99f6e4" : "#fed7aa" }}>
                <div style={{ fontWeight: 950, color: selectedScalpSignal.tone }}>
                  Burst: {selectedScalpSignal.action.replace("_", " ")} · {selectedScalpSignal.burstScore}/100
                </div>
                <div style={{ ...subtle, marginTop: 6 }}>{selectedScalpSignal.holdWindow}</div>
              </div>
            )}
          </div>

          <div style={{ ...statCard, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={subtle}>Selected coin</div>
                <div style={{ fontWeight: 950, fontSize: "1.1rem", color: "#111827" }}>{simSymbol}</div>
              </div>
              <button style={btn} onClick={() => setSimCoinSearch("")}>
                Browse Coins
              </button>
            </div>
            <div style={{ ...subtle, marginTop: 8 }}>Use the scrollable coin list on the right to choose what to buy.</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={subtle}>Buy amount (sim USD)</div>
            <input
              style={input}
              inputMode="decimal"
              value={simBuyUsd}
              onChange={(e) => setSimBuyUsd(e.target.value)}
              placeholder="Enter amount, e.g. 250"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
              {["100", "250", "500", "1000"].map((amount) => (
                <button key={amount} style={btn} onClick={() => setSimBuyUsd(amount)}>
                  ${amount}
                </button>
              ))}
            </div>
            <button
              style={{ ...((simTradeMode === "SCALP" ? (selectedScalpSignal?.suggestedUsd ?? 0) : aiTradeBrief.suggestedUsd) > 0 ? btn : btnDisabled), width: "100%", marginTop: 8 }}
              disabled={(simTradeMode === "SCALP" ? (selectedScalpSignal?.suggestedUsd ?? 0) : aiTradeBrief.suggestedUsd) <= 0}
              onClick={() => setSimBuyUsd(String(simTradeMode === "SCALP" ? selectedScalpSignal?.suggestedUsd ?? 0 : aiTradeBrief.suggestedUsd))}
            >
              Use {simTradeMode === "SCALP" ? "Scalp" : "AI"} Size ({fmtUsd(simTradeMode === "SCALP" ? selectedScalpSignal?.suggestedUsd ?? 0 : aiTradeBrief.suggestedUsd)})
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={subtle}>Stop loss / take profit</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
              <input
                style={{ ...input, borderColor: simStopLossInput && !simStopLossValid ? "#fecaca" : input.borderColor }}
                inputMode="decimal"
                value={simStopLossInput}
                onChange={(e) => setSimStopLossInput(e.target.value)}
                placeholder="Stop below price"
              />
              <input
                style={{ ...input, borderColor: simTakeProfitInput && !simTakeProfitValid ? "#fecaca" : input.borderColor }}
                inputMode="decimal"
                value={simTakeProfitInput}
                onChange={(e) => setSimTakeProfitInput(e.target.value)}
                placeholder="Target above price"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
              <button
                style={btn}
                onClick={() => {
                  const stop = simulatorPrice * 0.99;
                  setSimStopLossInput(stop.toPrecision(8));
                  setSimTakeProfitInput((simulatorPrice + (simulatorPrice - stop) * 2).toPrecision(8));
                }}
              >
                1% / 2R
              </button>
              <button
                style={btn}
                onClick={() => {
                  const stop = simulatorPrice * 0.985;
                  setSimStopLossInput(stop.toPrecision(8));
                  setSimTakeProfitInput((simulatorPrice + (simulatorPrice - stop) * 2).toPrecision(8));
                }}
              >
                1.5% / 2R
              </button>
              <button
                style={btn}
                onClick={() => {
                  const stop = simulatorPrice * 0.98;
                  setSimStopLossInput(stop.toPrecision(8));
                  setSimTakeProfitInput((simulatorPrice + (simulatorPrice - stop) * 2).toPrecision(8));
                }}
              >
                2% / 2R
              </button>
            </div>
            <div style={{ ...subtle, marginTop: 8 }}>
              Planned loss {simPlannedLossPct ? simPlannedLossPct.toFixed(2) : "0.00"}% · planned gain{" "}
              {simPlannedGainPct ? simPlannedGainPct.toFixed(2) : "0.00"}% · R:R {simRewardRisk ? simRewardRisk.toFixed(2) : "0.00"}x
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={subtle}>Why are you buying?</div>
            <input
              style={input}
              value={simThesis}
              onChange={(e) => setSimThesis(e.target.value)}
              placeholder="e.g. Scanner VALID + Structure OK, quick day-trade test"
            />
          </div>

          {simCanBuySelected && simStopLossValid && simTakeProfitValid && simTradeWarningActive && (
            <div style={{ ...statCard, marginTop: 10, borderColor: "#fed7aa", background: "#fff7ed" }}>
              <div style={{ fontWeight: 950, color: "#9a3412" }}>{simTradeMode === "SCALP" ? "Scalp warning" : "AI warning"}</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {simBuyBlocker} This is allowed in the simulator, but the trade will be marked as a warning entry.
              </div>
            </div>
          )}

          <button
            style={{ ...(simBuyAllowed ? (simTradeWarningActive ? btnDanger : btn) : btnDisabled), width: "100%", marginTop: 12, padding: "11px 12px" }}
            disabled={!simBuyAllowed}
            onClick={() => buySimCrypto(simSymbol)}
          >
            {simBuyAllowed ? (simTradeWarningActive ? `Buy Anyway: ${simSymbol}` : `Buy ${simSymbol}`) : `Complete Ticket for ${simSymbol}`}
          </button>

          <div style={{ ...subtle, marginTop: 10 }}>
            {!simCanBuySelected
              ? "Coins are listed, but this coin needs a live price before buying is enabled. Use Refresh Market or run through localhost:8888."
              : !simStopLossValid || !simTakeProfitValid
                ? "Set a stop loss below price and take profit above price before the simulator can record the trade."
                : simTradeWarningActive
                  ? `${simTradeMode === "SCALP" ? "Scalp warning" : "AI warning"}: ${simBuyBlocker} You can still buy in the simulator.`
                  : `Buying uses the current market price. Time left: ${simDaysLeft.toFixed(1)} days.`}
          </div>
        </div>

        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>SCANNER UNIVERSE</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                Revolut UK candidate universe: {universeStats.total} coins. Live data loaded for {universeStats.live}; missing entries stay visible for cleanup.
              </div>
            </div>
            <input
              style={{ ...input, maxWidth: 260 }}
              placeholder="Search coins..."
              value={simCoinSearch}
              onChange={(e) => setSimCoinSearch(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12, maxHeight: 520, overflow: "auto", paddingRight: 4 }}>
            {simCoinChoices.map((s) => {
              const selected = s.symbol === simSymbol;
              const scalpSignal = scalpSignalBySymbol.get(s.symbol);
              const coinVerdict =
                scalpSignal?.legsLabel === "HAS LEGS" && scalpSignal.action === "SCALP_TEST"
                  ? "LEGS"
                  : scalpSignal?.legsLabel === "PEAK RISK" || scalpSignal?.action === "TOO_LATE"
                    ? "PEAK RISK"
                    : scalpSignal?.speedLabel === "FADING"
                      ? "FADING"
                      : s.priceUsd && s.entryQuality === "VALID" && s.structureLabel === "OK" && s.combinedScore >= 70
                        ? "WATCH"
                        : s.priceUsd
                          ? "WAIT"
                          : "Loading";
              return (
                <div
                  key={s.symbol}
                  onClick={() => {
                    setSimSymbol(s.symbol);
                    setFocusSymbol(s.symbol);
                    if (s.priceUsd) {
                      setEntryPrice(s.priceUsd);
                      setStopPrice(s.priceUsd * 0.985);
                      setSimStopLossInput((s.priceUsd * 0.985).toPrecision(8));
                      setSimTakeProfitInput((s.priceUsd * 1.03).toPrecision(8));
                    }
                  }}
                  style={{
                    ...statCard,
                    cursor: "pointer",
                    border: selected ? "1px solid #0f766e" : statCard.border,
                    background: selected ? "#eef7f5" : statCard.background,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontWeight: 950 }}>{s.symbol}</div>
                    <ScorePill score={s.combinedScore} />
                  </div>
                  <div style={{ ...subtle, marginTop: 8 }}>
                    {fmtUsd(s.priceUsd)} · {fmtPct(s.change24h)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span style={{ ...pill, borderRadius: 7, color: s.entryQuality === "VALID" ? "#047857" : "#92400e" }}>{s.entryQuality}</span>
                    <span style={{ ...pill, borderRadius: 7, color: s.structureLabel === "OK" ? "#047857" : "#92400e" }}>{s.structureLabel}</span>
                    <span
                      style={{
                        ...pill,
                        borderRadius: 7,
                        color: coinVerdict === "LEGS" ? "#047857" : coinVerdict === "PEAK RISK" || coinVerdict === "FADING" ? "#b91c1c" : "#64748b",
                      }}
                    >
                      {coinVerdict}
                    </span>
                  </div>
                  {scalpSignal && (
                    <div style={{ ...subtle, marginTop: 8 }}>
                      Legs {scalpSignal.legsScore}/100 · Peak risk {scalpSignal.peakRiskScore}/100 · {scalpSignal.speedLabel}
                    </div>
                  )}
                  <button
                    style={{ ...(s.priceUsd ? btn : btnDisabled), marginTop: 10, width: "100%" }}
                    disabled={!s.priceUsd}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSimSymbol(s.symbol);
                      setFocusSymbol(s.symbol);
                      if (s.priceUsd) {
                        setEntryPrice(s.priceUsd);
                        setStopPrice(s.priceUsd * 0.985);
                        setSimStopLossInput((s.priceUsd * 0.985).toPrecision(8));
                        setSimTakeProfitInput((s.priceUsd * 1.03).toPrecision(8));
                      }
                    }}
                  >
                    Inspect
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 14, marginTop: 14 }}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={sectionTitle}>PORTFOLIO / CURRENT HOLDINGS</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                {aiAdvisor
                  ? `Real AI review: ${aiAdvisor.portfolioReview.summary}`
                  : `Rule review: ${holdingSummary.headline} · sell ${holdingSummary.sell} · hold ${holdingSummary.hold} · increase ${holdingSummary.increase}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button style={aiAdvisorLoading ? btnDisabled : btnDanger} disabled={aiAdvisorLoading} onClick={requestAiAdvisor}>
                {aiAdvisorLoading ? "Checking..." : aiAdvisor ? "Refresh Real AI" : "Generate Real AI"}
              </button>
              <span style={{ ...pill, color: aiAdvisor ? "#047857" : holdingSummary.sell ? "#b91c1c" : holdingSummary.increase ? "#047857" : "#111827" }}>
                {aiAdvisor ? "REAL AI" : holdingSummary.headline}
              </span>
            </div>
          </div>
          {aiAdvisorError && (
            <div style={{ ...statCard, marginTop: 10, borderColor: "#fecaca", background: "#fff1f2" }}>
              <div style={{ fontWeight: 950, color: "#b91c1c" }}>Real AI needs setup</div>
              <div style={{ ...subtle, marginTop: 6 }}>{aiAdvisorError}</div>
            </div>
          )}
          <div
            style={{
              marginTop: 10,
              overflowX: "auto",
              overflowY: "visible",
              WebkitOverflowScrolling: "touch",
              paddingBottom: 8,
            }}
          >
            {simState.positions.length === 0 ? (
              <div style={emptyState}>No simulated crypto bought yet. Pick a coin in the scanner universe, choose a buy amount, then use Buy.</div>
            ) : (
              <table style={{ width: "100%", minWidth: 1240, borderCollapse: "separate", borderSpacing: "0 8px" }}>
                <thead>
                  <tr style={{ color: "#64748b", fontSize: "0.78rem", textAlign: "left" }}>
                    <th style={{ paddingLeft: 8 }}>Coin</th>
                    <th>Buy</th>
                    <th>Market</th>
                    <th>Qty</th>
                    <th>Value</th>
                    <th>P/L</th>
                    <th>Stop</th>
                    <th>Target</th>
                    <th>AI</th>
                    <th>Scanner</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Short-term scalps", rows: simScalpPositions, note: "Awake-only trades. Close fast; do not let these turn into overnight holds." },
                    { label: "Long-term study", rows: simLongStudyPositions, note: "Research lane only. Use this to learn, not as the default trading style." },
                  ].map((group) =>
                    group.rows.length ? (
                      <React.Fragment key={group.label}>
                        <tr>
                          <td colSpan={11} style={{ padding: "8px", background: "#ffffff" }}>
                            <div style={{ fontWeight: 950, color: group.label === "Short-term scalps" ? "#b91c1c" : "#0f766e" }}>{group.label}</div>
                            <div style={{ ...subtle, marginTop: 4 }}>{group.note}</div>
                          </td>
                        </tr>
                        {group.rows.map((p) => {
                    const now = getSimPrice(p.symbol) || p.entry;
                    const value = now * p.qty;
                    const pnl = (now - p.entry) * p.qty;
                    const stopGapPct = p.stop ? ((now - p.stop) / now) * 100 : 0;
                    const targetGapPct = p.takeProfit ? ((p.takeProfit - now) / now) * 100 : 0;
                    const review = holdingReviews.find((r) => r.id === p.id);
                    const realAiHolding = aiAdvisor?.portfolioReview.holdings.find((h) => h.symbol.toUpperCase() === p.symbol.toUpperCase());
                    const realAiTone =
                      realAiHolding?.action === "SELL" || realAiHolding?.action === "REDUCE" || realAiHolding?.action === "FREE_CAPITAL"
                        ? "#b91c1c"
                        : realAiHolding?.action === "INCREASE"
                          ? "#047857"
                          : "#111827";
                    return (
                      <tr key={p.id} style={{ background: "#f8fafc", verticalAlign: "top" }}>
                        <td style={{ padding: "10px 8px", fontWeight: 950 }}>
                          {p.symbol}
                          {p.mode === "SCALP" && <div style={{ ...pill, marginTop: 6, display: "inline-block", color: "#b91c1c" }}>SCALP</div>}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{fmtUsd(p.entry)}</td>
                        <td style={{ padding: "10px 8px" }}>{fmtUsd(now)}</td>
                        <td style={{ padding: "10px 8px" }}>{p.qty.toFixed(6)}</td>
                        <td style={{ padding: "10px 8px" }}>{fmtUsd(value)}</td>
                        <td style={{ padding: "10px 8px", color: pnl >= 0 ? "#047857" : "#b91c1c", fontWeight: 950 }}>{fmtUsd(pnl)}</td>
                        <td style={{ padding: "10px 8px", minWidth: 130 }}>
                          <input
                            style={{ ...input, padding: "7px 8px", borderColor: p.stop ? "#fecaca" : "#cbd5e1" }}
                            inputMode="decimal"
                            defaultValue={p.stop ? p.stop.toPrecision(8) : ""}
                            onBlur={(e) => updateSimHoldingExit(p.id, "stop", e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            placeholder="No stop"
                          />
                          <div style={{ ...subtle, marginTop: 4 }}>{p.stop ? `${stopGapPct.toFixed(2)}% away` : "Unprotected"}</div>
                        </td>
                        <td style={{ padding: "10px 8px", minWidth: 130 }}>
                          <input
                            style={{ ...input, padding: "7px 8px", borderColor: p.takeProfit ? "#bbf7d0" : "#cbd5e1" }}
                            inputMode="decimal"
                            defaultValue={p.takeProfit ? p.takeProfit.toPrecision(8) : ""}
                            onBlur={(e) => updateSimHoldingExit(p.id, "takeProfit", e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            placeholder="No target"
                          />
                          <div style={{ ...subtle, marginTop: 4 }}>{p.takeProfit ? `${targetGapPct.toFixed(2)}% away` : "No exit"}</div>
                        </td>
                        <td style={{ padding: "10px 8px", minWidth: 210 }}>
                          {realAiHolding ? (
                            <div>
                              <div style={{ fontWeight: 950, color: realAiTone }}>
                                {realAiHolding.action.replace("_", " ")} · {confidencePct(realAiHolding.confidence)}%
                              </div>
                              <div style={{ ...subtle, marginTop: 4 }}>{realAiHolding.reason}</div>
                              <div style={{ ...subtle, marginTop: 4 }}>
                                {realAiHolding.goalImpact}
                                {realAiHolding.replacementIdea ? ` Replacement: ${realAiHolding.replacementIdea}` : ""}
                              </div>
                            </div>
                          ) : review ? (
                            <div>
                              <div style={{ fontWeight: 950, color: review.tone }}>{review.action}</div>
                              <div style={{ ...subtle, marginTop: 4 }}>{review.reasons.slice(0, 2).join(" ")}</div>
                              <div style={{ ...subtle, marginTop: 4 }}>Generate Real AI for capital rotation advice.</div>
                            </div>
                          ) : (
                            <span style={subtle}>Review loading</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px", color: "#64748b" }}>{p.source}</td>
                        <td
                          style={{
                            padding: "10px 8px",
                            textAlign: "right",
                            minWidth: 170,
                            position: "sticky",
                            right: 0,
                            background: "#f8fafc",
                            boxShadow: "-14px 0 18px rgba(248,250,252,0.92)",
                          }}
                        >
                          {review?.action === "INCREASE" && (
                            <button
                              style={{ ...btn, marginRight: 6, marginBottom: 6 }}
                              onClick={() => {
                                setSimSymbol(p.symbol);
                                setFocusSymbol(p.symbol);
                                setEntryPrice(now);
                                setStopPrice(p.stop ?? now * 0.985);
                                setSimStopLossInput((p.stop ?? now * 0.985).toPrecision(8));
                                setSimTakeProfitInput((p.takeProfit ?? now * 1.03).toPrecision(8));
                                setSimBuyUsd(String(review.addUsd || 50));
                                setSimThesis(`AI holding review: increase ${p.symbol}. ${review.reasons.join(" ")}`);
                              }}
                            >
                              Add
                            </button>
                          )}
                          {realAiHolding && (realAiHolding.action === "SELL" || realAiHolding.action === "REDUCE" || realAiHolding.action === "FREE_CAPITAL") && (
                            <button style={{ ...btnDanger, marginRight: 6, marginBottom: 6 }} onClick={() => sellSimHolding(p.id)}>
                              AI Sell
                            </button>
                          )}
                          <button
                            style={{ ...btn, marginRight: 6, marginBottom: 6 }}
                            onClick={() => {
                              setSimSymbol(p.symbol);
                              setFocusSymbol(p.symbol);
                              setEntryPrice(now);
                              setStopPrice(p.stop ?? now * 0.985);
                              setSimStopLossInput((p.stop ?? now * 0.985).toPrecision(8));
                              setSimTakeProfitInput((p.takeProfit ?? now * 1.03).toPrecision(8));
                            }}
                          >
                            Review
                          </button>
                          <button style={btn} onClick={() => sellSimHolding(p.id)}>
                            Sell
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                      </React.Fragment>
                    ) : null
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={panel}>
          <div style={sectionTitle}>END RESULT TRACKER</div>
          <div style={{ ...proPanel, marginTop: 12 }}>
            <div style={{ fontWeight: 950, color: simReturnPct >= 0 ? "#047857" : "#b91c1c" }}>
              {simEquity >= simState.startingCashUsd ? "Currently profitable" : "Currently down"}
            </div>
            <div style={{ ...subtle, marginTop: 8 }}>
              Started with {fmtUsd(simState.startingCashUsd)}. Current account value is {fmtUsd(simEquity)}.
            </div>
          </div>

          <div style={{ marginTop: 12, overflow: "auto", maxHeight: 520 }}>
            {simState.history.length === 0 ? (
              <div style={emptyState}>Sell a holding to build your buy/sell history and see whether the scanner helped.</div>
            ) : (
              simState.history.map((t) => (
                <div key={t.id} style={{ ...statCard, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>
                      Bought and sold {t.symbol}
                      {(t.mode === "SCALP" || t.source.startsWith("SCALP")) && (
                        <span style={{ ...pill, marginLeft: 8, color: "#b91c1c" }}>SCALP</span>
                      )}
                      {t.exitReason && (
                        <span style={{ ...pill, marginLeft: 8, color: t.exitReason === "TAKE_PROFIT" ? "#047857" : t.exitReason === "STOP_LOSS" ? "#b91c1c" : "#111827" }}>
                          {t.exitReason.replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <div style={{ color: t.pnlUsd >= 0 ? "#047857" : "#b91c1c", fontWeight: 950 }}>
                      {fmtUsd(t.pnlUsd)} ({t.pnlPct >= 0 ? "+" : ""}
                      {t.pnlPct.toFixed(2)}%)
                    </div>
                  </div>
                  <div style={{ ...subtle, marginTop: 8 }}>
                    Buy {fmtUsd(t.entry)} · Sell {fmtUsd(t.exit)} · {new Date(t.closedAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ ...subtle, marginTop: 8 }}>
                    Stop {t.stop ? fmtUsd(t.stop) : "none"} · Target {t.takeProfit ? fmtUsd(t.takeProfit) : "none"}
                  </div>
                  <div style={{ ...subtle, marginTop: 8 }}>Scanner tag: {t.source}</div>
                  {t.thesis && <div style={{ ...subtle, marginTop: 8 }}>{t.thesis}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );

  const Accuracy = () => (
    <>
      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={sectionTitle}>ACCURACY LAB</div>
            <div style={{ marginTop: 8, fontSize: "1.35rem", fontWeight: 950, color: "#111827" }}>
              Proof before confidence.
            </div>
            <div style={{ ...subtle, marginTop: 6 }}>
              This page scores the scanner from simulator outcomes, replay proxy, AI signal calibration, and current regime. It is evidence, not a guarantee.
            </div>
          </div>
          <span style={{ ...pill, color: accuracyScore.score >= 70 ? "#047857" : accuracyScore.score >= 45 ? "#92400e" : "#b91c1c" }}>
            Accuracy score: {accuracyScore.score}/100
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          {[
            ["Evidence weight", `${Math.round(accuracyScore.evidenceWeight * 100)}%`, "More sim trades + AI checks improves trust."],
            ["Sim score", `${Math.round(accuracyScore.simScore)}/100`, `${simStats.winRate.toFixed(0)}% win · ${simStats.expectancyPct.toFixed(2)}% exp.`],
            ["Replay score", `${Math.round(accuracyScore.replayScore)}/100`, `${scannerReplay.trades.length} strict replay candidates.`],
            ["Calibration", `${Math.round(accuracyScore.calibrationScore)}/100`, `${signalCalibration.resolved.length} checked AI signals.`],
            ["Regime", regimeDiagnostics.label, regimeDiagnostics.action],
          ].map(([title, value, copy]) => (
            <div key={title} style={statCard}>
              <div style={subtle}>{title}</div>
              <div style={{ marginTop: 6, fontWeight: 950, color: "#111827" }}>{value}</div>
              <div style={{ ...subtle, marginTop: 8 }}>{copy}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={sectionTitle}>LEARNING REVIEW</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              Uses {learningReview.sampleLabel} to suggest rule changes from your actual simulator outcomes.
            </div>
          </div>
          <span style={{ ...pill, color: learningReview.all.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>
            Expectancy {learningReview.all.expectancyPct >= 0 ? "+" : ""}
            {learningReview.all.expectancyPct.toFixed(2)}%
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          <div style={statCard}>
            <div style={subtle}>Sample</div>
            <div style={{ fontWeight: 950 }}>{learningReview.all.count} trades</div>
            <div style={{ ...subtle, marginTop: 6 }}>{learningReview.all.winRate.toFixed(0)}% win rate</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Long-term study</div>
            <div style={{ fontWeight: 950, color: learningReview.normal.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>
              {learningReview.normal.count ? `${learningReview.normal.expectancyPct >= 0 ? "+" : ""}${learningReview.normal.expectancyPct.toFixed(2)}%` : "No data"}
            </div>
            <div style={{ ...subtle, marginTop: 6 }}>{learningReview.normal.count} trades</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Quick scalp</div>
            <div style={{ fontWeight: 950, color: learningReview.scalp.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>
              {learningReview.scalp.count ? `${learningReview.scalp.expectancyPct >= 0 ? "+" : ""}${learningReview.scalp.expectancyPct.toFixed(2)}%` : "No data"}
            </div>
            <div style={{ ...subtle, marginTop: 6 }}>{learningReview.scalp.count} trades</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Exit quality</div>
            <div style={{ fontWeight: 950 }}>{learningReview.takeProfits} TP / {learningReview.stopLosses} SL</div>
            <div style={{ ...subtle, marginTop: 6 }}>{learningReview.manualLosers} manual losers</div>
          </div>
          <div style={statCard}>
            <div style={subtle}>Suggested score floor</div>
            <div style={{ fontWeight: 950 }}>{learningReview.suggestedMinScore}+</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              Wins avg {learningReview.avgWinningScore ? learningReview.avgWinningScore.toFixed(0) : "-"} · losses avg {learningReview.avgLosingScore ? learningReview.avgLosingScore.toFixed(0) : "-"}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14, marginTop: 14 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {learningReview.recommendations.map((rec) => (
              <div key={rec} style={{ ...statCard, background: "#ffffff" }}>
                <div style={{ fontWeight: 900, color: "#111827" }}>{rec}</div>
              </div>
            ))}
          </div>
          <div style={proPanel}>
            <div style={{ fontWeight: 950, color: "#111827" }}>Next rule tweak</div>
            <div style={{ ...subtle, marginTop: 8 }}>
              Run the next 5-10 simulator trades using these recommendations, then compare the Learning Review again. Only promote a rule to real-money use after it improves expectancy, not just win rate.
            </div>
            {learningReview.repeatLosers.length > 0 && (
              <div style={{ ...subtle, marginTop: 10 }}>
                Weak repeat coins: {learningReview.repeatLosers.map((s) => `${s.symbol} ${fmtUsd(s.pnlUsd)}`).join(" · ")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div style={panel}>
          <div style={sectionTitle}>SCANNER REPLAY PROXY</div>
          <div style={{ ...subtle, marginTop: 6 }}>
            Uses current 24h/4h scanner evidence as a quick replay proxy after estimated fees/slippage. Build a deeper candle backtester next.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <div style={statCard}><div style={subtle}>Candidates</div><div style={{ fontWeight: 950 }}>{scannerReplay.trades.length}</div></div>
            <div style={statCard}><div style={subtle}>Win rate</div><div style={{ fontWeight: 950 }}>{scannerReplay.winRate.toFixed(0)}%</div></div>
            <div style={statCard}><div style={subtle}>Expectancy</div><div style={{ fontWeight: 950, color: scannerReplay.expectancyPct >= 0 ? "#047857" : "#b91c1c" }}>{scannerReplay.expectancyPct.toFixed(2)}%</div></div>
            <div style={statCard}><div style={subtle}>Best / worst</div><div style={{ fontWeight: 950 }}>{scannerReplay.best?.symbol ?? "-"} / {scannerReplay.worst?.symbol ?? "-"}</div></div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {scannerReplay.trades.slice(0, 8).map((r) => (
              <div key={r.symbol} style={{ ...statCard, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 950 }}>{r.symbol} · score {Math.round(r.score)}</div>
                  <div style={{ ...subtle, marginTop: 4 }}>Proxy return after costs: {r.afterCostsPct.toFixed(2)}%</div>
                </div>
                <span style={{ ...pill, color: r.result >= 0 ? "#047857" : "#b91c1c" }}>{r.result >= 0 ? "PASS" : "FAIL"}</span>
              </div>
            ))}
            {!scannerReplay.trades.length && <div style={emptyState}>No strict replay candidates yet. Refresh market or wait for scanner data.</div>}
          </div>
        </div>

        <div style={panel}>
          <div style={sectionTitle}>AI CONFIDENCE CALIBRATION</div>
          <div style={{ ...subtle, marginTop: 6 }}>
            Every generated AI idea is saved locally and checked against later prices. If confidence runs hotter than outcomes, the app automatically reduces confidence.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <div style={statCard}><div style={subtle}>Signals</div><div style={{ fontWeight: 950 }}>{signalCalibration.checked.length}</div></div>
            <div style={statCard}><div style={subtle}>Resolved</div><div style={{ fontWeight: 950 }}>{signalCalibration.resolved.length}</div></div>
            <div style={statCard}><div style={subtle}>Win rate</div><div style={{ fontWeight: 950 }}>{signalCalibration.winRate.toFixed(0)}%</div></div>
            <div style={statCard}><div style={subtle}>Adjustment</div><div style={{ fontWeight: 950, color: signalCalibration.adjustment >= 0 ? "#047857" : "#b91c1c" }}>{signalCalibration.adjustment >= 0 ? "+" : ""}{signalCalibration.adjustment.toFixed(0)}</div></div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {signalCalibration.buckets.map((b) => (
              <div key={b.floor} style={statCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 950 }}>{b.floor}-{b.floor + 9}% confidence</div>
                  <div style={{ fontWeight: 950 }}>{b.count ? `${b.winRate.toFixed(0)}% win` : "No data"}</div>
                </div>
              </div>
            ))}
          </div>
          <button style={{ ...btn, marginTop: 12 }} onClick={() => setAiSignals([])} disabled={!aiSignals.length}>
            Clear Signal Log
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div style={panel}>
          <div style={sectionTitle}>TRADE GRADES</div>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {tradeGrades.length ? (
              tradeGrades.map((g) => (
                <div key={g.id} style={{ ...statCard, display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 950, fontSize: "1.35rem", color: g.grade === "A" || g.grade === "B" ? "#047857" : g.grade === "C" ? "#92400e" : "#b91c1c" }}>{g.grade}</div>
                  <div>
                    <div style={{ fontWeight: 950 }}>{g.symbol} · {fmtUsd(g.pnlUsd)} · {g.pnlPct.toFixed(2)}%</div>
                    <div style={{ ...subtle, marginTop: 4 }}>{g.lesson}</div>
                  </div>
                  <span style={pill}>{g.score}/100</span>
                </div>
              ))
            ) : (
              <div style={emptyState}>Sell simulated holdings to generate trade grades.</div>
            )}
          </div>
        </div>

        <div style={panel}>
          <div style={sectionTitle}>REGIME + CAPITAL ROTATION</div>
          <div style={{ ...proPanel, marginTop: 12 }}>
            <div style={{ fontWeight: 950, color: "#111827" }}>{regimeDiagnostics.label}</div>
            <div style={{ ...subtle, marginTop: 8 }}>{regimeDiagnostics.action}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <div style={statCard}><div style={subtle}>Breadth</div><div style={{ fontWeight: 950 }}>{regimeDiagnostics.breadth.toFixed(0)}%</div></div>
            <div style={statCard}><div style={subtle}>Avg 24h</div><div style={{ fontWeight: 950 }}>{regimeDiagnostics.avgChange.toFixed(2)}%</div></div>
            <div style={statCard}><div style={subtle}>Avg vol</div><div style={{ fontWeight: 950 }}>{regimeDiagnostics.avgVolFactor.toFixed(2)}x</div></div>
            <div style={statCard}><div style={subtle}>Strict rate</div><div style={{ fontWeight: 950 }}>{regimeDiagnostics.strictRate.toFixed(1)}%</div></div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {holdingReviews.length ? (
              holdingReviews.map((h) => (
                <div key={h.id} style={statCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>{h.symbol}</div>
                    <div style={{ fontWeight: 950, color: h.tone }}>{h.action}</div>
                  </div>
                  <div style={{ ...subtle, marginTop: 6 }}>{h.reasons.slice(0, 2).join(" ")}</div>
                </div>
              ))
            ) : (
              <div style={emptyState}>Buy simulated positions to test capital rotation decisions.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const Pro = () => (
    <>
      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={sectionTitle}>BASIC VS PRO</div>
            <div style={{ marginTop: 8, fontSize: "1.35rem", fontWeight: 950, color: "#111827" }}>Obsidian Pro adds the intelligence layer.</div>
            <div style={{ ...subtle, marginTop: 6 }}>
              Basic helps you see the market. Pro helps you decide, practice, review, and package it as a product.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <ProBadge />
            <button style={btnDanger} onClick={openCheckout}>
              Buy Pro {PRO_PRICE}
            </button>
            {!proPass && (
              <button style={btn} onClick={activateDemoPass}>
                Demo Unlock
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div style={statCard}>
            <div style={{ fontWeight: 950, color: "#0f766e" }}>Basic</div>
            <div style={{ ...subtle, marginTop: 10, lineHeight: 1.8 }}>
              Live scanner and watchlist
              <br />
              Manual simulator buying and selling
              <br />
              Basic score, entry quality, and structure labels
              <br />
              Daily commitment and trade journal
              <br />
              CSV export
            </div>
          </div>
          <div style={{ ...proPanel }}>
            <div style={{ fontWeight: 950, color: "#047857" }}>Pro</div>
            <div style={{ ...subtle, marginTop: 10, lineHeight: 1.8 }}>
              AI Command Brief with action, confidence, and reasons
              <br />
              AI suggested sim sizing
              <br />
              Best-candidate and trap-blocker intelligence
              <br />
              Weekly simulator review and coaching notes
              <br />
              Lead capture and checkout-ready monetization
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
          {[
            ["AI Confidence", `${aiTradeBrief.confidence}%`, aiTradeBrief.headline],
            ["Strict Signals", `${watchlistHealth.tradable}`, "VALID + Structure OK + score filter."],
            ["Trap Blocks", `${watchlistHealth.blocked}`, "Coins that look active but fail timing/structure."],
            ["Sim Return", `${simReturnPct >= 0 ? "+" : ""}${simReturnPct.toFixed(2)}%`, "Weekly simulated account result."],
          ].map(([title, value, copy]) => (
            <div key={title} style={statCard}>
              <div style={subtle}>{title}</div>
              <div style={{ marginTop: 6, fontWeight: 950, fontSize: "1.25rem", color: "#111827" }}>{value}</div>
              <div style={{ ...subtle, marginTop: 8 }}>{copy}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 0.85fr", gap: 14, marginTop: 14 }}>
        <div style={panel}>
          <div style={sectionTitle}>PRO PRODUCT ENGINE</div>
          <div style={{ ...subtle, marginTop: 8 }}>
            Wire `VITE_CHECKOUT_URL` to Stripe, Gumroad, Whop, or any payment page. The app already has lead capture, pricing, and a Pro state.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <div style={statCard}>
              <div style={{ color: "#0f766e", fontWeight: 900 }}>Customer Promise</div>
              <div style={{ ...subtle, marginTop: 10, lineHeight: 1.7 }}>
                Stop guessing. Use a scanner, simulator, AI brief, and journal to prove your process before risking capital.
              </div>
            </div>
            <div style={statCard}>
              <div style={{ color: "#0f766e", fontWeight: 900 }}>Upsell Path</div>
              <div style={{ ...subtle, marginTop: 10, lineHeight: 1.7 }}>
                Pro subscription → weekly review → setup coaching → private alerts/community.
              </div>
            </div>
          </div>
        </div>

        <div style={panel}>
        <div style={{ color: "#0f766e", fontWeight: 950, letterSpacing: 0.8 }}>CAPTURE A LEAD</div>
        <div style={{ ...subtle, marginTop: 6 }}>Use this for trial access, coaching calls, or a paid alerts waitlist.</div>

        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          <input style={input} placeholder="email@example.com" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} />
          <button style={btn} onClick={saveLead}>
            Save
          </button>
        </div>
        {leadSaved && <div style={{ marginTop: 10, color: "#047857", fontWeight: 900 }}>Lead saved locally.</div>}

        <div style={{ ...proPanel, marginTop: 14 }}>
          <div style={{ color: edgeGrade.color, fontWeight: 950 }}>Today’s sales angle: {edgeGrade.label}</div>
          <div style={{ ...subtle, marginTop: 8 }}>
            “Obsidian found {watchlistHealth.tradable} strict candidates and blocked {watchlistHealth.blocked} traps. Get the exact trade/no-trade cockpit for {PRO_PRICE}.”
          </div>
          <button style={{ ...btnDanger, marginTop: 12 }} onClick={openCheckout}>
            Send Buyer to Checkout
          </button>
        </div>

        <div style={{ marginTop: 14, ...subtle }}>
          Legal line to keep: this is decision support, not financial advice. The product sells process and risk control, not guaranteed profit.
        </div>
      </div>
      </div>
    </>
  );

  return (
    <div style={appWrap}>
      <div style={topbar}>
        <div style={row}>
          <div style={brand}>
            <div style={dot} />
            <div>OBSIDIAN AI TRADER</div>
          </div>

          <div style={tabsWrap}>
            <div style={tabBtn(tab === "dashboard")} onClick={() => setTab("dashboard")}>
              Dashboard
            </div>
            <div style={tabBtn(tab === "scanner")} onClick={() => setTab("scanner")}>
              Scanner
            </div>
            <div style={tabBtn(tab === "journal")} onClick={() => setTab("journal")}>
              Journal
            </div>
            <div style={tabBtn(tab === "history")} onClick={() => setTab("history")}>
              History
            </div>
            <div style={tabBtn(tab === "plan")} onClick={() => setTab("plan")}>
              Plan
            </div>
            <div style={tabBtn(tab === "simulator")} onClick={() => setTab("simulator")}>
              Simulator
            </div>
            <div style={tabBtn(tab === "accuracy")} onClick={() => setTab("accuracy")}>
              Accuracy
            </div>
            <div style={tabBtn(tab === "pro")} onClick={() => setTab("pro")}>
              Pro
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={pill}>
              Local time: <b style={{ color: "#111827" }}>{localTime}</b>
            </span>
            <span style={pill}>
              Focus: <b style={{ color: "#111827" }}>{focusSymbol}</b>
            </span>
            <span style={pill}>{error ? <span style={{ color: "#b91c1c", fontWeight: 900 }}>Data error</span> : "Live (proxy)"}</span>
          </div>
        </div>

        <div style={banner}>
          {bannerLeft}
          {bannerRight}
        </div>
      </div>

      <div style={{ ...shell, paddingBottom: 0 }}>
        <div style={commandHero}>
          <div style={heroGrid}>
            <div>
              <div style={heroKicker}>LIVE SCANNER + 7-DAY SIMULATOR + AI DECISION BRIEF</div>
              <h1 style={heroTitle}>Trade the scanner before you trade your cash.</h1>
              <div style={{ color: "#475569", maxWidth: 760, marginTop: 12, lineHeight: 1.55 }}>
                Buy and sell simulated crypto at live market values, track your portfolio, and use the scanner’s entry,
                structure, and AI confidence signals to see whether your process could survive a week.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <button style={btn} onClick={() => setTab("simulator")}>
                  Open Simulator
                </button>
                <button style={btn} onClick={() => setTab("plan")}>
                  Build Plan
                </button>
                <button style={btn} onClick={() => setTab("scanner")}>
                  Scan Coins
                </button>
                <button style={btnDanger} onClick={() => setTab("pro")}>
                  Basic vs Pro
                </button>
                <button style={isLoading ? btnDisabled : btn} onClick={refresh} disabled={isLoading}>
                  {isLoading ? "Refreshing..." : "Refresh Market"}
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                ["AI ADVICE", aiAdvice.symbol, `${aiAdvice.action} · ${aiAdvice.confidence}%`, aiAdvice.action === "BUY TEST" ? "#047857" : aiAdvice.action === "DO NOT BUY" ? "#b91c1c" : "#111827"],
                ["STRICT SIGNALS", `${watchlistHealth.tradable}`, `${watchlistHealth.blocked} traps blocked`, "#047857"],
                ["SIM RESULT", `${simReturnPct >= 0 ? "+" : ""}${simReturnPct.toFixed(2)}%`, `${fmtUsd(simEquity)} equity`, simReturnPct >= 0 ? "#047857" : "#b91c1c"],
                ["PLAN", goalPlan ? goalPlan.strategyProfile : "NO PLAN", goalPlan ? `+${goalPlan.targetReturnPct}%/${goalPlan.targetPeriod} · -${goalPlan.maxDailyLossPct}% stop` : "Accept risk to unlock AI buys", goalPlan ? "#047857" : "#b91c1c"],
              ].map(([label, value, copy, color]) => (
                <div key={label} style={heroMetric}>
                  <div style={{ ...subtle, fontSize: "0.72rem", letterSpacing: 1, fontWeight: 900 }}>{label}</div>
                  <div style={{ marginTop: 8, color, fontWeight: 950, fontSize: "1.15rem" }}>{value}</div>
                  <div style={{ ...subtle, marginTop: 6 }}>{copy}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={shell}>
        {commitRequired && tab !== "simulator" && tab !== "plan" && tab !== "accuracy" && tab !== "pro" ? (
          <>
            {commitmentPanel}
            <div style={{ marginTop: 14, ...panel }}>
              <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>WHY THE APP IS STRICT</div>
              <div style={{ ...subtle, marginTop: 10 }}>
                A coin can look “strong” on 24h/volume while being untradable after a dump or with no 2R room. Entry Quality + Structure exist to stop chase-trading and protect your capital.
              </div>
            </div>
          </>
        ) : (
          <>
            {todaysCommitSummary}
            {tab === "dashboard" && Dashboard()}
            {tab === "scanner" && Scanner()}
            {tab === "journal" && Journal()}
            {tab === "history" && History()}
            {tab === "plan" && Plan()}
            {tab === "simulator" && Simulator()}
            {tab === "accuracy" && Accuracy()}
            {tab === "pro" && Pro()}
          </>
        )}
      </div>

      {/* LOG TRADE MODAL */}
      {logOpen && (
        <div
          onClick={() => setLogOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(900px, 96vw)",
              borderRadius: 16,
              border: "1px solid #d8e0ea",
              background: "rgba(10,10,10,0.95)",
              padding: 14,
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: 0.8 }}>LOG TRADE</div>
                <div style={{ ...subtle, marginTop: 4 }}>Success metric: rules followed. Outcome is secondary.</div>
              </div>
              <button style={btn} onClick={() => setLogOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <div style={subtle}>Side</div>
                <select style={input} value={logSide} onChange={(e) => setLogSide(e.target.value === "SHORT" ? "SHORT" : "LONG")}>
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div>
                <div style={subtle}>Entry</div>
                <input style={input} type="number" value={logEntry} onChange={(e) => setLogEntry(Number(e.target.value))} />
              </div>
              <div>
                <div style={subtle}>Stop</div>
                <input style={input} type="number" value={logStop} onChange={(e) => setLogStop(Number(e.target.value))} />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <div style={subtle}>Exit</div>
                <input style={input} type="number" value={logExit} onChange={(e) => setLogExit(Number(e.target.value))} />
              </div>

              <div>
                <div style={subtle}>Rules followed?</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, color: "#64748b", fontWeight: 900 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="radio" checked={logRulesFollowed} onChange={() => setLogRulesFollowed(true)} />
                    YES
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="radio" checked={!logRulesFollowed} onChange={() => setLogRulesFollowed(false)} />
                    NO
                  </label>
                </div>
              </div>

              <div style={{ gridColumn: "span 3" }}>
                <div style={subtle}>Note (optional)</div>
                <input
                  style={input}
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="e.g. Broke rule: chased late entry / traded in WAIT window / no structure"
                />
              </div>
            </div>

            <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid #e2e8f0", padding: 12, background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, color: "#111827" }}>
                  R Result:{" "}
                  <span style={{ color: computeR(logSide, logEntry, logStop, logExit) >= 0 ? "#047857" : "#b91c1c" }}>
                    {fmtR(computeR(logSide, logEntry, logStop, logExit))}
                  </span>
                </div>
                <button style={btn} onClick={addTrade}>
                  Save Trade
                </button>
              </div>
              <div style={{ ...subtle, marginTop: 6 }}>
                If you didn’t have a structural stop, mark “Rules followed = NO”. That’s how you build real trust with yourself.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


