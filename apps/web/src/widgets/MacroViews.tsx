// v0.6 매크로: ECOD 지표 상세(발표 이력·수정), ECST 경제 통계(한국·미국·내 통계, KOSIS), ECOF 지표 찾기,
// ECMX 세계 경제 매트릭스(세계은행), IFMO 인플레이션 모니터(물가·기대인플레 탭).
// 시계열은 /api/macro/series, 첫 발표 값은 /api/macro/vintage, 찾기는 /api/macro/search, 매트릭스는 /api/macro/matrix.

import { useMemo, useState } from 'react';
import {
  ECMX_COUNTRIES,
  ECMX_INDICATORS,
  MACRO_SERIES,
  TRANSFORM_LABEL,
  macroDef,
  periodLabel,
  type CentralBankResponse,
  type MacroFreq,
  type MacroGroup,
  type MacroObs,
  type MacroResponse,
  type MacroSearchResponse,
  type MacroSeriesDef,
  type MatrixResponse,
  type VintageResponse,
} from '@bt/shared';
import { dirClass } from '../format';
import { applyExecution, patchPanel, type PanelState } from '../stores/panels';
import { appState, updateState, type MacroCustom } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar, usePoll } from './common';
import { openLink } from './News';
import { Spark } from './RatesViews';

const POLL = 60 * 60_000;
const COUNTRY: Record<string, string> = { KR: '한국', US: '미국', EU: '유로' };

function useSeries(ids: string[]) {
  const key = ids.join(',');
  const res = usePoll<MacroResponse>(ids.length ? `/api/macro/series?ids=${encodeURIComponent(key)}` : '', POLL);
  const map = useMemo(() => new Map((res?.data?.series ?? []).map((s) => [s.id, s])), [res?.data]);
  return { res, map };
}

function fmt(v: number | undefined, def?: Pick<MacroSeriesDef, 'digits' | 'unit'>, unit = true) {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toLocaleString('en-US', { minimumFractionDigits: def?.digits ?? 1, maximumFractionDigits: def?.digits ?? 1 });
  return unit && def?.unit ? (def.unit === '%' ? `${s}%` : `${s} ${def.unit}`) : s;
}

/** 날짜순 값에서 n칸 앞 */
const back = (obs: MacroObs[], n: number) => obs[obs.length - 1 - n]?.value;
const PER_YEAR: Record<MacroFreq, number> = { D: 260, W: 52, M: 12, Q: 4, A: 1 };

/** ECOD로 열기 */
export function openEcod(panelId: string, id: string) {
  applyExecution(panelId, { kind: 'function', fn: 'ECOD', canonical: 'ECOD', notes: [] });
  patchPanel(panelId, { macroId: id });
}

function MissingNote({ res }: { res?: { data?: { missing: Array<{ id: string; reason: string }> }; error?: string } }) {
  if (res?.error && !res.data) return <div className="des-note err">{res.error}</div>;
  const miss = res?.data?.missing ?? [];
  if (!miss.length) return null;
  return <div className="label fx-warn">{`일부 없음: ${[...new Set(miss.map((m) => m.reason))].join(' / ')}`}</div>;
}

