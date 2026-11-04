import { describe, expect, it } from 'vitest';
import { daysBefore, rowOnOrBefore, ustTenor } from '@bt/shared';
import { parseUstXml } from './rates';

const entry = (date: string, extra = '') => `<entry><content type="application/xml">
<m:properties>
<d:Id m:type="Edm.Int32">1</d:Id>
<d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>
<d:BC_1MONTH m:type="Edm.Double">4.06</d:BC_1MONTH>
<d:BC_1_5MONTH m:type="Edm.Double">4.10</d:BC_1_5MONTH>
<d:BC_10YEAR m:type="Edm.Double">5.24</d:BC_10YEAR>
<d:BC_30YEARDISPLAY m:type="Edm.Double">5.61</d:BC_30YEARDISPLAY>${extra}
</m:properties></content></entry>`;

describe('미국채 금리 XML', () => {
  it('날짜별 금리를 읽고, 표시용 칸(30YEARDISPLAY)은 빼요', () => {
    const r = parseUstXml(`<feed>${entry('2026-10-02')}${entry('2026-10-01', '<d:BC_2YEAR m:type="Edm.Double">4.78</d:BC_2YEAR>')}</feed>`);
    expect(r.rows.map((x) => x.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(r.tenors.map((t) => t.label)).toEqual(['1M', '1.5M', '2Y', '10Y']);
    expect(r.rows[0].values.BC_10YEAR).toBe(5.24);
    expect(r.rows[1].values.BC_2YEAR).toBeUndefined();
  });

  it('새 테너도 이름으로 읽어요(1.5개월물)', () => {
    expect(ustTenor('BC_1_5MONTH')).toMatchObject({ label: '1.5M', years: 0.125 });
    expect(ustTenor('BC_30YEARDISPLAY')).toBeUndefined();
  });
});

describe('비교 날짜', () => {
  it('그 날짜 이전의 가장 가까운 행(휴일이면 앞 영업일)', () => {
    const rows = [{ date: '2026-10-01' }, { date: '2026-10-02' }, { date: '2026-10-05' }];
    expect(rowOnOrBefore(rows, '2026-10-04')?.date).toBe('2026-10-02');
    expect(rowOnOrBefore(rows, '2026-09-30')).toBeUndefined();
    expect(daysBefore('2026-11-04', 7)).toBe('2026-10-28');
  });
});
