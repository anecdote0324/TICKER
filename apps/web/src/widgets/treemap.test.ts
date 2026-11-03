import { describe, expect, it } from 'vitest';
import { periodReturn } from './sector';
import { squarify } from './treemap';

describe('타일 배치', () => {
  it('넓이는 값에 비례하고 상자를 꽉 채워요', () => {
    const vals = [6, 6, 4, 3, 2, 2, 1];
    const r = squarify(vals, { x: 0, y: 0, w: 600, h: 400 });
    const total = vals.reduce((s, v) => s + v, 0);
    r.forEach((x, i) => expect(x.w * x.h).toBeCloseTo((vals[i] / total) * 240000, 3));
    for (const x of r) {
      expect(x.x).toBeGreaterThanOrEqual(-1e-6);
      expect(x.y).toBeGreaterThanOrEqual(-1e-6);
      expect(x.x + x.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(x.y + x.h).toBeLessThanOrEqual(400 + 1e-6);
    }
  });
  it('들어온 순서대로 돌려주고, 0이나 빈 상자는 크기 0', () => {
    const r = squarify([1, 9], { x: 10, y: 10, w: 100, h: 100 });
    expect(r[1].w * r[1].h).toBeGreaterThan(r[0].w * r[0].h);
    expect(squarify([0, 0], { x: 0, y: 0, w: 10, h: 10 }).every((x) => x.w === 0)).toBe(true);
  });
});


describe('업종 기간 등락', () => {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const closes = [
    { t: day('2025-12-30'), c: 100 },
    { t: day('2026-01-02'), c: 102 },
    { t: day('2026-10-27'), c: 110 },
    { t: day('2026-10-30'), c: 120 },
    { t: day('2026-11-02'), c: 125 },
  ];
  const now = day('2026-11-03') + 3600;
  it('올해는 작년 마지막 종가 대비, 1주는 7일 전보다 앞선 마지막 종가 대비', () => {
    expect(periodReturn(closes, 130, 'YTD', now)).toBeCloseTo(30, 6);
    expect(periodReturn(closes, 130, '1W', now)).toBeCloseTo((130 / 110 - 1) * 100, 6);
  });
  it('지금 값이 없으면 마지막 종가, 기준이 없으면 비워요', () => {
    expect(periodReturn(closes, undefined, '1W', now)).toBeCloseTo((125 / 110 - 1) * 100, 6);
    expect(periodReturn(closes.slice(3), 130, '3M', now)).toBeUndefined();
  });
});
