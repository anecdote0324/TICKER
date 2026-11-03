// HMAP 업종 히트맵(03 v0.2): 업종마다 오늘·1주·1개월·3개월·올해 등락을 색 칸으로, 추세는 최근 60일 선.
// 업종을 누르면 그 업종의 큰 종목들(오늘 등락). 종목을 누르면 연동 그룹이 그 종목으로 바뀌어요.

import { useEffect, useState } from 'react';
import { SECTOR_INDEXES, type SectorHistoryResponse, type SectorMapResponse } from '@bt/shared';
import { api } from '../api';
import { fmtBig, fmtNum } from '../format';
import { getInstrument } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar } from './common';
import { PERIODS, SECTOR_INDEX_INST, heat, periodReturn, sectorIndexOf } from './sector';

const MAP_MS = 30_000;
const HISTORY_MS = 60_000;

function usePoll<T>(path: string, ms: number): { key: string; data?: T; error?: string } | undefined {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<T>(path)
        .then((data) => alive && setState({ key: path, data }))
        .catch((e: Error) => alive && setState((s) => (s?.key === path && s.data ? s : { key: path, error: e.message })));
    void load();
    const t = window.setInterval(load, ms);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [path, ms]);
  return state?.key === path ? state : undefined;
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="hmap-spark" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 60).toFixed(1)},${(14 - ((v - min) / (max - min || 1)) * 12).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className="hmap-spark" viewBox="0 0 60 16" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.2" />
    </svg>
  );
}

const pct = (v: number | undefined) => (v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

export function Hmap({ panel }: { panel: PanelState }) {
  const index = sectorIndexOf(panel);
  const map = usePoll<SectorMapResponse>(`/api/sectors?index=${index}`, MAP_MS);
  const hist = usePoll<SectorHistoryResponse>(`/api/sectors/history?index=${index}`, HISTORY_MS);
  const label = SECTOR_INDEXES.find((x) => x.code === index)?.label ?? index;
  const closes = new Map((hist?.data?.rows ?? []).map((r) => [r.code, r.closes]));
  const sectors = map?.data?.sectors ?? [];
  const drill = panel.hmapSector ? sectors.find((s) => s.code === panel.hmapSector) : undefined;
  const now = Date.now() / 1000;
  return (
    <>
      <TitleBar
        fn="HMAP"
        name="업종 히트맵"
        sub={drill ? `${label} · ${drill.name}` : label}
        fresh={map?.data?.fresh}
        inst={getInstrument(SECTOR_INDEX_INST[index])}
        tools={
          <>
            {SECTOR_INDEXES.map((x) => (
              <button key={x.code} className={x.code === index ? 'on' : ''} onClick={() => patchPanel(panel.id, { args: [x.code], hmapSector: undefined })} title={`HMAP ${x.code}`}>
                {x.label}
              </button>
            ))}
          </>
        }
      />
      <div className="pbody">
        {drill ? (
          <>
            <div className="thead">
              <button className="hmap-back" onClick={() => patchPanel(panel.id, { hmapSector: undefined })}>
                ← 업종
              </button>
              <span style={{ flex: 1 }}>
                {drill.name} · {index !== 'KOSPI2' ? `${drill.count}종목 중 시가총액 상위 200 안의 ${drill.members.length}종목` : `${drill.count}종목`}
              </span>
              <span style={{ width: 84, textAlign: 'right' }}>현재가</span>
              <span style={{ width: 70, textAlign: 'right' }}>오늘</span>
              <span style={{ width: 76, textAlign: 'right' }}>시가총액</span>
            </div>
            {drill.members.map((m) => (
              <div key={m.id} className="row" onClick={() => setPanelSecurity(panel.id, m.id)}>
                <span className="nm">
                  <span>{m.name}</span>
                  <span className="cd">{m.code}</span>
                </span>
                <span className="num" style={{ width: 84, color: 'var(--value-hi)' }}>
                  {m.last !== undefined ? m.last.toLocaleString('en-US') : '—'}
                </span>
                <span className="num hmap-cell" style={{ width: 70, background: heat(m.changePct) }}>
                  {pct(m.changePct)}
                </span>
                <span className="num" style={{ width: 76 }}>
                  {fmtBig(m.mcap, 'KRW')}
                </span>
              </div>
            ))}
            {drill.members.length === 0 && <div className="des-note label">시가총액 상위 200종목 안에 이 업종 종목이 없어요</div>}
          </>
        ) : (
          <>
            <div className="thead">
              <span style={{ flex: 1 }}>업종</span>
              <span className="col-vol" style={{ width: 70, textAlign: 'right' }}>
                지수
              </span>
              {PERIODS.map((p) => (
                <span key={p.code} style={{ width: 58, textAlign: 'right' }}>
                  {p.label}
                </span>
              ))}
              <span className="col-spark" style={{ width: 60, textAlign: 'right' }}>
                추세
              </span>
            </div>
            {sectors.map((s) => {
              const c = closes.get(s.code) ?? [];
              const vals = PERIODS.map((p) => (p.code === '1D' ? s.changePct : periodReturn(c, s.last, p.code, now)));
              const spark = c.slice(-60).map((x) => x.c);
              if (s.last !== undefined && spark.length) spark.push(s.last);
              return (
                <div key={s.code} className="row" onClick={() => patchPanel(panel.id, { hmapSector: s.code })} title={`${s.name} · ${s.count}종목 · 시가총액 ${fmtBig(s.mcap, 'KRW')} · 누르면 종목`}>
                  <span className="nm">
                    <span>{s.name}</span>
                    <span className="cd">{s.count}</span>
                  </span>
                  <span className="num col-vol" style={{ width: 70, color: 'var(--value-hi)' }}>
                    {s.last !== undefined ? fmtNum(s.last, 2) : '—'}
                  </span>
                  {PERIODS.map((p, i) => (
                    <span key={p.code} className="num hmap-cell" style={{ width: 58, background: heat(vals[i], p.full) }}>
                      {pct(vals[i])}
                    </span>
                  ))}
                  <span className="col-spark" style={{ width: 60, display: 'flex', justifyContent: 'flex-end' }}>
                    <Spark values={spark} />
                  </span>
                </div>
              );
            })}
            {!map && <div className="des-note label">불러오는 중…</div>}
            {map?.error && <div className="des-note err">{map.error}</div>}
            {map?.data && sectors.length === 0 && <div className="des-note label">종목 마스터를 아직 받지 못해서 업종을 묶을 수 없어요</div>}
            {map?.data?.liveError && <div className="des-note label">{map.data.liveError}</div>}
            {hist?.data && (hist.data.rows.length < sectors.length || hist.data.error) && (
              <div className="des-note label">{hist.data.error ?? `업종 지수 일봉을 받는 중이에요(${hist.data.rows.length}/${sectors.length}) · 1주·1개월·3개월·올해 칸이 차례로 채워져요`}</div>
            )}
            <div className="des-note label">업종은 KRX 업종(코스피200은 코스피200 섹터) · 칸 색은 기간마다 다른 폭(오늘 ±3%, 1주 ±6%, 1개월 ±10%, 3개월 ±20%, 올해 ±30%)에서 가장 진해요</div>
          </>
        )}
      </div>
    </>
  );
}
