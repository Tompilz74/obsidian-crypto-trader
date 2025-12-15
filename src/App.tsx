import React, { useEffect, useMemo, useRef, useState } from "react";

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
 * ✅ Binance 1h candles — via Netlify proxy
 * ✅ Support / resistance pivots (zoned)
 * ✅ Room-to-2R HARD BLOCK (NO EDGE if < 2R)
 * ✅ Clear labels (STRUCTURE: OK / WAIT / NO EDGE)
 */

type TabKey = "dashboard" | "scanner" | "journal" | "history";
type SessionStatus = "TRADE" | "SELECTIVE" | "WAIT";

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

type TradeRecord = {
  id: string;
  tsIso: string;
  symbol: string;
  side: "LONG" | "SHORT";
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

type MicroMetrics = {
  ret1h: number;
  ret4h: number;
  dropFromHigh6h: number;
  spikeFromLow6h: number;
  entryQuality: "VALID" | "EXTENDED" | "NO_EDGE";
  whyNot: string[];
};

type MicroMap = Record<string, MicroMetrics>;

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
 * - ASIA:   07:00–16:00
 * - EUROPE: 16:00–21:00
 * - OVERLAP:21:00–01:00
 * - US:     01:00–06:00
 * - OFF:    06:00–07:00
 */
function computeSession(now: Date): SessionInfo {
  const h = now.getHours();
  const m = now.getMinutes();
  const curMinutes = h * 60 + m;

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

  if (curMinutes >= B_ASIA && curMinutes < B_EU) {
    session = "ASIA";
    status = "SELECTIVE";
    note = "Decent for some alts/scalps. Be picky (A+ only).";
    nextChangeAt = makeNext(16, 0, 0);
  } else if (curMinutes >= B_EU && curMinutes < B_OVERLAP) {
    session = "EUROPE";
    status = "TRADE";
    note = "Good activity. Trade A+ setups only.";
    nextChangeAt = makeNext(21, 0, 0);
  } else if (curMinutes >= B_OVERLAP || curMinutes < B_0100) {
    session = "EUROPE + US OVERLAP";
    status = "TRADE";
    note = "Best liquidity/volatility. Highest quality breakouts often occur here.";
    nextChangeAt = curMinutes >= B_OVERLAP ? makeNext(1, 0, 1) : makeNext(1, 0, 0);
  } else if (curMinutes >= B_0100 && curMinutes < B_US_END) {
    session = "US";
    status = "TRADE";
    note = "Strong activity. Don’t overtrade.";
    nextChangeAt = makeNext(6, 0, 0);
  } else if (curMinutes >= B_US_END && curMinutes < B_OFF_END) {
    session = "OFF-PEAK";
    status = "WAIT";
    note = "Thin/awkward window. Avoid forcing trades; wait for Asia/Europe.";
    nextChangeAt = makeNext(7, 0, 0);
  } else {
    session = "OFF-PEAK";
    status = "WAIT";
    note = "Low quality window. Prefer waiting for Europe/US activity.";
    nextChangeAt = curMinutes < B_ASIA ? makeNext(7, 0, 0) : makeNext(16, 0, 0);
  }

  const color = status === "TRADE" ? "#82f0b9" : status === "SELECTIVE" ? "#f2e7cd" : "#ffb6b6";
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

/** ===== Phase 3: Binance structure (via Netlify function proxy) ===== */

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

/** Your Revolut watchlist/movers universe (best-effort CoinGecko ids) */
const COINS: Array<{ symbol: string; cgId?: string; name?: string }> = [
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

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [overrideGuard, setOverrideGuard] = useState(false);

  const [clockTick, setClockTick] = useState(0);

  const [market, setMarket] = useState<MarketRow[]>([]);
  const [microMap, setMicroMap] = useState<MicroMap>({});
  const [structMap, setStructMap] = useState<Record<string, StructureResult>>({});

  const [focusSymbol, setFocusSymbol] = useState<string>("SOL");

  // Risk / sizing
  const [accountUsd, setAccountUsd] = useState(1000);
  const [riskPct, setRiskPct] = useState(2);
  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [stopPrice, setStopPrice] = useState<number>(0);

  // Trade logging modal state
  const [logOpen, setLogOpen] = useState(false);
  const [logSide, setLogSide] = useState<"LONG" | "SHORT">("LONG");
  const [logEntry, setLogEntry] = useState<number>(0);
  const [logStop, setLogStop] = useState<number>(0);
  const [logExit, setLogExit] = useState<number>(0);
  const [logRulesFollowed, setLogRulesFollowed] = useState(true);
  const [logNote, setLogNote] = useState("");

  const todayKey = useMemo(() => dayKeyLocal(new Date()), [clockTick]);
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

  useInterval(() => setClockTick((x) => x + 1), 1000);

  const localTime = useMemo(
    () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    [clockTick]
  );
  const sessionInfo = useMemo(() => computeSession(new Date()), [clockTick]);

  const coinIds = useMemo(() => COINS.map((c) => c.cgId).filter(Boolean) as string[], []);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchCoinGeckoMarkets(coinIds);
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

      // ---- Phase 2B: micro entry-quality (CoinGecko hourly)
      try {
        const pairs = await Promise.all(
          rankedTemp.map(async (x) => {
            const prices = await fetchCoinGeckoHourly24h(x.cgId!);
            return [x.symbol, computeMicro(prices)] as const;
          })
        );
        const next: MicroMap = {};
        for (const [sym, metrics] of pairs) next[sym] = metrics;
        setMicroMap((prev) => ({ ...prev, ...next }));
      } catch {
        // keep previous microMap if chart calls fail
      }

      // ---- Phase 3: structure engine (Binance 1h) for TOP candidates only
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
                  reasons: ["Structure unavailable (Binance pair missing)."],
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
    } catch (e: any) {
      setError(e?.message ?? "Failed to fetch market data.");
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
  }, autoRefresh ? 5 * 60 * 1000 : null);

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
    return commit.allowOffPeak;
  }, [commit, sessionInfo.session]);

  // Trade allowed logic:
  const tradingAllowed = useMemo(() => {
    if (commitRequired) return false;
    if (dayState.locked) return false;

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
  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return market;
    return market.filter(
      (m) => (m.symbol ?? "").toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q)
    );
  }, [market, query]);

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
    if (commitRequired) return { tone: "#ffb6b6", text: "Commit today’s rules before you trade." };
    if (dayState.locked) return { tone: "#ffb6b6", text: dayState.lockedReason ?? "Session locked — stop trading." };
    if (sessionInfo.status === "WAIT" && !overrideGuard) return { tone: "#ffb6b6", text: "WAIT window — protect capital. Don’t force entries." };
    if (!sessionAllowedByCommit && !overrideGuard) return { tone: "#ffb6b6", text: "This session isn’t in your plan. Wait for your allowed window." };
    if (sessionInfo.status === "SELECTIVE") return { tone: "#f2e7cd", text: "Selective window — A+ only. One clean setup beats five weak ones." };
    return { tone: "#82f0b9", text: "Trade window — execute your rules, not your emotions." };
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

  // ===== Styles =====
  const appWrap: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(1000px 600px at 20% 10%, rgba(212,199,161,0.12), transparent 60%), linear-gradient(180deg, #0b0b0c 0%, #070707 100%)",
    color: "#eaeaea",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  };

  const topbar: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 10,
    padding: "14px 18px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(8,8,8,0.75)",
    backdropFilter: "blur(10px)",
  };

  const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
  const brand: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontWeight: 900, letterSpacing: 1.2 };
  const dot: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: 4,
    background: "linear-gradient(135deg, rgba(212,199,161,0.9), rgba(212,199,161,0.2))",
    boxShadow: "0 0 16px rgba(212,199,161,0.25)",
  };

  const tabsWrap: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(212,199,161,0.7)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(212,199,161,0.08)" : "rgba(255,255,255,0.03)",
    color: active ? "#f2e7cd" : "#bdbdbd",
    fontWeight: 800,
    cursor: "pointer",
    userSelect: "none",
  });

  const shell: React.CSSProperties = { padding: "14px 18px 24px", maxWidth: 1500, margin: "0 auto" };

  const pill: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#bdbdbd",
    fontSize: "0.78rem",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  const banner: React.CSSProperties = {
    marginTop: 10,
    border: "1px solid rgba(255,255,255,0.06)",
    background: "linear-gradient(90deg, rgba(212,199,161,0.08), rgba(255,255,255,0.02))",
    borderRadius: 16,
    padding: "10px 12px",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    color: "#bdbdbd",
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
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "radial-gradient(900px 360px at 20% 0%, rgba(212,199,161,0.10), transparent 60%), rgba(255,255,255,0.02)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
    padding: 14,
    overflow: "hidden",
  };

  const btn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(212,199,161,0.45)",
    background: "rgba(212,199,161,0.10)",
    color: "#f2e7cd",
    fontWeight: 900,
    cursor: "pointer",
  };

  const btnDanger: React.CSSProperties = {
    ...btn,
    border: "1px solid rgba(255,120,120,0.55)",
    background: "rgba(255,120,120,0.12)",
    color: "#ffd1d1",
  };

  const btnDisabled: React.CSSProperties = {
    ...btn,
    opacity: 0.45,
    cursor: "not-allowed",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#bdbdbd",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.25)",
    color: "#eaeaea",
    outline: "none",
  };

  const subtle: React.CSSProperties = { color: "#9a9a9a", fontSize: "0.82rem", lineHeight: 1.45 };

  function ScorePill({ score }: { score: number }) {
    let bg = "rgba(255, 90, 90, 0.20)";
    let border = "rgba(255, 90, 90, 0.35)";
    let text = "#ffb6b6";
    if (score >= 80) {
      bg = "rgba(212, 199, 161, 0.22)";
      border = "rgba(212, 199, 161, 0.8)";
      text = "#f2e7cd";
    } else if (score >= 65) {
      bg = "rgba(70, 220, 140, 0.16)";
      border = "rgba(70, 220, 140, 0.32)";
      text = "#bff6d8";
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

  function EntryQualityBadge({ s }: { s: SetupRow }) {
    if (s.entryQuality === "VALID") return null;
    const isNoEdge = s.entryQuality === "NO_EDGE";
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 950, color: isNoEdge ? "#ffb6b6" : "#f2e7cd" }}>
          {isNoEdge ? "🚫 NO EDGE — WAIT" : "⚠️ EXTENDED — DON’T CHASE"}
        </div>
        {!!s.whyNot?.length && (
          <div style={{ marginTop: 6, color: "#9a9a9a", fontSize: "0.82rem", lineHeight: 1.4 }}>
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
    const tone = isNoEdge ? "#ffb6b6" : "#f2e7cd";

    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 950, color: tone }}>{title}</div>
        {!!s.structureWhy?.length && (
          <div style={{ marginTop: 6, color: "#9a9a9a", fontSize: "0.82rem", lineHeight: 1.4 }}>
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
              color: s.entryQuality === "NO_EDGE" || s.structureLabel === "NO_EDGE" ? "#ffd1d1" : "#f2e7cd",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.10)",
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
      <span style={{ ...pill, borderColor: "rgba(255,255,255,0.10)", color: sessionInfo.color }}>
        {sessionInfo.status === "TRADE" ? "TRADE WINDOW" : sessionInfo.status === "SELECTIVE" ? "BE SELECTIVE" : "WAIT"}
      </span>
      <span style={{ color: processMessage.tone, fontWeight: 900 }}>{processMessage.text}</span>
    </div>
  );

  const bannerRight = (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={pill}>
        Next change: <b style={{ color: "#f2e7cd" }}>{sessionInfo.countdown}</b>
      </span>

      {(sessionInfo.status === "WAIT" || !sessionAllowedByCommit || dayState.locked) && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#ffb6b6", fontWeight: 900 }}>
          <input type="checkbox" checked={overrideGuard} onChange={(e) => setOverrideGuard(e.target.checked)} />
          Override guard (not recommended)
        </label>
      )}

      <span style={pill}>
        Trades: <b style={{ color: "#f2e7cd" }}>{tradesToday}</b> · R:{" "}
        <b style={{ color: rToday >= 0 ? "#82f0b9" : "#ffb6b6" }}>{fmtR(rToday)}</b>
      </span>

      {lastUpdated ? (
        <span style={pill}>
          Updated:{" "}
          <b style={{ color: "#f2e7cd" }}>
            {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </b>
        </span>
      ) : null}
    </div>
  );

  const commitmentPanel = (
    <div style={{ ...panel, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>DAILY PRE-COMMITMENT</div>
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, color: "#bdbdbd", fontWeight: 800 }}>
            {[
              ["allowAsia", "Asia"],
              ["allowEurope", "Europe"],
              ["allowOverlap", "Europe+US overlap"],
              ["allowUS", "US"],
              ["allowOffPeak", "Off-peak"],
            ].map(([k, label]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={(commitDraft as any)[k]}
                  onChange={(e) => setCommitDraft((c) => ({ ...(c as any), [k]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          <div style={{ ...subtle, marginTop: 8 }}>
            Recommended default: <b style={{ color: "#f2e7cd" }}>Europe + Overlap + US</b>.
          </div>
        </div>
      </div>
    </div>
  );

  const todaysCommitSummary = commit ? (
    <div style={{ ...panel, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>TODAY’S COMMITMENT</div>
          <div style={{ ...subtle, marginTop: 4 }}>
            Max trades: <b style={{ color: "#f2e7cd" }}>{commit.maxTrades}</b> · Max loss:{" "}
            <b style={{ color: "#f2e7cd" }}>-{commit.maxDailyLossR}R</b> · Consecutive losses:{" "}
            <b style={{ color: "#f2e7cd" }}>{commit.maxConsecutiveLosses}</b> · Risk:{" "}
            <b style={{ color: "#f2e7cd" }}>{commit.riskPct}%</b>
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
      <div style={grid3}>
        {/* COL 1 — Market + Top Momentum */}
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>MARKET OVERVIEW</div>
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
                    background: "rgba(0,0,0,0.22)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#bdbdbd" }}>{sym}</div>
                  <div style={{ marginTop: 6, fontWeight: 950, fontSize: "1.05rem" }}>{fmtUsd(m?.priceUsd)}</div>
                  <div style={{ marginTop: 4, color: (m?.change24h ?? 0) >= 0 ? "#82f0b9" : "#ff8a8a", fontWeight: 900 }}>
                    {m?.change24h === undefined ? "—" : `${m.change24h >= 0 ? "+" : ""}${fmtPct(m.change24h)}`}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>TOP ACTIVITY</div>
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
                    background: "rgba(0,0,0,0.22)",
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

                  {s.structureLabel === "OK" && isFinite(s.roomTo2R as any) && (
                    <div style={{ ...subtle, marginTop: 8 }}>
                      Structure: <b style={{ color: "#82f0b9" }}>OK</b> · Room:{" "}
                      <b style={{ color: "#f2e7cd" }}>{(s.roomTo2R ?? 0).toFixed(2)}R</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ ...subtle, marginTop: 12 }}>
            Tip: a coin can be “active” but still <b style={{ color: "#ffb6b6" }}>NO EDGE</b> if it fails 2R room or dumps fast. That’s intentional — it protects you.
          </div>
        </div>

        {/* COL 2 — TP/SL + sizing + LOG */}
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>POSITION SIZING + TP/SL</div>
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

          <div style={{ marginTop: 12, borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)", padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={{ fontWeight: 900, color: "#d8c79f" }}>LONG PLAN</div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  Stop Dist: <b style={{ color: "#f2e7cd" }}>{stopDistanceLong > 0 ? fmtUsd(stopDistanceLong) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  Size: <b style={{ color: "#f2e7cd" }}>{positionSizeLong > 0 ? `${positionSizeLong.toFixed(6)} ${focusSymbol}` : "—"}</b>
                </div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  TP1: <b style={{ color: "#f2e7cd" }}>{tp1Long > 0 ? fmtUsd(tp1Long) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  TP2: <b style={{ color: "#f2e7cd" }}>{tp2Long > 0 ? fmtUsd(tp2Long) : "—"}</b>
                </div>
                {stopDistanceLong <= 0 && <div style={{ marginTop: 8, color: "#ffb6b6", fontWeight: 900 }}>Long invalid: Stop must be below Entry</div>}
              </div>

              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={{ fontWeight: 900, color: "#d8c79f" }}>SHORT PLAN</div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  Stop Dist: <b style={{ color: "#f2e7cd" }}>{stopDistanceShort > 0 ? fmtUsd(stopDistanceShort) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  Size: <b style={{ color: "#f2e7cd" }}>{positionSizeShort > 0 ? `${positionSizeShort.toFixed(6)} ${focusSymbol}` : "—"}</b>
                </div>
                <div style={{ ...subtle, marginTop: 6 }}>
                  TP1: <b style={{ color: "#f2e7cd" }}>{tp1Short > 0 ? fmtUsd(tp1Short) : "—"}</b>
                </div>
                <div style={{ ...subtle }}>
                  TP2: <b style={{ color: "#f2e7cd" }}>{tp2Short > 0 ? fmtUsd(tp2Short) : "—"}</b>
                </div>
                {stopDistanceShort <= 0 && <div style={{ marginTop: 8, color: "#ffb6b6", fontWeight: 900 }}>Short invalid: Stop must be above Entry</div>}
              </div>
            </div>

            <div style={{ marginTop: 10, ...subtle }}>
              Risk Amount: <b style={{ color: "#f2e7cd" }}>{fmtUsd(riskAmount)}</b> · If you can’t define a structural stop, you don’t have a trade.
            </div>
          </div>
        </div>

        {/* COL 3 — Session Guard + Rules */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={panel}>
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>SESSION GUARD</div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={subtle}>Trades today</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem" }}>
                  {tradesToday} / {commitRequired ? "—" : commit?.maxTrades}
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={subtle}>R today</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem", color: rToday >= 0 ? "#82f0b9" : "#ffb6b6" }}>{fmtR(rToday)}</div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={subtle}>Consecutive losses</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem" }}>{consecutiveLosses}</div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10 }}>
                <div style={subtle}>Status</div>
                <div style={{ fontWeight: 950, fontSize: "1.05rem", color: dayState.locked ? "#ffb6b6" : "#f2e7cd" }}>
                  {dayState.locked ? "SESSION COMPLETE" : "ACTIVE"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 10, background: "rgba(0,0,0,0.18)" }}>
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
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>RULES (BASICS)</div>
            <div style={{ ...subtle, marginTop: 10, lineHeight: 1.6 }}>
              <b style={{ color: "#f2e7cd" }}>A+ only</b>
              <br />
              VALID entry · Structure OK · Score ≥ 70 · Vol ≥ 1.3x · Clear 2R room
              <br />
              <br />
              <b style={{ color: "#f2e7cd" }}>Risk stays small</b>
              <br />
              1–2% per trade · Stop after 2 losses or -2R
              <br />
              <br />
              <b style={{ color: "#f2e7cd" }}>Stop is structural</b>
              <br />
              Swing low / failed retest — never random %
              <br />
              <br />
              <b style={{ color: "#f2e7cd" }}>Do not chase</b>
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
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>WATCHLIST (RANKED)</div>
            <span style={pill}>Revolut universe</span>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input style={input} placeholder="Search coins (symbol or name)…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#bdbdbd", fontWeight: 800 }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto (5m)
            </label>
          </div>

          <div style={{ marginTop: 10, overflow: "auto", maxHeight: 420 }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px" }}>
              <thead>
                <tr style={{ color: "#9a9a9a", fontSize: "0.78rem", textAlign: "left" }}>
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
                        background: "rgba(0,0,0,0.20)",
                        cursor: allowed ? "pointer" : "not-allowed",
                        opacity: allowed ? 1 : 0.55,
                      }}
                      title={!allowed ? "Blocked: needs VALID + Structure OK (or override)" : "Click to focus"}
                    >
                      <td style={{ padding: "10px 8px", fontWeight: 950 }}>{s.symbol}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 800 }}>{fmtUsd(s.priceUsd)}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 900, color: (s.change24h ?? 0) >= 0 ? "#82f0b9" : "#ff8a8a" }}>
                        {s.change24h === undefined ? "—" : `${s.change24h >= 0 ? "+" : ""}${fmtPct(s.change24h)}`}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#bdbdbd", fontWeight: 800 }}>
                        {isFinite(s.volFactor) ? `${s.volFactor.toFixed(2)}x` : "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontWeight: 950,
                          color: s.entryQuality === "VALID" ? "#82f0b9" : s.entryQuality === "EXTENDED" ? "#f2e7cd" : "#ffb6b6",
                        }}
                      >
                        {s.entryQuality}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontWeight: 950,
                          color: s.structureLabel === "OK" ? "#82f0b9" : s.structureLabel === "WAIT" ? "#f2e7cd" : "#ffb6b6",
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
            Focus: <b style={{ color: "#f2e7cd" }}>{focusSymbol}</b> · Tradable requires <b style={{ color: "#82f0b9" }}>VALID</b> +{" "}
            <b style={{ color: "#82f0b9" }}>Structure OK</b>.
          </div>
        </div>

        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>MARKET HEATMAP</div>
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
            <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 12, background: "rgba(0,0,0,0.18)" }}>
              <div style={{ fontWeight: 950, color: "#f2e7cd" }}>Best right now (strict): {bestSetup.symbol}</div>
              <div style={{ ...subtle, marginTop: 6 }}>
                Entry:{" "}
                <b style={{ color: bestSetup.entryQuality === "VALID" ? "#82f0b9" : bestSetup.entryQuality === "EXTENDED" ? "#f2e7cd" : "#ffb6b6" }}>
                  {bestSetup.entryQuality}
                </b>
                {" · "}
                Structure:{" "}
                <b style={{ color: bestSetup.structureLabel === "OK" ? "#82f0b9" : bestSetup.structureLabel === "WAIT" ? "#f2e7cd" : "#ffb6b6" }}>
                  {bestSetup.structureLabel}
                </b>
                {bestSetup.roomTo2R !== undefined && (
                  <>
                    {" · "}Room: <b style={{ color: "#f2e7cd" }}>{bestSetup.roomTo2R.toFixed(2)}R</b>
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
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>BEST TO CONSIDER NOW (STRICT)</div>
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
                  Room: <b style={{ color: "#f2e7cd" }}>{(s.roomTo2R ?? 0).toFixed(2)}R</b>
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
            <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>FULL SCANNER</div>
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
                  background: "rgba(0,0,0,0.22)",
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
                    <b style={{ color: s.entryQuality === "VALID" ? "#82f0b9" : s.entryQuality === "EXTENDED" ? "#f2e7cd" : "#ffb6b6" }}>
                      {s.entryQuality}
                    </b>
                    {" · "}Structure{" "}
                    <b style={{ color: s.structureLabel === "OK" ? "#82f0b9" : s.structureLabel === "WAIT" ? "#f2e7cd" : "#ffb6b6" }}>
                      {s.structureLabel}
                    </b>
                    {s.roomTo2R !== undefined && (
                      <>
                        {" · "}Room <b style={{ color: "#f2e7cd" }}>{s.roomTo2R.toFixed(2)}R</b>
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
      <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>TRADE JOURNAL (TODAY)</div>
      <div style={{ ...subtle, marginTop: 8 }}>
        Your job is to follow rules. Outcomes vary. The journal restores trust through evidence.
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 12 }}>
          <div style={subtle}>Trades</div>
          <div style={{ fontWeight: 950, fontSize: "1.3rem" }}>{tradesToday}</div>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 12 }}>
          <div style={subtle}>R today</div>
          <div style={{ fontWeight: 950, fontSize: "1.3rem", color: rToday >= 0 ? "#82f0b9" : "#ffb6b6" }}>{fmtR(rToday)}</div>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 12 }}>
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
              <tr style={{ color: "#9a9a9a", fontSize: "0.78rem", textAlign: "left" }}>
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
                  <tr key={t.id} style={{ background: "rgba(0,0,0,0.20)" }}>
                    <td style={{ padding: "10px 8px" }}>
                      {new Date(t.tsIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 8px", fontWeight: 950 }}>{t.symbol}</td>
                    <td style={{ padding: "10px 8px" }}>{t.side}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.entry)}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.stop)}</td>
                    <td style={{ padding: "10px 8px" }}>{fmtUsd(t.exit)}</td>
                    <td style={{ padding: "10px 8px", fontWeight: 950, color: t.r >= 0 ? "#82f0b9" : "#ffb6b6" }}>{fmtR(t.r)}</td>
                    <td style={{ padding: "10px 8px", fontWeight: 900, color: t.rulesFollowed ? "#82f0b9" : "#ffb6b6" }}>
                      {t.rulesFollowed ? "YES" : "NO"}
                    </td>
                    <td style={{ padding: "10px 8px", color: "#bdbdbd" }}>{t.note ?? ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const History = () => (
    <div style={panel}>
      <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>HISTORY</div>
      <div style={{ ...subtle, marginTop: 10 }}>
        Next: multi-day stats (expectancy, best session, best coins, rule-break cost).
      </div>
    </div>
  );

  return (
    <div style={appWrap}>
      <div style={topbar}>
        <div style={row}>
          <div style={brand}>
            <div style={dot} />
            <div>OBSIDIAN CRYPTO TRADER</div>
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
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={pill}>
              Local time: <b style={{ color: "#f2e7cd" }}>{localTime}</b>
            </span>
            <span style={pill}>
              Focus: <b style={{ color: "#f2e7cd" }}>{focusSymbol}</b>
            </span>
            <span style={pill}>{error ? <span style={{ color: "#ffb6b6", fontWeight: 900 }}>Data error</span> : "Live (proxy)"}</span>
          </div>
        </div>

        <div style={banner}>
          {bannerLeft}
          {bannerRight}
        </div>
      </div>

      <div style={shell}>
        {commitRequired ? (
          <>
            {commitmentPanel}
            <div style={{ marginTop: 14, ...panel }}>
              <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>WHY THE APP IS STRICT</div>
              <div style={{ ...subtle, marginTop: 10 }}>
                A coin can look “strong” on 24h/volume while being untradable after a dump or with no 2R room. Entry Quality + Structure exist to stop chase-trading and protect your capital.
              </div>
            </div>
          </>
        ) : (
          <>
            {todaysCommitSummary}
            {tab === "dashboard" && <Dashboard />}
            {tab === "scanner" && <Scanner />}
            {tab === "journal" && <Journal />}
            {tab === "history" && <History />}
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
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(10,10,10,0.95)",
              padding: 14,
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ color: "#d8c79f", fontWeight: 900, letterSpacing: 0.8 }}>LOG TRADE</div>
                <div style={{ ...subtle, marginTop: 4 }}>Success metric: rules followed. Outcome is secondary.</div>
              </div>
              <button style={btn} onClick={() => setLogOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <div style={subtle}>Side</div>
                <select style={input} value={logSide} onChange={(e) => setLogSide(e.target.value as any)}>
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
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, color: "#bdbdbd", fontWeight: 900 }}>
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

            <div style={{ marginTop: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 12, background: "rgba(0,0,0,0.20)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, color: "#f2e7cd" }}>
                  R Result:{" "}
                  <span style={{ color: computeR(logSide, logEntry, logStop, logExit) >= 0 ? "#82f0b9" : "#ffb6b6" }}>
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
