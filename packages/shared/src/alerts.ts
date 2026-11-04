// ALRT 알림(03 v0.3): 가격·등락률 조건. 조건이 맞으면 알려요(이미 맞아 있으면 만들자마자 한 번).
// 한 번만이면 알린 뒤 꺼지고, 반복이면 조건이 풀렸다가 다시 맞을 때 또 알려요.

export type AlertKind = 'above' | 'below' | 'pctAbove' | 'pctBelow';

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  above: '가격 이상',
  below: '가격 이하',
  pctAbove: '등락률 이상(%)',
  pctBelow: '등락률 이하(%)',
};

export interface AlertRule {
  id: string;
  instrumentId: string;
  kind: AlertKind;
  value: number;
  enabled: boolean;
  /** 한 번 알리면 꺼져요(기본). false면 조건이 풀렸다 다시 맞을 때마다 */
  once: boolean;
  createdAt: number;
  lastFiredAt?: number;
  note?: string;
}

export interface AlertLogEntry {
  ruleId: string;
  instrumentId: string;
  at: number;
  /** '삼성전자 72,000 ≥ 70,000' 같은 문구 */
  text: string;
}

export interface AlertsState {
  rules: AlertRule[];
  /** 최근 알림(새것부터, 100개까지) */
  log: AlertLogEntry[];
}

export function alertMet(rule: Pick<AlertRule, 'kind' | 'value'>, last: number | undefined, changePct: number | undefined): boolean | undefined {
  switch (rule.kind) {
    case 'above':
      return last === undefined ? undefined : last >= rule.value;
    case 'below':
      return last === undefined ? undefined : last <= rule.value;
    case 'pctAbove':
      return changePct === undefined ? undefined : changePct >= rule.value;
    case 'pctBelow':
      return changePct === undefined ? undefined : changePct <= rule.value;
  }
}

/**
 * 한 번 판단: armed는 '조건이 풀린 뒤 다시 알릴 수 있는지'(반복 알림용, 처음에는 true).
 * 돌려주는 fire가 true면 알리고, rule은 한 번만이면 꺼진 규칙, armed는 다음 판단에 쓸 값
 */
export function evaluateAlert(rule: AlertRule, armed: boolean, last: number | undefined, changePct: number | undefined): { fire: boolean; armed: boolean } {
  if (!rule.enabled) return { fire: false, armed };
  const met = alertMet(rule, last, changePct);
  if (met === undefined) return { fire: false, armed };
  if (met && armed) return { fire: true, armed: false };
  // 조건이 풀리면 다시 알릴 수 있어요
  return { fire: false, armed: met ? armed : true };
}

/** 지금 값에서 조건까지 남은 거리(%) */
export function alertDistance(rule: Pick<AlertRule, 'kind' | 'value'>, last: number | undefined, changePct: number | undefined): number | undefined {
  if (rule.kind === 'above' || rule.kind === 'below') return last ? (rule.value / last - 1) * 100 : undefined;
  return changePct === undefined ? undefined : rule.value - changePct;
}
