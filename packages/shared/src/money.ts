// v0.6 금리 시계열: BTMM 금리 종합, OIS 무위험지표금리, FICM 크레딧 스프레드가 쓰는 일별 시계열(최근 약 400일).

import type { Freshness } from './freshness';

export type MoneySeriesId =
  | 'KR_BASE' | 'KR_CALL' | 'KR_CD91' | 'KR_CP91' | 'KR_KTB3' | 'KR_KTB10' | 'KR_AA3' | 'KR_BBB3'
  | 'US_FFU' | 'US_FFL' | 'US_EFFR' | 'US_SOFR' | 'US_TB3M' | 'US_UST2' | 'US_UST10'
  | 'US_OAS_IG' | 'US_OAS_AAA' | 'US_OAS_BBB' | 'US_OAS_HY'
  | 'EU_ESTR';

export interface MoneySeriesDef {
  id: MoneySeriesId;
  name: string;
  country: 'KR' | 'US' | 'EU';
  source: 'ECOS' | 'FRED';
  /** ECOS '표/항목', FRED 시계열 이름 */
  code: string;
  /** 단위: 금리 %, 스프레드 %p */
  unit: '%' | '%p';
}

export const MONEY_SERIES: MoneySeriesDef[] = [
  { id: 'KR_BASE', name: '한국은행 기준금리', country: 'KR', source: 'ECOS', code: '722Y001/0101000', unit: '%' },
  { id: 'KR_CALL', name: '콜금리(1일)', country: 'KR', source: 'ECOS', code: '817Y002/010101000', unit: '%' },
  { id: 'KR_CD91', name: 'CD 91일', country: 'KR', source: 'ECOS', code: '817Y002/010502000', unit: '%' },
  { id: 'KR_CP91', name: 'CP 91일', country: 'KR', source: 'ECOS', code: '817Y002/010503000', unit: '%' },
  { id: 'KR_KTB3', name: '국고채 3년', country: 'KR', source: 'ECOS', code: '817Y002/010200000', unit: '%' },
  { id: 'KR_KTB10', name: '국고채 10년', country: 'KR', source: 'ECOS', code: '817Y002/010210000', unit: '%' },
  { id: 'KR_AA3', name: '회사채 AA- 3년', country: 'KR', source: 'ECOS', code: '817Y002/010300000', unit: '%' },
  { id: 'KR_BBB3', name: '회사채 BBB- 3년', country: 'KR', source: 'ECOS', code: '817Y002/010320000', unit: '%' },
  { id: 'US_FFU', name: '연방기금 목표 상단', country: 'US', source: 'FRED', code: 'DFEDTARU', unit: '%' },
  { id: 'US_FFL', name: '연방기금 목표 하단', country: 'US', source: 'FRED', code: 'DFEDTARL', unit: '%' },
  { id: 'US_EFFR', name: 'EFFR(실효 연방기금금리)', country: 'US', source: 'FRED', code: 'EFFR', unit: '%' },
  { id: 'US_SOFR', name: 'SOFR', country: 'US', source: 'FRED', code: 'SOFR', unit: '%' },
  { id: 'US_TB3M', name: '미국 단기국채 3개월', country: 'US', source: 'FRED', code: 'DTB3', unit: '%' },
  { id: 'US_UST2', name: '미국채 2년', country: 'US', source: 'FRED', code: 'DGS2', unit: '%' },
  { id: 'US_UST10', name: '미국채 10년', country: 'US', source: 'FRED', code: 'DGS10', unit: '%' },
  { id: 'US_OAS_IG', name: '미국 투자등급 회사채 OAS', country: 'US', source: 'FRED', code: 'BAMLC0A0CM', unit: '%p' },
  { id: 'US_OAS_AAA', name: '미국 AAA 회사채 OAS', country: 'US', source: 'FRED', code: 'BAMLC0A1CAAA', unit: '%p' },
  { id: 'US_OAS_BBB', name: '미국 BBB 회사채 OAS', country: 'US', source: 'FRED', code: 'BAMLC0A4CBBB', unit: '%p' },
  { id: 'US_OAS_HY', name: '미국 하이일드 OAS', country: 'US', source: 'FRED', code: 'BAMLH0A0HYM2', unit: '%p' },
  { id: 'EU_ESTR', name: '€STR(유로 단기금리)', country: 'EU', source: 'FRED', code: 'ECBESTRVOLWGTTRMDMNRT', unit: '%' },
];

