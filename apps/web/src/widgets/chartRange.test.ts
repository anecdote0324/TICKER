import { describe, expect, it } from 'vitest';
import { aggregateBars, visibleBarCount } from './chartRange';

/** start부터 1분 간격 봉 n개 */
const minutes = (start: number, n: number) => Array.from({ length: n }, (_, i) => ({ t: start + i * 60 }));
const day = 86400;

describe('차트에 보여 줄 봉 수', () => {
  it('GP는 기간의 일봉 수, 주봉·월봉은 나눠서', () => {
    const bars = minutes(0, 500);
    expect(visibleBarCount(bars, false, '1d', '3M')).toBe(63);
    expect(visibleBarCount(bars, false, '1d', '1M')).toBe(21);
    expect(visibleBarCount(bars, false, '1w', '1Y')).toBe(50);
    expect(visibleBarCount(bars, false, '1d', 'MAX')).toBe(500);
    // 봉이 적으면 있는 만큼
    expect(visibleBarCount(minutes(0, 40), false, '1d', '6M')).toBe(40);
  });

  it('GIP는 저장해 둔 며칠치 분봉이 있어도 최근 4시간만(기본)', () => {
    // 어제 장 390개 + 오늘 장 390개
    const bars = [...minutes(0, 390), ...minutes(day, 390)];
    expect(visibleBarCount(bars, true, '1m', '4H')).toBe(240);
    expect(visibleBarCount(bars, true, '1m', '1H')).toBe(60);
    expect(visibleBarCount(bars, true, '1m', 'MAX')).toBe(780);
  });

  it('GIP 1D는 가장 최근 장 전체, 24시간 시장은 최근 24시간', () => {
    expect(visibleBarCount([...minutes(0, 390), ...minutes(day, 390)], true, '1m', '1D')).toBe(390);
    expect(visibleBarCount(minutes(0, 3000), true, '1m', '1D')).toBe(1440);
  });

  it('장이 막 열려 봉이 적어도 30개 자리는 잡아요', () => {
    expect(visibleBarCount([...minutes(0, 390), ...minutes(day, 5)], true, '1m', '1H')).toBe(30);
  });

  it('GIP 봉 크기: 1분봉을 5분·60분봉으로 묶고, 기간은 시간으로 세요', () => {
    // 09:00(한국)부터 1분봉 390개(정규장 6시간 30분)
    const open = Date.UTC(2026, 9, 29, 0) / 1000;
    const one = Array.from({ length: 390 }, (_, i) => ({ t: open + i * 60, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1 }));
    const five = aggregateBars(one, 5);
    expect(five).toHaveLength(78);
    expect(five[0]).toEqual({ t: open, o: 100, h: 105, l: 99, c: 104.5, v: 5 });
    const hour = aggregateBars(one, 60);
    // 09·10·11·12·13·14·15시 칸(15시 칸은 15:00~15:29)
    expect(hour.map((b) => b.v)).toEqual([60, 60, 60, 60, 60, 60, 30]);
    // 1H 기간 = 5분봉 12개, 4H = 60분봉 4개지만 너무 크게 보이지 않게 8개는 자리를 잡아요
    expect(visibleBarCount(five, true, '1m', '1H', 5)).toBe(12);
    expect(visibleBarCount(hour, true, '1m', '4H', 60)).toBe(8);
    expect(aggregateBars(one, 1)).toBe(one);
  });
});
