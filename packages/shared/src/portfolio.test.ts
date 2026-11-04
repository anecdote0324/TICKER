import { describe, expect, it } from 'vitest';
import { computePortfolio, parseHoldingsCsv, splitCsvLine } from './portfolio';

describe('포트폴리오 계산', () => {
  const quotes = (id: string) =>
    ({
      'EQ:KS:005930': { last: 70000, prevClose: 69000, currency: 'KRW' },
      'EQ:US:AAPL': { last: 200, prevClose: 198, currency: 'USD' },
    })[id];
  it('원화로 합치고, 미국 종목은 지금 환율로 평가·매입 환율로 매입금액', () => {
    const { rows, totals } = computePortfolio(
      [
        { id: 'EQ:KS:005930', qty: 10, avgCost: 60000 },
        { id: 'EQ:US:AAPL', qty: 5, avgCost: 150, fxAtCost: 1300 },
      ],
      quotes,
      1400,
    );
    expect(rows[0]).toMatchObject({ value: 700000, cost: 600000, pnl: 100000, dayPnl: 10000 });
    expect(rows[1]).toMatchObject({ value: 1400000, cost: 975000, dayPnl: 14000, fx: 1400 });
    expect(totals.value).toBe(2100000);
    expect(totals.pnl).toBe(2100000 - 1575000);
    expect(rows[0].weight).toBeCloseTo(33.333, 2);
  });
  it('매입 환율이 없으면 지금 환율(환율 손익 0), 시세가 없으면 평가에서 빼요', () => {
    const { rows, totals } = computePortfolio([{ id: 'EQ:US:AAPL', qty: 1, avgCost: 200 }, { id: 'EQ:KS:000000', qty: 1, avgCost: 1 }], quotes, 1400);
    expect(rows[0].pnl).toBe(0);
    expect(totals.missing).toBe(1);
  });
});

describe('잔고 CSV', () => {
  it('따옴표 안 쉼표', () => {
    expect(splitCsvLine('"1,234",abc,"a""b"')).toEqual(['1,234', 'abc', 'a"b']);
  });
  it('머리줄을 찾고 증권사 열 이름(종목번호·잔고수량·매입단가)과 A 접두 코드를 읽어요', () => {
    const csv = '잔고 조회 결과\n계좌,종목번호,종목명,잔고수량,매입단가,평가금액\n신한,A005930,삼성전자,"1,000","60,000원",70000000\n신한,AAPL,애플,3,150.5,\n합계,,,,,\n';
    const r = parseHoldingsCsv(csv);
    expect(r.rows).toEqual([
      { code: '005930', name: '삼성전자', qty: 1000, avgCost: 60000, fxAtCost: undefined, account: '신한' },
      { code: 'AAPL', name: '애플', qty: 3, avgCost: 150.5, fxAtCost: undefined, account: '신한' },
    ]);
    expect(r.skipped).toBe(1);
  });
  it('머리줄이 없으면 이유', () => {
    expect(parseHoldingsCsv('a,b\n1,2').error).toBeDefined();
  });
});
