// 내장 서버 시작점. Electron 메인 프로세스와 개발용 실행 스크립트가 함께 써요.

import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstrumentsResponse } from '@bt/shared';
import { BinanceAdapter } from './adapters/binance';
import { DemoAdapter } from './adapters/demo';
import { EcbAdapter } from './adapters/ecb';
import { KisAdapter, type KisCredentials, type KisEndpoints, type KisTokenStore, type SavedKisToken } from './adapters/kis';
import { buildApp } from './app';
import { History } from './history';
import { NewsService } from './news';
import { NoteStore } from './notes';
import { CalendarService } from './calendar';
import { FxService } from './fx';
import { MoneyService } from './money';
import { UsActivity } from './us-activity';
import { Hub } from './hub';
import { buildInstruments } from './instruments';
import { EXTRA_KEY_NAMES, tailHint, type ExtraKeys } from './extra-keys';
import { RatesService } from './rates';
import { UsMapService } from './us-map';
import { FinancialsService, secContactError } from './financials';
import { DartCorpService } from './dart-corp';
import { MarketService } from './market';
import { EcoService } from './eco';
import { fileSecretBox, Store, type SecretBox } from './store';
import { recordingLogger, withTimeout, type RecordingLogger } from './util';

export interface ServerOptions {
  dataDir: string;
  /** 0이면 빈 포트를 골라요 */
  port?: number;
  token?: string;
  /** 배포판 화면 파일 폴더 */
  webDir?: string;
  /** 설치 파일에 넣은 종목 목록 사본(05 §6.1) */
  snapshotFile?: string;
  /** 개발 서버(Vite)처럼 추가로 허용할 Origin */
  devOrigins?: string[];
  secretBox?: SecretBox;
  version?: string;
  quiet?: boolean;
  /** 서버 기록 파일(데스크톱 앱은 데이터 폴더의 logs/server.log). 없으면 메모리에만 */
  logFile?: string;
  /** 시험용 가짜 한국투자증권 서버 주소(개발 실행의 BT_KIS_REST·BT_KIS_WS) */
  kisEndpoints?: KisEndpoints;
}

export interface RunningServer {
  port: number;
  token: string;
  url: string;
  log: RecordingLogger;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = recordingLogger('server', { quiet: opts.quiet, file: opts.logFile });
  log.info(`서버 시작 · 버전 ${opts.version ?? '개발'} · ${process.platform} · Node ${process.versions.node}`);
  await mkdir(opts.dataDir, { recursive: true });
  const store = new Store(opts.dataDir, opts.secretBox ?? (await fileSecretBox(opts.dataDir)));
  await store.load();

  const hub = new Hub(log);
  try {
    hub.history = new History(join(opts.dataDir, 'history.db'));
  } catch (e) {
    log.warn(`분봉·이력 저장을 쓸 수 없어요: ${(e as Error).message}`);
  }
  hub.binance = new BinanceAdapter(hub);
  hub.ecb = new EcbAdapter(hub);
  hub.demo = new DemoAdapter(hub);
  // 미국 종목 인기도 보강(v0.2): 앱에서 본 거래대금
  const usActivity = new UsActivity(opts.dataDir);
  await usActivity.load();
  hub.usActivity = usActivity;
  // IMAP 미국 지수(v0.3): ETF 보유 종목 파일과 해외 업종 분류
  hub.usMap = new UsMapService(opts.dataDir, log);
  // N 뉴스·공시: RSS·DART를 받아 뉴스 아카이브(news.db)에 쌓아요(03 v0.2)
  const news = new NewsService(opts.dataDir, log, join(opts.dataDir, 'news.db'));
  news.start();
  hub.news = news;
  void withTimeout(store.getSecret('dart'), 15_000, '보안 저장소가 15초 동안 응답하지 않았어요')
    .then((raw) => raw && news.setDartKey((JSON.parse(raw) as { key: string }).key))
    .catch((e: Error) => log.warn(`저장된 DART 인증키를 읽지 못했어요: ${e.message}`));

