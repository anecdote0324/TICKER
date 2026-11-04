// ALRT 알림 감시(v0.3): 메인 창에 늘 붙어 있어서 패널을 닫아도 켜진 알림 종목의 시세를 지켜봐요.
// 조건이 맞으면 알림(앱 안 알림 + 설정에 따라 운영체제 알림·소리)을 띄우고 기록을 남겨요. 데모 시세로는 알리지 않아요.

import { useEffect, useMemo, useRef } from 'react';
import { ALERT_KIND_LABEL, evaluateAlert, type AlertRule } from '@bt/shared';
import { fmtPct, fmtPrice } from '../format';
import { useQuotes } from '../stores/feed';
import { getInstrument } from '../stores/instruments';
import { settings } from '../stores/settings';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { showToast } from '../stores/ui';

export function alertText(rule: AlertRule, last: number | undefined, pct: number | undefined): string {
  const inst = getInstrument(rule.instrumentId);
  const name = inst ? inst.nameKo || inst.nameEn || inst.code : rule.instrumentId;
  const now = rule.kind === 'above' || rule.kind === 'below' ? fmtPrice(inst, last) : fmtPct(pct);
  const cond = rule.kind === 'above' || rule.kind === 'below' ? fmtPrice(inst, rule.value) : `${rule.value}%`;
  return `${name} ${now} · ${ALERT_KIND_LABEL[rule.kind]} ${cond}`;
}

/** 짧은 알림음(두 번 삑) */
function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.12);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // 소리를 낼 수 없는 환경
  }
}

export function AlertWatcher() {
  const rules = useStore(appState, (s) => s.alerts?.rules ?? []);
  const ids = useMemo(() => [...new Set(rules.filter((r) => r.enabled).map((r) => r.instrumentId))], [rules]);
  const quotes = useQuotes(ids);
  /** 규칙 id → 다시 알릴 수 있는지(조건이 풀렸는지) */
  const armed = useRef(new Map<string, boolean>());
  useEffect(() => {
    const fired: Array<{ rule: AlertRule; text: string }> = [];
    for (const r of rules) {
      if (!r.enabled) continue;
      const q = quotes.get(r.instrumentId);
      if (!q || q.fresh.mode === 'demo') continue;
      const res = evaluateAlert(r, armed.current.get(r.id) ?? true, q.last, q.changePct);
      armed.current.set(r.id, res.armed);
      if (res.fire) fired.push({ rule: r, text: alertText(r, q.last, q.changePct) });
    }
    if (!fired.length) return;
    const at = Date.now();
    updateState('alerts', (s) => ({
      rules: (s?.rules ?? []).map((r) => {
        const f = fired.find((x) => x.rule.id === r.id);
        return f ? { ...r, lastFiredAt: at, enabled: r.once ? false : r.enabled } : r;
      }),
      log: [...fired.map((f) => ({ ruleId: f.rule.id, instrumentId: f.rule.instrumentId, at, text: f.text })), ...(s?.log ?? [])].slice(0, 100),
    }));
    const cfg = settings.get().alerts ?? { system: true, sound: true };
    for (const f of fired) {
      showToast(`🔔 ${f.text}`, undefined, 10_000);
      if (cfg.system && typeof Notification !== 'undefined') {
        const show = () => new Notification('TICKER 알림', { body: f.text, silent: true });
        if (Notification.permission === 'granted') show();
        else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => p === 'granted' && show());
      }
    }
    if (cfg.sound) beep();
  }, [quotes, rules]);
  // 지운 규칙의 기억은 버려요
  useEffect(() => {
    const live = new Set((appState.get().alerts?.rules ?? []).map((r) => r.id));
    for (const id of armed.current.keys()) if (!live.has(id)) armed.current.delete(id);
  }, [rules]);
  return null;
}
