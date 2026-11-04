import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '@bt/shared';
import { indicatorOf, transformSeries } from './eco';

describe('ECO 발표 이름', () => {
  it('원천 이름으로 지표를 찾고, 주별 GDP는 GDP와 따로', () => {
    expect(indicatorOf('Consumer Price Index')?.name).toContain('CPI');
    expect(indicatorOf('Gross Domestic Product')?.series?.id).toBe('A191RL1Q225SBEA');
    expect(indicatorOf('Gross Domestic Product by State and Personal Income by State')?.series).toBeUndefined();
    expect(indicatorOf('Something Else')).toBeUndefined();
  });
});

describe('실제·이전 값', () => {
  const obs = (vals: number[]) => vals.map((v, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, value: String(v) }));
  it('전년 대비(12개 앞), 전월 대비, 증감, 그대로', () => {
    const o = obs([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 103, 104]);
    expect(transformSeries(o, { id: 'X', transform: 'yoy', unit: '%' })).toMatchObject({ latest: '4.0%', previous: '3.0%' });
    expect(transformSeries(obs([200, 202]), { id: 'X', transform: 'mom', unit: '%' }).latest).toBe('1.0%');
    expect(transformSeries(obs([150000, 150250]), { id: 'X', transform: 'diff', unit: '천 명', digits: 0 }).latest).toBe('250 천 명');
    expect(transformSeries(obs([4.25, 4.5]), { id: 'X', transform: 'level', unit: '%', digits: 2 })).toMatchObject({ latest: '4.50%', previous: '4.25%' });
  });
  it('빈 값(".")은 건너뛰어요', () => {
    expect(transformSeries([{ date: '2026-01-01', value: '.' }, { date: '2026-02-01', value: '5' }], { id: 'X', transform: 'level', unit: '' }).latest).toBe('5.0');
  });
});

describe('관례 시각(뉴욕) → UTC', () => {
  it('서머타임이면 UTC-4, 아니면 UTC-5', () => {
    expect(new Date(zonedToUtc('2026-07-15', '08:30', 'America/New_York')).toISOString()).toBe('2026-07-15T12:30:00.000Z');
    expect(new Date(zonedToUtc('2026-12-10', '08:30', 'America/New_York')).toISOString()).toBe('2026-12-10T13:30:00.000Z');
    expect(new Date(zonedToUtc('2026-11-04', '09:00', 'Asia/Seoul')).toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });
});
