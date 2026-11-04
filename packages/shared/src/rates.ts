// GC 금리 커브(03 v0.3): 미국채(재무부 XML)와 국고채(BOK ECOS)의 일별 금리.
// 서버는 최근 약 400일의 날짜별 금리를 주고, 화면이 오늘·1주 전·1개월 전·1년 전 커브와 변동(bp)을 계산해요.

import type { Freshness } from './freshness';

export type CurveId = 'UST' | 'KTB';

export interface CurveTenor {
  /** 'BC_10YEAR', '010210000' 같은 원천 키 */
  key: string;
  /** '10Y', '3M' */
  label: string;
  /** 만기(년) */
  years: number;
}

export interface YieldCurve {
  id: CurveId;
  /** '미국채', '국고채' */
  name: string;
  tenors: CurveTenor[];
  /** 날짜순(오래된 것부터). values는 테너 키 → 금리(%) */
  rows: Array<{ date: string; values: Record<string, number> }>;
  fresh: Freshness;
}

export interface CurvesResponse {
  curves: YieldCurve[];
  /** 받지 못한 커브와 이유(키 없음 등) */
  missing: Array<{ id: CurveId; name: string; reason: string }>;
}

/** 미국채 XML 키 → 테너. 1.5개월물처럼 새로 생기는 테너도 이름으로 읽어요(04: 테너 목록을 고정하지 않아요) */
export function ustTenor(key: string): CurveTenor | undefined {
  const m = /^BC_(\d+)(?:_(\d+))?(MONTH|YEAR)$/.exec(key);
  if (!m) return undefined;
  const n = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0);
  const years = m[3] === 'MONTH' ? n / 12 : n;
  return { key, label: `${m[2] ? `${m[1]}.${m[2]}` : m[1]}${m[3] === 'MONTH' ? 'M' : 'Y'}`, years };
}

/** 국고채 ECOS 항목(시장금리 일별 817Y002). 2026-11 샘플 키로 이름을 확인했어요 */
export const KTB_ITEMS: CurveTenor[] = [
  { key: '010190000', label: '1Y', years: 1 },
  { key: '010195000', label: '2Y', years: 2 },
  { key: '010200000', label: '3Y', years: 3 },
  { key: '010200001', label: '5Y', years: 5 },
  { key: '010210000', label: '10Y', years: 10 },
  { key: '010220000', label: '20Y', years: 20 },
  { key: '010230000', label: '30Y', years: 30 },
  { key: '010240000', label: '50Y', years: 50 },
];

/** 날짜(YYYY-MM-DD) 이전(같은 날 포함)의 가장 가까운 행 */
export function rowOnOrBefore<T extends { date: string }>(rows: T[], date: string): T | undefined {
  let found: T | undefined;
  for (const r of rows) {
    if (r.date <= date) found = r;
    else break;
  }
  return found;
}

/** 날짜에서 n일 전(YYYY-MM-DD, UTC로 셈) */
export function daysBefore(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - n * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}
