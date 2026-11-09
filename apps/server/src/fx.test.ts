import { describe, expect, it } from 'vitest';
import { ecbRows, lastTwo } from './fx';

describe('FIXI·단기 금리', () => {
  it('마지막 값과 앞 값', () => {
    expect(lastTwo([{ date: '2026-11-05', value: 1 }, { date: '2026-11-06', value: 2 }, { date: '2026-11-04', value: NaN }])).toEqual({ date: '2026-11-06', value: 2, prev: 1 });
    expect(lastTwo([])).toBeUndefined();
  });
  it('ECB 기준환율(유로 기준) → 통화쌍 교차 계산', () => {
    const rows = ecbRows({ date: '2026-11-06', rates: { USD: 1.1, KRW: 1540, JPY: 170 } }, { rates: { USD: 1.0, KRW: 1500, JPY: 160 } });
    const usdkrw = rows.find((r) => r.pair === 'USD/KRW')!;
    expect(usdkrw.value).toBeCloseTo(1400);
    expect(usdkrw.prev).toBeCloseTo(1500);
    expect(rows.find((r) => r.pair === 'EUR/USD')?.value).toBeCloseTo(1.1);
    expect(rows.find((r) => r.pair === 'GBP/USD')).toBeUndefined();
  });
});
