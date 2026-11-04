import { describe, expect, it } from 'vitest';
import { ksdDate, ksdRange, opinionClass, opinionSummary } from '@bt/shared';
import { ksdEvents, parseDividends, parseEstimate, parseIpo, parseOpinions } from './corp';

describe('예탁원 날짜', () => {
  it('YYYYMMDD·YYYY/MM/DD·기간', () => {
    expect(ksdDate('20261105')).toBe('2026-11-05');
    expect(ksdDate('2026/11/05')).toBe('2026-11-05');
    expect(ksdDate('')).toBeUndefined();
    expect(ksdDate('00000000')).toBeUndefined();
    expect(ksdRange('2026.11.10~2026.11.11')).toEqual(['2026-11-10', '2026-11-11']);
    expect(ksdRange('20261110')).toEqual(['2026-11-10', '2026-11-10']);
  });
});

describe('EE 종목추정실적', () => {
  it('줄 이름(문서 순서)과 결산년월 머리', () => {
    const r = parseEstimate({
      periods: ['202412', '202512E', '202612E'],
      income: [
        [100, 110, 121],
        [5, 10, 10],
        [10, 12, null],
      ],
      indicators: [[1, 2, 3]],
    });
    expect(r.periods).toEqual(['2024.12', '2025.12 E', '2026.12 E']);
    expect(r.income.map((l) => l.label)).toEqual(['매출액', '매출액 증감률', '영업이익']);
    expect(r.income[1].pct).toBe(true);
    expect(r.indicators[0].label).toBe('EBITDA');
  });
});

describe('ANR 투자의견', () => {
  it('최근 먼저, 증권사 이름이 오면 쓰고, 3개월 요약은 증권사별 마지막 의견', () => {
    const rows = parseOpinions([
      { stck_bsop_date: '20261001', invt_opnn: 'BUY', mbcr_name: 'A증권', hts_goal_prc: '90000', stck_prdy_clpr: '70000', dprt: '-22.2' },
      { stck_bsop_date: '20261101', invt_opnn: '매수', mbcr_name: 'A증권', hts_goal_prc: '100000' },
      { stck_bsop_date: '20261020', invt_opnn: 'HOLD', mbcr_name: 'B증권', hts_goal_prc: '80000' },
      { stck_bsop_date: '20260101', invt_opnn: 'SELL', mbcr_name: 'C증권', hts_goal_prc: '50000' },
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-11-01', '2026-10-20', '2026-10-01', '2026-01-01']);
    const s = opinionSummary(rows, '2026-11-05');
    expect(s).toMatchObject({ brokers: 2, buy: 1, hold: 1, sell: 0, avgTarget: 90000, maxTarget: 100000, minTarget: 80000 });
    expect(opinionClass('Trading Buy')).toBe('buy');
    expect(opinionClass('비중축소')).toBe('sell');
    expect(opinionClass('Marketperform')).toBe('hold');
  });
});

describe('DVD·CACS·EVTS·IPO', () => {
  it('배당은 기준일 최근 먼저', () => {
    const r = parseDividends([
      { record_date: '20251231', divi_kind: '결산배당', per_sto_divi_amt: '361', divi_rate: '72.2', divi_pay_dt: '20260415' },
      { record_date: '20260630', divi_kind: '분기배당', per_sto_divi_amt: '361' },
    ]);
    expect(r.map((x) => x.recordDate)).toEqual(['2026-06-30', '2025-12-31']);
    expect(r[1]).toMatchObject({ cash: 361, cashRate: 72.2, payDate: '2026-04-15' });
  });
  it('예탁원 줄 → 이벤트(공모는 청약·상장 두 줄)', () => {
    const ev = ksdEvents('ipo', [{ sht_cd: '123450', subscr_dt: '2026.11.10~2026.11.11', list_dt: '20261120', fix_subscr_pri: '15000', lead_mgr: '한국투자증권' }]);
    expect(ev.map((e) => [e.type, e.date])).toEqual([
      ['ipo', '2026-11-10'],
      ['listing', '2026-11-20'],
    ]);
    expect(ev[0].detail).toContain('15,000원');
    const meet = ksdEvents('meeting', [{ sht_cd: '005930', gen_meet_dt: '20270315', gen_meet_type: '정기주총', agenda: '재무제표 승인' }]);
    expect(meet[0]).toMatchObject({ type: 'meeting', date: '2027-03-15', code: '005930' });
    expect(ksdEvents('deposit', [{ sht_cd: '1', depo_date: '', stk_qty: '1' }])).toEqual([]);
  });
  it('공모 줄: 청약 기간을 나누고 최근 먼저', () => {
    const r = parseIpo([
      { sht_cd: 'A', subscr_dt: '2026.10.01~2026.10.02', fix_subscr_pri: '10000' },
      { sht_cd: 'B', subscr_dt: '2026.11.10~2026.11.11', list_dt: '20261120' },
    ]);
    expect(r.map((x) => [x.code, x.subscrFrom, x.subscrTo])).toEqual([
      ['B', '2026-11-10', '2026-11-11'],
      ['A', '2026-10-01', '2026-10-02'],
    ]);
  });
});
