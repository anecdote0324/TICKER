import { describe, expect, it } from 'vitest';
import { hpCsv, hpFileName, lastSession, withChange } from './tradeCalc';

const bar = (t: number, c: number, v = 1) => ({ t, o: c, h: c, l: c, c, v });

describe('HP·AQR 계산', () => {
  it('앞 봉 대비 등락률', () => {
    const r = withChange([bar(0, 100), bar(86400, 110)]);
    expect(r[0].changePct).toBeUndefined();
    expect(r[1].changePct).toBeCloseTo(10);
  });
  it('마지막 세션만 남겨요(밤을 넘는 미국 장도 하나로)', () => {
    const day1 = [bar(0, 1), bar(60, 1)];
    const day2 = [bar(86400, 2), bar(86400 + 3 * 3600, 2), bar(86400 + 6 * 3600, 2)];
    expect(lastSession([...day1, ...day2])).toHaveLength(3);
    expect(lastSession([])).toEqual([]);
  });
  it('CSV는 한국어 머리줄과 쉼표 감싸기', () => {
    const csv = hpCsv(withChange([bar(Date.UTC(2026, 10, 5) / 1000, 100, 10), bar(Date.UTC(2026, 10, 6) / 1000, 105, 20)]).reverse(), { code: 'X', nameKo: 'A,B', nameEn: '' });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('종목코드,종목명,날짜,시가,고가,저가,종가,등락률(%),거래량');
    expect(lines[1]).toBe('X,"A,B",2026-11-06,105,105,105,105,5,20');
    expect(lines[2].endsWith(',,10')).toBe(true);
  });
  it('파일 이름은 영문·숫자만', () => {
    expect(hpFileName({ code: 'BRK/B' }, '1M', Date.UTC(2026, 10, 7, 3))).toBe('HP_BRK_B_1mo_20261107.csv');
  });
});
