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

describe('체결 테이프 해석', () => {
  it('국내 체결: 시각·부호·체결강도, 매수·매도는 직전 체결과 비교', async () => {
    const { parseKrTicks } = await import('./market');
    const { tickRuleSides } = await import('@bt/shared');
    const rows = tickRuleSides(
      parseKrTicks([
        { stck_cntg_hour: '093001', stck_prpr: '70100', prdy_vrss: '900', prdy_vrss_sign: '5', cntg_vol: '12', tday_rltv: '98.5', prdy_ctrt: '1.27' },
        { stck_cntg_hour: '093000', stck_prpr: '70200', prdy_vrss: '800', prdy_vrss_sign: '5', cntg_vol: '3', tday_rltv: '98.4', prdy_ctrt: '1.13' },
        { stck_cntg_hour: '', stck_prpr: '1', cntg_vol: '1' },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ time: '09:30:01', price: 70100, qty: 12, change: -900, changePct: -1.27, strength: 98.5, side: 'sell' });
  });
  it('해외 체결: 호가와 비교해 매수·매도', async () => {
    const { parseUsTicks } = await import('./market');
    const rows = parseUsTicks([
      { khms: '233001', last: '190.12', evol: '100', tvol: '5000', pbid: '190.10', pask: '190.12', diff: '1.2', sign: '2', rate: '0.63', vpow: '101' },
      { khms: '233000', last: '190.10', evol: '50', tvol: '4900', pbid: '190.10', pask: '190.12', diff: '1.18', sign: '2', rate: '0.62', vpow: '100' },
    ]);
    expect(rows.map((r) => r.side)).toEqual(['buy', 'sell']);
    expect(rows[0]).toMatchObject({ time: '23:30:01', cumVolume: 5000, change: 1.2 });
  });
});
