// GC 계산: 비교 커브·변동(bp)·스프레드
import { describe, expect, it } from 'vitest';
import type { YieldCurve } from '@bt/shared';
import { bp, curveAt, spreads } from './gcCalc';

const fresh = { source: 'TREASURY', mode: 'daily', asOf: 0, receivedAt: 0 } as const;
const us: YieldCurve = {
  id: 'UST',
  name: '미국채',
  tenors: [
    { key: 'm3', label: '3M', years: 0.25 },
    { key: 'y2', label: '2Y', years: 2 },
    { key: 'y10', label: '10Y', years: 10 },
  ],
  rows: [
    { date: '2026-10-02', values: { m3: 4.3, y2: 4.0, y10: 4.2 } },
    { date: '2026-10-30', values: { m3: 4.2, y2: 3.9, y10: 4.25 } },
    { date: '2026-11-03', values: { m3: 4.21, y2: 3.8, y10: 4.3 } },
  ],
  fresh,
};
const kr: YieldCurve = {
  id: 'KTB',
  name: '국고채',
  tenors: [
    { key: 'a', label: '3Y', years: 3 },
    { key: 'b', label: '10Y', years: 10 },
  ],
  rows: [
    { date: '2026-10-02', values: { a: 3.0, b: 3.3 } },
    { date: '2026-11-03', values: { a: 3.1, b: 3.5 } },
  ],
  fresh: { ...fresh, source: 'ECOS' },
};

describe('GC 계산', () => {
  it('비교 날짜는 그 날 이전의 가장 가까운 영업일', () => {
    expect(curveAt(us, 0)?.date).toBe('2026-11-03');
    expect(curveAt(us, 7)?.date).toBe('2026-10-02');
    expect(curveAt(us, 2)?.date).toBe('2026-10-30');
  });
  it('변동은 bp(소수 첫째 자리)', () => {
    expect(bp(4.3, 4.2)).toBe(10);
    expect(bp(3.8, 4.0)).toBe(-20);
    expect(bp(undefined, 4)).toBeUndefined();
  });
  it('스프레드: 미국 10Y-2Y·10Y-3M, 국고 10Y-3Y, 국고-미국 10Y와 비교 날짜 대비 변화', () => {
    const s = spreads([us, kr], 30);
    expect(s.find((x) => x.label === '미국 10Y-2Y')).toEqual({ label: '미국 10Y-2Y', now: 50, change: 30 });
    expect(s.find((x) => x.label === '국고 10Y-3Y')).toEqual({ label: '국고 10Y-3Y', now: 40, change: 10 });
    expect(s.find((x) => x.label === '국고 10Y - 미국 10Y')).toEqual({ label: '국고 10Y - 미국 10Y', now: -80, change: 10 });
  });
});
