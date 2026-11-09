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

describe('그리기 고치기(v0.6)', () => {
  it('선분까지 거리', async () => {
    const { distToSegment } = await import('./chartDrawings');
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
  it('손잡이 끌기: 점·모서리·몸통', async () => {
    const { moveHandle } = await import('./chartDrawings');
    const box = { id: 'b', kind: 'box' as const, p1: { t: 100, p: 10 }, p2: { t: 200, p: 20 } };
    expect(moveHandle(box, 'p2', { t: 300, p: 25 }, { t: 0, p: 0 })).toMatchObject({ p1: { t: 100, p: 10 }, p2: { t: 300, p: 25 } });
    // p12 = (p1의 시각, p2의 가격) 모서리
    expect(moveHandle(box, 'p12', { t: 50, p: 30 }, { t: 0, p: 0 })).toMatchObject({ p1: { t: 50, p: 10 }, p2: { t: 200, p: 30 } });
    expect(moveHandle(box, 'body', { t: 160, p: 17 }, { t: 150, p: 15 })).toMatchObject({ p1: { t: 110, p: 12 }, p2: { t: 210, p: 22 } });
    const h = { id: 'h', kind: 'hline' as const, p1: { t: 100, p: 10 } };
    expect(moveHandle(h, 'body', { t: 100, p: 12 }, { t: 100, p: 10 }).p1.p).toBe(12);
  });
  it('오른쪽 늘리기: 예전 추세선은 늘린 모양, 새 추세선·박스는 꺼짐', async () => {
    const { extendsRight } = await import('./chartPrefs');
    const p = { t: 1, p: 1 };
    expect(extendsRight({ id: 'a', kind: 'trend', p1: p, p2: p })).toBe(true);
    expect(extendsRight({ id: 'a', kind: 'trend', p1: p, p2: p, extend: false })).toBe(false);
    expect(extendsRight({ id: 'a', kind: 'box', p1: p, p2: p })).toBe(false);
    expect(extendsRight({ id: 'a', kind: 'box', p1: p, p2: p, extend: true })).toBe(true);
  });
});
