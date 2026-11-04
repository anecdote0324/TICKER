// 보조지표 계산(02 차트): 알려진 값과 맞는지
import { describe, expect, it } from 'vitest';
import type { Bar } from '@bt/shared';
import { activeIndicators, bollinger, ema, futureTimes, ichimoku, macd, prependBars, rsi, sma } from './indicators';

const bar = (t: number, c: number, h = c, l = c): Bar => ({ t, o: c, h, l, c, v: 0 });

describe('이동평균', () => {
  it('단순 이동평균은 n번째 봉부터', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([undefined, undefined, 2, 3, 4]);
  });
  it('지수 이동평균의 첫 값은 앞 n개 평균, 그다음은 2/(n+1) 가중', () => {
    const e = ema([1, 2, 3, 4], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5, 10);
  });
});

describe('볼린저 밴드', () => {
  it('값이 모두 같으면 밴드 폭이 0', () => {
    const b = bollinger(new Array(25).fill(10), 20, 2);
    expect(b.mid[24]).toBe(10);
    expect(b.upper[24]).toBe(10);
    expect(b.lower[19]).toBe(10);
    expect(b.upper[18]).toBeUndefined();
  });
  it('모표준편차 × 2', () => {
    const b = bollinger([1, 3], 2, 2);
    expect(b.upper[1]).toBe(4);
    expect(b.lower[1]).toBe(0);
  });
});

describe('RSI', () => {
  it('오르기만 하면 100, 내리기만 하면 0', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3)[5]).toBe(0);
  });
  it('와일더 공식(교과서 예제)', () => {
    // 14봉 예제(Wilder): 첫 RSI ≈ 70.53
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c, 14)[14]).toBeCloseTo(70.46, 0);
  });
});

describe('MACD', () => {
  it('값이 일정하면 MACD·시그널·히스토그램이 0', () => {
    const m = macd(new Array(60).fill(100));
    expect(m.macd[59]).toBe(0);
    expect(m.signal[59]).toBe(0);
    expect(m.hist[59]).toBe(0);
    expect(m.macd[24]).toBeUndefined();
    expect(m.signal[33]).toBe(0);
  });
});

describe('일목균형표', () => {
  const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i, 101 + i, 99 + i));
  const ich = ichimoku(bars);
  it('전환선 = 9봉 최고·최저 가운데, 기준선 = 26봉', () => {
    expect(ich.tenkan[8]).toBe((109 + 99) / 2);
    expect(ich.kijun[25]).toBe((126 + 99) / 2);
    expect(ich.tenkan[7]).toBeUndefined();
  });
  it('선행스팬은 26봉 앞에, 후행스팬은 26봉 뒤에', () => {
    expect(ich.lead1).toHaveLength(60 + 26);
    expect(ich.lead1[25 + 26]).toBe((ich.tenkan[25]! + ich.kijun[25]!) / 2);
    expect(ich.lead2[51 + 26]).toBe((152 + 99) / 2);
    expect(ich.lagging[0]).toBe(bars[26].c);
    expect(ich.lagging[59]).toBeUndefined();
  });
});

describe('앞날 시각', () => {
  it('일봉은 평일만(금요일 다음은 월요일), 코인은 매일', () => {
    const fri = Date.UTC(2026, 9, 30) / 1000 - 9 * 3600; // 2026-10-30(금) 00:00 KST
    const [a, b] = futureTimes(fri, 2, '1d');
    expect(new Date((a + 9 * 3600) * 1000).getUTCDay()).toBe(1);
    expect(b - a).toBe(86400);
    expect(futureTimes(fri, 1, '1d', true)[0] - fri).toBe(86400);
  });
  it('주봉 7일, 월봉 한 달', () => {
    expect(futureTimes(0, 1, '1w')[0]).toBe(7 * 86400);
    expect(new Date(futureTimes(Date.UTC(2026, 0, 15) / 1000, 1, '1M')[0] * 1000).getUTCMonth()).toBe(1);
  });
});

describe('저장값과 과거 봉', () => {
  it('처음이면 20·60선, 모르는 값은 빼요', () => {
    expect(activeIndicators(undefined)).toEqual(['ma20', 'ma60']);
    expect(activeIndicators(['ma200', 'xyz', 'rsi'])).toEqual(['ma200', 'rsi']);
    expect(activeIndicators([])).toEqual([]);
  });
  it('과거 봉은 지금 첫 봉보다 앞의 것만 붙여요', () => {
    expect(prependBars([bar(1, 1), bar(2, 2), bar(3, 3)], [bar(3, 30), bar(4, 4)]).map((b) => b.c)).toEqual([1, 2, 30, 4]);
  });
});
