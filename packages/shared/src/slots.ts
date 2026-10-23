// 한국투자증권 실시간 구독 슬롯(08 §4.1). 국내·미국 주식의 체결만 슬롯을 써요.
// 지수는 주기 조회, 코인은 Binance, 환율은 ECB라서 슬롯을 쓰지 않아요.
// 슬롯이 모자라면 넘치는 종목은 몇 초 간격 조회로 받고 'n초 주기' 배지가 붙어요.

import type { Instrument } from './instrument';

/** 이 종목이 실시간 슬롯을 쓰는지 */
export function usesRealtimeSlot(inst: Pick<Instrument, 'assetClass'>): boolean {
  return inst.assetClass === 'EQUITY';
}

/** 기능별 슬롯 비용(08 §4.1 표, v0.1 기능) */
export const FUNCTION_SLOT_COST: Record<string, string> = {
  MON: '보이는 주식 수만큼',
  GP: '주식이면 1개',
  GIP: '주식이면 1개',
  WEI: '0개 (지수는 주기 조회)',
  FXC: '0개 (ECB 기준환율)',
  CRYP: '0개 (Binance)',
};

/** 새로 필요한 슬롯 중 모자라는 수 */
export function slotShortfall(need: number, used: number, limit: number): number {
  return Math.max(0, need - Math.max(0, limit - used));
}
