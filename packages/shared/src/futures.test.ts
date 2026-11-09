import { describe, expect, it } from 'vitest';
import { carryFair, futuresSession, parseFuturesMaster, watchedContracts } from './futures';

const MASTER = [
  '1|A01612|KR4A016C0004|F 202612| |00000.00|1|2001|KOSPI200',
  '1|A01703|KR4A01730006|F 202703| |00000.00|2|2001|KOSPI200',
  '1|A01706|KR4A01760003|F 202706| |00000.00|3|2001|KOSPI200',
  'B|A05611|KR4A056B0006|미니F 202611| |00000.00|1|2001|KOSPI200',
  '3|A06612|KR4A066C0003|코스닥150F 202612| |00000.00|1|3003|KSQ150',
  '2|B01611|KR4B016B0001|C 202611 400.0| |00400.00|1|2001|KOSPI200',
].join('\n');

/** 한국 시간 → UTC ms */
const kst = (s: string) => Date.parse(`${s}+09:00`);

describe('지수선물 마스터', () => {
  it('선물만, 종류별 앞 월물', () => {
    const all = parseFuturesMaster(MASTER);
    expect(all.map((c) => c.code)).toEqual(['A01612', 'A01703', 'A01706', 'A05611', 'A06612']);
    expect(all[0]).toMatchObject({ kind: 'K200', month: '202612', seq: 1, underlying: 'KOSPI200' });
    expect(watchedContracts(all).map((c) => c.code)).toEqual(['A01612', 'A01703', 'A05611', 'A06612']);
  });
});

describe('장 구분(한국 시간)', () => {
  it('주간·야간·마감, 금요일 밤은 토요일 새벽까지', () => {
    expect(futuresSession(kst('2026-11-09T09:00:00'))).toBe('day');
    expect(futuresSession(kst('2026-11-09T16:30:00'))).toBe('closed');
    expect(futuresSession(kst('2026-11-09T21:00:00'))).toBe('night');
    expect(futuresSession(kst('2026-11-10T05:30:00'))).toBe('night');
    expect(futuresSession(kst('2026-11-14T03:00:00'))).toBe('night');
    expect(futuresSession(kst('2026-11-14T10:00:00'))).toBe('closed');
    expect(futuresSession(kst('2026-11-15T03:00:00'))).toBe('closed');
  });
});

describe('단순 이론가', () => {
  it('지수 × (1 + 금리 × 일/365)', () => {
    expect(carryFair(400, 3.65, 100)).toBeCloseTo(404, 6);
  });
});
