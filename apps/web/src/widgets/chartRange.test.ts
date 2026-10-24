import { describe, expect, it } from 'vitest';
import { visibleBarCount } from './chartRange';

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
});
