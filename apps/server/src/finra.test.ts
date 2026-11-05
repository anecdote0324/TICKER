import { describe, expect, it } from 'vitest';
import { finraSymbol, parseShortInterest } from './finra';
import { parseKrxEtf } from './market';
import { isIrTitle } from './dart-corp';

describe('FINRA 공매도 잔고', () => {
  it('결제일 최근 먼저, 같은 결제일(고친 보고)은 하나만', () => {
    const r = parseShortInterest([
      { settlementDate: '2026-09-30', currentShortPositionQuantity: 120, previousShortPositionQuantity: 128, changePercent: -6.2, averageDailyVolumeQuantity: 40, daysToCoverQuantity: 3 },
      { settlementDate: '2026-10-15', currentShortPositionQuantity: 131, changePercent: 8.9 },
      { settlementDate: '2026-10-15', currentShortPositionQuantity: 132 },
      { settlementDate: '2026-10-31' },
    ]);
    expect(r.map((x) => [x.date, x.shares])).toEqual([
      ['2026-10-15', 131],
      ['2026-09-30', 120],
    ]);
    expect(finraSymbol('BRK/B')).toBe('BRK.B');
  });
});

describe('KRX ETF 일별매매정보', () => {
  it('표준코드(12자리)는 가운데 6자리, 상장 좌수 없는 줄은 빼요', () => {
    const m = parseKrxEtf({
      OutBlock_1: [
        { ISU_CD: 'KR7069500007', LIST_SHRS: '1,000,000', NAV: '35,000.12', INVSTASST_NETASST_TOTAMT: '35000000000' },
        { ISU_CD: '229200', LIST_SHRS: '500', NAV: '12000' },
        { ISU_CD: '000000', LIST_SHRS: '' },
      ],
    });
    expect(m.get('069500')).toEqual({ shares: 1_000_000, nav: 35000.12, netAssets: 35_000_000_000 });
    expect(m.get('229200')?.shares).toBe(500);
    expect(m.has('000000')).toBe(false);
  });
});

describe('EVTS DART', () => {
  it('IR 개최 공시 제목', () => {
    expect(isIrTitle('기업설명회(IR)개최(안내공시)')).toBe(true);
    expect(isIrTitle('주식등의대량보유상황보고서')).toBe(false);
  });
});
