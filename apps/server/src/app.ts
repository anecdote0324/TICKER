// 내장 서버의 HTTP·WebSocket 경로와 보안(01 보안).
// - 이 PC 안(127.0.0.1)에서만 열어요.
// - 실행할 때마다 새로 만드는 토큰을 요청마다 확인해요.
// - Host·Origin 헤더를 엄격하게 검사하고, 다른 사이트의 접근(CORS)을 허용하지 않아요.
import type { ExtraKeyName } from '@bt/shared';
import { EXTRA_KEY_NAMES, tailHint, type ExtraKeys } from './extra-keys';
import type { RatesService } from './rates';
import type { FinancialsService } from './financials';
import type { EcoService } from './eco';
import type { DartCorpService } from './dart-corp';

import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { isUsMapIndex, type BarInterval, type ClientMessage, type FlowKind, type CredentialStatus, type InstrumentsResponse, type MapIndex, type MostKind, type SectorIndex, type ServerMessage, type Settings } from '@bt/shared';
import { KisAdapter, type KisCredentials } from './adapters/kis';
import type { Hub } from './hub';
import type { NewsService } from './news';
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
  news?: NewsService;
  /** GC 금리 커브(v0.3) */
  rates?: RatesService;
  /** FA 재무제표(v0.3) */
  financials?: FinancialsService;
  /** ECO 경제 캘린더(v0.3) */
  eco?: EcoService;
  /** v0.4 DART 종목 정보(MGMT·RELS·HDS·OWN·ERN·CF) */
  dartCorp?: DartCorpService;
  /** v0.3 키(ECOS·FRED·SEC 연락처) */
  extraKeys?: ExtraKeys;
}

/** 키를 암호화하거나 푸는 데 이보다 오래 걸리면 보안 저장소가 응답하지 않는 걸로 봐요 */
const SECRET_TIMEOUT_MS = 15_000;
const SECRET_TIMEOUT_MSG = 'PC의 보안 저장소(Windows 데이터 보호·Mac 키체인)가 15초 동안 응답하지 않아요';

