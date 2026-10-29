import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterHost } from './types';
import { KisAdapter, type KisTokenStore } from './kis';

// 가짜 한국투자증권 서버: 경로마다 정한 대로 답해요(hang이면 끝까지 답하지 않아요)
type Mode = 'ok' | 'hang' | 'reject';
const mode: Record<'token' | 'price', Mode> = { token: 'ok', price: 'ok' };
let server: Server;
let rest = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const kind = req.url?.startsWith('/oauth2/tokenP') ? 'token' : 'price';
    const m = mode[kind];
    if (m === 'hang') return;
    if (m === 'reject') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error_code: 'EGW00103', error_description: '유효하지 않은 AppKey입니다.' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(kind === 'token' ? { access_token: 't', expires_in: 86400 } : { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output: { stck_prpr: '71200' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  rest = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  KisAdapter.timeouts = { step: 600, tokenStore: 200 };
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function adapter(store: KisTokenStore) {
  const logs: string[] = [];
  const host = {
    emitQuote: () => undefined,
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

  it('키가 틀리면 한국투자증권의 오류 내용을 함께 보여 줘요', async () => {
    mode.token = 'reject';
    const r = await adapter(memoryStore()).kis.test();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('토큰 받기');
    expect(r.message).toContain('EGW00103');
  });
});
