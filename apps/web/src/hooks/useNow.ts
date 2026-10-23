import { useEffect, useState } from 'react';

// 배지의 멈춤 판정과 시계는 시간이 흐르면 다시 그려야 해요. 같은 주기의 타이머를 하나로 묶어요.
const listeners = new Map<number, Set<() => void>>();
const timers = new Map<number, number>();

function subscribe(ms: number, fn: () => void) {
  let set = listeners.get(ms);
  if (!set) {
    set = new Set();
    listeners.set(ms, set);
    timers.set(ms, window.setInterval(() => listeners.get(ms)?.forEach((f) => f()), ms));
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) {
      clearInterval(timers.get(ms));
      timers.delete(ms);
      listeners.delete(ms);
    }
  };
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(ms, () => setNow(Date.now())), [ms]);
  return now;
}
