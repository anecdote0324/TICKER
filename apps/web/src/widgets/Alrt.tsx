// ALRT 알림(03 v0.3): 가격·등락률 조건 알림 만들기·켜고 끄기·지우기와 최근 알림 기록.
// 감시는 메인 창의 AlertWatcher가 해요(이 패널을 닫아도 동작). 앱이 켜져 있을 때만 알려요.

import { useEffect, useMemo, useState } from 'react';
import { ALERT_KIND_LABEL, alertDistance, type AlertKind, type AlertRule, type Instrument } from '@bt/shared';
import { fmtPct, fmtPrice } from '../format';
import { useQuotes } from '../stores/feed';
import { getInstrument, index, useInstrument } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Alrt({ panel }: { panel: PanelState }) {
  const state = useStore(appState, (s) => s.alerts ?? { rules: [], log: [] });
  const panelInst = useInstrument(panel.securityId);
  const ids = useMemo(() => [...new Set(state.rules.map((r) => r.instrumentId))], [state.rules]);
  const quotes = useQuotes(ids);
  const setRules = (f: (rules: AlertRule[]) => AlertRule[]) => updateState('alerts', (s) => ({ rules: f(s?.rules ?? []), log: s?.log ?? [] }));
  const demo = [...quotes.values()].some((q) => q.fresh.mode === 'demo');
  return (
    <>
      <TitleBar fn="ALRT" name="알림" sub={`${state.rules.filter((r) => r.enabled).length}개 켜짐 · 앱이 켜져 있을 때만`} />
      <div className="pbody alrt">
        <AlrtAdd initial={panelInst?.assetClass === 'EQUITY' || panelInst?.assetClass === 'CRYPTO' || panelInst?.assetClass === 'CURNCY' || panelInst?.assetClass === 'INDEX' ? panelInst : undefined} onAdd={(r) => setRules((rs) => [...rs, r])} />
        {demo && <div className="gc-note label">데모 시세인 종목은 알리지 않아요(한국투자증권 키를 넣으면 실제 시세로 알려요).</div>}
        {state.rules.length === 0 ? (
          <div className="empty-body label">알림이 없어요. 위에서 종목과 조건을 넣어 만들어요.</div>
        ) : (
          <table className="port-table">
            <thead>
              <tr>
                <th>종목</th>
                <th>조건</th>
                <th>지금</th>
                <th>남은 거리</th>
                <th>방식</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.rules.map((r) => {
                const inst = getInstrument(r.instrumentId);
                const q = quotes.get(r.instrumentId);
                const price = r.kind === 'above' || r.kind === 'below';
                const dist = alertDistance(r, q?.last, q?.changePct);
                return (
                  <tr key={r.id} onClick={() => setPanelSecurity(panel.id, r.instrumentId)} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                    <td>
                      <span className="port-name">{inst?.nameKo || inst?.nameEn || r.instrumentId}</span> <span className="cd">{inst?.code}</span>
                    </td>
                    <td className="num">
                      {ALERT_KIND_LABEL[r.kind]} {price ? fmtPrice(inst, r.value) : `${r.value}%`}
                    </td>
                    <td className="num">{price ? fmtPrice(inst, q?.last) : fmtPct(q?.changePct)}</td>
                    <td className="num">{dist === undefined ? '—' : price ? `${dist > 0 ? '+' : ''}${dist.toFixed(2)}%` : `${dist > 0 ? '+' : ''}${dist.toFixed(2)}%p`}</td>
                    <td>{r.once ? '한 번' : '반복'}</td>
                    <td>{r.enabled ? '켜짐' : r.lastFiredAt ? `알림 ${when(r.lastFiredAt)}` : '꺼짐'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn" onClick={() => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}>
                        {r.enabled ? '끄기' : '켜기'}
                      </button>
                      <button className="icon-btn" aria-label="지우기" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {state.log.length > 0 && (
          <>
            <div className="grp" style={{ marginTop: 8 }}>
              <span style={{ flex: 1 }}>최근 알림</span>
              <button className="icon-btn" title="기록 지우기" onClick={() => updateState('alerts', (s) => ({ rules: s?.rules ?? [], log: [] }))}>
                ✕
              </button>
            </div>
            {state.log.slice(0, 30).map((l, i) => (
              <div key={`${l.at}${i}`} className="row" onClick={() => setPanelSecurity(panel.id, l.instrumentId)}>
                <span className="num label" style={{ width: 90 }}>
                  {when(l.at)}
                </span>
                <span>{l.text}</span>
              </div>
            ))}
          </>
        )}
        <div className="attr">조건이 맞으면 앱 안 알림을 띄우고, 설정 → 알림에 따라 운영체제 알림과 소리도 내요. 이미 조건이 맞아 있으면 만들자마자 알려요. '반복'은 조건이 풀렸다가 다시 맞을 때마다 알려요.</div>
      </div>
    </>
  );
}

function AlrtAdd({ initial, onAdd }: { initial?: Instrument; onAdd: (r: AlertRule) => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Instrument | undefined>(initial);
  const [kind, setKind] = useState<AlertKind>('above');
  const [value, setValue] = useState('');
  const [once, setOnce] = useState(true);
  useEffect(() => setPick(initial), [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => {
    if (!q.trim() || pick) return [];
    return index
      .search(q, { first: false })
      .sort((a, b) => a.tier - b.tier || a.sub - b.sub || (b.rec.inst.popularity ?? 0) - (a.rec.inst.popularity ?? 0))
      .slice(0, 6)
      .map((m) => m.rec.inst);
  }, [q, pick]);
  const v = Number(value.replace(/,/g, ''));
  const ok = !!pick && value !== '' && Number.isFinite(v);
  const add = () => {
    if (!ok || !pick) return;
    onAdd({ id: `a${Date.now().toString(36)}`, instrumentId: pick.id, kind, value: v, enabled: true, once, createdAt: Date.now() });
    setValue('');
  };
  return (
    <div className="port-add">
      {pick ? (
        <button className="btn" onClick={() => (setPick(undefined), setQ(''))} title="다른 종목 고르기">
          {pick.nameKo || pick.nameEn} {pick.code} ✕
        </button>
      ) : (
        <input placeholder="종목코드·이름" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && results[0] && setPick(results[0])} />
      )}
      <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
        {(Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => (
          <option key={k} value={k}>
            {ALERT_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input placeholder={kind === 'above' || kind === 'below' ? '가격' : '% (예: 3, -3)'} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 110 }} />
      <label className="label" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input type="checkbox" checked={!once} onChange={(e) => setOnce(!e.target.checked)} /> 반복
      </label>
      <button className="btn primary" disabled={!ok} onClick={add}>
        알림 만들기
      </button>
      {results.map((r) => (
        <div key={r.id} className="row" onClick={() => setPick(r)}>
          <span className="nm">
            <span>{r.nameKo ?? r.nameEn}</span>
            <span className="cd">{r.code}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
