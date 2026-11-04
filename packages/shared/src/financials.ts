// FA 재무제표(03 v0.3): 국내는 DART 단일회사 전체 재무제표, 미국은 SEC companyfacts(US GAAP).
// 서버는 기간별 계정 값(원천 단위 그대로: 원·달러)을 주고, 비율은 여기서 같은 식으로 계산해요.

import type { Freshness } from './freshness';

export type FinPeriodKind = 'annual' | 'quarter';

/** 표준 계정(국내·미국을 같은 줄로 보여 주려고 이름을 맞춰요) */
export type FinLineId =
  | 'revenue'
  | 'cogs'
  | 'grossProfit'
  | 'operatingIncome'
  | 'pretaxIncome'
  | 'netIncome'
  | 'netIncomeOwners'
  | 'assets'
  | 'currentAssets'
  | 'cash'
  | 'liabilities'
  | 'currentLiabilities'
  | 'equity'
  | 'equityOwners'
  | 'cfo'
  | 'cfi'
  | 'cff'
  | 'capex';

export const FIN_LINES: Array<{ id: FinLineId; label: string; section: 'is' | 'bs' | 'cf' }> = [
  { id: 'revenue', label: '매출액', section: 'is' },
  { id: 'cogs', label: '매출원가', section: 'is' },
  { id: 'grossProfit', label: '매출총이익', section: 'is' },
  { id: 'operatingIncome', label: '영업이익', section: 'is' },
  { id: 'pretaxIncome', label: '법인세차감전순이익', section: 'is' },
  { id: 'netIncome', label: '당기순이익', section: 'is' },
  { id: 'netIncomeOwners', label: '지배주주 순이익', section: 'is' },
  { id: 'assets', label: '자산총계', section: 'bs' },
  { id: 'currentAssets', label: '유동자산', section: 'bs' },
  { id: 'cash', label: '현금및현금성자산', section: 'bs' },
  { id: 'liabilities', label: '부채총계', section: 'bs' },
  { id: 'currentLiabilities', label: '유동부채', section: 'bs' },
  { id: 'equity', label: '자본총계', section: 'bs' },
  { id: 'equityOwners', label: '지배주주 지분', section: 'bs' },
  { id: 'cfo', label: '영업활동 현금흐름', section: 'cf' },
  { id: 'cfi', label: '투자활동 현금흐름', section: 'cf' },
  { id: 'cff', label: '재무활동 현금흐름', section: 'cf' },
  { id: 'capex', label: '유형자산 취득(CAPEX)', section: 'cf' },
];

export interface FinPeriod {
  /** '2024', '2024Q2', 또는 미국의 기말일 '2024-09-28' */
  key: string;
  /** 화면 머리줄: '2024', '2024 2Q', '2024.09' */
  label: string;
  /** 기말일(YYYY-MM-DD, 알 때) */
  end?: string;
}

export interface FinancialsResponse {
  id: string;
  /** 'KRW', 'USD' */
  currency: string;
  source: 'DART' | 'SEC';
  /** '연결', '별도', 'US GAAP' */
  basis: string;
  period: FinPeriodKind;
  /** 오래된 것부터 */
  periods: FinPeriod[];
  /** 계정 id → 기간 순서대로의 값(없으면 null) */
  values: Partial<Record<FinLineId, Array<number | null>>>;
  fresh: Freshness;
  /** 받은 보고서 등 참고 */
  note?: string;
}

export type FinRatioId = 'revenueGrowth' | 'grossMargin' | 'operatingMargin' | 'netMargin' | 'roe' | 'roa' | 'debtRatio' | 'currentRatio' | 'fcf';

export const FIN_RATIOS: Array<{ id: FinRatioId; label: string; unit: '%' | 'amount' }> = [
  { id: 'revenueGrowth', label: '매출 성장률(전년 같은 기간 대비)', unit: '%' },
  { id: 'grossMargin', label: '매출총이익률', unit: '%' },
  { id: 'operatingMargin', label: '영업이익률', unit: '%' },
  { id: 'netMargin', label: '순이익률', unit: '%' },
  { id: 'roe', label: 'ROE(지배주주 순이익 ÷ 지배주주 지분)', unit: '%' },
  { id: 'roa', label: 'ROA(순이익 ÷ 자산)', unit: '%' },
  { id: 'debtRatio', label: '부채비율(부채 ÷ 자본)', unit: '%' },
  { id: 'currentRatio', label: '유동비율(유동자산 ÷ 유동부채)', unit: '%' },
  { id: 'fcf', label: '잉여현금흐름(영업CF − CAPEX)', unit: 'amount' },
];

const div = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : (a / b) * 100);

/**
 * 비율 계산. 분기의 ROE·ROA는 분기 이익 그대로(연환산하지 않아요). 성장률은 연간은 전년, 분기는 4개 앞 분기와 비교해요.
 * CAPEX는 원천마다 부호가 달라서 크기만 써요
 */
export function finRatios(r: Pick<FinancialsResponse, 'values' | 'periods' | 'period'>): Record<FinRatioId, Array<number | null>> {
  const n = r.periods.length;
  const v = (id: FinLineId, i: number) => r.values[id]?.[i] ?? null;
  const lag = r.period === 'annual' ? 1 : 4;
  const out = {} as Record<FinRatioId, Array<number | null>>;
  const each = (f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i));
  out.revenueGrowth = each((i) => {
    const now = v('revenue', i);
    const then = i >= lag ? v('revenue', i - lag) : null;
    return now == null || then == null || then === 0 ? null : (now / then - 1) * 100;
  });
  out.grossMargin = each((i) => div(v('grossProfit', i) ?? (v('revenue', i) != null && v('cogs', i) != null ? v('revenue', i)! - Math.abs(v('cogs', i)!) : null), v('revenue', i)));
  out.operatingMargin = each((i) => div(v('operatingIncome', i), v('revenue', i)));
  out.netMargin = each((i) => div(v('netIncome', i), v('revenue', i)));
  out.roe = each((i) => div(v('netIncomeOwners', i) ?? v('netIncome', i), v('equityOwners', i) ?? v('equity', i)));
  out.roa = each((i) => div(v('netIncome', i), v('assets', i)));
  out.debtRatio = each((i) => div(v('liabilities', i), v('equity', i)));
  out.currentRatio = each((i) => div(v('currentAssets', i), v('currentLiabilities', i)));
  out.fcf = each((i) => {
    const cfo = v('cfo', i);
    const capex = v('capex', i);
    return cfo == null || capex == null ? null : cfo - Math.abs(capex);
  });
  return out;
}

/**
 * 누적 값(1분기·반기·3분기·연간 누적) → 분기 값. 순서대로 [Q1누적, H1누적, 9M누적, FY]이면 [Q1, Q2, Q3, Q4].
 * 앞 누적이 없으면 그 분기는 null
 */
export function quartersFromCumulative(cum: Array<number | null>): Array<number | null> {
  return cum.map((c, i) => {
    if (c == null) return null;
    if (i === 0) return c;
    const prev = cum[i - 1];
    return prev == null ? null : c - prev;
  });
}
