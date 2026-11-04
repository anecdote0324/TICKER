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

describe('SEC 연락처와 막힘 안내', async () => {
  const { secContactError, secBlockMessage, secHeaders } = await import('./financials');
  it('한글은 요청 머리글에 못 넣어서 미리 막아요', () => {
    expect(secContactError('박시준 me@example.com')).toContain('영문');
    expect(secContactError('Park me')).toContain('이메일');
    expect(secContactError('Park Sijun me@example.com')).toBeUndefined();
  });
  it('머리글은 영문만, SEC 규칙의 Accept-Encoding', () => {
    const h = secHeaders('Park me@example.com');
    expect(h['accept-encoding']).toBe('gzip, deflate');
    expect(/^[\x20-\x7E]+$/.test(h['user-agent'])).toBe(true);
  });
  it('막힌 이유(응답 제목)를 함께 보여 줘요', () => {
    expect(secBlockMessage(403, '<html><title>SEC.gov | Request Rate Threshold Exceeded</title></html>')).toContain('Request Rate Threshold Exceeded');
  });
});

describe('SEC가 막은 뒤 쉬기', async () => {
  const { FinancialsService } = await import('./financials');
  const { vi, afterEach } = await import('vitest');
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('403을 받으면 확인 버튼은 10분, 재무제표 화면은 1시간 동안 SEC에 보내지 않아요', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    const fetchMock = vi.fn(async () => new Response('<html><title>SEC.gov | Your Request Originates from an Undeclared Automated Tool</title></html>', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new FinancialsService(undefined, quiet);
    const first = await svc.testSec('Park me@example.com');
    expect(first.ok).toBe(false);
    expect(first.message).toContain('Undeclared Automated Tool');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 5분 뒤 다시 확인: 보내지 않고 쉬는 중이라고
    vi.setSystemTime(new Date('2026-11-05T00:05:00Z'));
    const again = await svc.testSec('Park me@example.com');
    expect(again.message).toMatch(/약 5분 동안 SEC에 요청하지 않아요/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 11분 뒤 확인 버튼은 다시 보내요(또 막혀서 그때부터 다시 쉬어요)
    vi.setSystemTime(new Date('2026-11-05T00:11:00Z'));
    await svc.testSec('Park me@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 재무제표 화면은 마지막으로 막힌 때부터 1시간
    svc.setSecContact('Park me@example.com');
    const inst = { id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', code: 'AAPL', exchange: 'NAS' } as const;
    vi.setSystemTime(new Date('2026-11-05T00:30:00Z'));
    await expect(svc.get(inst as never, 'annual')).rejects.toThrow(/약 41분 동안/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
