// 실시간 슬롯 확인(08 §4.1): 기능을 열 때 새로 필요한 한국투자증권 실시간 슬롯이 모자라면,
// 넘치는 종목은 몇 초 간격 조회로 받는다고 알려요. 데모 시세일 때는 묻지 않아요.

import { FUNCTION_SLOT_COST, slotShortfall, usesRealtimeSlot, type SourceStatus } from '@bt/shared';
import { feedStatus, isSubscribed, subscribedIds } from './feed';
import { getInstrument } from './instruments';
import { panels, type PanelState } from './panels';
import { appState } from './state';
import { showToast } from './ui';

export { FUNCTION_SLOT_COST };

/** 한국투자증권 연결 상태의 슬롯 사용량. 데모면 undefined */
export function kisSlots(sources: SourceStatus[] = feedStatus.get().sources) {
  const kis = sources.find((s) => s.source === 'KIS');
  if (!kis?.wsLimit) return undefined;
  return { used: kis.wsUsed ?? 0, limit: kis.wsLimit, overflow: kis.wsOverflow ?? 0 };
}

/** 패널이 실시간 슬롯으로 받을 종목 */
export function panelRealtimeIds(p: PanelState): string[] {
  let ids: string[] = [];
  if (p.fn === 'MON') {
    const groups = appState.get().watchlists;
    ids = (p.watchGroups ? groups.filter((g) => p.watchGroups!.includes(g.id)) : groups).flatMap((g) => g.ids);
  } else if (p.fn && p.securityId && FUNCTION_SLOT_COST[p.fn]?.startsWith('주식')) ids = [p.securityId];
  return ids.filter((id) => {
    const inst = getInstrument(id);
    return !!inst && usesRealtimeSlot(inst);
  });
}

/** 패널 상태가 바뀐 직후(구독이 바뀌기 전)에 불러요 */
export function checkSlots() {
  const s = kisSlots();
  if (!s) return;
  const need = new Set(Object.values(panels.get()).flatMap(panelRealtimeIds));
  const fresh = [...need].filter((id) => !isSubscribed(id));
  if (fresh.length === 0) return;
  // 더는 안 보이는 주식은 곧 슬롯을 돌려줘요
  const freed = subscribedIds().filter((id) => !need.has(id) && usesRealtimeSlot(getInstrument(id) ?? { assetClass: 'INDEX' })).length;
  const short = slotShortfall(fresh.length, Math.max(0, s.used - freed), s.limit);
  if (short > 0) {
    showToast(`실시간 슬롯이 모자라요(${s.used}/${s.limit}). 주식 ${short}개는 몇 초 간격 조회로 받고 'n초 주기' 배지가 붙어요`, undefined, 8000);
  }
}

