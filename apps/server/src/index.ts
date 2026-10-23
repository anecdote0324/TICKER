// 내장 서버 시작점. Electron 메인 프로세스와 개발용 실행 스크립트가 함께 써요.

import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstrumentsResponse } from '@bt/shared';
import { BinanceAdapter } from './adapters/binance';
import { DemoAdapter } from './adapters/demo';
import { EcbAdapter } from './adapters/ecb';
import { KisAdapter, type KisCredentials, type KisTokenStore } from './adapters/kis';
import { buildApp } from './app';
import { History } from './history';
import { Hub } from './hub';
import { buildInstruments } from './instruments';
import { fileSecretBox, Store, type SecretBox } from './store';
import { consoleLogger } from './util';

export interface ServerOptions {
  dataDir: string;
  /** 0이면 빈 포트를 골라요 */
  port?: number;
  token?: string;
  /** 배포판 화면 파일 폴더 */
  webDir?: string;
  /** 개발 서버(Vite)처럼 추가로 허용할 Origin */
  devOrigins?: string[];
  secretBox?: SecretBox;
  version?: string;
  quiet?: boolean;
}

export interface RunningServer {
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = consoleLogger('server', opts.quiet);
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

  const tokenStore: KisTokenStore = {
    async load() {
      const raw = await store.getSecret('kisToken');
      return raw ? (JSON.parse(raw) as { token: string; expiresAt: number }) : undefined;
    },
    async save(t) {
      await store.setSecret('kisToken', JSON.stringify(t));
    },
  };
  const makeKis = (cred: KisCredentials) => new KisAdapter(hub, cred, tokenStore);

  // 종목 색인은 마스터를 받는 동안 기다리지 않고 시작해요. 목록 요청만 기다려요
  let instruments: Promise<InstrumentsResponse> = buildInstruments(opts.dataDir, hub.binance, log).then((r) => {
    hub.setInstruments(r.instruments);
    return r;
  });
  // 하루에 한 번 다시 만들어요
  const rebuild = setInterval(() => {
    instruments = buildInstruments(opts.dataDir, hub.binance, log).then((r) => {
      hub.setInstruments(r.instruments);
      return r;
    });
  }, 12 * 3600_000);

  await Promise.all([hub.binance.start(), hub.demo.start()]);
  void hub.ecb.start();

  const kisRaw = await store.getSecret('kis');
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
    webDir: opts.webDir,
    devOrigins: opts.devOrigins,
    version: opts.version ?? '0.1.0-dev',
    makeKis,
  });
  await app.listen({ host: '127.0.0.1', port });
  const addr = app.server.address();
  if (addr && typeof addr === 'object') port = addr.port;
  log.info(`내장 서버 시작: http://127.0.0.1:${port}`);

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    async close() {
      clearInterval(rebuild);
      hub.binance.stop();
      hub.ecb.stop();
      hub.demo.stop();
      hub.kis?.stop();
      await app.close();
      // 실시간 구독을 끊은 뒤 남은 분봉을 저장해요(01 종료할 때)
      hub.history?.close();
    },
  };
}

export { fileSecretBox, type SecretBox } from './store';
