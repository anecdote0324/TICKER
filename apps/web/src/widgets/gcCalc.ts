// GC 금리 커브 계산(03 v0.3): 비교 날짜의 커브, 테너별 변동(bp), 스프레드. 화면과 떼어 테스트해요.

import { daysBefore, rowOnOrBefore, type YieldCurve } from '@bt/shared';

/** 비교 기간: 달력 날 수 */
export const GC_COMPARE: Record<string, { label: string; days: number }> = {
  '1W': { label: '1주 전', days: 7 },
  '1M': { label: '1개월 전', days: 30 },
  '1Y': { label: '1년 전', days: 365 },
};

/** 가장 최근 행과 n일 전(그 날 이전의 가장 가까운 영업일) 행 */
export function curveAt(c: YieldCurve, daysAgo: number) {
  const last = c.rows[c.rows.length - 1];
  if (!last) return undefined;
  return daysAgo === 0 ? last : rowOnOrBefore(c.rows, daysBefore(last.date, daysAgo));
}

/** 테너 값: 그 날 값이 비면(국고채 일부 테너) undefined */
export function tenorValue(row: { values: Record<string, number> } | undefined, key: string): number | undefined {
  const v = row?.values[key];
  return v === undefined || !Number.isFinite(v) ? undefined : v;
}

/** 변동(bp, 소수 첫째 자리). 둘 중 하나라도 없으면 undefined */
export function bp(now: number | undefined, then: number | undefined): number | undefined {
  if (now === undefined || then === undefined) return undefined;
  return Math.round((now - then) * 1000) / 10;
}

/** 테너 라벨로 값(스프레드 계산용) */
function byLabel(c: YieldCurve, row: { values: Record<string, number> } | undefined, label: string) {
  const t = c.tenors.find((x) => x.label === label);
  return t ? tenorValue(row, t.key) : undefined;
}

export interface Spread {
  label: string;
  /** bp */
  now?: number;
  /** 비교 날짜 대비 변화(bp) */
  change?: number;
}

/** 스프레드: 미국 10Y-2Y·10Y-3M, 국고 10Y-3Y, 국고 10Y - 미국 10Y */
export function spreads(curves: YieldCurve[], daysAgo: number): Spread[] {
  const us = curves.find((c) => c.id === 'UST');
  const kr = curves.find((c) => c.id === 'KTB');
  const out: Spread[] = [];
  const pair = (label: string, a: () => [number | undefined, number | undefined], b: () => [number | undefined, number | undefined]) => {
    const [n1, n2] = a();
    const [t1, t2] = b();
    const now = bp(n1, n2);
    const then = bp(t1, t2);
    if (now !== undefined) out.push({ label, now, change: then !== undefined ? Math.round((now - then) * 10) / 10 : undefined });
  };
  if (us) {
    const n = curveAt(us, 0);
    const t = curveAt(us, daysAgo);
    pair('미국 10Y-2Y', () => [byLabel(us, n, '10Y'), byLabel(us, n, '2Y')], () => [byLabel(us, t, '10Y'), byLabel(us, t, '2Y')]);
    pair('미국 10Y-3M', () => [byLabel(us, n, '10Y'), byLabel(us, n, '3M')], () => [byLabel(us, t, '10Y'), byLabel(us, t, '3M')]);
  }
  if (kr) {
    const n = curveAt(kr, 0);
    const t = curveAt(kr, daysAgo);
    pair('국고 10Y-3Y', () => [byLabel(kr, n, '10Y'), byLabel(kr, n, '3Y')], () => [byLabel(kr, t, '10Y'), byLabel(kr, t, '3Y')]);
  }
  if (us && kr) {
    pair(
      '국고 10Y - 미국 10Y',
      () => [byLabel(kr, curveAt(kr, 0), '10Y'), byLabel(us, curveAt(us, 0), '10Y')],
      () => [byLabel(kr, curveAt(kr, daysAgo), '10Y'), byLabel(us, curveAt(us, daysAgo), '10Y')],
    );
  }
  return out;
}

/** 가로축: 만기(년)의 제곱근(짧은 만기가 몰리지 않게) */
export const xOfYears = (years: number) => Math.sqrt(years);
