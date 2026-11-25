// MON 트레이딩뷰 묶음(v0.6): 공유한 관심 목록 링크를 읽어 '트레이딩뷰' 묶음을 트레이딩뷰 목록과 같게 맞춰요.
// 앱을 켤 때마다(종목 목록을 다 받은 뒤), 링크를 넣을 때, ↻을 누를 때 맞춰요.

import { mapTvSymbols, normalizeTvWatchlistUrl, type TvWatchlistResponse } from '@bt/shared';
import { api } from '../api';
import { getInstrument, indexState } from './instruments';
import { appState, updateState, type WatchGroup } from './state';

export const TV_GROUP_ID = 'tv';

/** 종목 목록을 다 받을 때까지 기다려요(다시 시도하는 중이어도) */
export function whenInstrumentsReady(): Promise<void> {
  if (!indexState.get().loading) return Promise.resolve();
  return new Promise((res) => {
    const off = indexState.subscribe(() => {
      if (!indexState.get().loading) {
        off();
        res();
      }
    });
  });
}

let running: Promise<void> | null = null;

/** 트레이딩뷰 묶음 맞추기. 실패하면 종목은 그대로 두고 오류만 적어요 */
export function syncTradingView(): Promise<void> {
  const g = appState.get().watchlists.find((x) => x.id === TV_GROUP_ID);
  if (!g?.tvUrl) return Promise.resolve();
  if (running) return running;
  const url = g.tvUrl;
  running = (async () => {
    let patch: Partial<WatchGroup>;
    try {
      const r = await api.get<TvWatchlistResponse>(`/api/tradingview/watchlist?url=${encodeURIComponent(url)}`);
      if (r.error) patch = { syncError: r.error, syncedAt: Date.now() };
      else {
        const m = mapTvSymbols(r.symbols, (id) => !!getInstrument(id));
        patch = { ids: m.ids, unmatched: m.unmatched, tvName: r.name, syncError: undefined, syncedAt: Date.now() };
      }
    } catch (e) {
      patch = { syncError: (e as Error).message, syncedAt: Date.now() };
    }
    updateState('watchlists', (ws) => ws.map((x) => (x.id === TV_GROUP_ID && x.tvUrl === url ? { ...x, ...patch } : x)));
  })().finally(() => (running = null));
  return running;
}

/** 링크 넣기(묶음이 없으면 만들어요). 틀린 링크면 이유를 돌려줘요 */
export function setTradingViewUrl(raw: string): string | undefined {
  const url = normalizeTvWatchlistUrl(raw);
  if (!url) return '트레이딩뷰 관심 목록 공유 링크(https://www.tradingview.com/watchlists/번호/)를 넣어 주세요';
  updateState('watchlists', (ws) =>
    ws.some((x) => x.id === TV_GROUP_ID)
      ? ws.map((x) => (x.id === TV_GROUP_ID ? { ...x, tvUrl: url, syncError: undefined } : x))
      : [...ws, { id: TV_GROUP_ID, name: '트레이딩뷰', ids: [], tvUrl: url }],
  );
  void syncTradingView();
  return undefined;
}

/** 연결 끊기: 트레이딩뷰 묶음을 지워요 */
export function removeTradingView() {
  updateState('watchlists', (ws) => ws.filter((x) => x.id !== TV_GROUP_ID));
}