/** 선 그래프(가로 날짜, 세로 값). 0을 넘나들면 0 선 */
export function LineChart({ obs, height = 180 }: { obs: MacroObs[]; height?: number }) {
  if (obs.length < 2) return <div className="label">그래프를 그릴 값이 모자라요</div>;
  const W = 640;
  const H = height;
  const left = 46;
  const pad = 8;
  const vals = obs.map((o) => o.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.05;
  const x = (i: number) => left + (i / (obs.length - 1)) * (W - left - pad);
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - pad * 2 - 14);
  const pts = obs.map((o, i) => `${x(i).toFixed(1)},${y(o.value).toFixed(1)}`).join(' ');
  const ticks = [hi - (hi - lo) * 0.05, (hi + lo) / 2, lo + (hi - lo) * 0.05];
  const dig = span < 2 ? 2 : span < 50 ? 1 : 0;
  const labels = [0, Math.floor((obs.length - 1) / 2), obs.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="macro-chart" role="img" aria-label="시계열 그래프">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - pad} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="0.6" />
          <text x={left - 5} y={y(t) + 3} textAnchor="end" className="dots-axis">
            {t.toFixed(dig)}
          </text>
        </g>
      ))}
      {lo < 0 && hi > 0 && <line x1={left} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeWidth="0.8" />}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.4" />
      {labels.map((i) => (
        <text key={i} x={x(i)} y={H - 2} textAnchor={i === 0 ? 'start' : i === obs.length - 1 ? 'end' : 'middle'} className="dots-axis">
          {obs[i].date.slice(0, 7)}
        </text>
      ))}
    </svg>
  );
}

// ── ECOD 지표 상세 ──

