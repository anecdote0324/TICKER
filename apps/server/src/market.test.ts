import { describe, expect, it } from 'vitest';
import { etfFlows, withContribution } from '@bt/shared';
import { parseBook, parseComponents, parseNavDaily } from './market';

describe('MEMB·MOV·ETF·BQ', () => {
  it('ETF 구성종목: 6자리 종목만, 비중 큰 순, 하락 부호는 음수', () => {
    const rows = parseComponents([
      { stck_shrn_iscd: '000660', hts_kor_isnm: 'SK하이닉스', etf_cnfg_issu_rlim: '10.5', stck_prpr: '200000', prdy_ctrt: '1.0', prdy_vrss_sign: '5' },
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', etf_cnfg_issu_rlim: '25.1', stck_prpr: '70000', prdy_ctrt: '2.0', prdy_vrss_sign: '2' },
      { stck_shrn_iscd: 'KRD010010001', hts_kor_isnm: '원화예금', etf_cnfg_issu_rlim: '0.3' },
    ]);
    expect(rows.map((r) => r.code)).toEqual(['005930', '000660']);
    expect(rows[1].changePct).toBe(-1);
    const w = withContribution(rows);
    expect(w.rows[0].contribution).toBeCloseTo(0.502);
    expect(w.total).toBeCloseTo(0.502 - 0.105);
  });
  it('NAV 비교추이: 최근 먼저', () => {
    expect(parseNavDaily([{ stck_bsop_date: '20261103', nav: '100.5', stck_clpr: '100', dprt: '-0.5' }, { stck_bsop_date: '20261104', nav: '101' }]).map((r) => r.date)).toEqual(['2026-11-04', '2026-11-03']);
  });
  it('자금 흐름: 상장 주수 변화 × 그날 NAV, 최근 먼저', () => {
    const f = etfFlows([
      { date: '2026-11-04', shares: 1100, nav: 100 },
      { date: '2026-11-03', shares: 1000, nav: 99 },
    ]);
    expect(f.map((r) => [r.date, r.flow])).toEqual([
      ['2026-11-04', 10_000],
      ['2026-11-03', undefined],
    ]);
  });
  it('10호가: 가까운 호가부터, 잔량·시각·예상 체결', () => {
    const book: Record<string, string> = { aspr_acpt_hour: '093015', total_askp_rsqn: '500', total_bidp_rsqn: '700' };
    for (let i = 1; i <= 10; i++) {
      book[`askp${i}`] = String(70000 + i * 100);
      book[`askp_rsqn${i}`] = String(i * 10);
      book[`bidp${i}`] = String(70000 - (i - 1) * 100);
      book[`bidp_rsqn${i}`] = String(i * 20);
    }
    const r = parseBook(book, { antc_cnpr: '70050', antc_vol: '1234' });
    expect(r.asks[0]).toMatchObject({ price: 70100, qty: 10 });
    expect(r.bids[0]).toMatchObject({ price: 70000, qty: 20 });
    expect(r.asks).toHaveLength(10);
    expect(r.time).toBe('09:30:15');
    expect(r.expected).toEqual({ price: 70050, qty: 1234 });
    expect(parseBook({}, {}).asks).toEqual([]);
  });
});
