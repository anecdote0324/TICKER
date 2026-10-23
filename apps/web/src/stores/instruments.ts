// 종목 색인과 커맨드 라인 엔진. 목록은 네트워크를 기다리지 않고 메모리의 색인에서 바로 찾아요(05 §1.2).
// 색인의 무거운 부분(한글 자모·초성·자판 키)은 웹 워커에서 만들고, 화면 스레드는 압축 색인을 풀기만 해요(05 §14).

import { CommandEngine, SearchIndex, unpackRecords } from '@bt/command';
import { staticInstruments, type AssetClass, type Instrument, type InstrumentsResponse } from '@bt/shared';
import { api, token } from '../api';
import type { IndexWorkerReply } from '../workers/index-worker';
import { createStore, useStore } from './store';

export const index = new SearchIndex(staticInstruments());
export const engine = new CommandEngine(index);

export interface IndexState {
  loading: boolean;
  count: number;
  error?: string;
  sources: InstrumentsResponse['sources'];
  /** 색인 준비에 걸린 시간(ms): 워커에서 만든 시간, 화면 스레드에서 푼 시간 */
  timing?: { worker: number; main: number };
}

export const indexState = createStore<IndexState>({ loading: true, count: 0, sources: [] });

/** 분봉을 줄 수 있는 자산군(소스 능력, 05 §3.4) */
export const intraday = createStore<Record<AssetClass, boolean>>({ EQUITY: true, CRYPTO: true, CURNCY: false, INDEX: true });

/** 웹 워커로 목록을 받고 색인을 만들어요. 워커를 못 쓰면 undefined */
function loadViaWorker(): Promise<{ r: InstrumentsResponse; timing: IndexState['timing'] }> | undefined {
  if (typeof Worker === 'undefined') return undefined;
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/index-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return undefined;
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<IndexWorkerReply>) => {
      worker.terminate();
      const m = e.data;
      if (!m.ok) {
        reject(new Error(m.error));
        return;
      }
      const t0 = performance.now();
      const r = JSON.parse(m.text) as InstrumentsResponse;
      index.setRecords(unpackRecords(r.instruments, m.packed));
      resolve({ r, timing: { worker: Math.round(m.ms), main: Math.round(performance.now() - t0) } });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || '색인 워커 오류'));
    };
    worker.postMessage({ url: new URL('/api/instruments', location.href).href, token });
  });
}

export async function loadInstruments(retries = 20): Promise<void> {
  try {
    let viaWorker: Awaited<ReturnType<typeof loadViaWorker>> | undefined;
    try {
      viaWorker = await loadViaWorker();
    } catch (e) {
      // 서버가 아직 목록을 만드는 중이면 다시 시도하고, 워커 자체가 안 되면 화면 스레드에서 만들어요
      if (/HTTP 5\d\d|Failed to fetch|NetworkError/.test((e as Error).message)) throw e;
    }
    if (viaWorker) {
      const { r, timing } = viaWorker;
      indexState.set({ loading: false, count: r.instruments.length, sources: r.sources, timing });
      return;
    }
    const t0 = performance.now();
    const r = await api.get<InstrumentsResponse>('/api/instruments');
    index.setInstruments(r.instruments);
    indexState.set({ loading: false, count: r.instruments.length, sources: r.sources, timing: { worker: 0, main: Math.round(performance.now() - t0) } });
  } catch (e) {
    indexState.set((s) => ({ ...s, error: (e as Error).message }));
    if (retries > 0) setTimeout(() => void loadInstruments(retries - 1), 3000);
  }
}

export async function loadCapabilities() {
  try {
    const r = await api.get<{ intraday: Record<AssetClass, boolean> }>('/api/hello');
    intraday.set(r.intraday);
  } catch {
    // 기본값을 써요
  }
}

export function getInstrument(id: string | undefined): Instrument | undefined {
  return id ? index.get(id)?.inst : undefined;
}

export function supports(fnCode: string, inst: Instrument): boolean {
  if (fnCode === 'GIP') return intraday.get()[inst.assetClass];
  return true;
}

/** 색인이 늦게 도착해도 다시 그려지게, 색인 상태를 구독하면서 종목을 찾아요 */
export function useInstrument(id: string | undefined): Instrument | undefined {
  useStore(indexState, (s) => s.count);
  return getInstrument(id);
}
