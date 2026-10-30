import { describe, expect, it, vi } from 'vitest';
import { RequestBudget, SlotAllocator } from './kis-budget';

describe('실시간 슬롯 배분', () => {
  it('한도를 넘는 종목은 조회로, 넘친 수를 알려요', () => {
    const s = new SlotAllocator(2);
    ['a', 'b', 'c', 'a'].forEach((k) => s.add(k));
    expect(s.plan()).toEqual({ ws: ['a', 'b'], poll: ['c'] });
    expect([s.used, s.overflow()]).toEqual([2, 1]);
    s.remove('a');
    expect(s.plan()).toEqual({ ws: ['b', 'c'], poll: [] });
    expect(s.overflow()).toBe(0);
  });

  it('장이 닫힌 종목은 슬롯을 쓰지 않고, 열린 종목이 슬롯을 받아요', () => {
    const s = new SlotAllocator(2);
    ['kr1', 'kr2', 'us1', 'us2', 'us3'].forEach((k) => s.add(k));
    const open = (k: string) => k.startsWith('us');
    expect(s.plan(open)).toEqual({ ws: ['us1', 'us2'], poll: ['kr1', 'kr2', 'us3'] });
    // 넘친 수에는 장이 닫혀 조회로 받는 종목을 세지 않아요
    expect(s.overflow(open)).toBe(1);
  });
});

describe('요청 예산', () => {
  it('초당 거래건수 초과를 받으면 0.7배로 줄여요(최소 2)', () => {
    const b = new RequestBudget(15);
    const t = 1_000_000;
    b.throttled(t);
    expect(b.perSecond).toBe(10);
    // 같은 순간의 초과는 한 번으로 쳐요
    b.throttled(t + 500);
    expect(b.perSecond).toBe(10);
    b.throttled(t + 3000);
    expect(b.perSecond).toBe(7);
    for (let i = 0; i < 10; i++) b.throttled(t + 6000 + i * 3000);
    expect(b.perSecond).toBe(2);
    expect(b.usage().throttles).toBe(13);
  });

  it('30초 동안 초과가 없으면 하나씩 되돌려요', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const b = new RequestBudget(15);
      b.throttled();
      expect(b.perSecond).toBe(10);
      vi.setSystemTime(1_000_000 + 31_000);
      await b.schedule(1, async () => 1);
      expect(b.perSecond).toBe(11);
      vi.setSystemTime(1_000_000 + 45_000);
      await b.schedule(1, async () => 1);
      expect(b.perSecond).toBe(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
