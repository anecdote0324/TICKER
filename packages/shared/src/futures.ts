// v0.6 WEIF 세계 지수선물: 국내 지수선물(KOSPI200·미니·코스닥150·KRX300·VKOSPI) 시세, 베이시스, 이론가, 미결제약정.
// 종목은 한국투자증권 지수선물옵션 마스터(fo_idx_code_mts.mst, 공식 저장소 stocks_info/domestic_index_future_code.py)에서 와요.
// 미국 지수선물 장중 시세는 사용자 결정으로 넣지 않아요(CME 유료 시세).

import type { Freshness } from './freshness';
import { holidayName } from './calendar';

export type FuturesKind = 'K200' | 'MINI' | 'KQ150' | 'KRX300' | 'VKOSPI';

/** 마스터 첫 칸(상품종류) → 종류. 옵션(2·4·5·6 등)은 빼요 */
export const FUTURES_KINDS: Array<{ type: string; kind: FuturesKind; label: string; months: number }> = [
  { type: '1', kind: 'K200', label: 'KOSPI200 선물', months: 2 },
  { type: 'B', kind: 'MINI', label: '미니 KOSPI200 선물', months: 1 },
  { type: '3', kind: 'KQ150', label: '코스닥150 선물', months: 1 },
  { type: 'H', kind: 'KRX300', label: 'KRX300 선물', months: 1 },
  { type: '7', kind: 'VKOSPI', label: 'VKOSPI 선물', months: 1 },
];

export interface FuturesContract {
  kind: FuturesKind;
  /** 단축코드(예: A01612) */
  code: string;
  /** 만기 연월 YYYYMM */
  month: string;
  /** 월물 순서(1 = 최근월물) */
  seq: number;
  underlying: string;
}

/** 마스터 한 줄: 상품종류|단축코드|표준코드|한글종목명|ATM구분|행사가|월물구분코드|기초자산 단축코드|기초자산 명 */
export function parseFuturesMaster(text: string): FuturesContract[] {
  const out: FuturesContract[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('|');
    if (c.length < 9) continue;
    const def = FUTURES_KINDS.find((k) => k.type === c[0].trim());
    if (!def) continue;
    const month = c[3].match(/(\d{6})\s*$/)?.[1];
    const seq = Number(c[6]);
    if (!month || !Number.isFinite(seq)) continue;
    out.push({ kind: def.kind, code: c[1].trim(), month, seq, underlying: c[8].trim() });
  }
  return out;
}

/** WEIF에 보여 줄 계약(종류마다 앞 월물) */
export function watchedContracts(all: FuturesContract[]): FuturesContract[] {
  const out: FuturesContract[] = [];
  for (const k of FUTURES_KINDS) {
    const list = all.filter((c) => c.kind === k.kind).sort((a, b) => a.seq - b.seq);
    out.push(...list.slice(0, k.months));
  }
  return out;
}

export type FuturesSession = 'day' | 'night' | 'closed';

/**
 * 장 구분(한국 시간): 주간 08:45~15:45, 야간(KRX 야간 파생시장) 18:00~다음 날 06:00.
 * 야간은 영업일 저녁에 열려 다음 날 새벽까지예요(금요일 밤은 토요일 06:00까지)
 */
export function futuresSession(now: number): FuturesSession {
  const k = new Date(now + 9 * 3600_000);
  const hm = k.getUTCHours() * 60 + k.getUTCMinutes();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const isBiz = (d: Date) => {
    const dow = d.getUTCDay();
    return dow !== 0 && dow !== 6 && !holidayName('KR', ymd(d));
  };
  if (hm >= 8 * 60 + 45 && hm < 15 * 60 + 45 && isBiz(k)) return 'day';
  if (hm >= 18 * 60 && isBiz(k)) return 'night';
  if (hm < 6 * 60) {
    const prev = new Date(k.getTime() - 86400_000);
    if (isBiz(prev)) return 'night';
  }
  return 'closed';
}

export const FUTURES_SESSION_LABEL: Record<FuturesSession, string> = { day: '주간', night: '야간', closed: '장 마감' };

/** 단순 보유비용 이론가: 지수 × (1 + 금리 × 잔존일/365). 배당은 빼지 않아요 */
export function carryFair(spot: number, ratePct: number, days: number): number {
  return spot * (1 + (ratePct / 100) * (days / 365));
}

export interface FuturesRow {
  contract: FuturesContract;
  label: string;
  last?: number;
  change?: number;
  changePct?: number;
  volume?: number;
  openInterest?: number;
  oiChange?: number;
  /** 베이시스 = 선물 − 지수(KIS basis) */
  basis?: number;
  /** KIS 이론가와 괴리율(%) */
  theo?: number;
  disparity?: number;
  /** 앱이 계산한 단순 이론가(CD91) */
  carry?: number;
  daysLeft?: number;
  lastTradeDate?: string;
  /** 기초 지수 */
  spot?: number;
  spotChangePct?: number;
  error?: string;
}

export interface FuturesResponse {
  rows: FuturesRow[];
  session: FuturesSession;
  /** 이론가 계산에 쓴 CD91(%) */
  cd91?: number;
  masterAsOf?: string;
  error?: string;
  fresh: Freshness;
}

export interface FuturesBook {
  code: string;
  asks: Array<{ price: number; qty: number }>;
  bids: Array<{ price: number; qty: number }>;
  totalAsk?: number;
  totalBid?: number;
  time?: string;
  error?: string;
}