function SeriesPicker({ onPick }: { onPick: (id: string) => void }) {
  const groups = ['KR', 'US', 'EU'].map((c) => ({ c, list: MACRO_SERIES.filter((d) => d.country === c) }));
  return (
    <div className="ecod-pick">
      {groups.map((g) => (
        <div key={g.c}>
          <div className="cb-sub label">{COUNTRY[g.c]}</div>
          {g.list.map((d) => (
            <button key={d.id} className="linkish ecod-item" onClick={() => onPick(d.id)}>
              <span className="label">{d.group}</span> {d.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Ecod({ panel }: { panel: PanelState }) {
  const id = panel.macroId;
  const years = panel.ecodYears ?? 5;
  const { res, map } = useSeries(id ? [id] : []);
  const vin = usePoll<VintageResponse>(id?.startsWith('FRED:') ? `/api/macro/vintage?id=${encodeURIComponent(id)}` : '', POLL);
  const def = id ? macroDef(id) : undefined;
  const s = id ? map.get(id) : undefined;
  const freq: MacroFreq = def?.freq ?? (s && s.obs.length > 1 ? guessFreq(s.obs) : 'M');
  const shown = s ? s.obs.slice(-Math.max(2, PER_YEAR[freq] * years)) : [];
  const initial = useMemo(() => new Map((vin?.data?.initial ?? []).map((o) => [o.date, o.value])), [vin?.data]);
  const name = def?.name ?? s?.title ?? id ?? '';
  const tools = id ? (
    <>
      {[2, 5, 10].map((y) => (
        <button key={y} className={years === y ? 'on' : ''} onClick={() => patchPanel(panel.id, { ecodYears: y })}>
          {`${y}Y`}
        </button>
      ))}
      <button onClick={() => patchPanel(panel.id, { macroId: undefined })}>목록</button>
    </>
  ) : undefined;
  const rows = s ? s.obs.slice(-24).reverse() : [];
  const fd = def ?? { digits: 2, unit: '' };
  return (
    <>
      <TitleBar fn="ECOD" name="지표 상세" sub={id ? name : undefined} fresh={res?.data?.fresh} tools={tools} />
      <div className="pbody flow">
        {!id && (
          <>
            <div className="des-note label">볼 지표를 골라요. 다른 지표는 ECOF⏎에서 찾아 열어요.</div>
            <SeriesPicker onPick={(x) => patchPanel(panel.id, { macroId: x })} />
          </>
        )}
        {id && (
          <>
            <MissingNote res={res} />
            {!res && <div className="des-note label">받는 중…</div>}
            <div className="cb-sub">
              <b>{name}</b>
              <span className="label">{[def ? COUNTRY[def.country] : undefined, def ? TRANSFORM_LABEL[def.transform] : s?.units, def?.unit, id.split(':')[0]].filter(Boolean).join(' · ')}</span>
            </div>
            {s && <LineChart obs={shown} />}
            {s && (
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>기간</th>
                    <th>지금 값</th>
                    <th>전기 대비</th>
                    {id.startsWith('FRED:') && <th>첫 발표</th>}
                    {id.startsWith('FRED:') && <th>수정</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => {
                    const prev = rows[i + 1]?.value;
                    const first = initial.get(o.date);
                    const rev = first !== undefined ? o.value - first : undefined;
                    return (
                      <tr key={o.date}>
                        <td>{periodLabel(o.date, freq)}</td>
                        <td>{fmt(o.value, fd)}</td>
                        <td className={dirClass(prev === undefined ? undefined : o.value - prev)}>{prev === undefined ? '—' : fmt(o.value - prev, fd, false)}</td>
                        {id.startsWith('FRED:') && <td>{first === undefined ? '—' : fmt(first, fd)}</td>}
                        {id.startsWith('FRED:') && <td className={dirClass(rev)}>{rev === undefined || Math.abs(rev) < 1e-9 ? '' : fmt(rev, fd, false)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {vin?.data?.error && <div className="label">{vin.data.error}</div>}
          </>
        )}
      </div>
      <div className="attr">
        {id?.startsWith('FRED:')
          ? '첫 발표는 ALFRED(FRED 과거 판)의 처음 나온 수준 값으로 같은 방식(전년 대비 등)으로 다시 계산한 값이에요. 수정 = 지금 값 − 첫 발표. FRED 키 필요'
          : 'ECOS(한국은행)는 지금 값만 줘서 한국 지표의 수정 이력은 없어요. ECOS 인증키 필요'}
      </div>
    </>
  );
}

function guessFreq(obs: MacroObs[]): MacroFreq {
  const d = (Date.parse(obs[obs.length - 1].date) - Date.parse(obs[obs.length - 2].date)) / 86400_000;
  return d <= 4 ? 'D' : d <= 8 ? 'W' : d <= 40 ? 'M' : d <= 100 ? 'Q' : 'A';
}

// ── ECST 경제 통계 ──

const GROUPS: MacroGroup[] = ['성장', '물가', '고용', '대외', '심리', '기대인플레'];

function StatTable({ defs, panelId }: { defs: MacroSeriesDef[]; panelId: string }) {
  const { res, map } = useSeries(defs.map((d) => d.id));
  return (
    <>
      <MissingNote res={res} />
      {!res && <div className="des-note label">받는 중…</div>}
      <table className="flow-table">
        <thead>
          <tr>
            <th>지표</th>
            <th>최근</th>
            <th>기간</th>
            <th>이전</th>
            <th>1년 전</th>
            <th>5년</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.flatMap((g) => {
            const list = defs.filter((d) => d.group === g);
            if (!list.length) return [];
            return [
              <tr key={g} className="macro-group">
                <td colSpan={6}>{g}</td>
              </tr>,
              ...list.map((d) => {
                const s = map.get(d.id);
                const obs = s?.obs ?? [];
                const last = obs[obs.length - 1];
                const prev = back(obs, 1);
                return (
                  <tr key={d.id} className="click" onClick={() => openEcod(panelId, d.id)} title="눌러서 지표 상세(ECOD)">
                    <td>{d.name}</td>
                    <td className={dirClass(last && prev !== undefined ? last.value - prev : undefined)}>{fmt(last?.value, d)}</td>
                    <td className="label">{last ? periodLabel(last.date, d.freq) : ''}</td>
                    <td>{fmt(prev, d, false)}</td>
                    <td>{fmt(back(obs, PER_YEAR[d.freq]), d, false)}</td>
                    <td>
                      <Spark values={obs.slice(-PER_YEAR[d.freq] * 5).map((o) => o.value)} />
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </>
  );
}

function KosisRow({ item, panelId: _panelId, onRemove }: { item: MacroCustom; panelId: string; onRemove: () => void }) {
  const res = usePoll<{ groups: Array<{ name: string; unit: string; freq: MacroFreq; obs: MacroObs[] }>; error?: string }>(`/api/macro/kosis?url=${encodeURIComponent(item.kosisUrl!)}`, POLL);
  const g = res?.data?.groups[0];
  const last = g?.obs[g.obs.length - 1];
  return (
    <tr>
      <td>{item.name}</td>
      <td>{last ? `${last.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${g?.unit ? ` ${g.unit}` : ''}` : res?.data?.error ? <span className="err">{res.data.error}</span> : '…'}</td>
      <td className="label">{last && g ? periodLabel(last.date, g.freq) : ''}</td>
      <td>{g ? fmt(back(g.obs, 1), { digits: 2, unit: '' }, false) : ''}</td>
      <td className="label">{g && (res?.data?.groups.length ?? 0) > 1 ? `${g.name} 외 ${res!.data!.groups.length - 1}개` : (g?.name ?? '')}</td>
      <td>
        <Spark values={(g?.obs ?? []).slice(-60).map((o) => o.value)} />
        <button className="linkish" onClick={onRemove}>
          빼기
        </button>
      </td>
    </tr>
  );
}

function FredRow({ item, panelId, onRemove, s }: { item: MacroCustom; panelId: string; onRemove: () => void; s?: MacroResponse['series'][number] }) {
  const obs = s?.obs ?? [];
  const last = obs[obs.length - 1];
  return (
    <tr className="click" onClick={() => openEcod(panelId, item.id)}>
      <td>{item.name}</td>
      <td>{fmt(last?.value, { digits: 2, unit: '' })}</td>
      <td className="label">{last?.date ?? ''}</td>
      <td>{fmt(back(obs, 1), { digits: 2, unit: '' }, false)}</td>
      <td className="label">{s?.units ?? item.id}</td>
      <td>
        <Spark values={obs.slice(-120).map((o) => o.value)} />
        <button
          className="linkish"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          빼기
        </button>
      </td>
    </tr>
  );
}

function MyStats({ panelId }: { panelId: string }) {
  const custom = useStore(appState).macroCustom ?? [];
  const fred = custom.filter((c) => !c.kosisUrl);
  const { map } = useSeries(fred.map((c) => c.id));
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const remove = (id: string) => updateState('macroCustom', (l) => (l ?? []).filter((x) => x.id !== id));
  const add = () => {
    const u = url.trim().replace(/([?&])apiKey=[^&]*/i, '$1').replace(/[?&]$/, '');
    if (!/^https:\/\/kosis\.kr\/openapi\//.test(u)) return;
    updateState('macroCustom', (l) => [...(l ?? []), { id: `KOSIS:${Date.now().toString(36)}`, name: name.trim() || 'KOSIS 통계', kosisUrl: u }].slice(-30));
    setName('');
    setUrl('');
  };
  return (
    <>
      <table className="flow-table">
        <thead>
          <tr>
            <th>지표</th>
            <th>최근</th>
            <th>기간</th>
            <th>이전</th>
            <th>설명</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {custom.map((c) => (c.kosisUrl ? <KosisRow key={c.id} item={c} panelId={panelId} onRemove={() => remove(c.id)} /> : <FredRow key={c.id} item={c} panelId={panelId} s={map.get(c.id)} onRemove={() => remove(c.id)} />))}
          {!custom.length && (
            <tr>
              <td colSpan={6} className="label">
                아직 없어요. ECOF⏎에서 찾은 지표를 더하거나, 아래에 KOSIS 주소를 넣어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="ecst-add">
        <input placeholder="이름 (예: 시도별 실업률)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="KOSIS OpenAPI 주소 https://kosis.kr/openapi/Param/statisticsParameterData.do?…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add} disabled={!/^https:\/\/kosis\.kr\/openapi\//.test(url.trim())}>
          더하기
        </button>
      </div>
      <div className="label ecst-help">KOSIS에서 통계표를 열고 OpenAPI → URL 생성으로 만든 주소를 붙여 넣어요. 주소 속 인증키는 지우고 저장해요(요청할 때 설정의 KOSIS 인증키를 넣어요).</div>
    </>
  );
}

export function Ecst({ panel }: { panel: PanelState }) {
  const tab = panel.ecstTab ?? 'KR';
  const tools = (
    <>
      {(['KR', 'US', 'MY'] as const).map((t) => (
        <button key={t} className={t === tab ? 'on' : ''} onClick={() => patchPanel(panel.id, { ecstTab: t })}>
          {t === 'MY' ? '내 통계' : COUNTRY[t]}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="ECST" name="경제 통계" sub={tab === 'MY' ? '내 통계' : COUNTRY[tab]} tools={tools} />
      <div className="pbody flow">{tab === 'MY' ? <MyStats panelId={panel.id} /> : <StatTable defs={MACRO_SERIES.filter((d) => d.country === tab)} panelId={panel.id} />}</div>
      <div className="attr">한국은 ECOS(인증키), 미국은 FRED(키), 내 통계의 KOSIS는 KOSIS 인증키. 줄을 누르면 지표 상세(ECOD)로 바뀌어요. 이전·1년 전은 같은 방식(전년 대비 등)의 값이에요</div>
    </>
  );
}

// ── ECOF 지표 찾기 ──

export function Ecof({ panel }: { panel: PanelState }) {
  const q = (panel.ecofQuery ?? '').trim();
  const res = usePoll<MacroSearchResponse>(q ? `/api/macro/search?q=${encodeURIComponent(q)}` : '', POLL);
  const custom = useStore(appState).macroCustom ?? [];
  const addMine = (id: string, name: string) => updateState('macroCustom', (l) => ((l ?? []).some((x) => x.id === id) ? l : [...(l ?? []), { id, name }].slice(-30)));
  return (
    <>
      <TitleBar fn="ECOF" name="지표 찾기" sub={q ? `"${q}"` : undefined} />
      <div className="pbody flow">
        <div className="nse-bar">
          <input
            className="cf-search"
            placeholder="지표 이름 (예: 물가, 실업, housing starts, CPI)"
            defaultValue={panel.ecofQuery ?? ''}
            key={panel.ecofQuery ?? ''}
            onKeyDown={(e) => e.key === 'Enter' && patchPanel(panel.id, { ecofQuery: (e.target as HTMLInputElement).value })}
            onBlur={(e) => patchPanel(panel.id, { ecofQuery: e.target.value })}
          />
        </div>
        {!q && <div className="des-note label">찾을 낱말을 넣고 Enter. 앱 지표, FRED 시계열(영문, 키), ECOS 통계표 이름(인증키)에서 찾아요.</div>}
        {q && !res && <div className="des-note label">찾는 중…</div>}
        {res?.data?.missing.length ? <div className="label fx-warn">{res.data.missing.join(' / ')}</div> : null}
        {res?.data && (
          <table className="flow-table ecof">
            <thead>
              <tr>
                <th>출처</th>
                <th>이름</th>
                <th>설명</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {res.data.hits.map((h, i) => (
                <tr key={`${h.source}${h.id ?? h.title}${i}`}>
                  <td className="label">{h.source === 'APP' ? '앱' : h.source}</td>
                  <td>{h.title}</td>
                  <td className="label">{h.detail}</td>
                  <td className="ecof-act">
                    {h.id && (
                      <button className="linkish" onClick={() => openEcod(panel.id, h.id!)}>
                        열기
                      </button>
                    )}
                    {h.id && h.source === 'FRED' && !custom.some((c) => c.id === h.id) && (
                      <button className="linkish" onClick={() => addMine(h.id!, h.title)}>
                        내 통계에
                      </button>
                    )}
                    {h.url && (
                      <button className="linkish" onClick={() => openLink(h.url!)}>
                        원문
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!res.data.hits.length && (
                <tr>
                  <td colSpan={4} className="label">
                    찾은 지표가 없어요
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="attr">열기는 지표 상세(ECOD), 내 통계에는 ECST 내 통계 탭에 더해요. ECOS 통계표는 항목을 골라야 해서 원문(ECOS)으로 열어요</div>
    </>
  );
}

// ── ECMX 세계 경제 매트릭스 ──

/** 나라 → BIS 정책금리 지역(유로 나라는 ECB) */
const POLICY_AREA: Record<string, string> = { DEU: 'XM', FRA: 'XM', ITA: 'XM' };

export function Ecmx({ panel: _panel }: { panel: PanelState }) {
  const res = usePoll<MatrixResponse>('/api/macro/matrix', POLL);
  const cb = usePoll<CentralBankResponse>('/api/centralbank', POLL);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | undefined>();
  const policy = new Map((cb?.data?.rates ?? []).map((r) => [r.area, r.rate]));
  const policyOf = (iso3: string, iso2: string) => policy.get(POLICY_AREA[iso3] ?? iso2);
  const cells = res?.data?.cells ?? {};
  const rows = [...ECMX_COUNTRIES];
  if (sort) {
    const val = (c: (typeof ECMX_COUNTRIES)[number]) => (sort.col === 'policy' ? policyOf(c.iso3, c.iso2) : cells[sort.col]?.[c.iso3]?.value);
    rows.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return sort.desc ? y - x : x - y;
    });
  }
  const head = (col: string, label: string) => (
    <th className="click" onClick={() => setSort((s) => (s?.col === col ? { col, desc: !s.desc } : { col, desc: true }))}>
      {label}
      {sort?.col === col ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );
  // 지표마다 가장 흔한 해(그 해가 아니면 칸에 해를 붙여요)
  const commonYear = (code: string) => {
    const count = new Map<string, number>();
    for (const c of Object.values(cells[code] ?? {})) count.set(c.year, (count.get(c.year) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return (
    <>
      <TitleBar fn="ECMX" name="세계 경제 매트릭스" fresh={res?.data?.fresh} />
      <div className="pbody flow">
        {res?.error && !res.data && <div className="des-note err">{res.error}</div>}
        {res?.data?.errors.length ? <div className="label fx-warn">{`일부 없음: ${res.data.errors.join(' / ')}`}</div> : null}
        {!res && <div className="des-note label">받는 중…</div>}
        {res?.data && (
          <table className="flow-table">
            <thead>
              <tr>
                <th>나라</th>
                {ECMX_INDICATORS.map((ind) => head(ind.code, `${ind.name}${commonYear(ind.code) ? ` ${commonYear(ind.code)}` : ''}`))}
                {head('policy', '정책금리')}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.iso3}>
                  <td>{c.name}</td>
                  {ECMX_INDICATORS.map((ind) => {
                    const v = cells[ind.code]?.[c.iso3];
                    const cy = commonYear(ind.code);
                    return (
                      <td key={ind.code} className={v && v.prev !== undefined ? dirClass(v.value - v.prev) : ''} title={v?.prev !== undefined ? `앞 해 ${v.prev.toFixed(ind.digits)}` : undefined}>
                        {v ? v.value.toLocaleString('en-US', { minimumFractionDigits: ind.digits, maximumFractionDigits: ind.digits }) : '—'}
                        {v && cy && v.year !== cy && <span className="label ecmx-year">{` '${v.year.slice(2)}`}</span>}
                      </td>
                    );
                  })}
                  <td>{policyOf(c.iso3, c.iso2)?.toFixed(2) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="attr">세계은행 WDI 연간 값(나라마다 늦게 올라와서 다른 해면 칸에 해를 붙여요, 색은 앞 해 대비). 정책금리는 BIS(독일·프랑스·이탈리아는 ECB). 칸 이름을 누르면 정렬해요</div>
    </>
  );
}

// ── IFMO 인플레이션 모니터 ──

const CPI_IDS = ['FRED:CPIAUCSL', 'FRED:CPILFESL', 'FRED:PCEPI', 'FRED:PCEPILFE', 'FRED:PPIFIS', 'ECOS:901Y009/M/0', 'ECOS:901Y010/M/QB', 'ECOS:901Y010/M/DB', 'ECOS:404Y014/M/*AA', 'FRED:CP0000EZ19M086NEST'];
const BEI_IDS = ['FRED:T5YIE', 'FRED:T10YIE', 'FRED:T5YIFR', 'FRED:DFII10', 'FRED:MICH', 'ECOS:511Y003/M/FMB'];

export function Ifmo({ panel }: { panel: PanelState }) {
  const tab = panel.ifmoTab ?? 'CPI';
  const ids = tab === 'CPI' ? CPI_IDS : BEI_IDS;
  const { res, map } = useSeries(ids);
  const tools = (
    <>
      {(['CPI', 'BEI'] as const).map((t) => (
        <button key={t} className={t === tab ? 'on' : ''} onClick={() => patchPanel(panel.id, { ifmoTab: t })}>
          {t === 'CPI' ? '물가' : '기대인플레'}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="IFMO" name="인플레이션 모니터" sub={tab === 'CPI' ? '물가 상승률' : '기대인플레·실질금리'} fresh={res?.data?.fresh} tools={tools} />
      <div className="pbody flow">
        <MissingNote res={res} />
        {!res && <div className="des-note label">받는 중…</div>}
        <table className="flow-table">
          <thead>
            <tr>
              <th>지표</th>
              <th>나라</th>
              <th>최근</th>
              <th>기간</th>
              <th>{tab === 'CPI' ? '이전' : '1주 전'}</th>
              <th>{tab === 'CPI' ? '3달 전' : '1달 전'}</th>
              <th>1년 전</th>
              <th>2년</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const d = macroDef(id)!;
              const obs = map.get(id)?.obs ?? [];
              const last = obs[obs.length - 1];
              const daily = d.freq === 'D';
              const a = daily ? back(obs, 5) : back(obs, 1);
              const b = daily ? back(obs, 21) : back(obs, 3);
              const y = back(obs, PER_YEAR[d.freq]);
              const hot = tab === 'CPI' && last ? last.value > 2.0 : false;
              return (
                <tr key={id} className="click" onClick={() => openEcod(panel.id, id)} title="눌러서 지표 상세(ECOD)">
                  <td>{d.name}</td>
                  <td className="label">{COUNTRY[d.country]}</td>
                  <td className={tab === 'CPI' ? (hot ? 'up' : 'down') : ''}>{fmt(last?.value, d)}</td>
                  <td className="label">{last ? periodLabel(last.date, d.freq) : ''}</td>
                  <td className={dirClass(last && a !== undefined ? last.value - a : undefined)}>{fmt(a, d, false)}</td>
                  <td>{fmt(b, d, false)}</td>
                  <td>{fmt(y, d, false)}</td>
                  <td>
                    <Spark values={obs.slice(-PER_YEAR[d.freq] * 2).map((o) => o.value)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="attr">
        {tab === 'CPI'
          ? '전년 대비 상승률. 최근 칸 색은 목표 2%를 넘으면 상승 색, 아래면 하락 색이에요. 미국·유로는 FRED(키), 한국은 ECOS(인증키). 줄을 누르면 지표 상세(ECOD)'
          : 'BEI = 명목 국채 − 물가연동국채 금리(시장 기대인플레, 매일). 5년 뒤 5년은 5~10년 구간 기대. 미시간대·한국은행은 설문 기대인플레(매달). 물가연동국고채 BEI는 무료 데이터가 없어요'}
      </div>
    </>
  );
}

