import { describe, expect, it } from 'vitest';
import { finRatios, quartersFromCumulative } from '@bt/shared';
import { dartAnnual, dartCumulative, dartFind, secSeries, type DartRow, type SecFact } from './financials';

const row = (sj: string, id: string, nm: string, th: string, fr = '', bf = '', add?: string): DartRow => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: th, frmtrm_amount: fr, bfefrmtrm_amount: bf, thstrm_add_amount: add });

describe('DART 재무제표', () => {
  const rows: DartRow[] = [
    row('CIS', 'ifrs-full_Revenue', '매출액', '300', '200', '100'),
    row('CIS', 'dart_OperatingIncomeLoss', '영업이익', '30', '-10', '5'),
    row('BS', 'ifrs-full_Assets', '자산총계', '1,000', '900', '800'),
    row('CF', '-표준계정코드 미사용-', '유형자산의 취득', '-50', '-40', '-30'),
  ];
  it('표준 계정 코드로 찾고, 없으면 계정 이름으로', () => {
    expect(dartFind(rows, 'revenue')?.account_nm).toBe('매출액');
    expect(dartFind(rows, 'capex')?.thstrm_amount).toBe('-50');
    expect(dartFind(rows, 'cash')).toBeUndefined();
  });
  it('사업보고서 하나에서 전전년·전년·그해(쉼표·음수)', () => {
    const a = dartAnnual(rows);
    expect(a.revenue).toEqual([100, 200, 300]);
    expect(a.operatingIncome).toEqual([5, -10, 30]);
    expect(a.assets).toEqual([800, 900, 1000]);
  });
  it('분기 누적: 손익은 반기·3분기에 누적 칸, 현금흐름은 당기 칸', () => {
    const half = [row('CIS', 'ifrs-full_Revenue', '매출액', '120', '', '', '220'), row('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', '70')];
    expect(dartCumulative(half, 'revenue', '11012')).toBe(220);
    expect(dartCumulative(half, 'revenue', '11013')).toBe(120);
    expect(dartCumulative(half, 'cfo', '11012')).toBe(70);
  });
  it('누적 → 분기 값(앞 누적이 없으면 비워요)', () => {
    expect(quartersFromCumulative([100, 220, 330, 460])).toEqual([100, 120, 110, 130]);
    expect(quartersFromCumulative([100, null, 330, 460])).toEqual([100, null, null, 130]);
  });
});

describe('SEC companyfacts', () => {
  const f = (start: string | undefined, end: string, val: number, filed = '2025-01-01'): SecFact => ({ start, end, val, filed });
  const gaap = {
    Revenues: { units: { USD: [f('2023-01-01', '2023-12-31', 400), f('2024-01-01', '2024-12-31', 500), f('2024-01-01', '2024-03-31', 100), f('2024-04-01', '2024-06-30', 120), f('2024-07-01', '2024-09-30', 130), f('2024-01-01', '2024-06-30', 220)] } },
    Assets: { units: { USD: [f(undefined, '2024-12-31', 900), f(undefined, '2024-12-31', 950, '2025-03-01')] } },
  };
  it('연간은 1년 기간 값, 재무상태는 기말일 값(나중에 제출한 것)', () => {
    expect([...secSeries(gaap, 'revenue', 'annual')]).toEqual([
      ['2023-12-31', 400],
      ['2024-12-31', 500],
    ]);
    expect(secSeries(gaap, 'assets', 'annual').get('2024-12-31')).toBe(950);
  });
  it('현금흐름처럼 누적(3·6·9개월)만 있으면 누적끼리 빼서 분기 값', () => {
    const cf = { NetCashProvidedByUsedInOperatingActivities: { units: { USD: [f('2024-01-01', '2024-03-31', 30), f('2024-01-01', '2024-06-30', 70), f('2024-01-01', '2024-09-30', 100), f('2024-01-01', '2024-12-31', 150)] } } };
    const q = secSeries(cf, 'cfo', 'quarter');
    expect([q.get('2024-03-31'), q.get('2024-06-30'), q.get('2024-09-30'), q.get('2024-12-31')]).toEqual([30, 40, 30, 50]);
  });
  it('분기는 3개월 값이고, 4분기는 연간에서 앞 세 분기를 빼요(반기 누적은 안 써요)', () => {
    const q = secSeries(gaap, 'revenue', 'quarter');
    expect(q.get('2024-06-30')).toBe(120);
    expect(q.get('2024-12-31')).toBe(150);
  });
});

describe('비율', () => {
  it('영업이익률·ROE·부채비율·FCF·성장률(연간은 전년, CAPEX는 크기만)', () => {
    const r = finRatios({
      period: 'annual',
      periods: [{ key: '2023', label: '2023' }, { key: '2024', label: '2024' }],
      values: { revenue: [100, 150], operatingIncome: [10, 30], netIncome: [5, 15], equity: [50, 60], liabilities: [50, 90], cfo: [20, 40], capex: [-5, 10] },
    });
    expect(r.operatingMargin).toEqual([10, 20]);
    expect(r.roe).toEqual([10, 25]);
    expect(r.debtRatio).toEqual([100, 150]);
    expect(r.fcf).toEqual([15, 30]);
    expect(r.revenueGrowth).toEqual([null, 50]);
  });
});
