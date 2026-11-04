import { describe, expect, it } from 'vitest';
import { cumulative, flowCell } from './flowCalc';

describe('수급 화면', () => {
  it('누적 순매수는 오래된 날부터 더해요(줄은 최근이 먼저)', () => {
    const rows = [
      { date: '2026-11-04', values: { a: 3 } },
      { date: '2026-11-03', values: { a: -1 } },
      { date: '2026-11-02', values: { a: 2 } },
    ];
    expect(cumulative(rows, 'a')).toEqual([2, 1, 4]);
  });
  it('금액은 억 원, 작은 금액(평균가)은 원, 비율은 %', () => {
    expect(flowCell({ key: 'x', label: '', unit: 'krw', signed: true }, 12_345_000_000)).toBe('+123.5');
    expect(flowCell({ key: 'x', label: '', unit: 'krw' }, 50_000)).toBe('50,000');
    expect(flowCell({ key: 'x', label: '', unit: 'pct' }, 3.456)).toBe('3.46%');
    expect(flowCell({ key: 'x', label: '', unit: 'shares', signed: true }, -1200)).toBe('-1,200');
    expect(flowCell({ key: 'x', label: '', unit: 'shares' }, undefined)).toBe('—');
  });
});
