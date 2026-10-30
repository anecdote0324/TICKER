import { describe, expect, it } from 'vitest';
import type { Instrument } from './instrument';
import { intradayAt, tradingNow } from './session';

const kr: Instrument = { id: 'EQ:KS:005380', assetClass: 'EQUITY', market: 'KS', code: '005380' };
const us: Instrument = { id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', code: 'AAPL' };
const spx: Instrument = { id: 'IDX:SPX', assetClass: 'INDEX', code: 'SPX' };
// 한국 시각 → ms
const kst = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 9, m);

describe('종목의 장 상태', () => {
  it('미국 주식은 프리·애프터마켓도 열려 있고, 지수는 정규장만 열려 있어요', () => {
    // 한국 30일 20:00 = 뉴욕 07:00(프리마켓)
    expect(tradingNow(us, kst(30, 20))).toBe(true);
    expect(tradingNow(spx, kst(30, 20))).toBe(false);
    expect(tradingNow(spx, kst(31, 0, 30))).toBe(true);
  });

  it('국내 분봉은 정규장(09:00~15:30)과 종가 단일가(15:30) 봉만 만들어요', () => {
    expect(intradayAt(kr, kst(30, 10))).toBe(true);
    expect(intradayAt(kr, kst(30, 15, 30))).toBe(true);
    expect(intradayAt(kr, kst(30, 19, 25))).toBe(false);
    expect(intradayAt(kr, kst(31, 0, 34))).toBe(false);
    expect(intradayAt(kr, kst(30, 8, 50))).toBe(false);
  });
});
