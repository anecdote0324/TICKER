import { describe, expect, it } from 'vitest';
import { evalCix, parseCix, splitCixRef } from './cix';

const vals: Record<string, number> = { '005930': 70000, '000660': 140000, SPX: 6000, NDX: 21000, 'AAPL US': 200 };
const v = (r: string) => vals[r];

describe('CIX 수식', () => {
  it('비율·스프레드·우선순위·괄호·음수', () => {
    expect(evalCix(parseCix('[005930] / [000660]'), v)).toBe(0.5);
    expect(evalCix(parseCix('[SPX] - [NDX] * 0.25'), v)).toBe(750);
    expect(evalCix(parseCix('([SPX] - [NDX]) / 2'), v)).toBe(-7500);
    expect(evalCix(parseCix('-[SPX] + 1'), v)).toBe(-5999);
    expect(evalCix(parseCix('[ AAPL   US ] * 2'), v)).toBe(400);
  });
  it('종목 목록은 겹치지 않게', () => {
    expect(parseCix('[SPX] / [SPX] + [NDX]').refs).toEqual(['SPX', 'NDX']);
  });
  it('값이 없거나 0으로 나누면 undefined', () => {
    expect(evalCix(parseCix('[XYZ] + 1'), v)).toBeUndefined();
    expect(evalCix(parseCix('[SPX] / 0'), v)).toBeUndefined();
  });
  it('틀린 식은 이유와 함께', () => {
    expect(() => parseCix('')).toThrow('비어');
    expect(() => parseCix('[SPX] +')).toThrow();
    expect(() => parseCix('[SPX] [NDX]')).toThrow('연산자');
    expect(() => parseCix('([SPX]')).toThrow('괄호');
    expect(() => parseCix('[SPX')).toThrow('대괄호');
    expect(() => parseCix('alert(1)')).toThrow('쓸 수 없는');
  });
  it('시장 붙이기', () => {
    expect(splitCixRef('aapl us')).toEqual({ code: 'AAPL', market: 'US' });
  });
});
