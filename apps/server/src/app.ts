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
import { withTimeout, type RecordingLogger } from './util';

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
  log: RecordingLogger;
}

/** 키를 암호화하거나 푸는 데 이보다 오래 걸리면 보안 저장소가 응답하지 않는 걸로 봐요 */
const SECRET_TIMEOUT_MS = 15_000;
const SECRET_TIMEOUT_MSG = 'PC의 보안 저장소(Windows 데이터 보호·Mac 키체인)가 15초 동안 응답하지 않아요';

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

  // 목록에 없는 코드를 한국투자증권에서 직접 조회해요(05 §4.5). 찾으면 이번 실행 동안 목록에 더해요
  app.get<{ Querystring: { code?: string; market?: string } }>('/api/lookup', async (req, reply) => {
    const code = (req.query.code ?? '').toUpperCase();
    const market = req.query.market === 'US' ? 'US' : 'KR';
    if (!/^[0-9A-Z.\/-]{1,12}$/.test(code)) return reply.code(400).send({ error: '코드 모양이 아니에요' });
    if (!hub.kis) return reply.code(409).send({ error: '한국투자증권 키를 넣으면 목록에 없는 코드도 직접 조회할 수 있어요' });
    try {
      const inst = await hub.kis.lookup(code, market);
      hub.addInstrument(inst);
      return inst;
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
  // 끝나지 않는 단계(보안 저장소, 실시간 준비)가 있어도 화면의 버튼이 멈추지 않게 단계마다 시간을 정해요.
  // 기록에는 앱키 끝 4자리만 남기고, 앱시크릿·토큰은 남기지 않아요
  const { log } = deps;
  const readSecret = (name: string) => withTimeout(store.getSecret(name), SECRET_TIMEOUT_MS, SECRET_TIMEOUT_MSG);
  const saveSecret = (name: string, value: string | undefined) => withTimeout(store.setSecret(name, value), SECRET_TIMEOUT_MS, SECRET_TIMEOUT_MSG);
  const credentialStatus = async (): Promise<CredentialStatus & { secretKind: string }> => {
    const raw = await readSecret('kis');
    if (!raw) return { kis: { configured: false, env: 'real' }, secretKind: store.secretKind };
    const c = JSON.parse(raw) as KisCredentials & { lastTest?: CredentialStatus['kis']['lastTest'] };
    return {
      kis: { configured: true, appKeyHint: `…${c.appKey.slice(-4)}`, env: c.env, lastTest: c.lastTest },
      secretKind: store.secretKind,
    };
  };
  /** 키를 저장한 뒤 실시간 소스를 한국투자증권으로 바꿔요. 오래 걸려도 응답은 먼저 보내요 */
  const switchToKis = async (kis: KisAdapter) => {
    await withTimeout(hub.setKis(kis), 20_000, '실시간 준비가 20초 안에 끝나지 않았어요').catch((e) => log.warn(`한국투자증권으로 바꾸는 중: ${(e as Error).message}`));
  };
  const envName = (c: KisCredentials) => (c.env === 'real' ? '실전' : '모의');

  app.get('/api/credentials', async (_req, reply) => {
    try {
      return await credentialStatus();
    } catch (e) {
      log.error(`저장된 키를 읽지 못했어요: ${(e as Error).message}`);
      return reply.code(500).send({ error: `저장된 키를 읽지 못했어요: ${(e as Error).message}` });
    }
  });

  app.put<{ Body: { appKey?: string; appSecret?: string; env?: 'real' | 'virtual' } }>('/api/credentials/kis', async (req, reply) => {
    const { appKey, appSecret, env } = req.body ?? {};
    if (!appKey || !appSecret) return reply.code(400).send({ error: '앱키와 앱시크릿을 모두 넣어 주세요' });
    const cred: KisCredentials = { appKey: appKey.trim(), appSecret: appSecret.trim(), env: env === 'virtual' ? 'virtual' : 'real' };
    const t0 = Date.now();
    log.info(`한국투자증권 키 저장·연결 테스트 시작(${envName(cred)}, 앱키 …${cred.appKey.slice(-4)}, 앱키 ${cred.appKey.length}자·앱시크릿 ${cred.appSecret.length}자)`);
    const kis = deps.makeKis(cred);
    const test = await kis.test();
    log.info(`한국투자증권 연결 테스트 ${test.ok ? '성공' : '실패'}(${Date.now() - t0}ms): ${test.message}`);
    try {
      await saveSecret('kis', JSON.stringify({ ...cred, lastTest: { ...test, at: Date.now() } }));
    } catch (e) {
      log.error(`키 저장 실패: ${(e as Error).message}`);
      return reply.code(500).send({ error: `키를 저장하지 못했어요: ${(e as Error).message}` });
    }
    if (test.ok) await switchToKis(kis);
    else kis.stop();
    return { test, status: await credentialStatus().catch(() => ({ kis: { configured: true, env: cred.env }, secretKind: store.secretKind })) };
  });

  app.post('/api/credentials/kis/test', async (_req, reply) => {
    let raw: string | undefined;
    try {
      raw = await readSecret('kis');
    } catch (e) {
      return reply.code(500).send({ error: `저장된 키를 읽지 못했어요: ${(e as Error).message}` });
    }
    if (!raw) return reply.code(400).send({ error: '저장된 키가 없어요' });
    const cred = JSON.parse(raw) as KisCredentials;
    const t0 = Date.now();
    const kis = hub.kis ?? deps.makeKis(cred);
    const test = await kis.test();
    log.info(`한국투자증권 다시 테스트 ${test.ok ? '성공' : '실패'}(${Date.now() - t0}ms, ${envName(cred)}): ${test.message}`);
    await saveSecret('kis', JSON.stringify({ ...cred, lastTest: { ...test, at: Date.now() } })).catch((e) => log.error(`키 저장 실패: ${(e as Error).message}`));
    if (test.ok && !hub.kis) await switchToKis(kis);
    return { test, status: await credentialStatus().catch(() => ({ kis: { configured: true, env: cred.env }, secretKind: store.secretKind })) };
  });

  app.delete('/api/credentials/kis', async () => {
    await saveSecret('kis', undefined).catch((e) => log.error(`키 지우기 실패: ${(e as Error).message}`));
    await saveSecret('kisToken', undefined).catch(() => undefined);
    await hub.setKis(undefined);
    log.info('한국투자증권 키를 지웠어요');
    return { status: await credentialStatus().catch(() => ({ kis: { configured: false, env: 'real' as const }, secretKind: store.secretKind })) };
  });

  // ── 진단 정보(설정 → 정보 → 진단 정보 복사) ──
  // 앱키·앱시크릿·토큰은 넣지 않아요. 사용자가 복사해서 보내는 글이에요
  app.get('/api/diagnostics', async () => {
    let kis: Record<string, unknown> = { configured: false };
    try {
      const raw = await readSecret('kis');
      if (raw) {
        const c = JSON.parse(raw) as KisCredentials & { lastTest?: unknown };
        kis = { configured: true, env: c.env, appKeyHint: `…${c.appKey.slice(-4)}`, lastTest: c.lastTest };
      }
    } catch (e) {
      kis = { error: (e as Error).message };
    }
    return {
      version: deps.version,
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      uptimeSec: Math.round(process.uptime()),
      secretKind: store.secretKind,
      kis,
      kisRuntime: hub.kis?.diagnostics(),
      sources: hub.statuses(),
      logFile: log.file,
      log: log.recent().slice(-200),
    };
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
