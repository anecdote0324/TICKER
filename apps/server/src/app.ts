// 내장 서버의 HTTP·WebSocket 경로와 보안(01 보안).
// - 이 PC 안(127.0.0.1)에서만 열어요.
// - 실행할 때마다 새로 만드는 토큰을 요청마다 확인해요.
// - Host·Origin 헤더를 엄격하게 검사하고, 다른 사이트의 접근(CORS)을 허용하지 않아요.

import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { BarInterval, ClientMessage, CredentialStatus, InstrumentsResponse, ServerMessage, Settings } from '@bt/shared';
import { KisAdapter, type KisCredentials } from './adapters/kis';
import type { Hub } from './hub';
import { STATE_NAMES, type StateName, type Store } from './store';

export interface AppDeps {
  hub: Hub;
  store: Store;
  token: string;
  /** 연 포트(리슨 뒤에 정해져요) */
  port: () => number;
  instruments: () => Promise<InstrumentsResponse>;
  webDir?: string;
  devOrigins?: string[];
  version: string;
  makeKis: (cred: KisCredentials) => KisAdapter;
}

const BAR_INTERVALS = new Set<BarInterval>(['1m', '5m', '1d', '1w', '1M']);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const { hub, store } = deps;

  const allowedHosts = () => new Set([`127.0.0.1:${deps.port()}`, `localhost:${deps.port()}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${deps.port()}`, `http://localhost:${deps.port()}`, ...(deps.devOrigins ?? [])]);

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts().has(host)) {
      return reply.code(403).send({ error: '허용하지 않는 Host예요' });
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins().has(origin)) {
      return reply.code(403).send({ error: '허용하지 않는 Origin이에요' });
    }
    const path = req.url.split('?')[0];
    if (path.startsWith('/api') || path === '/ws') {
      const header = req.headers['x-bt-token'];
      const q = new URL(req.url, 'http://local').searchParams.get('token');
      const tok = (typeof header === 'string' ? header : undefined) ?? (path === '/ws' ? q : null) ?? '';
      if (!safeEqual(tok, deps.token)) return reply.code(401).send({ error: '토큰이 맞지 않아요' });
    }
  });

  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // ── 시세 WebSocket ──
  app.get('/ws', { websocket: true }, (socket) => {
    const client = {
      ids: new Set<string>(),
      send(msg: ServerMessage) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };
    client.send({ type: 'hello', serverTime: Date.now(), demo: hub.demoMode });
    hub.addClient(client);
    socket.on('message', (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'subscribe' && Array.isArray(msg.ids)) hub.subscribe(client, msg.ids.slice(0, 2000).map(String));
      else if (msg.type === 'unsubscribe' && Array.isArray(msg.ids)) hub.unsubscribe(client, msg.ids.map(String));
      else if (msg.type === 'ping') client.send({ type: 'pong', t: msg.t });
    });
    socket.on('close', () => hub.removeClient(client));
  });

  // ── REST ──
  app.get('/api/hello', async () => ({
    version: deps.version,
    demo: hub.demoMode,
    serverTime: Date.now(),
    secretKind: store.secretKind,
    intraday: {
      EQUITY: true,
      CRYPTO: true,
      CURNCY: false,
      INDEX: hub.demoMode,
    },
  }));

  let instrumentsJson: { at: number; body: string } | null = null;
  app.get('/api/instruments', async (_req, reply) => {
    const r = await deps.instruments();
    if (!instrumentsJson || instrumentsJson.at !== r.builtAt) instrumentsJson = { at: r.builtAt, body: JSON.stringify(r) };
    reply.type('application/json').send(instrumentsJson.body);
  });

  app.get<{ Querystring: { id?: string; interval?: string } }>('/api/bars', async (req, reply) => {
    const { id, interval } = req.query;
    if (!id || !interval || !BAR_INTERVALS.has(interval as BarInterval)) return reply.code(400).send({ error: 'id와 interval이 필요해요' });
    try {
      return await hub.bars(id, interval as BarInterval);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: { ids?: string } }>('/api/quotes', async (req) => hub.quoteSnapshot((req.query.ids ?? '').split(',').filter(Boolean)));

  app.get('/api/status', async () => ({ sources: hub.statuses(), kisBudget: hub.kis?.budgetUsage() }));

  app.get('/api/settings', async () => store.getSettings());
  app.put<{ Body: Partial<Settings> }>('/api/settings', async (req) => store.setSettings(req.body ?? {}));

  app.get<{ Params: { name: string } }>('/api/state/:name', async (req, reply) => {
    if (!STATE_NAMES.includes(req.params.name as StateName)) return reply.code(404).send({ error: '없는 상태예요' });
    return { value: store.getState(req.params.name as StateName) ?? null };
  });
  app.put<{ Params: { name: string }; Body: { value: unknown } }>('/api/state/:name', async (req, reply) => {
    if (!STATE_NAMES.includes(req.params.name as StateName)) return reply.code(404).send({ error: '없는 상태예요' });
    await store.setState(req.params.name as StateName, req.body?.value ?? null);
    return { ok: true };
  });

  // ── 한국투자증권 키 ──
  const credentialStatus = async (): Promise<CredentialStatus & { secretKind: string }> => {
    const raw = await store.getSecret('kis');
    if (!raw) return { kis: { configured: false, env: 'real' }, secretKind: store.secretKind };
    const c = JSON.parse(raw) as KisCredentials & { lastTest?: CredentialStatus['kis']['lastTest'] };
    return {
      kis: { configured: true, appKeyHint: `…${c.appKey.slice(-4)}`, env: c.env, lastTest: c.lastTest },
      secretKind: store.secretKind,
    };
  };

  app.get('/api/credentials', credentialStatus);

  app.put<{ Body: { appKey?: string; appSecret?: string; env?: 'real' | 'virtual' } }>('/api/credentials/kis', async (req, reply) => {
    const { appKey, appSecret, env } = req.body ?? {};
    if (!appKey || !appSecret) return reply.code(400).send({ error: '앱키와 앱시크릿을 모두 넣어 주세요' });
    const cred: KisCredentials = { appKey: appKey.trim(), appSecret: appSecret.trim(), env: env === 'virtual' ? 'virtual' : 'real' };
    const kis = deps.makeKis(cred);
    const test = await kis.test();
    await store.setSecret('kis', JSON.stringify({ ...cred, lastTest: { ...test, at: Date.now() } }));
    if (test.ok) await hub.setKis(kis);
    return { test, status: await credentialStatus() };
  });

  app.post('/api/credentials/kis/test', async (_req, reply) => {
    const raw = await store.getSecret('kis');
    if (!raw) return reply.code(400).send({ error: '저장된 키가 없어요' });
    const cred = JSON.parse(raw) as KisCredentials;
    const kis = hub.kis ?? deps.makeKis(cred);
    const test = await kis.test();
    await store.setSecret('kis', JSON.stringify({ ...cred, lastTest: { ...test, at: Date.now() } }));
    if (test.ok && !hub.kis) await hub.setKis(kis);
    return { test, status: await credentialStatus() };
  });

  app.delete('/api/credentials/kis', async () => {
    await store.setSecret('kis', undefined);
    await store.setSecret('kisToken', undefined);
    await hub.setKis(undefined);
    return { status: await credentialStatus() };
  });

  // ── 화면 파일(배포판) ──
  // 화면에는 외부 스크립트를 넣지 않아요. 뉴스 원문 같은 외부 HTML도 앱 화면에 바로 넣지 않아요(01 보안)
  app.addHook('onSend', async (req, reply, payload) => {
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'",
      );
      reply.header('x-content-type-options', 'nosniff');
    }
    return payload;
  });
  if (deps.webDir && existsSync(join(deps.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: deps.webDir, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: '없는 경로예요' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
