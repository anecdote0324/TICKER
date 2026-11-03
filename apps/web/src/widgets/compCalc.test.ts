import { describe, expect, it } from 'vitest';
import type { Bar, Instrument } from '@bt/shared';
import { benchmarkOf, commonStart, rangeStart, returnsFrom } from './compCalc';

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const bar = (d: string, c: number): Bar => ({ t: day(d), o: c, h: c, l: c, c, v: 0 });

describe('COMP 비교 차트 계산', () => {
  it('시작일 이후 첫 종가가 0%, 그 뒤는 그 값 대비 수익률', () => {
    const r = returnsFrom([bar('2026-01-02', 90), bar('2026-01-05', 100), bar('2026-01-06', 110), bar('2026-01-07', 95)], day('2026-01-03'));
    expect(r.map((x) => Math.round(x.v * 100) / 100)).toEqual([0, 10, -5]);
  });
  it('함께 시작하는 날은 데이터가 가장 늦게 시작하는 종목에 맞춰요', () => {
    expect(commonStart([[bar('2025-06-01', 1)], [bar('2025-09-01', 1)]], day('2025-01-01'))).toBe(day('2025-09-01'));
    expect(commonStart([[bar('2025-06-01', 1)]], day('2025-08-01'))).toBe(day('2025-08-01'));
  });
  it('YTD는 올해 1월 1일, 1Y는 366일 전', () => {
    const now = day('2026-11-03');
    expect(rangeStart('YTD', now)).toBe(day('2026-01-01'));
    expect(rangeStart('1Y', now)).toBe(now - 366 * 86400);
  });
  it('대표 지수: 코스피·코스닥·S&P 500, 코인은 비트코인', () => {
    const eq = (market: 'KS' | 'KQ' | 'US'): Instrument => ({ id: `EQ:${market}:X`, assetClass: 'EQUITY', market, code: 'X' });
    expect([benchmarkOf(eq('KS')), benchmarkOf(eq('KQ')), benchmarkOf(eq('US'))]).toEqual(['IDX:KOSPI', 'IDX:KOSDAQ', 'IDX:SPX']);
    expect(benchmarkOf({ id: 'CRY:BTC', assetClass: 'CRYPTO', code: 'BTC' })).toBe('CRY:ETH');
    expect(benchmarkOf({ id: 'CUR:USDKRW', assetClass: 'CURNCY', code: 'USDKRW' })).toBeUndefined();
  });
});
