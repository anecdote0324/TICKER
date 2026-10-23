import { describe, expect, it } from 'vitest';
import { slotShortfall, usesRealtimeSlot } from './slots';

describe('실시간 슬롯', () => {
  it('주식만 슬롯을 써요', () => {
    expect(usesRealtimeSlot({ assetClass: 'EQUITY' })).toBe(true);
    expect(usesRealtimeSlot({ assetClass: 'INDEX' })).toBe(false);
    expect(usesRealtimeSlot({ assetClass: 'CRYPTO' })).toBe(false);
  });

  it('남은 슬롯보다 많이 필요하면 모자라는 수', () => {
    expect(slotShortfall(1, 39, 40)).toBe(0);
    expect(slotShortfall(3, 39, 40)).toBe(2);
    expect(slotShortfall(2, 45, 40)).toBe(2);
  });
});
