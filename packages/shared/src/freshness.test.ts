import { describe, expect, it } from 'vitest';
import { computeBadge, slowestFreshness, type Freshness } from './freshness';
import { formatBadgeTime } from './time';

// 2026-10-22 14:03 KST
const NOW = Date.UTC(2026, 9, 22, 5, 3, 0);

const rt: Freshness = { source: 'KIS', mode: 'realtime', asOf: NOW - 1000, receivedAt: NOW - 1000 };
const poll5: Freshness = { source: 'KIS', mode: 'poll', asOf: NOW - 2000, receivedAt: NOW - 2000, intervalMs: 5000 };

describe('신선도 배지', () => {
  it('실시간은 배지가 없어요', () => {
    expect(computeBadge(rt, { now: NOW, sourceConnected: true, sessionOpen: true })).toMatchObject({
      state: 'realtime',
      long: null,
      short: null,
    });
  });

  it('실시간인데 연결이 끊기면 멈춤', () => {
    const b = computeBadge(rt, { now: NOW, sourceConnected: false });
    expect(b?.state).toBe('stale');
    expect(b?.long).toBe('⚠ 멈춤 14:02');
    expect(b?.inverted).toBe(true);
  });

  it('실시간인데 장이 끝나면 마감', () => {
    const b = computeBadge({ ...rt, asOf: Date.UTC(2026, 9, 22, 6, 30) }, { now: NOW + 3600_000, sessionOpen: false });
    expect(b?.long).toBe('마감 15:30');
    expect(b?.short).toBe('마감');
  });

  it('주기 조회', () => {
    expect(computeBadge(poll5, { now: NOW })).toMatchObject({ long: '5초 주기', short: '5초' });
  });

  it('주기의 3배와 1분 중 긴 시간이 지나면 멈춤', () => {
    expect(computeBadge(poll5, { now: NOW + 50_000 })?.state).toBe('poll');
    expect(computeBadge(poll5, { now: NOW + 61_000 })?.state).toBe('stale');
  });

  it('지연이 있으면 더 늦은 쪽(지연)을 보여요', () => {
    const f: Freshness = { ...poll5, mode: 'delayed', intervalMs: 60_000, delayMs: 15 * 60_000 };
    expect(computeBadge(f, { now: NOW })).toMatchObject({ long: '15분 지연', short: '지연' });
  });

  it('일별은 원천 기준일', () => {
    const f: Freshness = { source: 'FX', mode: 'daily', asOf: NOW, receivedAt: NOW, asOfDate: '2026-10-21' };
    expect(computeBadge(f, { now: NOW })).toMatchObject({ long: '일별 10/21', short: '일별' });
  });

  it('발표 주기', () => {
    const f: Freshness = { source: 'FX', mode: 'release', asOf: NOW, receivedAt: NOW, asOfDate: '2026-09', period: 'M' };
    expect(computeBadge(f, { now: NOW })).toMatchObject({ long: '기준 2026-09', short: '월간' });
  });

  it('계산한 값은 가장 늦은 입력을 따라가요', () => {
    const fx30: Freshness = { source: 'FX', mode: 'poll', asOf: NOW, receivedAt: NOW, intervalMs: 30_000 };
    expect(slowestFreshness([rt, fx30])).toBe(fx30);
  });
});

describe('배지 시각 표기', () => {
  it('오늘은 시각, 다른 날은 날짜, 1년이 넘으면 연도', () => {
    expect(formatBadgeTime(NOW, NOW)).toBe('14:03');
    expect(formatBadgeTime(NOW - 86400_000, NOW)).toBe('10/21');
    expect(formatBadgeTime(NOW - 400 * 86400_000, NOW)).toBe('2025-09-17');
  });
});