const BAR_INTERVALS = new Set<BarInterval>(['1m', '5m', '1h', '2h', '4h', '1d', '1w', '1M']);

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

  app.get<{ Querystring: { id?: string; interval?: string; before?: string } }>('/api/bars', async (req, reply) => {
    const { id, interval } = req.query;
    if (!id || !interval || !BAR_INTERVALS.has(interval as BarInterval)) return reply.code(400).send({ error: 'id와 interval이 필요해요' });
    // before(초): 그보다 오래된 봉 한 묶음(차트를 왼쪽 끝으로 끌 때)
    const before = req.query.before !== undefined ? Number(req.query.before) : undefined;
    if (before !== undefined && !(Number.isInteger(before) && before > 0)) return reply.code(400).send({ error: 'before는 초 단위 시각이에요' });
    try {
      if (before !== undefined) return await hub.olderBars(id, interval as BarInterval, before);
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

  app.get<{ Querystring: { id?: string } }>('/api/profile', async (req, reply) => {
    const id = req.query.id ?? '';
    if (!hub.instruments.has(id)) return reply.code(404).send({ error: '종목을 찾지 못했어요' });
    try {
      return await hub.profile(id);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // v0.4 수급(KINV·KPGM·KCRD·SI)과 KWRN 시장경보·VI
  app.get<{ Querystring: { id?: string; kind?: string } }>('/api/flows', async (req, reply) => {
    const id = req.query.id ?? '';
    const kind = req.query.kind ?? '';
    if (!hub.instruments.has(id)) return reply.code(404).send({ error: '종목을 찾지 못했어요' });
    if (!['investor', 'program', 'credit', 'loan', 'short'].includes(kind)) return reply.code(400).send({ error: '종류가 맞지 않아요' });
    try {
      return await hub.flows(id, kind as FlowKind);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  // v0.4 실적·기업행위: EE·ANR·DVD(종목), CACS·EVTS(종목 또는 시장), IPO(시장)
  const corp = async <T>(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, run: () => Promise<T>) => {
    try {
      return await run();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  };
  app.get<{ Querystring: { id?: string } }>('/api/estimate', (req, reply) => corp(reply, () => hub.corp.estimate(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string } }>('/api/opinions', (req, reply) => corp(reply, () => hub.corp.opinions(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string } }>('/api/dividends', (req, reply) => corp(reply, () => hub.corp.dividends(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string; view?: string } }>('/api/corp-events', (req, reply) =>
    corp(reply, () =>
      hub.corp.events(
        req.query.id || undefined,
        req.query.view === 'actions' ? ['paidin', 'bonus', 'capdcrs', 'merger', 'revsplit', 'deposit'] : ['meeting', 'ipo', 'dividend', 'paidin', 'bonus', 'deposit'],
      ),
    ),
  );
  app.get('/api/ipo', (_req, reply) => corp(reply, () => hub.corp.ipo()));
  // v0.4 DART 종목 정보
  const dart = () => {
    if (!deps.dartCorp) throw new Error('DART 기능을 쓸 수 없어요');
    return deps.dartCorp;
  };
  app.get<{ Querystring: { id?: string } }>('/api/mgmt', (req, reply) => corp(reply, () => dart().mgmt(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string } }>('/api/rels', (req, reply) => corp(reply, () => dart().rels(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string } }>('/api/holders', (req, reply) => corp(reply, () => dart().holders(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string } }>('/api/earnings', (req, reply) => corp(reply, () => dart().earnings(req.query.id ?? '')));
  app.get<{ Querystring: { id?: string; type?: string } }>('/api/disclosures', (req, reply) =>
    corp(reply, () => dart().disclosures(req.query.id || undefined, /^[A-J]?$/.test(req.query.type ?? '') ? (req.query.type ?? '') : '')),
  );
  app.get<{ Querystring: { id?: string } }>('/api/warnings', async (req) => hub.warnings(req.query.id || undefined));

  app.get<{ Querystring: { market?: string; kind?: string } }>('/api/most', async (req, reply) => {
    const market = req.query.market ?? 'KS';
    const kind = req.query.kind ?? 'volume';
    if (!['KS', 'KQ', 'US', 'CRYPTO'].includes(market) || !['volume', 'turnover', 'gainers', 'losers'].includes(kind)) return reply.code(400).send({ error: '시장 또는 종류가 맞지 않아요' });
    try {
      return await hub.most(market as 'KS' | 'KQ' | 'US' | 'CRYPTO', kind as MostKind);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // HMAP·IMAP 업종(03 v0.2)
  const sectorIndex = (v?: string): SectorIndex => (v === 'KOSDAQ' || v === 'KOSPI2' ? v : 'KOSPI');
  // IMAP은 미국 지수(SPX·NDX)도 받아요(v0.3). HMAP 기간별 등락은 국내 지수만
  const mapIndex = (v?: string): MapIndex => (v && isUsMapIndex(v) ? v : sectorIndex(v));
  app.get<{ Querystring: { index?: string } }>('/api/sectors', async (req, reply) => {
    try {
      return await hub.sectorMap(mapIndex(req.query.index));
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  app.get<{ Querystring: { index?: string } }>('/api/sectors/history', async (req) => hub.sectorHistory(sectorIndex(req.query.index)));

  app.get<{ Querystring: { id?: string } }>('/api/quote', async (req, reply) => {
    const id = req.query.id ?? '';
    if (!hub.instruments.has(id)) return reply.code(404).send({ error: '종목을 찾지 못했어요' });
    try {
      const q = await hub.snapshotQuote(id);
      return q ?? reply.code(404).send({ error: '시세가 없어요' });
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
    const dartRaw = await readSecret('dart');
    const d = dartRaw ? (JSON.parse(dartRaw) as { key: string; lastTest?: { ok: boolean; message: string; at: number } }) : undefined;
    const dart: CredentialStatus['dart'] = d ? { configured: true, keyHint: `…${d.key.slice(-4)}`, lastTest: d.lastTest } : { configured: false };
    // v0.3 키: 끝 4자리(연락처는 앞부분)만
    const extra: Partial<CredentialStatus> = {};
    for (const name of EXTRA_KEY_NAMES) {
      const r = await readSecret(name);
      const v = r ? (JSON.parse(r) as { key: string; lastTest?: { ok: boolean; message: string; at: number } }) : undefined;
      extra[name] = v ? { configured: true, keyHint: deps.extraKeys?.[name]?.hint(v.key) ?? tailHint(v.key), lastTest: v.lastTest } : { configured: false };
    }
    if (!raw) return { kis: { configured: false, env: 'real' }, dart, ...extra, secretKind: store.secretKind };
    const c = JSON.parse(raw) as KisCredentials & { lastTest?: CredentialStatus['kis']['lastTest'] };
    return {
      kis: { configured: true, appKeyHint: `…${c.appKey.slice(-4)}`, env: c.env, lastTest: c.lastTest },
      dart,
      ...extra,
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
    // 같은 키를 다시 저장하면 지금 연결로 테스트만 해요(새 연결을 겹쳐 만들지 않아요)
    const current = hub.kis?.sameCredentials(cred) ? hub.kis : undefined;
    const kis = current ?? deps.makeKis(cred);
    const test = await kis.test();
    log.info(`한국투자증권 연결 테스트 ${test.ok ? '성공' : '실패'}(${Date.now() - t0}ms${current ? ', 지금 연결' : ''}): ${test.message}`);
    try {
      await saveSecret('kis', JSON.stringify({ ...cred, lastTest: { ...test, at: Date.now() } }));
    } catch (e) {
      log.error(`키 저장 실패: ${(e as Error).message}`);
      return reply.code(500).send({ error: `키를 저장하지 못했어요: ${(e as Error).message}` });
    }
    if (test.ok) await switchToKis(kis);
    else if (!current) kis.stop();
    return { test, status: await credentialStatus().catch(() => ({ kis: { configured: true, env: cred.env }, secretKind: store.secretKind })) };
  });

  // ── DART 인증키(N 뉴스·공시) ── 기록에는 끝 4자리만 남겨요
  app.put<{ Body: { key?: string } }>('/api/credentials/dart', async (req, reply) => {
    const key = (req.body?.key ?? '').trim();
    if (!/^[0-9A-Za-z]{40}$/.test(key)) return reply.code(400).send({ error: 'DART 인증키는 40자리 영문·숫자예요' });
    if (!deps.news) return reply.code(409).send({ error: '뉴스 기능을 쓸 수 없어요' });
    const test = await deps.news.testDart(key);
    log.info(`DART 인증키 확인 ${test.ok ? '성공' : '실패'}(…${key.slice(-4)}): ${test.message}`);
    try {
      await saveSecret('dart', JSON.stringify({ key, lastTest: { ...test, at: Date.now() } }));
    } catch (e) {
      return reply.code(500).send({ error: `인증키를 저장하지 못했어요: ${(e as Error).message}` });
    }
    if (test.ok) deps.news.setDartKey(key);
    return { test, status: await credentialStatus() };
  });

  app.delete('/api/credentials/dart', async () => {
    await saveSecret('dart', undefined);
    deps.news?.setDartKey(undefined);
    log.info('DART 인증키를 지웠어요');
    return { ok: true };
  });

  // ── v0.3 키(ECOS·FRED·SEC 연락처) ── 기록에는 힌트만 남겨요
  app.put<{ Params: { name: string }; Body: { key?: string } }>('/api/credentials/:name', async (req, reply) => {
    const name = req.params.name as ExtraKeyName;
    const def = EXTRA_KEY_NAMES.includes(name) ? deps.extraKeys?.[name] : undefined;
    if (!def) return reply.code(404).send({ error: '없는 키예요' });
    const key = (req.body?.key ?? '').trim();
    const bad = def.validate(key);
    if (bad) return reply.code(400).send({ error: bad });
    const test = await def.test(key);
    log.info(`${def.label} 확인 ${test.ok ? '성공' : '실패'}(${def.hint(key)}): ${test.message}`);
    try {
      await saveSecret(name, JSON.stringify({ key, lastTest: { ...test, at: Date.now() } }));
    } catch (e) {
      return reply.code(500).send({ error: `저장하지 못했어요: ${(e as Error).message}` });
    }
    if (test.ok) def.apply(key);
    return { test, status: await credentialStatus() };
  });
  app.delete<{ Params: { name: string } }>('/api/credentials/:name', async (req, reply) => {
    const name = req.params.name as ExtraKeyName;
    const def = EXTRA_KEY_NAMES.includes(name) ? deps.extraKeys?.[name] : undefined;
    if (!def) return reply.code(404).send({ error: '없는 키예요' });
    await saveSecret(name, undefined);
    def.apply(undefined);
    log.info(`${def.label}을(를) 지웠어요`);
    return { ok: true };
  });

  // ── FA 재무제표(v0.3) ──
  app.get<{ Querystring: { id?: string; period?: string } }>('/api/financials', async (req, reply) => {
    if (!deps.financials) return reply.code(409).send({ error: '재무제표를 쓸 수 없어요' });
    const inst = req.query.id ? hub.instruments.get(req.query.id) : undefined;
    if (!inst) return reply.code(404).send({ error: '종목을 찾을 수 없어요' });
    if (inst.assetClass !== 'EQUITY') return reply.code(400).send({ error: '재무제표는 주식만 볼 수 있어요' });
    try {
      return await deps.financials.get(inst, req.query.period === 'quarter' ? 'quarter' : 'annual');
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ── ECO 경제 캘린더(v0.3) ──
  app.get('/api/eco', async (_req, reply) => {
    if (!deps.eco) return reply.code(409).send({ error: '경제 캘린더를 쓸 수 없어요' });
    try {
      return await deps.eco.get();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ── GC 금리 커브(v0.3) ──
  app.get('/api/curves', async (_req, reply) => {
    if (!deps.rates) return reply.code(409).send({ error: '금리 커브를 쓸 수 없어요' });
    try {
      return await deps.rates.curves();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ── N 뉴스·공시 ──
  app.get<{ Querystring: { id?: string; kind?: string; limit?: string } }>('/api/news', async (req, reply) => {
    if (!deps.news) return reply.code(409).send({ error: '뉴스 기능을 쓸 수 없어요' });
    const kind = req.query.kind === 'news' || req.query.kind === 'disclosure' ? req.query.kind : 'all';
    const inst = req.query.id ? hub.instruments.get(req.query.id) : undefined;
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 150));
    return deps.news.list(inst, kind, limit);
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
