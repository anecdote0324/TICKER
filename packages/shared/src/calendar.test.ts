import { describe, expect, it } from 'vitest';
import { addBusinessDays, businessDaysBetween, easter, holidayName, holidaysOf, isBusinessDay, setHolidayOverrides } from './calendar';

const keys = (m: Map<string, string>) => [...m.keys()].sort();

describe('공용 영업일 달력', () => {
  it('부활절', () => {
    expect(easter(2025)).toBe('2025-04-20');
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
  });
  it('미국 NYSE 2026', () => {
    expect(keys(holidaysOf('US', 2026))).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    ]);
    // 2022-01-01(토)은 전년 12월 31일에 쉬지 않아요
    expect(holidaysOf('US', 2021).has('2021-12-31')).toBe(false);
  });
  it('영국 2026: 박싱 데이가 토요일이면 월요일로', () => {
    expect(keys(holidaysOf('UK', 2026))).toEqual(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  });
  it('일본 2026: 춘분·추분, 대체 휴일, 국민의 휴일, 연초·연말 휴장', () => {
    const h = holidaysOf('JP', 2026);
    expect(h.get('2026-03-20')).toBe('춘분의 날');
    expect(h.get('2026-09-23')).toBe('추분의 날');
    expect(h.get('2026-05-06')).toBe('대체 휴일'); // 5/3(일) → 5/6
    expect(h.get('2026-09-22')).toBe('국민의 휴일'); // 경로의 날(9/21)과 추분(9/23) 사이
    expect(h.has('2026-01-02') && h.has('2026-12-31')).toBe(true);
  });
  it('한국 2025: 설·추석·대체공휴일·선거일', () => {
    const h = holidaysOf('KR', 2025);
    for (const d of ['2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-03', '2025-05-01', '2025-05-05', '2025-05-06', '2025-06-03', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25', '2025-12-31'])
      expect(h.has(d), d).toBe(true);
    // 어린이날과 부처님오신날이 겹쳐도 대체공휴일은 하루만
    expect(h.has('2025-05-07')).toBe(false);
  });
  it('한국 2026: 주말 공휴일의 대체공휴일', () => {
    const h = holidaysOf('KR', 2026);
    for (const d of ['2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-25', '2026-06-03', '2026-08-17', '2026-10-05', '2026-12-31']) expect(h.has(d), d).toBe(true);
    expect(h.has('2026-09-28')).toBe(false); // 추석이 토요일에 끝나도 대체공휴일 없음
  });
  it('영업일 더하기·세기, 받은 값으로 덮어쓰기', () => {
    expect(addBusinessDays('KR', '2026-02-13', 1)).toBe('2026-02-19');
    expect(addBusinessDays('US', '2026-07-02', 1)).toBe('2026-07-06');
    expect(addBusinessDays('US', '2026-07-04', 0)).toBe('2026-07-06');
    expect(businessDaysBetween('KR', '2026-02-16', '2026-02-20')).toBe(2);
    expect(holidayName('KR', '2026-11-07')).toBe('주말');
    setHolidayOverrides({ KR: { '2026-11-10': '임시공휴일', '2026-12-31': null } });
    expect(isBusinessDay('KR', '2026-11-10')).toBe(false);
    expect(isBusinessDay('KR', '2026-12-31')).toBe(true);
    setHolidayOverrides({});
  });
});
