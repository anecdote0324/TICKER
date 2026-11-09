// GC 금리 커브(03 v0.3): 미국채(재무부 XML)와 국고채(BOK ECOS)의 일별 금리. v0.6: 일본 국채(재무성 CSV)·유로 AAA 국채(ECB 데이터 포털).
// 서버는 최근 약 400일의 날짜별 금리를 주고, 화면이 오늘·1주 전·1개월 전·1년 전 커브와 변동(bp)을 계산해요.

import type { Freshness } from './freshness';

export type CurveId = 'UST' | 'KTB' | 'JGB' | 'EUR';

/** 커브 → 나라·통화 */
export const CURVE_INFO: Record<CurveId, { country: string; ccy: string; short: string }> = {
  KTB: { country: '한국', ccy: 'KRW', short: 'KR' },
  UST: { country: '미국', ccy: 'USD', short: 'US' },
  JGB: { country: '일본', ccy: 'JPY', short: 'JP' },
  EUR: { country: '유로존(AAA)', ccy: 'EUR', short: 'EU' },
};

export interface CurveTenor {
  /** 'BC_10YEAR', '010210000' 같은 원천 키 */
  key: string;
  /** '10Y', '3M' */
  label: string;
  /** 만기(년) */
  years: number;
}

export interface YieldCurve {
  id: CurveId;
  /** '미국채', '국고채' */
  name: string;
  tenors: CurveTenor[];
  /** 날짜순(오래된 것부터). values는 테너 키 → 금리(%) */
  rows: Array<{ date: string; values: Record<string, number> }>;
  fresh: Freshness;
}

export interface CurvesResponse {
  curves: YieldCurve[];
  /** 받지 못한 커브와 이유(키 없음 등) */
  missing: Array<{ id: CurveId; name: string; reason: string }>;
}

/** 미국채 XML 키 → 테너. 1.5개월물처럼 새로 생기는 테너도 이름으로 읽어요(04: 테너 목록을 고정하지 않아요) */
export function ustTenor(key: string): CurveTenor | undefined {
  const m = /^BC_(\d+)(?:_(\d+))?(MONTH|YEAR)$/.exec(key);
  if (!m) return undefined;
  const n = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0);
  const years = m[3] === 'MONTH' ? n / 12 : n;
  return { key, label: `${m[2] ? `${m[1]}.${m[2]}` : m[1]}${m[3] === 'MONTH' ? 'M' : 'Y'}`, years };
}

/** 국고채 ECOS 항목(시장금리 일별 817Y002). 2026-11 샘플 키로 이름을 확인했어요 */
export const KTB_ITEMS: CurveTenor[] = [
  { key: '010190000', label: '1Y', years: 1 },
  { key: '010195000', label: '2Y', years: 2 },
  { key: '010200000', label: '3Y', years: 3 },
  { key: '010200001', label: '5Y', years: 5 },
  { key: '010210000', label: '10Y', years: 10 },
  { key: '010220000', label: '20Y', years: 20 },
  { key: '010230000', label: '30Y', years: 30 },
  { key: '010240000', label: '50Y', years: 50 },
];

/** 날짜(YYYY-MM-DD) 이전(같은 날 포함)의 가장 가까운 행 */
export function rowOnOrBefore<T extends { date: string }>(rows: T[], date: string): T | undefined {
  let found: T | undefined;
  for (const r of rows) {
    if (r.date <= date) found = r;
    else break;
  }
  return found;
}

/** 날짜에서 n일 전(YYYY-MM-DD, UTC로 셈) */
export function daysBefore(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - n * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 일본 재무성 국채 금리 CSV 칸('1Y'…'40Y') */
export const JGB_TENORS: CurveTenor[] = ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', '15Y', '20Y', '25Y', '30Y', '40Y'].map((l) => ({ key: l, label: l, years: Number(l.slice(0, -1)) }));

/** ECB 유로 지역 AAA 국채 수익률 곡선(YC, 현물 금리) 테너 */
export const EUR_TENORS: CurveTenor[] = [
  { key: 'SR_3M', label: '3M', years: 0.25 },
  { key: 'SR_1Y', label: '1Y', years: 1 },
  { key: 'SR_2Y', label: '2Y', years: 2 },
  { key: 'SR_3Y', label: '3Y', years: 3 },
  { key: 'SR_5Y', label: '5Y', years: 5 },
  { key: 'SR_7Y', label: '7Y', years: 7 },
  { key: 'SR_10Y', label: '10Y', years: 10 },
  { key: 'SR_20Y', label: '20Y', years: 20 },
  { key: 'SR_30Y', label: '30Y', years: 30 },
];

/** 그 행에서 만기 years의 금리(없으면 앞뒤 테너로 선형 보간) */
export function yieldAt(curve: Pick<YieldCurve, 'tenors'>, values: Record<string, number>, years: number): number | undefined {
  const pts = curve.tenors.filter((t) => values[t.key] !== undefined).map((t) => ({ y: t.years, v: values[t.key] }));
  if (!pts.length) return undefined;
  pts.sort((a, b) => a.y - b.y);
  const hit = pts.find((p) => Math.abs(p.y - years) < 1e-6);
  if (hit) return hit.v;
  if (years < pts[0].y || years > pts[pts.length - 1].y) return undefined;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y >= years) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.v + ((b.v - a.v) * (years - a.y)) / (b.y - a.y);
    }
  }
  return undefined;
}

/** 현물 금리(연복리, %)로 t1년 뒤 시작 (t2−t1)년 선도금리(%) */
export function forwardFromSpot(r1: number, t1: number, r2: number, t2: number): number {
  if (t1 <= 0) return r2;
  return (Math.pow(Math.pow(1 + r2 / 100, t2) / Math.pow(1 + r1 / 100, t1), 1 / (t2 - t1)) - 1) * 100;
}

/** 일본 재무성 금리 CSV → 날짜별 금리(서기 날짜 'YYYY/M/D', 값 '-'는 없음) */
export function parseJgbCsv(text: string): Array<{ date: string; values: Record<string, number> }> {
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith('Date,'));
  if (head < 0) return [];
  const cols = lines[head].split(',');
  const out: Array<{ date: string; values: Record<string, number> }> = [];
  for (const line of lines.slice(head + 1)) {
    const cells = line.split(',');
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(cells[0] ?? '');
    if (!m) continue;
    const values: Record<string, number> = {};
    cols.forEach((c, i) => {
      if (i === 0) return;
      const v = Number(cells[i]);
      if (cells[i] && cells[i] !== '-' && Number.isFinite(v)) values[c.trim()] = v;
    });
    if (Object.keys(values).length) out.push({ date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, values });
  }
  return out;
}

/** ECB 데이터 포털 CSV(csvdata) → 날짜·값(여러 시계열을 한 번에 받으면 series에 DATA_TYPE_FM, 예: 'SR_10Y') */
export function parseEcbCsv(text: string): Array<{ date: string; value: number; series?: string }> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  const si = head.indexOf('DATA_TYPE_FM');
  if (ti < 0 || vi < 0) return [];
  return lines
    .slice(1)
    .map((l) => l.split(','))
    .map((c) => ({ date: c[ti], value: Number(c[vi]), ...(si >= 0 && c[si] ? { series: c[si] } : {}) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.value));
}
