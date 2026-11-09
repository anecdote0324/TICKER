import { describe, expect, it } from 'vitest';
import { krOverrides, parseKrHolidays } from './calendar';

describe('국내 휴장일(한국투자증권)', () => {
  it('개장일 여부를 날짜별로, 규칙 계산과 다른 날만 덮어써요', () => {
    const days = parseKrHolidays([
      { bass_dt: '20261110', opnd_yn: 'N' }, // 임시공휴일(규칙에 없음)
      { bass_dt: '20261231', opnd_yn: 'Y' }, // 규칙상 연말 휴장인데 연다고 하면
      { bass_dt: '20261111', opnd_yn: 'Y' }, // 규칙과 같음 → 덮어쓰지 않음
      { bass_dt: '20261114', opnd_yn: 'N' }, // 토요일 → 덮어쓰지 않음
      { bass_dt: 'bad', opnd_yn: 'N' },
    ]);
    expect(Object.keys(days)).toHaveLength(4);
    expect(krOverrides(days)).toEqual({ '2026-11-10': '휴장(한국투자증권)', '2026-12-31': null });
  });
});
