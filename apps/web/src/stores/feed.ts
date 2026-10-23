// 시세 연결: 서버와 WebSocket 하나만 두고 모든 패널(떼어낸 창 포함)이 나눠 받아요.
// 화면에 보이는 종목만 구독하고, 어떤 패널에도 안 보이면 해제해요.
// 갱신은 화면 주사율에 맞춰 묶어서 알려요(01 성능 원칙).

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Quote, ServerMessage, SourceStatus } from '@bt/shared';
import { wsUrl } from '../api';
import { createStore } from './store';

const quotes = new Map<string, Quote>();
const listeners = new Map<string, Set<() => void>>();
const refs = new Map<string, number>();
const dirty = new Set<string>();
let frame = 0;

export interface FeedStatus {
  connected: boolean;
  demo: boolean;
  sources: SourceStatus[];
}

export const feedStatus = createStore<FeedStatus>({ connected: false, demo: true, sources: [] });

let ws: WebSocket | null = null;
let backoff = 500;
let pendingSub = new Set<string>();
let pendingUnsub = new Set<string>();
let sendTimer = 0;

function send(msg: object) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function flushSubs() {
  sendTimer = 0;
  if (pendingSub.size) send({ type: 'subscribe', ids: [...pendingSub] });
  if (pendingUnsub.size) send({ type: 'unsubscribe', ids: [...pendingUnsub] });
  pendingSub = new Set();
  pendingUnsub = new Set();
}

function scheduleSubs() {
  if (!sendTimer) sendTimer = window.setTimeout(flushSubs, 30);
}

function notify() {
  frame = 0;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) listeners.get(id)?.forEach((f) => f());
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'hello':
      feedStatus.set((s) => ({ ...s, demo: msg.demo }));
      break;
    case 'quotes':
      for (const q of msg.quotes) {
        quotes.set(q.id, q);
        dirty.add(q.id);
      }
      if (!frame) frame = requestAnimationFrame(notify);
      break;
    case 'status':
      feedStatus.set((s) => ({ ...s, sources: msg.sources, demo: !msg.sources.some((x) => x.source === 'KIS') }));
      break;
    default:
      break;
  }
}

export function connectFeed() {
  if (ws) return;
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => {
    backoff = 500;
    feedStatus.set((s) => ({ ...s, connected: true }));
    // 다시 연결되면 지금 보고 있는 종목을 모두 다시 구독해요
    pendingSub = new Set(refs.keys());
    pendingUnsub.clear();
    flushSubs();
  };
  sock.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    } catch {
      // 무시
    }
  };
  sock.onclose = () => {
    ws = null;
    feedStatus.set((s) => ({ ...s, connected: false }));
    window.setTimeout(connectFeed, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  };
}

function retain(id: string) {
  const n = (refs.get(id) ?? 0) + 1;
  refs.set(id, n);
  if (n === 1) {
    pendingUnsub.delete(id);
    pendingSub.add(id);
    scheduleSubs();
  }
}

function release(id: string) {
  const n = (refs.get(id) ?? 1) - 1;
  if (n <= 0) {
    refs.delete(id);
    pendingSub.delete(id);
    pendingUnsub.add(id);
    scheduleSubs();
  } else refs.set(id, n);
}

function listen(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** 지금 구독 중인지(실시간 슬롯 확인용, 08 §4.1) */
export function isSubscribed(id: string): boolean {
  return refs.has(id);
}

export function subscribedIds(): string[] {
  return [...refs.keys()];
}

export function getQuote(id: string): Quote | undefined {
  return quotes.get(id);
}

/** 종목 하나의 시세. 쓰는 동안 구독해요 */
export function useQuote(id: string | undefined): Quote | undefined {
  useEffect(() => {
    if (!id) return;
    retain(id);
    return () => release(id);
  }, [id]);
  return useSyncExternalStore(
    (fn) => (id ? listen(id, fn) : () => undefined),
    () => (id ? quotes.get(id) : undefined),
  );
}

/** 여러 종목 시세(목록 화면용). 하나라도 바뀌면 다시 그려요 */
export function useQuotes(ids: string[]): Map<string, Quote> {
  const key = ids.join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    list.forEach(retain);
    return () => list.forEach(release);
  }, [key]);
  const store = useMemo(() => {
    let version = 0;
    const list = key ? key.split(',') : [];
    return {
      subscribe(fn: () => void) {
        const offs = list.map((id) =>
          listen(id, () => {
            version++;
            fn();
          }),
        );
        return () => offs.forEach((o) => o());
      },
      getVersion: () => version,
    };
  }, [key]);
  useSyncExternalStore(store.subscribe, store.getVersion);
  const out = new Map<string, Quote>();
  for (const id of ids) {
    const q = quotes.get(id);
    if (q) out.set(id, q);
  }
  return out;
}
