// ALRT 알림 감시(v0.3): 메인 창에 늘 붙어 있어서 패널을 닫아도 켜진 알림 종목의 시세를 지켜봐요.
// 조건이 맞으면 알림(앱 안 알림 + 설정에 따라 운영체제 알림·소리)을 띄우고 기록을 남겨요. 데모 시세로는 알리지 않아요.

import { useEffect, useMemo, useRef } from 'react';
import { ALERT_KIND_LABEL, ecoAlertsDue, evaluateAlert, type AlertRule, type EcoResponse, type NewsViewResponse } from '@bt/shared';
import { api } from '../api';
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

/** 알림 띄우기(앱 안 알림 + 설정에 따라 운영체제 알림·소리) */
function notify(texts: string[]) {
  const cfg = settings.get().alerts ?? { system: true, sound: true };
  for (const t of texts) {
    showToast(`🔔 ${t}`, undefined, 10_000);
    if (cfg.system && typeof Notification !== 'undefined') {
      const show = () => new Notification('TICKER 알림', { body: t, silent: true });
      if (Notification.permission === 'granted') show();
      else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => p === 'granted' && show());
    }
  }
  if (cfg.sound && texts.length) beep();
}

const NEWS_POLL_MS = 2 * 60_000;

/** ALRT 뉴스 조건(v0.4): 2분마다 아카이브를 찾아 마지막으로 알린 뒤의 새 줄이 있으면 알려요 */
function useNewsAlerts() {
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const rules = (appState.get().alerts?.newsRules ?? []).filter((r) => r.enabled);
      for (const r of rules) {
        try {
          const res = await api.get<NewsViewResponse>(`/api/news/search?q=${encodeURIComponent(r.query)}&since=${r.lastSeen + 1}&days=2`);
          if (!alive || res.items.length === 0) continue;
          const newest = Math.max(...res.items.map((x) => x.published));
          const at = Date.now();
          const text = `뉴스 "${r.query}" ${res.items.length}건: ${res.items[0].title}`;
          updateState('alerts', (s) => ({
            ...s,
            rules: s?.rules ?? [],
            newsRules: (s?.newsRules ?? []).map((x) => (x.id === r.id ? { ...x, lastSeen: newest, lastFiredAt: at } : x)),
            log: [{ ruleId: r.id, instrumentId: '', at, text }, ...(s?.log ?? [])].slice(0, 100),
          }));
          notify([text]);
        } catch {
          // 다음 차례에 다시
        }
      }
    };
    const t = window.setInterval(() => void check(), NEWS_POLL_MS);
    const first = window.setTimeout(() => void check(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.clearTimeout(first);
    };
  }, []);
}

/** ALRT 지표 조건(v0.4): 1분마다 ECO 일정을 보고(서버는 3시간 동안 같은 값을 써요) 미리 알림·발표 알림 */
function useEcoAlerts() {
  useEffect(() => {
    let alive = true;
    let eco: { at: number; data?: EcoResponse } = { at: 0 };
    const check = async () => {
      const rules = (appState.get().alerts?.ecoRules ?? []).filter((r) => r.enabled);
      if (!rules.length) return;
      if (Date.now() - eco.at > 10 * 60_000) {
        try {
          eco = { at: Date.now(), data: await api.get<EcoResponse>('/api/eco') };
        } catch {
          return;
        }
      }
      if (!alive || !eco.data) return;
      const now = Date.now();
      const due = rules.map((r) => ({ r, items: ecoAlertsDue(r, eco.data!.events, now) })).filter((x) => x.items.length);
      if (!due.length) return;
      updateState('alerts', (s) => ({
        ...s,
        rules: s?.rules ?? [],
        ecoRules: (s?.ecoRules ?? []).map((x) => {
          const d = due.find((y) => y.r.id === x.id);
          return d ? { ...x, fired: [...x.fired, ...d.items.map((i) => i.key)].slice(-50), lastFiredAt: now } : x;
        }),
        log: [...due.flatMap((d) => d.items.map((i) => ({ ruleId: d.r.id, instrumentId: '', at: now, text: i.text }))), ...(s?.log ?? [])].slice(0, 100),
      }));
      notify(due.flatMap((d) => d.items.map((i) => i.text)));
    };
    const t = window.setInterval(() => void check(), 60_000);
    const first = window.setTimeout(() => void check(), 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.clearTimeout(first);
    };
  }, []);
}

export function AlertWatcher() {
  useNewsAlerts();
  useEcoAlerts();
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
      newsRules: s?.newsRules,
      ecoRules: s?.ecoRules,
      log: [...fired.map((f) => ({ ruleId: f.rule.id, instrumentId: f.rule.instrumentId, at, text: f.text })), ...(s?.log ?? [])].slice(0, 100),
    }));
    notify(fired.map((f) => f.text));
  }, [quotes, rules]);
  // 지운 규칙의 기억은 버려요
  useEffect(() => {
    const live = new Set((appState.get().alerts?.rules ?? []).map((r) => r.id));
    for (const id of armed.current.keys()) if (!live.has(id)) armed.current.delete(id);
  }, [rules]);
  return null;
}
