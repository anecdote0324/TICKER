// 설명 창 간단 시세(05 §4.6, v0.2): 목록은 시세를 기다리지 않아요. 줄을 고르고 150ms 뒤에 요청하고, 받은 값은 10초 동안 다시 써요.
// 화살표로 줄을 훑어도 요청은 한 번에 하나만(앞 요청은 취소). 패널이 이미 받는 시세가 있으면 그것을 써요.

import { useEffect, useState } from 'react';
import type { Quote } from '@bt/shared';
import { token } from '../api';
import { getQuote } from './feed';

const DELAY_MS = 150;
const REUSE_MS = 10_000;
const cache = new Map<string, { at: number; q: Quote | null }>();
let inflight: AbortController | null = null;

export function useQuickQuote(id: string | undefined): { q?: Quote; loading: boolean } {
  const [state, setState] = useState<{ id?: string; q?: Quote; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (!id) {
      setState({ loading: false });
      return;
    }
    const live = getQuote(id);
    if (live) {
      setState({ id, q: live, loading: false });
      return;
    }
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < REUSE_MS) {
      setState({ id, q: hit.q ?? undefined, loading: false });
      return;
    }
    setState({ id, loading: true });
    const timer = window.setTimeout(() => {
      inflight?.abort();
      const ctl = new AbortController();
      inflight = ctl;
      fetch(`/api/quote?id=${encodeURIComponent(id)}`, { headers: { 'x-bt-token': token }, signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Quote>) : null))
        .then((q) => {
          cache.set(id, { at: Date.now(), q });
          setState((s) => (s.id === id ? { id, q: q ?? undefined, loading: false } : s));
        })
        .catch(() => setState((s) => (s.id === id ? { id, loading: false } : s)))
        .finally(() => {
          if (inflight === ctl) inflight = null;
        });
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [id]);
  return state.id === id ? { q: state.q, loading: state.loading } : { loading: !!id };
}
