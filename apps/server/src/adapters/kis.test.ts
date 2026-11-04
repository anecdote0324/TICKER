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
const requests: Array<{ path: string; q: URLSearchParams; h: Record<string, string | string[] | undefined> }> = [];
let server: Server;
let rest = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push({ path: url.pathname, q: url.searchParams, h: req.headers });
    const fixed = custom.get(url.pathname);
    if (fixed) {
      // __headers를 주면 응답 머리글로 보내요(연속 조회 tr_cont)
      const { __headers, ...body } = (fixed(url.searchParams) ?? {}) as { __headers?: Record<string, string> };
      res.writeHead(200, { 'content-type': 'application/json', ...(__headers ?? {}) });
      res.end(JSON.stringify(body));
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

  it('국내 GIP 분봉은 장이 닫힌 때 주식일별분봉조회로 가장 최근 하루를 15:30부터 받고, 정규장 밖의 봉은 버려요', async () => {
    mode.token = 'ok';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 15, 34)); // 한국 토요일 00:34
    const row = (date: string, hour: string, c: string) => ({ stck_bsop_date: date, stck_cntg_hour: hour, stck_oprc: c, stck_hgpr: c, stck_lwpr: c, stck_prpr: c, cntg_vol: '1' });
    custom.set('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output2:
        q.get('FID_INPUT_DATE_1') === '20261030' && q.get('FID_INPUT_HOUR_1') === '153059'
          ? [row('20261030', '192500', '1'), row('20261030', '153012', '278500'), row('20261030', '152900', '278000'), row('20261030', '090000', '277000'), row('20261029', '153000', '1')]
          : [],
    }));
    const { kis } = adapter(memoryStore());
    const s = await kis.bars(kr('005380'), '1m');
    const reqs = requests.filter((r) => r.path.endsWith('inquire-time-dailychartprice'));
    // 장 마감 단일가 봉에 초가 붙어 와도 빠지지 않게 15:30:59부터 받아요
    expect([reqs[0].q.get('FID_INPUT_DATE_1'), reqs[0].q.get('FID_INPUT_HOUR_1')]).toEqual(['20261030', '153059']);
    // 하루치(10/30)만, 정규장 봉만. 09:00에 닿으면 앞 날로 넘어가지 않아요. 15:30:12 봉은 15:30 칸으로
    expect(s.bars.map((b) => b.c)).toEqual([277000, 278000, 278500]);
    expect(s.bars[2].t).toBe(Date.UTC(2026, 9, 30, 6, 30) / 1000);
    expect(reqs).toHaveLength(1);
    expect(requests.some((r) => r.path.endsWith('inquire-time-itemchartprice'))).toBe(false);
    // 진단 정보에 거르기 전 응답 견본이 남아요(15:30 뒤 봉 포함)
    const sample = (kis.diagnostics().barSamples as Record<string, { newest: string[][] }>).FHKST03010230;
    expect(sample.newest[0]).toEqual(['20261030', '192500', '1', '1', '1', '1', '1']);
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
    expect([first.q.get('FID_INPUT_DATE_1'), first.q.get('FID_INPUT_HOUR_1'), first.q.get('FID_PW_DATA_INCU_YN')]).toEqual(['20261030', '153059', 'Y']);
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
  }, 15_000);

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

describe('환율(한국투자증권)', () => {
  it('해외지수 마스터의 환율 코드를 시장 구분 X로 조회하고, 달러로 매긴 값(달러/유로)은 1달러당 값으로 뒤집어요', async () => {
    mode.token = 'ok';
    const path = '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice';
    const values: Record<string, [string, string]> = { 'FX@KRW': ['1410.50', '10.50'], 'FX@EUR': ['1.1000', '0.0100'] };
    custom.set(path, (q) => {
      const [v, d] = values[q.get('FID_INPUT_ISCD')!] ?? ['0', '0'];
      return { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: { ovrs_nmix_prpr: v, ovrs_nmix_prdy_vrss: d, prdy_ctrt: '0' }, output2: [] };
    });
    const { kis, logs } = adapter(memoryStore());
    const r = await kis.fxPerUsd(['KRW', 'EUR', 'JPY']);
    expect(r.cur.KRW).toBe(1410.5);
    expect(r.prev.KRW).toBe(1400);
    expect(r.cur.EUR).toBeCloseTo(1 / 1.1, 10);
    expect(r.prev.EUR).toBeCloseTo(1 / 1.09, 10);
    // 값이 없는 통화(JPY)는 빠지고 기록에 남아요
    expect(r.cur.JPY).toBeUndefined();
    expect(logs.join('\n')).toContain('FX@JPY');
    const reqs = requests.filter((x) => x.path === path);
    expect(reqs.every((x) => x.q.get('FID_COND_MRKT_DIV_CODE') === 'X')).toBe(true);
    expect(reqs.map((x) => x.q.get('FID_INPUT_ISCD')).sort()).toEqual(['FX@EUR', 'FX@JPY', 'FX@KRW']);
  });
});

