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
