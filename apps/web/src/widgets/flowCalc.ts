// 수급 화면(KINV·KPGM·KCRD·SI) 계산: 표 값 모양과 누적 순매수.

import type { FlowColumn, FlowRow } from '@bt/shared';

/** 표 값: 금액은 억 원(소수 한 자리), 주식 수는 그대로, 비율은 % */
export function flowCell(c: FlowColumn, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const sign = c.signed && v > 0 ? '+' : '';
  if (c.unit === 'krw') {
    // 평균가처럼 작은 금액은 원 그대로
    if (Math.abs(v) < 1e7) return `${sign}${Math.round(v).toLocaleString('en-US')}`;
    return `${sign}${(v / 1e8).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }
  if (c.unit === 'pct') return `${sign}${v.toFixed(2)}%`;
  return `${sign}${Math.round(v).toLocaleString('en-US')}`;
}

/** 투자자: 기간 누적 순매수(오래된 날부터 더해요) */
export function cumulative(rows: Array<Pick<FlowRow, 'values'>>, key: string): number[] {
  const asc = [...rows].reverse();
  let t = 0;
  return asc.map((r) => (t += r.values[key] ?? 0));
}

