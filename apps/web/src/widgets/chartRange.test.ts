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

  it('GP 시간봉은 기간을 달력 날 수로 세요(국내 1시간봉 하루 7개)', () => {
    const day = 86400;
    // 평일 60일치 1시간봉 7개씩(09~15시)
    const hours = Array.from({ length: 60 }, (_, d) => Array.from({ length: 7 }, (_, h) => ({ t: d * day + h * 3600 }))).flat();
    const n1m = visibleBarCount(hours, false, '1h', '1M');
    expect(n1m).toBeGreaterThanOrEqual(31 * 7 - 7);
    expect(n1m).toBeLessThanOrEqual(31 * 7);
    expect(visibleBarCount(hours, false, '1h', 'MAX')).toBe(420);
    // 봉이 적어도 20개는 자리를 잡아요
    expect(visibleBarCount(hours.slice(0, 10), false, '4h', '1M')).toBe(10);
    expect(visibleBarCount(hours.slice(0, 30), false, '4h', '1M')).toBe(30);
  });
});
