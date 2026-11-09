import { describe, expect, it } from 'vitest';
import { closeOn, daysBetween, forwardRate, modifiedFollowing, periodReturn, realizedVol, spotDate, tenorDate } from './fxcalc';

describe('외환 계산', () => {
  it('현물 결제일은 두 통화 모두 여는 영업일로 T+2', () => {
    // 2026-02-13(금) → 설 연휴(16~18일) 건너뛰어 19·20일 → 20일
    expect(spotDate(['USD', 'KRW'], '2026-02-13')).toBe('2026-02-20');
    // 미국 독립기념일(7/3 대체) 건너뜀
    expect(spotDate(['USD', 'KRW'], '2026-07-01')).toBe('2026-07-06');
  });
  it('만기일: 달 끝은 수정 다음 영업일', () => {
    expect(modifiedFollowing(['USD'], '2026-01-31')).toBe('2026-01-30');
    expect(tenorDate(['USD', 'KRW'], '2026-01-30', '1M')).toBe('2026-02-27');
    expect(tenorDate(['USD', 'KRW'], '2026-03-04', '1W')).toBe('2026-03-11');
    expect(daysBetween('2026-03-04', '2026-06-04')).toBe(92);
  });
  it('금리평형 선물환', () => {
    // 원화 금리가 낮으면 원/달러 선물환은 현물보다 낮아요
    const f = forwardRate(1400, 'USD', 'KRW', 4.3, 2.8, 92);
    expect(f).toBeLessThan(1400);
    expect(f).toBeCloseTo((1400 * (1 + 0.028 * 92 / 365)) / (1 + 0.043 * 92 / 360), 6);
  });
  it('수익률·변동성·과거 종가', () => {
    const closes = [
      { t: 100, c: 100 },
      { t: 200, c: 110 },
      { t: 300, c: 121 },
    ];
    expect(periodReturn(closes, 150)).toBeCloseTo(21);
    expect(periodReturn(closes, 250)).toBeCloseTo(10);
    expect(realizedVol([100, 101, 100, 101, 100])).toBeGreaterThan(0);
    expect(closeOn([{ t: Date.parse('2026-01-02T00:00:00Z') / 1000, c: 1 }, { t: Date.parse('2026-01-05T00:00:00Z') / 1000, c: 2 }], '2026-01-04')?.c).toBe(1);
  });
});
