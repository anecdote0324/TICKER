// 종목 색인과 커맨드 라인 엔진. 목록은 네트워크를 기다리지 않고 메모리의 색인에서 바로 찾아요(05 §1.2).

import { CommandEngine, SearchIndex } from '@bt/command';
import { staticInstruments, type AssetClass, type Instrument, type InstrumentsResponse } from '@bt/shared';
import { api } from '../api';
import { createStore, useStore } from './store';

export const index = new SearchIndex(staticInstruments());
export const engine = new CommandEngine(index);

export interface IndexState {
  loading: boolean;
  count: number;
  error?: string;
  sources: InstrumentsResponse['sources'];
}

export const indexState = createStore<IndexState>({ loading: true, count: 0, sources: [] });

/** 분봉을 줄 수 있는 자산군(소스 능력, 05 §3.4) */
export const intraday = createStore<Record<AssetClass, boolean>>({ EQUITY: true, CRYPTO: true, CURNCY: false, INDEX: true });

export async function loadInstruments(retries = 20): Promise<void> {
  try {
    const r = await api.get<InstrumentsResponse>('/api/instruments');
    index.setInstruments(r.instruments);
    indexState.set({ loading: false, count: r.instruments.length, sources: r.sources });
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