describe('장중에 갱신되지 않는 해외 지수', () => {
  it('장중인데 15분 넘게 같은 값이면 실시간처럼 보이지 않게 가장 최근 일봉 날짜로 일별을 붙여요', async () => {
    mode.token = 'ok';
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 14, 0)); // 런던 14:00(장중)
    const day = (ymd: string, c: string) => ({ stck_bsop_date: ymd, ovrs_nmix_prpr: c });
    custom.set('/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: { ovrs_nmix_prpr: '7969.42', ovrs_nmix_prdy_vrss: '-0.58', prdy_ctrt: '-0.01' }, output2: [day('20261030', '7969.42'), day('20261029', '7970.00')] }));
    const quotes: Array<{ fresh: { mode: string; asOfDate?: string } }> = [];
    const { kis } = adapter(memoryStore(), quotes as never);
    const cac = { id: 'IDX:CAC', assetClass: 'INDEX', code: 'CAC', currency: 'EUR' } as never;
    const k = kis as unknown as { pollOne: (i: unknown, pri: number) => Promise<void> };
    await k.pollOne(cac, 0);
    expect(quotes[0].fresh.mode).toBe('poll');
    vi.setSystemTime(Date.UTC(2026, 10, 2, 14, 16));
    await k.pollOne(cac, 0);
    expect(quotes[1].fresh).toMatchObject({ mode: 'daily', asOfDate: '2026-10-30' });
  });
});

describe('환율 봉(한국투자증권)', () => {
  it('일봉을 시장 구분 X로 받고, 달러로 매긴 값(달러/유로)은 뒤집어 고가·저가를 바꿔요', async () => {
    mode.token = 'ok';
    const path = '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice';
    custom.set(path, (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output2: q.get('FID_INPUT_ISCD') === 'FX@EUR' ? [{ stck_bsop_date: '20261030', ovrs_nmix_prpr: '1.10', ovrs_nmix_oprc: '1.08', ovrs_nmix_hgpr: '1.25', ovrs_nmix_lwpr: '1.00' }] : [],
    }));
    const { kis } = adapter(memoryStore());
    const bars = await kis.fxBarsPerUsd('EUR', 'D');
    expect(bars).toHaveLength(1);
    expect(bars[0].c).toBeCloseTo(1 / 1.1, 10);
    expect(bars[0].h).toBeCloseTo(1 / 1.0, 10);
    expect(bars[0].l).toBeCloseTo(1 / 1.25, 10);
    const req = requests.find((r) => r.path === path)!;
    expect([req.q.get('FID_COND_MRKT_DIV_CODE'), req.q.get('FID_PERIOD_DIV_CODE')]).toEqual(['X', 'D']);
  });
});

describe('과거 봉 더 받기(차트를 왼쪽 끝으로 끌 때)', () => {
  const row = (d: string, c: number) => ({ stck_bsop_date: d, stck_oprc: String(c), stck_hgpr: String(c + 1), stck_lwpr: String(c - 1), stck_clpr: String(c), acml_vol: '10' });

  it('국내 일봉: before 전날부터 거꾸로 받고, before 이후 봉은 빼요', async () => {
    mode.token = 'ok';
    const path = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
    custom.set(path, (q) => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output2: q.get('FID_INPUT_DATE_2') === '20200102' ? [row('20200102', 50), row('20200101', 49)] : [] }));
    const { kis } = adapter(memoryStore());
    const before = Date.UTC(2020, 0, 3) / 1000 - 9 * 3600; // 2020-01-03 00:00 KST
    const s = await kis.bars({ id: 'EQ:KS:005930', assetClass: 'EQUITY', code: '005930', market: 'KS' } as never, '1d', { before });
    expect(s.bars.map((b) => b.c)).toEqual([49, 50]);
    expect(s.bars.every((b) => b.t < before)).toBe(true);
    expect(requests.find((r) => r.path === path)!.q.get('FID_INPUT_DATE_2')).toBe('20200102');
  });

  it('지수 일봉: 한 번(150일)에서 멈추지 않고 기간을 거꾸로 넘기며 4번까지 받아요', async () => {
    mode.token = 'ok';
    const path = '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice';
    let n = 0;
    custom.set(path, (q) => {
      n++;
      const end = q.get('FID_INPUT_DATE_2')!;
      return { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output2: [{ stck_bsop_date: end, bstp_nmix_prpr: '2500', bstp_nmix_oprc: '2490', bstp_nmix_hgpr: '2510', bstp_nmix_lwpr: '2480', acml_vol: '1' }] };
    });
    const { kis } = adapter(memoryStore());
    const s = await kis.bars({ id: 'IDX:KOSPI', assetClass: 'INDEX', code: 'KOSPI' } as never, '1d');
    expect(n).toBe(4);
    expect(s.bars).toHaveLength(4);
    const ends = requests.filter((r) => r.path === path).map((r) => r.q.get('FID_INPUT_DATE_2')!);
    expect([...ends].sort().reverse()).toEqual(ends);
  });
});

