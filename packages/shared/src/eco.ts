// ECO 경제 캘린더(03 v0.3): 미국 지표 발표 일시(BEA는 시각까지, FRED는 날짜만이라 관례 시각을 붙여요),
// 실제(가장 최근 값)·이전 값(FRED 시계열), 한국 주요 지표의 최근 값(BOK ECOS 100대 통계지표).

import type { Freshness } from './freshness';
import { zonedParts } from './time';

export interface EcoEvent {
  id: string;
  /** 발표 시각(UTC ms) */
  at: number;
  /** exact: 원천이 준 시각, usual: 원천은 날짜만 줘서 붙인 관례 시각, none: 시각 미상 */
  time: 'exact' | 'usual' | 'none';
  country: 'US' | 'KR';
  /** 화면 이름(한국어) */
  name: string;
  /** 원천의 이름 */
  sourceName: string;
  source: 'BEA' | 'FRED' | 'MODS' | 'BOK';
  /** ECOD로 열 시계열(v0.6) */
  seriesId?: string;
  /** 가장 최근 값과 그 앞 값(문자열, 단위 포함). 발표 전이면 previous만 의미가 있어요 */
  latest?: string;
  previous?: string;
  /** 최근 값의 기간(예: '2026-09') */
  period?: string;
}

export interface EcoKeyStat {
  /** '물가', '고용' 같은 분류 */
  group: string;
  name: string;
  value: string;
  unit: string;
  /** '202609', '2026Q2', '20261104' */
  cycle: string;
}

export interface EcoResponse {
  events: EcoEvent[];
  korea: EcoKeyStat[];
  missing: Array<{ what: string; reason: string }>;
  fresh: Freshness;
}

/** 시간대의 그날 그 시각 → UTC ms(서머타임 반영). zonedToUtc('2026-11-12', '08:30', 'America/New_York') */
export function zonedToUtc(ymd: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const base = Date.UTC(y, m - 1, d, hh, mm);
  // 시간대 오프셋은 -14~+14시간 안이라, 그 시간대의 시·일이 맞는 오프셋은 하나예요
  for (let off = -14; off <= 14; off++) {
    const t = base - off * 3600_000;
    const p = zonedParts(t, timeZone);
    if (p.hour === hh && p.day === d) return t;
  }
  return base;
}
