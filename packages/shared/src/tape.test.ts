import { describe, expect, it } from 'vitest';
import { intradaySummary, mergeTape, tickRuleSides, volumeAtPrice, type TapeRow } from './tape';

const r = (time: string, price: number, qty = 1): TapeRow => ({ time, price, qty });

describe('mergeTape', () => {
  it('겹치는 곳 앞의 새 체결만 더해요', () => {
    const old = [r('09:00:03', 101), r('09:00:02', 100), r('09:00:01', 100)];
    const fresh = [r('09:00:05', 102), r('09:00:04', 101), r('09:00:03', 101), r('09:00:02', 100)];
    const m = mergeTape(old, fresh);
    expect(m.added).toBe(2);
    expect(m.gap).toBe(false);
    expect(m.rows.map((x) => x.time)).toEqual(['09:00:05', '09:00:04', '09:00:03', '09:00:02', '09:00:01']);
  });
  it('같은 초에 같은 체결이 둘이어도 순서로 맞춰요', () => {
    const old = [r('09:00:01', 100), r('09:00:01', 100)];
    const fresh = [r('09:00:01', 100), r('09:00:01', 100), r('09:00:01', 100)];
    // 새 목록 첫 줄부터 맞춰 보면 겹쳐요(새 것 0개)
    expect(mergeTape(old, fresh).added).toBe(0);
  });
  it('겹치는 곳이 없으면 사이가 빈 거예요', () => {
    const m = mergeTape([r('09:00:01', 100)], [r('09:05:00', 103), r('09:04:59', 102)]);
    expect(m.gap).toBe(true);
    expect(m.rows).toHaveLength(3);
  });
  it('최대 개수까지만 남겨요', () => {
    expect(mergeTape([], [r('1', 1), r('2', 2), r('3', 3)], 2).rows).toHaveLength(2);
  });
});

describe('tickRuleSides', () => {
  it('오르면 매수, 내리면 매도, 같으면 직전 판단', () => {
    const s = tickRuleSides([r('4', 99), r('3', 101), r('2', 101), r('1', 100)]);
    expect(s.map((x) => x.side)).toEqual(['sell', 'buy', 'buy', undefined]);
  });
});

describe('intradaySummary', () => {
  it('VWAP과 구간별 거래량', () => {
    const bars = [
      { t: 0, o: 10, h: 12, l: 9, c: 12, v: 100 },
      { t: 60, o: 12, h: 12, l: 12, c: 12, v: 0 },
      { t: 1800, o: 12, h: 15, l: 12, c: 15, v: 300 },
    ];
    const s = intradaySummary(bars)!;
    expect(s.volume).toBe(400);
    expect(s.vwap).toBeCloseTo((11 * 100 + 14 * 300) / 400);
    expect(s.activeBars).toBe(2);
    expect(s.buckets.map((b) => b.volume)).toEqual([100, 300]);
    expect(s.high).toBe(15);
    expect(s.vsVwapPct).toBeCloseTo((15 / s.vwap! - 1) * 100);
  });
  it('봉이 없으면 없어요', () => {
    expect(intradaySummary([])).toBeUndefined();
  });
});

describe('volumeAtPrice', () => {
  it('봉 범위에 고르게 나누고 POC·70% 구간을 찾아요', () => {
    const bars = [
      { t: 0, o: 0, h: 10, l: 0, c: 5, v: 100 },
      { t: 1, o: 0, h: 2, l: 2, c: 2, v: 50 },
    ];
    const v = volumeAtPrice(bars, 5)!;
    expect(v.levels).toHaveLength(5);
    expect(v.total).toBeCloseTo(150);
    expect(v.levels.map((x) => Math.round(x.volume))).toEqual([20, 70, 20, 20, 20]);
    expect(v.poc).toBe(1);
    const inVa = v.levels.slice(v.vaLo, v.vaHi + 1).reduce((s, x) => s + x.volume, 0);
    expect(inVa).toBeGreaterThanOrEqual(v.total * 0.7);
  });
  it('가격이 하나뿐이면 한 칸', () => {
    const v = volumeAtPrice([{ t: 0, o: 5, h: 5, l: 5, c: 5, v: 10 }])!;
    expect(v.levels).toHaveLength(1);
    expect(v.total).toBe(10);
  });
});
