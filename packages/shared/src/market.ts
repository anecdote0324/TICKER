// v0.4 지수·ETF·호가(08 §2.4·2.6): MEMB 지수 구성종목(ETF 구성 근사), MOV 등락·기여도, ETF 분석(FFLO 자금 흐름 탭), BQ 10호가.

import type { Freshness } from './freshness';

/** MEMB·MOV 인자: 코스피200(KODEX 200 구성), 코스닥150(KODEX 코스닥150 구성), S&P 500(SPY 보유), 나스닥100(QQQ 보유) */
export type MembIndex = 'KOSPI200' | 'KOSDAQ150' | 'SPX' | 'NDX';

export const MEMB_INDEXES: Array<{ code: MembIndex; label: string; aliases: string[] }> = [
  { code: 'KOSPI200', label: '코스피200', aliases: ['KOSPI2', 'K200', 'KS200', 'KOSPI'] },
  { code: 'KOSDAQ150', label: '코스닥150', aliases: ['KQ150', 'KOSDAQ'] },
  { code: 'SPX', label: 'S&P 500', aliases: ['SP500', 'SPY', 'US500'] },
  { code: 'NDX', label: '나스닥100', aliases: ['NASDAQ100', 'NAS100', 'QQQ'] },
];

/** 국내 지수 → 구성을 빌려 올 ETF(한국투자증권 ETF 구성종목시세) */
export const MEMB_KR_ETF: Record<'KOSPI200' | 'KOSDAQ150', { code: string; name: string }> = {
  KOSPI200: { code: '069500', name: 'KODEX 200' },
  KOSDAQ150: { code: '229200', name: 'KODEX 코스닥150' },
};

export interface MembRow {
  code: string;
  id?: string;
  name: string;
  /** 비중(%) */
  weight?: number;
  last?: number;
  changePct?: number;
  /** 지수 기여도(%p) = 비중 × 등락률 / 100 */
  contribution?: number;
}

export interface MembResponse {
  index: MembIndex;
  /** 구성을 가져온 ETF: 'KODEX 200(069500)', 'SPY' */
  source: { etf: string; issuer: string; asOf?: string };
  rows: MembRow[];
  /** 기여도 합(%p): 지수 등락의 근사 */
  totalContribution?: number;
  fresh: Freshness;
  note?: string;
}

/** 비중 × 등락률로 기여도를 붙이고 합을 구해요 */
export function withContribution(rows: MembRow[]): { rows: MembRow[]; total?: number } {
  let total = 0;
  let any = false;
  const out = rows.map((r) => {
    if (r.weight === undefined || r.changePct === undefined) return r;
    any = true;
    const c = (r.weight * r.changePct) / 100;
    total += c;
    return { ...r, contribution: c };
  });
  return { rows: out, total: any ? total : undefined };
}

export interface EtfNavRow {
  date: string;
  close?: number;
  nav?: number;
  /** 괴리율(%) */
  gap?: number;
}

export interface EtfFlowRow {
  date: string;
  /** 상장 주수 */
  shares: number;
  nav?: number;
  /** 전날 대비 주수 변화 × NAV(원). 첫날은 없음 */
  flow?: number;
}

export interface EtfResponse {
  id: string;
  name?: string;
  price?: number;
  changePct?: number;
  nav?: number;
  /** 괴리율(%) */
  gap?: number;
  /** 추적 오차율(%) */
  trackingError?: number;
  /** 순자산 총액(원) */
  netAssets?: number;
  listedShares?: number;
  componentCount?: number;
  category?: string;
  /** 분배금 주기 */
  dividendCycle?: string;
  /** 최근 30거래일 NAV 비교(최근 먼저) */
  navDaily: EtfNavRow[];
  /** 구성종목(비중 큰 순) */
  components: MembRow[];
  /** FFLO: 앱이 모은 상장 주수 일별 기록(최근 먼저) */
  flows: EtfFlowRow[];
  fresh: Freshness;
  note?: string;
}

/** 상장 주수 기록 → 자금 흐름(주수 변화 × 그날 NAV). 기록은 날짜 오름차순으로 받아 최근 먼저 돌려줘요 */
export function etfFlows(records: Array<{ date: string; shares: number; nav?: number }>): EtfFlowRow[] {
  const asc = [...records].sort((a, b) => a.date.localeCompare(b.date));
  return asc
    .map((r, i) => {
      const prev = asc[i - 1];
      return { ...r, flow: prev && r.nav ? (r.shares - prev.shares) * r.nav : undefined };
    })
    .reverse();
}

/** BQ 10호가: KRX(J)·NXT(NX)·통합(UN) */
export type BookMarket = 'J' | 'NX' | 'UN';

export const BOOK_MARKETS: Array<{ code: BookMarket; label: string }> = [
  { code: 'J', label: 'KRX' },
  { code: 'NX', label: 'NXT' },
  { code: 'UN', label: '통합' },
];

export interface OrderbookResponse {
  id: string;
  market: BookMarket;
  /** 호가 접수 시각 'HH:MM:SS' */
  time?: string;
  /** 매도호가(가까운 것부터 10개) */
  asks: Array<{ price: number; qty: number; change?: number }>;
  /** 매수호가(가까운 것부터 10개) */
  bids: Array<{ price: number; qty: number; change?: number }>;
  totalAsk?: number;
  totalBid?: number;
  /** 예상 체결가·수량(동시호가 때) */
  expected?: { price: number; qty?: number };
  fresh: Freshness;
}
