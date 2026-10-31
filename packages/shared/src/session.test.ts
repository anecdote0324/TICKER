import { describe, expect, it } from 'vitest';
import type { Instrument } from './instrument';
import { aggregateBars, bucketStart, intradayAt, tradingNow } from './session';

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

describe('시간봉 칸', () => {
  const btc: Instrument = { id: 'CRY:BTC', assetClass: 'CRYPTO', code: 'BTC' };
  const sec = (ms: number) => ms / 1000;

  it('국내 주식은 09:00에 맞춰요: 2시간봉 09·11·13·15시, 4시간봉 09·13시', () => {
    expect(bucketStart(kr, sec(kst(30, 10, 59)), 120)).toBe(sec(kst(30, 9)));
    expect(bucketStart(kr, sec(kst(30, 11, 0)), 120)).toBe(sec(kst(30, 11)));
    expect(bucketStart(kr, sec(kst(30, 15, 29)), 120)).toBe(sec(kst(30, 15)));
    expect(bucketStart(kr, sec(kst(30, 12, 30)), 240)).toBe(sec(kst(30, 9)));
    expect(bucketStart(kr, sec(kst(30, 13, 0)), 240)).toBe(sec(kst(30, 13)));
  });

  it('미국 주식은 뉴욕 정각에 맞춰요(한국투자증권 60분봉과 같게, 서머타임과 상관없이)', () => {
    // 10월 30일 뉴욕 10:45(서머타임) = 한국 23:45 → 10:00 칸 = 한국 23:00
    expect(bucketStart(us, sec(kst(30, 23, 45)), 60)).toBe(sec(kst(30, 23)));
    // 12월 1일 뉴욕 10:45(표준시) = 한국 다음 날 00:45 → 10:00 칸
    const dec = (h: number, m: number) => Date.UTC(2026, 11, 2, h - 9, m) / 1000;
    expect(bucketStart(us, dec(0, 45), 60)).toBe(dec(0, 0));
    // 4시간봉: 뉴욕 09·13시 칸(서머타임이면 한국 22시·다음 날 02시)
    expect(bucketStart(us, sec(kst(31, 1, 30)), 240)).toBe(sec(kst(30, 22)));
  });

  it('코인은 UTC 정각에 맞춰요(4시간봉: 한국 09·13·17·21·01·05시)', () => {
    expect(bucketStart(btc, sec(kst(30, 16, 10)), 240)).toBe(sec(kst(30, 13)));
  });

  it('1분봉을 1시간봉으로 묶어요(국내 15:00 칸은 15:00~15:30)', () => {
    const start = sec(kst(30, 9));
    const one = Array.from({ length: 390 }, (_, i) => ({ t: start + i * 60, o: 1, h: 2 + i, l: 1, c: 1 + i, v: 1 }));
    const hours = aggregateBars(kr, one, 60);
    expect(hours.map((b) => b.v)).toEqual([60, 60, 60, 60, 60, 60, 30]);
    expect(hours[0]).toEqual({ t: start, o: 1, h: 61, l: 1, c: 60, v: 60 });
  });
});