  // v0.3: GC 금리 커브(미국채 XML, 국고채 ECOS)와 v0.3 키
  const rates = new RatesService(opts.dataDir, log);
  const financials = new FinancialsService(news, log);
  // v0.4 DART 종목 정보(MGMT·RELS·HDS·OWN·ERN·CF)
  const dartCorp = new DartCorpService(
    news,
    () => hub.instruments,
    async (id) => (await hub.bars(id, '1d')).bars,
    (inst) => financials.get(inst, 'quarter'),
  );
  // v0.5 NOTE 메모(notes.db)
  const notes = new NoteStore(join(opts.dataDir, 'notes.db'), log);
  // v0.4 지수·ETF·호가(MEMB·MOV·ETF·FFLO·BQ)
  // v0.6 공용 영업일 달력: 한국 휴장일은 한국투자증권에서 하루 한 번(holidays-kr.json)
  const calendar = new CalendarService(opts.dataDir, () => hub.kis, log);
  void calendar.start();
  const market = new MarketService(
    opts.dataDir,
    () => hub.kis,
    () => hub.instruments,
    (index) => hub.sectorMap(index),
  );
  const eco = new EcoService(log, () => rates.ecosKeyValue);
  // v0.6 외환: FIXI 고시환율·FRD 단기 금리(FRED 키·ECOS 인증키를 같이 써요)
  const fx = new FxService(log, () => rates.ecosKeyValue);
  // v0.6 금리 시계열(BTMM·OIS·FICM)·국가부채(SOVM)
  const money = new MoneyService(opts.dataDir, log, () => rates.ecosKeyValue);
  // FRED 크레딧 스프레드는 최근 3년만 줘서 지금부터 쌓아요(03 v0.3)
  eco.startSpreadArchive(hub.history);
  const extraKeys: ExtraKeys = {
    ecos: {
      label: 'BOK ECOS 인증키',
      validate: (k) => (/^[0-9A-Za-z]{10,40}$/.test(k) ? undefined : 'ECOS 인증키는 영문·숫자 10~40자예요'),
      test: (k) => rates.testEcos(k),
      apply: (k) => {
        rates.setEcosKey(k);
        money.clear();
      },
      hint: tailHint,
    },
    fred: {
      label: 'FRED API 키',
      validate: (k) => (/^[0-9a-z]{32}$/.test(k) ? undefined : 'FRED API 키는 영문 소문자·숫자 32자예요'),
      test: (k) => eco.testFred(k),
      apply: (k) => {
        eco.setFredKey(k);
        fx.setFredKey(k);
        money.setFredKey(k);
      },
      hint: tailHint,
    },
    sec: {
      label: 'SEC EDGAR 연락처',
      // SEC는 이름과 이메일 같은 연락처를 요청마다 달라고 해요(fair access)
      validate: secContactError,
      test: (k) => financials.testSec(k),
      apply: (k) => financials.setSecContact(k),
      // 연락처는 앞부분만 보여 줘요
      hint: (k) => `${k.slice(0, 3)}…`,
    },
    krx: {
      label: 'KRX Open API 인증키',
      validate: (k) => (/^[0-9A-Za-z_-]{10,100}$/.test(k) ? undefined : 'KRX 인증키는 영문·숫자 10~100자예요'),
      test: (k) => market.testKrx(k),
      apply: (k) => market.setKrxKey(k),
      hint: tailHint,
    },
  };
  for (const name of EXTRA_KEY_NAMES) {
    const def = extraKeys[name];
    if (!def) continue;
    void withTimeout(store.getSecret(name), 15_000, '보안 저장소가 15초 동안 응답하지 않았어요')
      .then((raw) => raw && def.apply((JSON.parse(raw) as { key: string }).key))
      .catch((e: Error) => log.warn(`저장된 ${def.label}을(를) 읽지 못했어요: ${e.message}`));
  }

