import { describe, expect, it } from 'vitest';
import { staticInstruments, type Instrument } from '@bt/shared';
import { sortMatches, sortMatchesFull } from './rank';
import { buildRecord, packRecords, SearchIndex, unpackRecords } from './search-index';

const insts: Instrument[] = [
  ...staticInstruments(),
  { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930', nameKo: '삼성전자', nameEn: 'Samsung Electronics' },
  { id: 'EQ:US:BRK.B', assetClass: 'EQUITY', market: 'US', code: 'BRK.B', nameKo: '버크셔 해서웨이 B', nameEn: 'Berkshire Hathaway Inc Class B', aliases: ['BRKB'] },
  { id: 'CRY:BTC', assetClass: 'CRYPTO', code: 'BTC', nameKo: '비트코인', nameEn: 'BTC', aliases: ['BTCUSDT', 'XBT'] },
];

describe('다른 스레드에서 만든 색인', () => {
  it('압축했다가 되돌려도 바로 만든 레코드와 같아요', () => {
    const packed = packRecords(insts);
    expect(unpackRecords(insts, packed)).toEqual(insts.map(buildRecord));
  });

  it('되돌린 레코드로도 같은 결과를 찾아요', () => {
    const a = new SearchIndex(insts);
    const b = new SearchIndex();
    b.setRecords(unpackRecords(insts, packRecords(insts)));
    expect(b.exactCode('BRKB').map((r) => r.inst.id)).toEqual(a.exactCode('BRKB').map((r) => r.inst.id));
    expect(b.get('CRY:BTC')?.cho).toBe('ㅂㅌㅋㅇ');
  });
});

describe('결과가 많을 때의 부분 정렬(05 §14.1)', () => {
  // 'S'로 시작하는 가짜 종목 2천 개: 코드 길이·인기도·상장폐지·우선주를 섞어요
  const many: Instrument[] = [];
  for (let i = 0; i < 2000; i++) {
    const code = `S${'X'.repeat(i % 4)}${i}`;
    many.push({
      id: `EQ:US:${code}`,
      assetClass: 'EQUITY',
      market: 'US',
      code,
      nameEn: i % 3 === 0 ? `Some Fund ${i}` : `Alpha ${i}`,
      popularity: ((i * 7919) % 1000) / 1000,
      flags: i % 97 === 0 ? ['DELISTED'] : i % 53 === 0 ? ['ETN'] : undefined,
    });
  }
  many.push({ id: 'EQ:KS:S00001', assetClass: 'EQUITY', market: 'KS', code: 'S00001', nameKo: '에스보통', popularity: 0.99 });
  many.push({ id: 'EQ:KS:S00002', assetClass: 'EQUITY', market: 'KS', code: 'S00002', nameKo: '에스우', popularity: 0.1, flags: ['PREF'], commonId: 'EQ:KS:S00001' });
  const idx = new SearchIndex(many);
  const ctx = { panel: {}, assist: 'beginner' as const, hanEng: true, tabAutofill: true, usage: (id: string) => (id.endsWith('7') ? 0.6 : 0) };

  it('보일 수 있는 앞부분은 전체 정렬과 같아요', () => {
    for (const q of ['S', 'SX', 'SOME']) {
      const m = idx.search(q, { first: true, hanEng: true });
      expect(m.length, q).toBeGreaterThan(480);
      const fast = sortMatches(m, ctx).map((x) => x.rec.inst.id);
      const full = sortMatchesFull(m, ctx).map((x) => x.rec.inst.id);
      expect(fast.slice(0, 240), q).toEqual(full.slice(0, 240));
      expect(new Set(fast).size).toBe(m.length);
    }
  });
});
