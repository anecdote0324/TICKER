// COMP 비교 차트의 계산(03 v0.2): 기간 시작 = 0%인 수익률 선. 화면과 따로 두어 테스트해요.

import type { Bar, Instrument } from '@bt/shared';

/** 기간 버튼: 달력 날 수(YTD는 올해 1월 1일부터) */
export const COMP_RANGES = ['1M', '3M', '6M', 'YTD', '1Y'] as const;
export type CompRange = (typeof COMP_RANGES)[number];
export const COMP_DEFAULT: CompRange = '1Y';
const RANGE_DAYS: Record<Exclude<CompRange, 'YTD'>, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 };

/** 기간이 시작하는 시각(초, UTC 0시) */
export function rangeStart(range: CompRange, nowSec: number): number {
  if (range === 'YTD') {
    const y = new Date(nowSec * 1000).getUTCFullYear();
    return Date.UTC(y, 0, 1) / 1000;
  }
  return nowSec - RANGE_DAYS[range] * 86400;
}

/**
 * 모든 종목이 함께 시작하는 날: 기간 시작과 각 종목의 첫 봉 중 가장 늦은 날.
 * 한쪽 데이터가 짧으면(최근 상장, 소스가 주는 기간) 그 날부터 함께 0%로 맞춰요
 */
export function commonStart(series: Bar[][], start: number): number {
  let s = start;
  for (const bars of series) if (bars.length > 0) s = Math.max(s, bars[0].t);
  return s;
}

/** 시작일 이후 첫 종가를 0%로 둔 수익률(%) 선 */
export function returnsFrom(bars: Bar[], start: number): Array<{ t: number; v: number }> {
  const i = bars.findIndex((b) => b.t >= start && b.c > 0);
  if (i < 0) return [];
  const base = bars[i].c;
  return bars.slice(i).map((b) => ({ t: b.t, v: (b.c / base - 1) * 100 }));
}

/** 비교 종목을 붙이지 않았을 때 견줄 대표 지수(코인은 비트코인, 비트코인이면 이더리움) */
export function benchmarkOf(inst: Instrument | undefined): string | undefined {
  if (!inst) return undefined;
  if (inst.assetClass === 'EQUITY') return inst.market === 'KQ' ? 'IDX:KOSDAQ' : inst.market === 'US' ? 'IDX:SPX' : 'IDX:KOSPI';
  if (inst.assetClass === 'CRYPTO') return inst.id === 'CRY:BTC' ? 'CRY:ETH' : 'CRY:BTC';
  if (inst.assetClass === 'INDEX') return inst.id === 'IDX:SPX' ? 'IDX:KOSPI' : 'IDX:SPX';
  return undefined;
}
