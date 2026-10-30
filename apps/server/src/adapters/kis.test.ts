import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdapterHost } from './types';
import { KisAdapter, type KisTokenStore } from './kis';

// 가짜 한국투자증권 서버: 경로마다 정한 대로 답해요(hang이면 끝까지 답하지 않아요)
type Mode = 'ok' | 'hang' | 'reject' | 'rate';
const mode: Record<'token' | 'price', Mode> = { token: 'ok', price: 'ok' };
/** 'rate'일 때 앞의 몇 번을 초당 거래건수 초과(EGW00201)로 답할지 */
let rateLeft = 0;
/** 경로별로 따로 정한 답(시험마다 넣고 지워요) */
const custom = new Map<string, (q: URLSearchParams) => unknown>();
/** 받은 요청의 경로와 변수 */
const requests: Array<{ path: string; q: URLSearchParams }> = [];
let server: Server;
let rest = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push({ path: url.pathname, q: url.searchParams });
    const fixed = custom.get(url.pathname);
    if (fixed) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixed(url.searchParams)));
      return;
    }
    const kind = req.url?.startsWith('/oauth2/tokenP') ? 'token' : 'price';
    const m = mode[kind];
    if (m === 'hang') return;
    if (m === 'rate' && rateLeft > 0) {
      rateLeft--;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }));
      return;
    }
    if (m === 'reject') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error_code: 'EGW00103', error_description: '유효하지 않은 AppKey입니다.' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(kind === 'token' ? { access_token: 't', expires_in: 86400 } : { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output: { stck_prpr: '71200', prdt_abrv_name: '삼성전자', mket_id_cd: 'STK' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  rest = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  KisAdapter.timeouts = { step: 600, tokenStore: 200 };
});

afterEach(() => {
  custom.clear();
  requests.length = 0;
  vi.useRealTimers();
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function adapter(store: KisTokenStore, quotes: Array<{ id: string; last: number }> = []) {
  const logs: string[] = [];
  const host = {
    emitQuote: (q: { id: string; last: number }) => quotes.push(q),
    emitStatus: () => undefined,
    log: { debug: () => undefined, info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) },
  } as unknown as AdapterHost;
  return { kis: new KisAdapter(host, { appKey: 'PSabcd', appSecret: 's', env: 'real' }, store, { rest, ws: 'ws://127.0.0.1:1' }), logs };
}

const memoryStore = (): KisTokenStore => ({ load: async () => undefined, save: async () => undefined });
// 보안 저장소가 답하지 않는 경우(Windows에서 연결 테스트가 끝나지 않던 상황)
const stuckStore = (): KisTokenStore => ({ load: () => new Promise(() => undefined), save: () => new Promise(() => undefined) });

describe('한국투자증권 연결 테스트', () => {
  it('정상: 삼성전자 현재가를 알려 줘요', async () => {
    mode.token = 'ok';
    mode.price = 'ok';
    const r = await adapter(memoryStore()).kis.test();
    expect(r).toEqual({ ok: true, message: '연결됐어요 · 삼성전자 현재가 71,200원' });
  });

  it('토큰 저장소가 답하지 않아도 멈추지 않고 연결돼요', async () => {
    mode.token = 'ok';
    mode.price = 'ok';
    const { kis, logs } = adapter(stuckStore());
    const r = await kis.test();
    expect(r.ok).toBe(true);
    expect(logs.join('\n')).toContain('토큰을 제때 저장하지 못했어요');
  });

  it('한국투자증권이 답하지 않으면 막힌 단계를 알려 줘요', async () => {
    mode.token = 'ok';
    mode.price = 'hang';
    const r = await adapter(memoryStore()).kis.test();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('삼성전자 현재가 조회');
    expect(r.message).toContain('응답하지 않았어요');
  });

  it('다른 키로 받아 둔 토큰은 쓰지 않고 새로 받아요', async () => {
    mode.token = 'ok';
    mode.price = 'ok';
    const saved: { t?: { token: string; expiresAt: number; keyId?: string } } = {};
    const store: KisTokenStore = { load: async () => saved.t, save: async (t) => void (saved.t = t) };
    // 예전 형식(keyId 없음)이나 다른 키의 토큰
    saved.t = { token: 'old', expiresAt: Date.now() + 86400_000 };
    const { kis, logs } = adapter(store);
    expect((await kis.test()).ok).toBe(true);
    expect(logs.join('\n')).toContain('KIS 토큰 발급');
    expect(saved.t?.token).toBe('t');
    // 같은 키면 저장해 둔 토큰을 다시 써요
    const again = adapter(store);
    expect((await again.kis.test()).ok).toBe(true);
    expect(again.logs.join('\n')).toContain('저장해 둔 토큰을 써요');
  });

  it('초당 한도 초과가 몰려도 조회 대기줄이 멈추지 않아요(동시 8자리가 모두 재시도를 기다리던 문제)', async () => {
    mode.token = 'ok';
    mode.price = 'rate';
    rateLeft = 12;
    const { kis } = adapter(memoryStore());
    const all = Promise.all(Array.from({ length: 20 }, () => kis.lookup('005930', 'KR')));
    const done = await Promise.race([all.then(() => 'done'), new Promise((r) => setTimeout(() => r('stuck'), 8000))]);
    expect(done).toBe('done');
    mode.price = 'ok';
  }, 15_000);

  it('키가 틀리면 한국투자증권의 오류 내용을 함께 보여 줘요', async () => {
    mode.token = 'reject';
    const r = await adapter(memoryStore()).kis.test();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('토큰 받기');
    expect(r.message).toContain('EGW00103');
  });
});

describe('한국투자증권 실시간 구독 거절', () => {
  it('MAX SUBSCRIBE OVER로 거절된 종목은 조회로 받고, 받아들여진 종목은 실시간으로 받아요', async () => {
    // 국내 장중(목요일 10:00)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 29, 1, 0));
    const { kis } = adapter(memoryStore());
    // 실시간 연결이 열린 상태를 흉내 내요
    const sent: string[] = [];
    const k = kis as unknown as {
      ws: { readyState: number; send: (s: string) => void; close: () => void };
      state: string;
      onWsMessage: (raw: string) => void;
      pollTargets: () => Array<{ code: string }>;
      approvalKey: string;
    };
    k.ws = { readyState: WebSocket.OPEN, send: (s) => sent.push(s), close: () => undefined };
    k.state = 'connected';
    k.approvalKey = 'a';
    const inst = (code: string) => ({ id: `EQ:KS:${code}`, assetClass: 'EQUITY', market: 'KS', code, exchange: 'KRX', currency: 'KRW' }) as never;
    kis.subscribe([inst('005930'), inst('000660')]);
    // 구독 요청은 공식 예제처럼 0.05초 간격으로 나가요
    expect(sent.filter((s) => s.includes('"tr_type":"1"'))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(sent.filter((s) => s.includes('"tr_type":"1"'))).toHaveLength(2);
    const reply = (key: string, ok: boolean, msg: string) => JSON.stringify({ header: { tr_id: 'H0STCNT0', tr_key: key, encrypt: 'N' }, body: { rt_cd: ok ? '0' : '1', msg_cd: ok ? 'OPSP0000' : 'OPSP0008', msg1: msg } });
    k.onWsMessage(reply('005930', true, 'SUBSCRIBE SUCCESS'));
    k.onWsMessage(reply('000660', false, 'MAX SUBSCRIBE OVER'));
    expect(k.pollTargets().map((i) => i.code)).toEqual(['000660']);
    const d = kis.diagnostics();
    expect([d.wsAccepted, d.wsRejected]).toEqual([1, 1]);
    expect(kis.status().message).toContain('거절');
    kis.stop();
    // 닫을 때 받아 둔 구독을 풀어요
    expect(sent.filter((s) => s.includes('"tr_type":"2"')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('한국투자증권 실시간 메시지', () => {
  it('PINGPONG에는 공식 예제처럼 pong 프레임으로 답해요', () => {
    const { kis } = adapter(memoryStore());
    const pongs: string[] = [];
    const sent: string[] = [];
    const k = kis as unknown as { ws: unknown; onWsMessage: (raw: string) => void };
    k.ws = { readyState: 1, send: (x: string) => sent.push(x), pong: (b: Buffer) => pongs.push(b.toString()), close: () => undefined };
    const ping = JSON.stringify({ header: { tr_id: 'PINGPONG', datetime: '20261030233000' } });
    k.onWsMessage(ping);
    expect(pongs).toEqual([ping]);
    expect(sent).toEqual([]);
  });

  it('여러 건이 묶여 온 국내 체결을 건마다 나눠 읽어요(47칸)', () => {
    const quotes: Array<{ id: string; last: number }> = [];
    const { kis } = adapter(memoryStore(), quotes);
    const k = kis as unknown as { onWsMessage: (raw: string) => void; byKey: Map<string, unknown> };
    k.byKey.set('H0STCNT0|005930', { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930' });
    const rec = (price: string) => {
      const f = Array(47).fill('0');
      f[0] = '005930';
      f[1] = '101500';
      f[2] = price;
      return f.join('^');
    };
    k.onWsMessage(`0|H0STCNT0|002|${rec('71000')}^${rec('71100')}`);
    expect(quotes.map((q) => q.last)).toEqual([71000, 71100]);
  });
});

/** 실시간 연결이 열린 상태를 흉내 내요 */
function openWs(kis: KisAdapter) {
  const sent: string[] = [];
  const k = kis as unknown as { ws: unknown; state: string; approvalKey: string };
  k.ws = { readyState: WebSocket.OPEN, send: (x: string) => sent.push(x), close: () => undefined };
  k.state = 'connected';
  k.approvalKey = 'a';
  return sent;
}

const kr = (code: string) => ({ id: `EQ:KS:${code}`, assetClass: 'EQUITY', market: 'KS', code, exchange: 'KRX', currency: 'KRW' }) as never;
const us = (code: string) => ({ id: `EQ:US:${code}`, assetClass: 'EQUITY', market: 'US', code, exchange: 'NAS', currency: 'USD' }) as never;
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('장이 닫힌 종목', () => {
  it('국내 장이 닫히고 미국 장이 열려 있으면, 미국 종목만 실시간 슬롯을 쓰고 국내 종목은 5분 간격으로 마감 값을 확인해요', async () => {
    mode.token = 'ok';
    mode.price = 'ok';
    // 한국 토요일 00:30 = 뉴욕 금요일 11:30(장중)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 15, 30));
    const quotes: Array<{ id: string; last: number; fresh?: { mode: string; asOf: number; intervalMs?: number } }> = [];
    const { kis } = adapter(memoryStore(), quotes);
    const sent = openWs(kis);
    kis.subscribe([kr('005930'), us('AAPL')]);
    await new Promise((r) => setTimeout(r, 80));
    const subs = sent.filter((x) => x.includes('"tr_type":"1"'));
    expect(subs).toHaveLength(1);
    expect(subs[0]).toContain('DNASAAPL');
    const k = kis as unknown as { pollTargets: () => Array<{ code: string }>; intervalFor: (i: unknown) => number };
    expect(k.pollTargets().map((i) => i.code)).toEqual(['005930']);
    expect(k.intervalFor(kr('005930'))).toBe(5 * 60_000);
    // 국내 종목의 값은 마감 값이라 기준 시각이 금요일 15:30(한국)이에요
    await until(() => quotes.some((q) => q.id === 'EQ:KS:005930'));
    const q = quotes.find((x) => x.id === 'EQ:KS:005930')!;
    expect(q.fresh?.mode).toBe('poll');
    expect(q.fresh?.asOf).toBe(Date.UTC(2026, 9, 30, 6, 30));
    expect(q.fresh?.intervalMs).toBe(5 * 60_000);
    kis.stop();
  });

  it('국내 분봉은 장이 닫힌 때 15:30부터 받고, 정규장 밖의 봉은 버려요', async () => {
    mode.token = 'ok';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 15, 34)); // 한국 토요일 00:34
    const row = (hour: string, c: string) => ({ stck_bsop_date: '20261030', stck_cntg_hour: hour, stck_oprc: c, stck_hgpr: c, stck_lwpr: c, stck_prpr: c, cntg_vol: '1' });
    custom.set('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output2: q.get('FID_INPUT_HOUR_1') === '153000' ? [row('192500', '1'), row('153000', '278500'), row('152900', '278000'), row('090000', '277000')] : [],
    }));
    const { kis } = adapter(memoryStore());
    const s = await kis.bars(kr('005380'), '1m');
    expect(requests.find((r) => r.path.endsWith('inquire-time-itemchartprice'))?.q.get('FID_INPUT_HOUR_1')).toBe('153000');
    expect(s.bars.map((b) => b.c)).toEqual([277000, 278000, 278500]);
  });

  it('해외 지수의 현재가 칸이 비면 가장 최근 일봉으로 보여 주고, 값이 없으면 0을 보내지 않아요', async () => {
    mode.token = 'ok';
    const path = '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice';
    const day = (ymd: string, c: string) => ({ stck_bsop_date: ymd, ovrs_nmix_prpr: c, ovrs_nmix_oprc: c, ovrs_nmix_hgpr: c, ovrs_nmix_lwpr: c });
    custom.set(path, () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: { ovrs_nmix_prpr: '0.00', ovrs_nmix_prdy_vrss: '0.00', prdy_ctrt: '0.00' }, output2: [day('20261029', '47000'), day('20261030', '47500')] }));
    const quotes: Array<{ id: string; last: number; change?: number; fresh?: { mode: string; asOfDate?: string } }> = [];
    const { kis, logs } = adapter(memoryStore(), quotes);
    const dow = { id: 'IDX:INDU', assetClass: 'INDEX', code: 'INDU', market: 'US', exchange: 'US', currency: 'USD' } as never;
    const k = kis as unknown as { pollOne: (i: unknown, pri: number) => Promise<void> };
    await k.pollOne(dow, 0);
    expect(quotes).toHaveLength(1);
    expect([quotes[0].last, quotes[0].change, quotes[0].fresh?.mode, quotes[0].fresh?.asOfDate]).toEqual([47500, 500, 'daily', '2026-10-30']);
    // 해외 지수 마스터의 코드를 써요(요청 변수)
    expect(requests.find((r) => r.path === path)?.q.get('FID_INPUT_ISCD')).toBe('.DJI');
    custom.set(path, () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: { ovrs_nmix_prpr: '0.00' }, output2: [] }));
    await k.pollOne(dow, 0);
    expect(quotes).toHaveLength(1);
    expect(logs.join('\n')).toContain('값이 없어요');
  });
});

describe('시간봉(GP)', () => {
  /** 가짜 주식일별분봉조회: 그날 09:00~15:30 1분봉 391개 중 요청 시각과 그 앞 120개(새것부터). holidays는 빈 응답 */
  function dailyMinutes(holidays: string[] = []) {
    custom.set('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', (q) => {
      const date = q.get('FID_INPUT_DATE_1')!;
      const hour = q.get('FID_INPUT_HOUR_1')!;
      const wd = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))).getUTCDay();
      if (holidays.includes(date) || wd === 0 || wd === 6) return { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: [] };
      const rows = [];
      for (let m = 9 * 60; m <= 15 * 60 + 30; m++) {
        const hms = `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
        if (hms <= hour) rows.push({ stck_bsop_date: date, stck_cntg_hour: hms, stck_prpr: '100', stck_oprc: '100', stck_hgpr: '101', stck_lwpr: '99', cntg_vol: '1' });
      }
      return { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: rows.reverse().slice(0, 120) };
    });
  }
  const kst = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 9, m) / 1000;

  it('국내 1시간봉: 1분봉을 120개씩 거꾸로 받아 09~15시 칸으로 묶고, 처음에는 최근 5거래일(휴장일은 건너뜀)', async () => {
    mode.token = 'ok';
    // 조회가 15건을 넘어서 시계가 흘러야 해요(초당 호출 수를 세요)
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 15, 30)); // 한국 토요일 00:30
    dailyMinutes(['20261028']);
    const { kis } = adapter(memoryStore());
    const s = await kis.bars(kr('005930'), '1h');
    // 26·27·29·30일(28일 휴장) × 7칸
    expect(s.bars).toHaveLength(28);
    expect(s.bars[0].t).toBe(kst(26, 9));
    expect(s.bars.slice(0, 7).map((b) => b.v)).toEqual([60, 60, 60, 60, 60, 60, 31]);
    const first = requests.find((r) => r.path.endsWith('inquire-time-dailychartprice'))!;
    expect([first.q.get('FID_INPUT_DATE_1'), first.q.get('FID_INPUT_HOUR_1'), first.q.get('FID_PW_DATA_INCU_YN')]).toEqual(['20261030', '153000', 'Y']);
  });

  it('국내 1시간봉: 저장해 둔 봉이 있으면 그날부터만 받아요', async () => {
    mode.token = 'ok';
    // 조회가 15건을 넘어서 시계가 흘러야 해요(초당 호출 수를 세요)
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 15, 30));
    dailyMinutes();
    const { kis } = adapter(memoryStore());
    const s = await kis.bars(kr('005930'), '1h', { after: kst(29, 14) });
    expect(s.bars.map((b) => b.t)[0]).toBe(kst(29, 9));
    expect(s.bars).toHaveLength(14);
    // 하루 4번(120·120·120·31개)씩 이틀
    expect(requests.filter((r) => r.path.endsWith('inquire-time-dailychartprice'))).toHaveLength(8);
  });

  it('지난 국내 시간봉은 before 앞의 10거래일씩 채워요', async () => {
    mode.token = 'ok';
    dailyMinutes();
    const { kis } = adapter(memoryStore());
    const older = await kis.olderHourBars(kr('005930'), kst(26, 9));
    expect(older).toHaveLength(70);
    expect(older[older.length - 1].t).toBe(kst(23, 15));
    expect(older[0].t).toBe(kst(12, 9));
  });

  it('미국 1시간봉은 60분봉으로 받고, 다음 조회 KEYB는 가장 오래된 봉의 60분 전(현지 시각)이에요', async () => {
    mode.token = 'ok';
    const path = '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice';
    const row = (xhms: string, khms: string) => ({ xymd: '20261030', xhms, kymd: '20261031', khms, open: '1', high: '2', low: '1', last: '1.5', evol: '10' });
    custom.set(path, (q) => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: q.get('NEXT') ? [] : [row('153000', '043000'), row('143000', '033000'), row('133000', '023000')] }));
    const { kis } = adapter(memoryStore());
    const s = await kis.bars(us('AAPL'), '1h');
    expect(s.bars).toHaveLength(3);
    const reqs = requests.filter((r) => r.path === path);
    expect(reqs[0].q.get('NMIN')).toBe('60');
    expect([reqs[1].q.get('NEXT'), reqs[1].q.get('KEYB')]).toEqual(['1', '20261030123000']);
  });
});