  const tokenStore: KisTokenStore = {
    async load() {
      const raw = await store.getSecret('kisToken');
      return raw ? (JSON.parse(raw) as SavedKisToken) : undefined;
    },
    async save(t) {
      await store.setSecret('kisToken', JSON.stringify(t));
    },
  };
  const makeKis = (cred: KisCredentials) => new KisAdapter(hub, cred, tokenStore, opts.kisEndpoints);

  // 종목 색인은 마스터를 받는 동안 기다리지 않고 시작해요. 목록 요청만 기다려요
  let instruments: Promise<InstrumentsResponse> = buildInstruments(opts.dataDir, hub.binance, log, opts.snapshotFile, usActivity.scores()).then((r) => {
    hub.setInstruments(r.instruments);
    return r;
  });
  // 하루에 한 번 다시 만들어요
  const rebuild = setInterval(() => {
    instruments = buildInstruments(opts.dataDir, hub.binance, log, opts.snapshotFile, usActivity.scores()).then((r) => {
      hub.setInstruments(r.instruments);
      return r;
    });
  }, 12 * 3600_000);

  // 서버(앱의 메인 프로세스)가 오래 멈추면 기록해요. 멈춘 동안에는 시세도 API 응답도 나가지 않아요
  let lastBeat = Date.now();
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - lastBeat - 1000;
    if (lag > 2000) log.warn(`서버가 ${(lag / 1000).toFixed(1)}초 동안 멈춰 있었어요`);
    lastBeat = now;
  }, 1000);
  lagTimer.unref?.();
  // 화면이 서버가 살아 있는지 알 수 있게 상태를 5초마다 보내요(시세가 없을 때도). 오래 안 오면 화면이 ⚠로 바꿔요
  const heartbeat = setInterval(() => hub.emitStatus(), 5000);
  heartbeat.unref?.();

  await Promise.all([hub.binance.start(), hub.demo.start()]);
  void hub.ecb.start();

  // 저장된 키를 못 읽어도(보안 저장소가 답하지 않음) 앱은 데모 시세로 켜져요
  const kisRaw = await withTimeout(store.getSecret('kis'), 15_000, '보안 저장소가 15초 동안 응답하지 않았어요').catch((e: Error) => {
    log.error(`저장된 한국투자증권 키를 읽지 못했어요: ${e.message}`);
    return undefined;
  });
  if (kisRaw) {
    const cred = JSON.parse(kisRaw) as KisCredentials;
    await instruments.catch(() => undefined);
    void hub.setKis(makeKis(cred));
  }

  const token = opts.token ?? randomBytes(24).toString('base64url');
  let port = opts.port ?? 0;
  const app = await buildApp({
    hub,
    store,
    token,
    port: () => port,
    instruments: () => instruments,
    log,
    webDir: opts.webDir,
    devOrigins: opts.devOrigins,
    version: opts.version ?? '0.1.0-dev',
    makeKis,
    news,
    rates,
    financials,
    dartCorp,
    market,
    eco,
    extraKeys,
    notes,
    calendar,
    fx,
    money,
  });
  await app.listen({ host: '127.0.0.1', port });
  const addr = app.server.address();
  if (addr && typeof addr === 'object') port = addr.port;
  log.info(`내장 서버 시작: http://127.0.0.1:${port}`);

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    log,
    async close() {
      clearInterval(rebuild);
      clearInterval(lagTimer);
      clearInterval(heartbeat);
      hub.binance.stop();
      hub.ecb.stop();
      hub.demo.stop();
      hub.kis?.stop();
      news.stop();
      notes.close();
      calendar.stop();
      await usActivity.flush();
      await app.close();
      // 실시간 구독을 끊은 뒤 남은 분봉을 저장해요(01 종료할 때)
      hub.history?.close();
    },
  };
}

export { fileSecretBox, type SecretBox } from './store';
