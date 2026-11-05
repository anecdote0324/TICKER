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

/** ALRT 뉴스 탭(v0.4): 제목에 낱말이 모두 든 새 헤드라인·공시가 들어오면 알려요(NSE와 같은 검색, -낱말은 빼기) */
export interface NewsAlertRule {
  id: string;
  query: string;
  enabled: boolean;
  createdAt: number;
  /** 마지막으로 알린 줄의 시각(ms). 이보다 새것만 알려요 */
  lastSeen: number;
  lastFiredAt?: number;
}

/** ALRT 지표 탭(v0.4): ECO 경제지표 발표 알림(미리 알림과 발표 뒤 값) */
export interface EcoAlertRule {
  id: string;
  /** ECO 발표 이름(EcoEvent.name) */
  name: string;
  /** 발표 몇 분 전에 미리 알릴지(0이면 미리 알리지 않아요) */
  beforeMin: number;
  enabled: boolean;
  createdAt: number;
  /** 이미 알린 것('pre:이벤트id', 'rel:이벤트id', 최근 50개) */
  fired: string[];
  lastFiredAt?: number;
}

/**
 * 지표 알림 판단: 미리 알림(발표 beforeMin분 전부터 발표 전까지)과 발표 알림(발표 시각이 지났고 규칙을 만든 뒤의 발표).
 * 돌려준 key를 fired에 더해요
 */
export function ecoAlertsDue(rule: EcoAlertRule, events: Array<{ id: string; name: string; at: number; latest?: string; previous?: string }>, now: number): Array<{ key: string; text: string }> {
  if (!rule.enabled) return [];
  const out: Array<{ key: string; text: string }> = [];
  for (const e of events) {
    if (e.name !== rule.name) continue;
    const pre = `pre:${e.id}`;
    const rel = `rel:${e.id}`;
    if (rule.beforeMin > 0 && now < e.at && now >= e.at - rule.beforeMin * 60_000 && !rule.fired.includes(pre)) {
      out.push({ key: pre, text: `지표 ${e.name} 발표 ${Math.max(1, Math.round((e.at - now) / 60_000))}분 전` });
    }
    // 발표 뒤 6시간 안에만(앱을 오래 꺼 뒀다 켰을 때 지난 발표를 한꺼번에 알리지 않게)
    if (now >= e.at && now - e.at < 6 * 3600_000 && e.at > rule.createdAt && !rule.fired.includes(rel)) {
      out.push({ key: rel, text: `지표 ${e.name} 발표${e.latest ? `: ${e.latest}` : ''}${e.previous ? ` (이전 ${e.previous})` : ''}` });
    }
  }
  return out;
}

export interface AlertsState {
  rules: AlertRule[];
  /** 지표 조건(v0.4) */
  ecoRules?: EcoAlertRule[];
  /** 뉴스 조건(v0.4) */
  newsRules?: NewsAlertRule[];
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
