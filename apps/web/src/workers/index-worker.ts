// 종목 색인을 화면과 다른 스레드에서 만들어요(05 §6.1, §14.1). 한글 자모·초성·자판 키를 만드는 일이 무거워서,
// 화면 스레드는 목록을 받는 동안에도 타자를 받을 수 있게 해요.
// 종목 목록은 이 스레드에서 받아서, 원문(JSON 문자열)과 압축 색인만 화면 스레드로 넘겨요.

/// <reference lib="webworker" />

import { packRecords, type PackedRecords } from '@bt/command';
import type { InstrumentsResponse } from '@bt/shared';

export type IndexWorkerRequest = { url: string; token: string };
export type IndexWorkerReply = { ok: true; text: string; packed: PackedRecords; ms: number } | { ok: false; error: string; status?: number };

self.onmessage = async (e: MessageEvent<IndexWorkerRequest>) => {
  try {
    const res = await fetch(e.data.url, { headers: { 'x-bt-token': e.data.token } });
    const text = await res.text();
    if (!res.ok) {
      (self as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: `HTTP ${res.status}`, status: res.status } satisfies IndexWorkerReply);
      return;
    }
    const t0 = performance.now();
    const r = JSON.parse(text) as InstrumentsResponse;
    const packed = packRecords(r.instruments);
    (self as DedicatedWorkerGlobalScope).postMessage({ ok: true, text, packed, ms: performance.now() - t0 } satisfies IndexWorkerReply);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: (err as Error).message } satisfies IndexWorkerReply);
  }
};
