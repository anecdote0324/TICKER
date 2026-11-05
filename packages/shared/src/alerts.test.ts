import { describe, expect, it } from 'vitest';
import { alertDistance, evaluateAlert, type AlertRule } from './alerts';

const rule = (p: Partial<AlertRule>): AlertRule => ({ id: 'a', instrumentId: 'EQ:KS:005930', kind: 'above', value: 70000, enabled: true, once: true, createdAt: 0, ...p });

describe('알림 판단', () => {
  it('조건이 맞으면 알리고(이미 맞아 있어도), 다시 풀릴 때까지 또 알리지 않아요', () => {
    let s = evaluateAlert(rule({}), true, 71000, 1);
    expect(s).toEqual({ fire: true, armed: false });
    s = evaluateAlert(rule({}), s.armed, 72000, 1);
    expect(s.fire).toBe(false);
    s = evaluateAlert(rule({}), s.armed, 69000, 1);
    expect(s).toEqual({ fire: false, armed: true });
    expect(evaluateAlert(rule({}), s.armed, 70000, 1).fire).toBe(true);
  });
  it('등락률 조건, 꺼진 규칙, 값 없음', () => {
    expect(evaluateAlert(rule({ kind: 'pctBelow', value: -3 }), true, 1, -3.2).fire).toBe(true);
    expect(evaluateAlert(rule({ enabled: false }), true, 99999, 1).fire).toBe(false);
    expect(evaluateAlert(rule({}), true, undefined, undefined)).toEqual({ fire: false, armed: true });
  });
  it('남은 거리(%)', () => {
    expect(alertDistance(rule({}), 66500, 0)).toBeCloseTo(5.263, 2);
    expect(alertDistance(rule({ kind: 'pctAbove', value: 3 }), 1, 1.2)).toBeCloseTo(1.8, 5);
  });
});

describe('ALRT 지표 조건(v0.4)', async () => {
  const { ecoAlertsDue } = await import('./alerts');
  const rule = { id: 'e1', name: 'CPI', beforeMin: 15, enabled: true, createdAt: 0, fired: [] as string[] };
  const at = Date.parse('2026-11-12T13:30:00Z');
  const ev = [{ id: 'cpi-1112', name: 'CPI', at, latest: '3.0%', previous: '2.9%' }];
  it('발표 15분 전부터 미리 알림, 발표 뒤 값 알림, 한 번씩만', () => {
    expect(ecoAlertsDue(rule, ev, at - 20 * 60_000)).toEqual([]);
    const pre = ecoAlertsDue(rule, ev, at - 10 * 60_000);
    expect(pre.map((x) => x.key)).toEqual(['pre:cpi-1112']);
    expect(pre[0].text).toContain('10분 전');
    const rel = ecoAlertsDue({ ...rule, fired: ['pre:cpi-1112'] }, ev, at + 60_000);
    expect(rel).toEqual([{ key: 'rel:cpi-1112', text: '지표 CPI 발표: 3.0% (이전 2.9%)' }]);
    expect(ecoAlertsDue({ ...rule, fired: ['pre:cpi-1112', 'rel:cpi-1112'] }, ev, at + 60_000)).toEqual([]);
  });
  it('규칙을 만들기 전 발표나 6시간 지난 발표, 다른 지표, 꺼진 규칙은 알리지 않아요', () => {
    expect(ecoAlertsDue({ ...rule, createdAt: at + 1 }, ev, at + 60_000)).toEqual([]);
    expect(ecoAlertsDue(rule, ev, at + 7 * 3600_000)).toEqual([]);
    expect(ecoAlertsDue({ ...rule, name: 'PPI' }, ev, at + 60_000)).toEqual([]);
    expect(ecoAlertsDue({ ...rule, enabled: false }, ev, at + 60_000)).toEqual([]);
  });
});
