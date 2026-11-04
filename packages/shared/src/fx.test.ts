// FXC 칸 → 환율 종목(v0.2): 모든 칸이 차트로 이어져요
import { describe, expect, it } from 'vitest';
import { FX_CURRENCIES, FX_PAIRS, fxPairFor } from './static-instruments';

describe('fxPairFor', () => {
  it('FXC의 모든 칸(통화 둘)에 환율 종목이 있어요', () => {
    for (const a of FX_CURRENCIES) for (const b of FX_CURRENCIES) if (a !== b) expect(fxPairFor(a, b), `${a}/${b}`).toBeDefined();
  });

  it('같은 방향의 쌍이 있으면 그대로, 없으면 뒤집은 쌍', () => {
    expect(fxPairFor('USD', 'KRW')).toMatchObject({ pair: { code: 'USDKRW' }, inverted: false });
    expect(fxPairFor('KRW', 'USD')).toMatchObject({ pair: { code: 'USDKRW' }, inverted: true });
    expect(fxPairFor('EUR', 'JPY')).toMatchObject({ pair: { code: 'EURJPY' }, inverted: false });
    expect(fxPairFor('JPY', 'CNY')).toMatchObject({ pair: { code: 'CNYJPY' }, inverted: true });
  });

  it('통화쌍마다 한 번만, FXC 통화로만', () => {
    const keys = FX_PAIRS.map((p) => [p.base, p.quote].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(FX_PAIRS.map((p) => p.code)).size).toBe(FX_PAIRS.length);
    for (const p of FX_PAIRS) {
      expect(p.code).toBe(`${p.base}${p.quote}`);
      expect(FX_CURRENCIES as readonly string[]).toContain(p.base);
      expect(FX_CURRENCIES as readonly string[]).toContain(p.quote);
    }
  });
});