describe('IMAP 미국 지수(한국투자증권)', () => {
  it('시가총액순위는 tr_cont가 M이면 tr_cont=N으로 다음 쪽을 받고, 찾던 종목을 다 찾으면 멈춰요', async () => {
    mode.token = 'ok';
    const path = '/uapi/overseas-stock/v1/ranking/market-cap';
    let calls = 0;
    const row = (symb: string, last: string, rate: string, sign: string) => ({ symb, name: symb, last, rate, sign, tamt: '1000' });
    custom.set(path, (q) => {
      calls++;
      if (q.get('EXCD') === 'NYS') return { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: [row('BRK.B', '480.1', '0.50', '2')], __headers: { tr_cont: 'D' } };
      return calls === 1
        ? { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: [row('NVDA', '200.5', '1.20', '2')], __headers: { tr_cont: 'M' } }
        : { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output1: {}, output2: [row('AAPL', '270.0', '0.80', '5')], __headers: { tr_cont: 'M' } };
    });
    const { kis } = adapter(memoryStore());
    const q = await kis.usMarketCapQuotes(
      new Map([
        ['NVDA', 'NAS'],
        ['AAPL', 'NAS'],
        ['BRK/B', 'NYS'],
      ]),
    );
    expect(q.get('NVDA')).toMatchObject({ last: 200.5, changePct: 1.2 });
    // 부호 칸 5(하락)면 음수
    expect(q.get('AAPL')?.changePct).toBe(-0.8);
    // BRK.B → 앱 표기 BRK/B
    expect(q.get('BRK/B')?.last).toBe(480.1);
    const reqs = requests.filter((r) => r.path === path);
    const nas = reqs.filter((r) => r.q.get('EXCD') === 'NAS');
    // NAS는 두 쪽에서 멈춰요(tr_cont M이 와도 다 찾았으니까)
    expect(nas).toHaveLength(2);
    expect([nas[0].h.tr_cont, nas[1].h.tr_cont]).toEqual(['', 'N']);
    expect(nas[0].q.get('VOL_RANG')).toBe('0');
  });

  it('업종 분류는 업종 코드마다 업종별시세를 받아 종목 → 업종 이름으로 묶고, 전체 줄은 빼요', async () => {
    mode.token = 'ok';
    custom.set('/uapi/overseas-price/v1/quotations/industry-price', (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output1: { nrec: '3' },
      output2: q.get('EXCD') === 'NAS' ? [{ icod: '000', name: '전체' }, { icod: '010', name: '반도체' }, { icod: '020', name: '소프트웨어' }] : [{ icod: '010', name: '반도체' }],
    }));
    custom.set('/uapi/overseas-price/v1/quotations/industry-theme', (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output1: {},
      output2: q.get('EXCD') === 'NYS' ? [{ symb: 'TSM' }] : q.get('ICOD') === '010' ? [{ symb: 'NVDA' }, { symb: 'AMD' }] : [{ symb: 'MSFT' }],
    }));
    const { kis } = adapter(memoryStore());
    const m = await kis.usIndustries();
    expect(Object.fromEntries(m)).toEqual({ NVDA: '반도체', AMD: '반도체', MSFT: '소프트웨어', TSM: '반도체' });
    const theme = requests.filter((r) => r.path.endsWith('/industry-theme'));
    expect(theme.map((r) => `${r.q.get('EXCD')}:${r.q.get('ICOD')}`)).toEqual(['NAS:010', 'NAS:020', 'NYS:010']);
  });
});

