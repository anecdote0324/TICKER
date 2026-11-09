import { describe, expect, it } from 'vitest';
import { compoundedRate, lastAndAgo } from './money';
import { forwardFromSpot, parseEcbCsv, parseJgbCsv, yieldAt } from './rates';

describe('금리 계산', () => {
  it('마지막 값과 n일 전 값', () => {
    const obs = [
      { date: '2026-10-01', value: 3 },
      { date: '2026-10-30', value: 3.1 },
      { date: '2026-11-06', value: 3.2 },
    ];
    expect(lastAndAgo(obs, 7)).toEqual({ last: { date: '2026-11-06', value: 3.2 }, ago: 3.1 });
  });
  it('OIS 복리: 금리가 일정하면 거의 같은 값, 주말은 금요일 금리로', () => {
    const obs = [
      { date: '2026-11-06', value: 4 }, // 금
      { date: '2026-11-09', value: 5 }, // 월
    ];
    const r = compoundedRate(obs, '2026-11-06', '2026-11-10', 360)!;
    expect(r.days).toBe(4);
    // 금·토·일 4%, 월 5%
    const acc = (1 + 0.04 / 360) ** 3 * (1 + 0.05 / 360);
    expect(r.rate).toBeCloseTo(((acc - 1) * 360 * 100) / 4, 8);
  });
  it('선형 보간과 선도금리', () => {
    const curve = { tenors: [{ key: 'a', label: '1Y', years: 1 }, { key: 'b', label: '3Y', years: 3 }] };
    expect(yieldAt(curve, { a: 2, b: 4 }, 2)).toBeCloseTo(3);
    expect(yieldAt(curve, { a: 2, b: 4 }, 5)).toBeUndefined();
    // 1년 2%, 2년 3% → 1Y1Y ≈ 4.01%
    expect(forwardFromSpot(2, 1, 3, 2)).toBeCloseTo(4.0098, 3);
  });
  it('재무성 CSV·ECB CSV', () => {
    const jgb = parseJgbCsv('Interest Rate,,(Unit : %)\nDate,1Y,2Y,10Y\n2026/11/2,1.671,1.88,-\n2026/11/4,1.676,1.891,2.855\n');
    expect(jgb).toEqual([
      { date: '2026-11-02', values: { '1Y': 1.671, '2Y': 1.88 } },
      { date: '2026-11-04', values: { '1Y': 1.676, '2Y': 1.891, '10Y': 2.855 } },
    ]);
    expect(parseEcbCsv('KEY,FREQ,TIME_PERIOD,OBS_VALUE\nYC,B,2026-11-05,3.29\n')).toEqual([{ date: '2026-11-05', value: 3.29 }]);
    expect(parseEcbCsv('KEY,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE\nYC,SR_10Y,2026-11-05,3.29\n')).toEqual([{ date: '2026-11-05', value: 3.29, series: 'SR_10Y' }]);
  });
});
