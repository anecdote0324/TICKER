import { describe, expect, it } from 'vitest';
import { extendRay } from './chartDrawings';
import { fibPrices, styleForAlias } from './chartPrefs';
import { activeIndicators } from './indicators';

describe('v0.5 차트 설정·그리기', () => {
  it('GPO는 바, GPC는 캔들', () => {
    expect(styleForAlias('GPO')).toBe('bar');
    expect(styleForAlias('GPC')).toBe('candle');
    expect(styleForAlias(undefined)).toBeUndefined();
  });
  it('피보나치: 첫 점 0%, 둘째 점 100%', () => {
    const f = fibPrices(100, 200);
    expect(f[0]).toEqual({ level: 0, price: 100 });
    expect(f.find((x) => x.level === 0.618)?.price).toBeCloseTo(161.8);
    expect(f.at(-1)).toEqual({ level: 1, price: 200 });
  });
  it('추세선은 둘째 점 너머 화면 끝까지 늘려요', () => {
    expect(extendRay(0, 100, 10, 90, 100)).toEqual([100, 0]);
    expect(extendRay(10, 10, 10, 20, 100)).toEqual([10, 20]);
  });
  it('TDEF 기본 지표: 패널에 고른 값이 없을 때만', () => {
    expect(activeIndicators(undefined, ['rsi', 'bb'])).toEqual(['rsi', 'bb']);
    expect(activeIndicators(['ma5'], ['rsi'])).toEqual(['ma5']);
    expect(activeIndicators(undefined)).toEqual(['ma20', 'ma60']);
  });
});