describe('v0.4 수급(한국투자증권)', () => {
  it('투자자: 공식 예제의 변수로 받고, 금액(백만 원)을 원으로 맞추고 최근 날짜를 먼저', async () => {
    mode.token = 'ok';
    const path = '/uapi/domestic-stock/v1/quotations/inquire-investor';
    custom.set(path, () => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output: [
        { stck_bsop_date: '20261103', stck_clpr: '70000', prdy_ctrt: '1.00', prdy_vrss_sign: '2', frgn_ntby_qty: '10000', frgn_ntby_tr_pbmn: '700', orgn_ntby_qty: '-5000', orgn_ntby_tr_pbmn: '-350', prsn_ntby_qty: '-5000', prsn_ntby_tr_pbmn: '-350' },
        { stck_bsop_date: '20261104', stck_clpr: '71000', prdy_ctrt: '1.43', prdy_vrss_sign: '2', frgn_ntby_qty: '20000', frgn_ntby_tr_pbmn: '1420', orgn_ntby_qty: '', orgn_ntby_tr_pbmn: '', prsn_ntby_qty: '-20000', prsn_ntby_tr_pbmn: '-1420' },
      ],
    }));
    const { kis } = adapter(memoryStore());
    const rows = await kis.flows('005930', 'investor');
    expect(rows.map((r) => r.date)).toEqual(['2026-11-04', '2026-11-03']);
    expect(rows[1].values.frgnAmt).toBe(700e6);
    expect(rows[0].values.orgnAmt).toBeUndefined();
    expect(rows[0].changePct).toBe(1.43);
    const req = requests.find((r) => r.path === path)!;
    expect([req.q.get('FID_COND_MRKT_DIV_CODE'), req.q.get('FID_INPUT_ISCD'), req.h.tr_id]).toEqual(['J', '005930', 'FHKST01010900']);
  });

  it('공매도: output2의 칸, 하락 부호면 등락률 음수', async () => {
    mode.token = 'ok';
    const path = '/uapi/domestic-stock/v1/quotations/daily-short-sale';
    custom.set(path, () => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output1: {},
      output2: [{ stck_bsop_date: '20261104', stck_clpr: '50000', prdy_ctrt: '2.00', prdy_vrss_sign: '5', ssts_cntg_qty: '1000', ssts_vol_rlim: '3.5', ssts_tr_pbmn: '50000000', ssts_tr_pbmn_rlim: '3.4', avrg_prc: '50000' }],
    }));
    const { kis } = adapter(memoryStore());
    const [r] = await kis.flows('000660', 'short');
    expect(r.changePct).toBe(-2);
    expect(r.values).toMatchObject({ qty: 1000, qtyShare: 3.5, amt: 50_000_000, avgPrice: 50000 });
    const req = requests.find((x) => x.path === path)!;
    expect(req.h.tr_id).toBe('FHPST04830000');
    expect(req.q.get('FID_INPUT_DATE_1')).toMatch(/^\d{8}$/);
  });

  it('VI 현황: 시각·종류·해제, 최근 발동이 먼저', async () => {
    mode.token = 'ok';
    custom.set('/uapi/domestic-stock/v1/quotations/inquire-vi-status', (q) => ({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: '정상',
      output: [
        { mksc_shrn_iscd: '123456', hts_kor_isnm: '가나다', cntg_vi_hour: '091500', vi_cncl_hour: '091700', vi_kind_code: '1', vi_prc: '11000', vi_dprt: '10.00', vi_count: '1' },
        { mksc_shrn_iscd: '654321', hts_kor_isnm: '라마바', cntg_vi_hour: '101000', vi_cncl_hour: '', vi_kind_code: '2', vi_prc: '5000', vi_dmc_dprt: '-3.10', vi_count: '2' },
      ],
      _q: q.get('FID_COND_SCR_DIV_CODE'),
    }));
    const { kis } = adapter(memoryStore());
    const list = await kis.viStatus();
    expect(list.map((v) => [v.code, v.time, v.kind, v.releaseTime])).toEqual([
      ['654321', '10:10:00', '동적', undefined],
      ['123456', '09:15:00', '정적', '09:17:00'],
    ]);
    expect(list[0].gap).toBe(-3.1);
  });
});
