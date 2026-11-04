import { describe, expect, it } from 'vitest';
import { dartNum, quarterBefore } from '@bt/shared';
import { isEarningsTitle, parseExecutives, parseInsiders, reaction, reportCandidates } from './dart-corp';

describe('DART 종목 정보', () => {
  it('가장 최근 정기보고서 후보: 올해 3분기·반기·1분기, 지난해 사업보고서 순서', () => {
    const c = reportCandidates(Date.parse('2026-11-05T00:00:00Z'));
    expect(c.slice(0, 4).map((p) => p.label)).toEqual(['2026 3분기보고서', '2026 반기보고서', '2026 1분기보고서', '2025 사업보고서']);
  });
  it('숫자 칸: 쉼표·하이픈', () => {
    expect(dartNum('1,234')).toBe(1234);
    expect(dartNum('-')).toBeUndefined();
    expect(dartNum('-1,000')).toBe(-1000);
  });
  it('임원·소유 보고', () => {
    expect(parseExecutives([{ nm: '홍길동', ofcps: '대표이사', rgist_exctv_at: '사내이사', chrg_job: '경영총괄', mxmm_shrholdr_relate: '-' }])[0]).toMatchObject({ name: '홍길동', position: '대표이사', registered: '사내이사', relation: undefined });
    const ins = parseInsiders([
      { rcept_no: '20261001000001', rcept_dt: '20261001', repror: 'A', sp_stock_lmp_cnt: '1,000', sp_stock_lmp_irds_cnt: '-200' },
      { rcept_no: '20261101000001', rcept_dt: '20261101', repror: 'B', sp_stock_lmp_irds_cnt: '300' },
    ]);
    expect(ins.map((r) => [r.date, r.change])).toEqual([
      ['2026-11-01', 300],
      ['2026-10-01', -200],
    ]);
    expect(ins[1].url).toContain('rcpNo=20261001000001');
  });
  it('잠정실적 공시 제목과 다루는 분기', () => {
    expect(isEarningsTitle('연결재무제표기준영업(잠정)실적(공정공시)')).toBe(true);
    expect(isEarningsTitle('[기재정정]영업(잠정)실적(공정공시)')).toBe(true);
    expect(isEarningsTitle('주요사항보고서(자기주식취득결정)')).toBe(false);
    expect(quarterBefore('2026-10-08')).toBe('2026Q3');
    expect(quarterBefore('2026-01-30')).toBe('2025Q4');
    expect(quarterBefore('2026-04-25')).toBe('2026Q1');
  });
  it('발표일 반응: 그날(또는 다음 거래일) 종가의 전일 대비', () => {
    const d = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
    const bars = [
      { t: d('2026-10-06'), o: 0, h: 0, l: 0, c: 100, v: 0 },
      { t: d('2026-10-07'), o: 0, h: 0, l: 0, c: 105, v: 0 },
      { t: d('2026-10-08'), o: 0, h: 0, l: 0, c: 110, v: 0 },
    ];
    const r = reaction(bars, '2026-10-07');
    expect(r.r1).toBeCloseTo(5);
    expect(r.r2).toBeCloseTo(10);
    // 주말 공시 → 다음 거래일
    expect(reaction(bars, '2026-10-05')).toEqual({});
  });
});
