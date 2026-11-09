// v0.6 외환: 공식 고시환율(FIXI)과 단기 금리(FRD 선물환, WCRS 캐리)의 응답 형식.

import type { Freshness } from './freshness';

export interface FixingRow {
  /** 'USD/KRW' 같은 통화쌍(앞 통화 1단위가 뒤 통화로 얼마) */
  pair: string;
  value: number;
  /** 기준일 'YYYY-MM-DD' */
  date: string;
  /** 앞 기준일 값(대비) */
  prev?: number;
  /** 단위 안내(예: '100엔당') */
  unit?: string;
}

export interface FixingSource {
  id: 'ECB' | 'ECOS' | 'FRED';
  name: string;
  /** 고시 기준 시각 안내 */
  basis: string;
  rows: FixingRow[];
  error?: string;
}

export interface FixingsResponse {
  sources: FixingSource[];
  fresh: Freshness;
}

export interface MoneyRate {
  /** 통화 */
  ccy: string;
  /** 'SOFR', 'CD91' 같은 금리 이름 */
  name: string;
  /** 연 % */
  value: number;
  date: string;
  source: string;
}

export interface MoneyRatesResponse {
  rates: MoneyRate[];
  errors: string[];
  fresh: Freshness;
}

/** FRD·WCRS가 통화마다 쓰는 기본 금리(앞의 것이 있으면 그것) */
export const DEFAULT_RATE_FOR: Record<string, string[]> = {
  USD: ['SOFR', 'EFFR'],
  EUR: ['€STR'],
  KRW: ['CD91', '콜'],
};
