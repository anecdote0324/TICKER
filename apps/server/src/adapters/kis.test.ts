import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterHost } from './types';
import { KisAdapter, type KisTokenStore } from './kis';

// 가짜 한국투자증권 서버: 경로마다 정한 대로 답해요(hang이면 끝까지 답하지 않아요)
type Mode = 'ok' | 'hang' | 'reject' | 'rate';
const mode: Record<'token' | 'price', Mode> = { token: 'ok', price: 'ok' };
/** 'rate'일 때 앞의 몇 번을 초당 거래건수 초과(EGW00201)로 답할지 */
let rateLeft = 0;
let server: Server;
let rest = '';

beforeAll(async () => {
  server = createServer((req, res) => {
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
