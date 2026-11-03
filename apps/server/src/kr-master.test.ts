import { describe, expect, it } from 'vitest';
import { KR_FIELDS, KR_TAIL_WIDTH, KrMasterStore, parseKrInfoLine, parseSectorNames } from './kr-master';

/** 칸 이름 → 값으로 마스터 한 줄을 만들어요(앞부분: 단축코드 9 + 표준코드 12 + 이름 40) */
function line(market: 'KS' | 'KQ', code: string, values: Record<string, string>): Uint8Array {
  const tail = KR_FIELDS[market].map(([n, w]) => (values[n] ?? '').padStart(w, n.length > 0 && /^\d/.test(values[n] ?? '') ? '0' : ' ').slice(0, w)).join('');
  const head = code.padEnd(9, ' ') + 'KR7000000000' + ' '.repeat(40);
  return new Uint8Array([...head, ...tail].map((c) => c.charCodeAt(0)));
}

describe('국내 종목 마스터 뒷부분', () => {
  it('칸 너비 합은 공식 field_specs에서 줄바꿈을 뺀 227·221칸', () => {
    expect(KR_TAIL_WIDTH).toEqual({ KS: 227, KQ: 221 });
  });

  it('업종 코드·상장주수(천 주)·시가총액·실적(억 원)·ROE를 읽어요', () => {
    const r = parseKrInfoLine(
      line('KS', '005930', {
        group: 'ST', big: '0027', mid: '0013', small: '0000', base: '229000', listedDate: '19750611', sharesK: '5846278',
        sales: '3053729', operatingProfit: '1467252', roe: '31.39', basisYm: '20260630', mcap: '13387978', face: '100', settleMonth: '12', warn: '01', managed: 'N',
      }),
      'KS',
    )!;
    expect(r.code).toBe('005930');
    expect(r.info).toMatchObject({ big: '0027', mid: '0013', listedDate: '1975-06-11', shares: 5_846_278_000, marketCap: 13_387_978e8, sales: 3_053_729e8, roe: 31.39, basisYm: '2026-06', faceValue: 100, settleMonth: '12', warn: '01', managed: false });
  });

  it('코스닥은 칸 배치가 달라요(벤처·KOSDAQ150 칸)', () => {
    const r = parseKrInfoLine(line('KQ', '035900', { group: 'ST', big: '0026', mid: '0000', sharesK: '35532', sales: '3691', operatingProfit: '644', roe: '18', basisYm: '20260630', mcap: '13484' }), 'KQ')!;
    expect(r.info).toMatchObject({ big: '0026', mid: '0000', shares: 35_532_000, sales: 3691e8, operatingProfit: 644e8, roe: 18, marketCap: 13484e8 });
  });

  it('업종 이름 파일로 대분류 > 중분류를 만들어요(중분류가 없으면 대분류만)', () => {
    // 파일은 cp949예요. 한글 바이트: 제조 = C1A6 C1B6, 금융 = B1DD C0B6
    const bytes = new Uint8Array([...'00013ELEC  \r\n'].map((c) => c.charCodeAt(0)).concat([0x30, 0x30, 0x30, 0x32, 0x31, 0xb1, 0xdd, 0xc0, 0xb6, 0x0a, 0x30, 0x30, 0x30, 0x32, 0x37, 0xc1, 0xa6, 0xc1, 0xb6, 0x0a]));
    const names = parseSectorNames(bytes);
    expect(names.get('0027')).toBe('제조');
    expect(names.get('0013')).toBe('ELEC');
    const store = new KrMasterStore();
    store.setSectorNames(names);
    const samsung = parseKrInfoLine(line('KS', '005930', { big: '0027', mid: '0013', warn: '02', managed: 'Y' }), 'KS')!;
    const kb = parseKrInfoLine(line('KS', '105560', { big: '0021', mid: '0000' }), 'KS')!;
    store.setMarket('KS', new Map([[samsung.code, samsung.info], [kb.code, kb.info]]), '2026-11-03');
    const inst = (code: string) => ({ id: `EQ:KS:${code}`, assetClass: 'EQUITY' as const, market: 'KS' as const, code });
    expect(store.profile(inst('005930'))).toMatchObject({ sector: ['제조', 'ELEC'], warnings: ['관리종목', '투자경고'], asOf: '2026-11-03' });
    expect(store.profile(inst('105560'))?.sector).toEqual(['금융']);
    expect(store.profile({ id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', code: 'AAPL' })).toBeUndefined();
  });
});
