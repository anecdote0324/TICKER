// 아주 작은 상태 저장소(useSyncExternalStore). 화면 전체가 같은 값을 보게 해요.

import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      for (const s of [...subs]) s();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T, S = T>(store: Store<T>, select?: (v: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => (select ? select(store.get()) : (store.get() as unknown as S)),
    () => (select ? select(store.get()) : (store.get() as unknown as S)),
  );
}
