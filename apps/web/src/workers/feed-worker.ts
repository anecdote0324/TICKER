// 시세 연결을 화면과 다른 스레드에서 받아요(01 성능 원칙, 05 §14.1). WebSocket 연결·다시 연결, JSON 해석,
// 같은 종목의 시세를 한 번에 묶는 일을 여기서 하고, 화면 스레드에는 묶은 결과만 넘겨요.
// 시세가 몰려도 화면 스레드는 타자와 그리기에 쓸 수 있어요.

/// <reference lib="webworker" />

import type { Quote, ServerMessage } from '@bt/shared';

export type FeedWorkerIn = { type: 'connect'; url: string } | { type: 'send'; msg: object };
export type FeedWorkerOut =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'quotes'; quotes: Quote[] }
  | { type: 'message'; msg: ServerMessage }
  | { type: 'stats'; parsedMs: number; messages: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FeedWorkerOut) => scope.postMessage(m);

let url = '';
let ws: WebSocket | null = null;
let backoff = 500;
const outbox: string[] = [];

// 같은 종목은 마지막 값만 남겨 16ms마다 넘겨요(화면 한 프레임)
const pending = new Map<string, Quote>();
let timer: ReturnType<typeof setTimeout> | null = null;
let parsedMs = 0;
let messages = 0;

function flush() {
  timer = null;
  if (pending.size === 0) return;
  const quotes = [...pending.values()];
  pending.clear();
  post({ type: 'quotes', quotes });
}

function connect() {
  if (ws || !url) return;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    backoff = 500;
    post({ type: 'open' });
    for (const m of outbox.splice(0)) sock.send(m);
  };
  sock.onmessage = (ev) => {
    const t0 = performance.now();
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'quotes') {
      for (const q of msg.quotes) pending.set(q.id, q);
      timer ??= setTimeout(flush, 16);
    } else {
      // 상태·인사 같은 드문 메시지는 시세보다 앞서지 않게 남은 시세를 먼저 보내요
      flush();
      post({ type: 'message', msg });
    }
    parsedMs += performance.now() - t0;
    messages++;
  };
  sock.onclose = () => {
    ws = null;
    post({ type: 'close' });
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  };
}

// 해석에 쓴 시간을 5초마다 알려요(설정 → 정보의 성능)
setInterval(() => {
  if (messages === 0) return;
  post({ type: 'stats', parsedMs, messages });
  parsedMs = 0;
  messages = 0;
}, 5000);

scope.onmessage = (e: MessageEvent<FeedWorkerIn>) => {
  const m = e.data;
  if (m.type === 'connect') {
    url = m.url;
    connect();
  } else if (m.type === 'send') {
    const text = JSON.stringify(m.msg);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
    else if (outbox.length < 100) outbox.push(text);
  }
};
