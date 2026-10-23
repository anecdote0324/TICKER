import { describe, expect, it } from 'vitest';
import { SlotAllocator } from './kis-budget';

describe('실시간 슬롯 배분', () => {
  it('한도를 넘는 종목은 조회로, 넘친 수를 알려요', () => {
    const s = new SlotAllocator(2);
    ['a', 'b', 'c', 'a'].forEach((k) => s.add(k));
    expect(s.plan()).toEqual({ ws: ['a', 'b'], poll: ['c'] });
    expect([s.used, s.overflow]).toEqual([2, 1]);
    s.remove('a');
    expect(s.plan()).toEqual({ ws: ['b', 'c'], poll: [] });
    expect(s.overflow).toBe(0);
  });
});
