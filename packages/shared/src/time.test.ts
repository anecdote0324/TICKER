import { describe, expect, it } from 'vitest';
import { EXCHANGES, lastRegularClose } from './time';

const kst = (s: string) => Date.parse(`${s}+09:00`);

describe('가장 최근 정규장 마감 시각', () => {
  it('한국: 밤에는 그날 15:30, 주말과 다음 날 아침에는 금요일 15:30', () => {
    // 2026-10-30은 금요일
    expect(lastRegularClose(EXCHANGES.KRX, kst('2026-10-30T23:41:14'))).toBe(kst('2026-10-30T15:30:00'));
    expect(lastRegularClose(EXCHANGES.KRX, kst('2026-10-31T12:00:00'))).toBe(kst('2026-10-30T15:30:00'));
    expect(lastRegularClose(EXCHANGES.KRX, kst('2026-11-02T08:10:00'))).toBe(kst('2026-10-30T15:30:00'));
  });

  it('미국: 뉴욕 16:00(한국 시간 새벽)', () => {
    // 2026-10-30 금요일 16:00 뉴욕(서머타임) = 10-31 05:00 한국
    expect(lastRegularClose(EXCHANGES.US, kst('2026-10-31T09:00:00'))).toBe(kst('2026-10-31T05:00:00'));
  });
});