export interface MoneySeries {
  id: MoneySeriesId;
  /** 날짜순(오래된 것부터) */
  obs: Array<{ date: string; value: number }>;
}

export interface MoneySeriesResponse {
  series: MoneySeries[];
  /** 받지 못한 시계열과 이유 */
  missing: Array<{ id: MoneySeriesId; reason: string }>;
  fresh: Freshness;
}

/** 시계열의 마지막 값과 n일 전(그날 이전 가장 가까운) 값 */
export function lastAndAgo(obs: Array<{ date: string; value: number }>, days: number): { last?: { date: string; value: number }; ago?: number } {
  if (!obs.length) return {};
  const last = obs[obs.length - 1];
  const cut = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86400_000).toISOString().slice(0, 10);
  let ago: number | undefined;
  for (const o of obs) {
    if (o.date <= cut) ago = o.value;
    else break;
  }
  return { last, ago };
}

/**
 * OIS 복리 계산: [start, end) 기간 동안 일별 고시 금리를 복리로(주말·휴일은 직전 고시 금리를 그 일수만큼). 연 %, 기준일수 basis
 * 고시가 없는 날은 바로 앞 고시를 써요
 */
export function compoundedRate(obs: Array<{ date: string; value: number }>, start: string, end: string, basis: 360 | 365): { rate: number; days: number } | undefined {
  if (end <= start) return undefined;
  let acc = 1;
  let days = 0;
  let cur: number | undefined;
  for (const o of obs) {
    if (o.date <= start) cur = o.value;
    else break;
  }
  if (cur === undefined) return undefined;
  const byDate = new Map(obs.map((o) => [o.date, o.value]));
  for (let t = Date.parse(`${start}T00:00:00Z`); t < Date.parse(`${end}T00:00:00Z`); t += 86400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const v = byDate.get(d);
    if (v !== undefined) cur = v;
    acc *= 1 + (cur / 100) / basis;
    days++;
  }
  return { rate: ((acc - 1) * basis * 100) / days, days };
}

/** SOVM 국가부채 */
export interface SovereignDebt {
  /** ISO3 나라 코드 */
  iso3: string;
  name: string;
  /** 중앙정부 부채 / GDP(%) 최근 값과 그 해 */
  debtGdp?: number;
  year?: string;
  /** 그 앞 해 */
  prevDebtGdp?: number;
}

export interface SovereignResponse {
  countries: SovereignDebt[];
  /** 미국 연방 부채 총액(달러)과 기준일, 하루 전 값 */
  usDebt?: { date: string; total: number; prev?: number };
  errors: string[];
  fresh: import('./freshness').Freshness;
}

/** SOVM이 보는 나라(세계은행 코드) */
export const SOVM_COUNTRIES: Array<{ iso2: string; iso3: string; name: string }> = [
  { iso2: 'KR', iso3: 'KOR', name: '한국' },
  { iso2: 'US', iso3: 'USA', name: '미국' },
  { iso2: 'JP', iso3: 'JPN', name: '일본' },
  { iso2: 'GB', iso3: 'GBR', name: '영국' },
  { iso2: 'DE', iso3: 'DEU', name: '독일' },
  { iso2: 'FR', iso3: 'FRA', name: '프랑스' },
  { iso2: 'IT', iso3: 'ITA', name: '이탈리아' },
  { iso2: 'CA', iso3: 'CAN', name: '캐나다' },
  { iso2: 'AU', iso3: 'AUS', name: '호주' },
  { iso2: 'CN', iso3: 'CHN', name: '중국' },
];
