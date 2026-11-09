// v0.6 외환 계산: 선물환(금리평형), 결제일(T+2·만기, 공용 영업일 달력), 통화 수익률·변동성(WCRS).

import { addDays, isBusinessDay, weekdayOf, type CalendarMarket } from './calendar';

/** 통화 → 휴장일 달력(없으면 주말만 쉬는 날로 봐요) */
export const CURRENCY_CALENDAR: Record<string, CalendarMarket | undefined> = { USD: 'US', KRW: 'KR', JPY: 'JP', GBP: 'UK' };

/** 금리 날짜 계산 관례: 달러·유로·엔·위안은 실제/360, 원·파운드·호주달러는 실제/365 */
export const DAY_BASIS: Record<string, 360 | 365> = { USD: 360, EUR: 360, JPY: 360, CNY: 360, KRW: 365, GBP: 365, AUD: 365 };

const okDay = (ccys: string[], d: string) => {
  const w = weekdayOf(d);
  if (w === 0 || w === 6) return false;
  return ccys.every((c) => {
    const cal = CURRENCY_CALENDAR[c];
    return !cal || isBusinessDay(cal, d);
  });
};

/** 두 통화가 모두 여는 영업일로 n일 뒤 */
export function addFxBusinessDays(ccys: string[], ymd: string, n: number): string {
  let d = ymd;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (okDay(ccys, d)) left--;
  }
  return d;
}

/** 수정 다음 영업일(modified following): 다음 영업일이 다음 달이면 앞 영업일 */
export function modifiedFollowing(ccys: string[], ymd: string): string {
  let d = ymd;
  while (!okDay(ccys, d)) d = addDays(d, 1);
  if (d.slice(0, 7) !== ymd.slice(0, 7)) {
    d = ymd;
    while (!okDay(ccys, d)) d = addDays(d, -1);
  }
  return d;
}

export type FxTenor = 'ON' | 'TN' | '1W' | '2W' | '1M' | '2M' | '3M' | '6M' | '9M' | '1Y';
export const FX_TENORS: FxTenor[] = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y'];

/** 거래일 → 현물 결제일(T+2) */
export function spotDate(ccys: string[], trade: string): string {
  return addFxBusinessDays(ccys, trade, 2);
}

/** 현물 결제일 기준 만기일(주는 7일 단위, 달은 같은 날짜, 수정 다음 영업일) */
export function tenorDate(ccys: string[], spot: string, tenor: FxTenor): string {
  if (tenor.endsWith('W')) return modifiedFollowing(ccys, addDays(spot, 7 * Number(tenor.slice(0, -1))));
  const months = tenor === '1Y' ? 12 : Number(tenor.slice(0, -1));
  const [y, m, d] = spot.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  const raw = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return modifiedFollowing(ccys, raw);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

/**
 * 금리평형 선물환: F = S × (1 + r_quote × d/B_quote) / (1 + r_base × d/B_base). 금리는 % 단위.
 * 실제 시장 스왑포인트와 다를 수 있어요(신용·수급 프리미엄)
 */
export function forwardRate(spot: number, base: string, quote: string, rBasePct: number, rQuotePct: number, days: number): number {
  const bb = DAY_BASIS[base] ?? 365;
  const bq = DAY_BASIS[quote] ?? 365;
  return (spot * (1 + (rQuotePct / 100) * (days / bq))) / (1 + (rBasePct / 100) * (days / bb));
}

/** 종가 이력(오래된 것부터)에서 기간 수익률(%). 기준일 이전 마지막 종가와 비교해요 */
export function periodReturn(closes: Array<{ t: number; c: number }>, sinceSec: number): number | undefined {
  if (closes.length < 2) return undefined;
  const last = closes[closes.length - 1].c;
  let base: number | undefined;
  for (const x of closes) {
    if (x.t <= sinceSec) base = x.c;
    else break;
  }
  return base ? (last / base - 1) * 100 : undefined;
}

/** 최근 n개 일간 로그수익률의 연환산 변동성(%, 252일) */
export function realizedVol(closes: number[], n = 21): number | undefined {
  const xs = closes.slice(-(n + 1));
  if (xs.length < 3) return undefined;
  const r: number[] = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] > 0) r.push(Math.log(xs[i] / xs[i - 1]));
  if (r.length < 2) return undefined;
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 252) * 100;
}

/** 오늘 이후로 값이 있는 마지막 날 이하 가장 가까운 종가(FXCA 과거 환산) */
export function closeOn(closes: Array<{ t: number; c: number }>, ymd: string): { t: number; c: number } | undefined {
  const until = Date.parse(`${ymd}T23:59:59Z`) / 1000;
  let hit: { t: number; c: number } | undefined;
  for (const x of closes) {
    if (x.t <= until) hit = x;
    else break;
  }
  return hit;
}
