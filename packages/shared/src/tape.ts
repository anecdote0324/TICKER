// v0.5 QR 체결 테이프, AQR 체결 요약, VAP 가격대별 거래량.
// QR은 한국투자증권 체결 조회(국내 FHKST01010300, 해외 HHDFS76200300)를 화면이 열려 있는 동안 받아 이어 붙여요.
// AQR·VAP는 틱 기록이 없어서 1분봉(긴 기간은 일봉)으로 근사해요.

import type { Bar } from './market-data';
import type { BookMarket } from './market';
import type { Freshness } from './freshness';

export interface TapeRow {
  /** 체결 시각 'HH:MM:SS'(국내는 한국 시각, 해외는 KIS가 준 한국 기준 시각) */
  time: string;
  price: number;
  /** 체결 수량 */
  qty: number;
  /** 전일 대비 */
  change?: number;
  changePct?: number;
  /** 체결강도 */
  strength?: number;
  /** 매수 체결(buy)·매도 체결(sell). 해외는 호가와 비교, 국내는 직전 체결과 비교한 추정이에요 */
  side?: 'buy' | 'sell';
  /** 당일 누적 거래량(해외만) */
  cumVolume?: number;
}

export interface TapeResponse {
  id: string;
  /** 국내만: KRX·NXT·통합 */
  market?: BookMarket;
  /** 최신 체결이 먼저 */
  rows: TapeRow[];
  /** 앱이 받기 시작한 뒤 이어 붙인 체결 수(조회 사이가 비면 빠진 체결이 있을 수 있어요) */
  gaps: number;
  fresh: Freshness;
  note?: string;
}

const same = (a: TapeRow, b: TapeRow) => a.time === b.time && a.price === b.price && a.qty === b.qty && a.cumVolume === b.cumVolume;

/**
 * 새로 받은 체결(최신 먼저)을 쌓아 둔 체결(최신 먼저) 앞에 이어 붙여요.
 * 새 목록 안에서 쌓아 둔 목록의 머리와 겹치는 곳을 찾아 그 앞만 더해요. 겹치는 곳이 없으면 사이가 빈 거예요(gap: true)
 */
export function mergeTape(old: TapeRow[], fresh: TapeRow[], max = 500): { rows: TapeRow[]; added: number; gap: boolean } {
  if (!old.length) return { rows: fresh.slice(0, max), added: fresh.length, gap: false };
  for (let j = 0; j < fresh.length; j++) {
    const n = Math.min(fresh.length - j, old.length);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!same(fresh[j + i], old[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return { rows: [...fresh.slice(0, j), ...old].slice(0, max), added: j, gap: false };
  }
  // 이전 체결이 새 목록에 하나도 없으면, 새 목록이 전부 새것이고 그 사이에 놓친 체결이 있을 수 있어요
  return { rows: [...fresh, ...old].slice(0, max), added: fresh.length, gap: true };
}

/** 직전 체결과 비교한 매수·매도 추정(틱 규칙): 오르면 매수, 내리면 매도, 같으면 직전 판단을 따라요. rows는 최신 먼저 */
export function tickRuleSides(rows: TapeRow[]): TapeRow[] {
  const out = rows.map((r) => ({ ...r }));
  let last: 'buy' | 'sell' | undefined;
  for (let i = out.length - 1; i >= 0; i--) {
    const prev = out[i + 1];
    if (prev) {
      if (out[i].price > prev.price) last = 'buy';
      else if (out[i].price < prev.price) last = 'sell';
    }
    if (!out[i].side) out[i].side = last;
  }
  return out;
}

// ── AQR 체결 요약(분봉 근사) ──

export interface AqrBucket {
  /** 구간 시작(초, UTC) */
  t: number;
  volume: number;
  vwap?: number;
  high: number;
  low: number;
  /** 구간 마지막 봉의 종가 */
  close: number;
}

export interface AqrSummary {
  open: number;
  high: number;
  low: number;
  last: number;
  volume: number;
  /** 거래대금 근사(봉마다 대표가 × 거래량의 합) */
  turnover: number;
  /** VWAP 근사(대표가 = (고가 + 저가 + 종가) ÷ 3) */
  vwap?: number;
  /** 지금가가 VWAP보다 몇 % 위인지 */
  vsVwapPct?: number;
  /** 거래량이 있는 봉 수 */
  activeBars: number;
  bars: number;
  /** 구간별 요약(기본 30분) */
  buckets: AqrBucket[];
}

const typical = (b: Bar) => (b.h + b.l + b.c) / 3;

export function intradaySummary(bars: Bar[], bucketSec = 1800): AqrSummary | undefined {
  if (!bars.length) return undefined;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let turnover = 0;
  let activeBars = 0;
  const groups = new Map<number, { v: number; pv: number; h: number; l: number; c: number }>();
  for (const b of bars) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
    volume += b.v;
    turnover += typical(b) * b.v;
    if (b.v > 0) activeBars++;
    const k = Math.floor(b.t / bucketSec) * bucketSec;
    const g = groups.get(k) ?? { v: 0, pv: 0, h: -Infinity, l: Infinity, c: b.c };
    g.v += b.v;
    g.pv += typical(b) * b.v;
    g.h = Math.max(g.h, b.h);
    g.l = Math.min(g.l, b.l);
    g.c = b.c;
    groups.set(k, g);
  }
  const last = bars[bars.length - 1].c;
  const vwap = volume > 0 ? turnover / volume : undefined;
  return {
    open: bars[0].o,
    high,
    low,
    last,
    volume,
    turnover,
    vwap,
    vsVwapPct: vwap ? (last / vwap - 1) * 100 : undefined,
    activeBars,
    bars: bars.length,
    buckets: [...groups].sort((a, b) => a[0] - b[0]).map(([t, g]) => ({ t, volume: g.v, vwap: g.v > 0 ? g.pv / g.v : undefined, high: g.h, low: g.l, close: g.c })),
  };
}

// ── VAP 가격대별 거래량(봉 근사) ──

export interface VapLevel {
  lo: number;
  hi: number;
  volume: number;
}

export interface VapResult {
  levels: VapLevel[];
  total: number;
  /** 거래가 가장 많은 가격대(POC)의 번호 */
  poc: number;
  /** 거래량 70%가 모인 가격대(밸류 에어리어)의 아래·위 번호 */
  vaLo: number;
  vaHi: number;
}

/**
 * 봉마다 거래량을 그 봉의 저가~고가에 고르게 나눠 가격대(levels개)에 더해요. 고가 = 저가면 그 가격대에 다 더해요.
 * levels는 낮은 가격부터
 */
export function volumeAtPrice(bars: Bar[], count = 24): VapResult | undefined {
  const use = bars.filter((b) => b.v > 0 && Number.isFinite(b.h) && Number.isFinite(b.l));
  if (!use.length) return undefined;
  const lo = Math.min(...use.map((b) => b.l));
  const hi = Math.max(...use.map((b) => b.h));
  const n = hi > lo ? count : 1;
  const step = hi > lo ? (hi - lo) / n : 1;
  const levels: VapLevel[] = Array.from({ length: n }, (_, i) => ({ lo: lo + step * i, hi: i === n - 1 ? hi : lo + step * (i + 1), volume: 0 }));
  const idx = (p: number) => Math.min(n - 1, Math.max(0, Math.floor((p - lo) / step)));
  for (const b of use) {
    if (b.h <= b.l || n === 1) {
      levels[idx(b.c)].volume += b.v;
      continue;
    }
    const a = idx(b.l);
    const z = idx(b.h);
    for (let i = a; i <= z; i++) {
      // 봉의 범위와 가격대가 겹치는 길이만큼 나눠요
      const overlap = Math.min(b.h, levels[i].hi) - Math.max(b.l, levels[i].lo);
      if (overlap > 0) levels[i].volume += (b.v * overlap) / (b.h - b.l);
    }
  }
  const total = levels.reduce((s, x) => s + x.volume, 0);
  let poc = 0;
  for (let i = 1; i < n; i++) if (levels[i].volume > levels[poc].volume) poc = i;
  // 밸류 에어리어: POC에서 시작해 양옆 중 더 많은 쪽을 붙여 70%가 될 때까지
  let vaLo = poc;
  let vaHi = poc;
  let sum = levels[poc].volume;
  while (sum < total * 0.7 && (vaLo > 0 || vaHi < n - 1)) {
    const down = vaLo > 0 ? levels[vaLo - 1].volume : -1;
    const up = vaHi < n - 1 ? levels[vaHi + 1].volume : -1;
    if (up >= down) sum += levels[++vaHi].volume;
    else sum += levels[--vaLo].volume;
  }
  return { levels, total, poc, vaLo, vaHi };
}
