// IMAP 업종 타일(03 v0.2): 업종별로 묶은 종목 타일. 넓이는 시가총액, 색은 오늘 등락률(finviz식 시장 지도).
// 지수는 인자(IMAP KOSDAQ)나 위 버튼으로. 타일을 누르면 연동 그룹이 그 종목으로 바뀌어요.

import { useEffect, useRef, useState } from 'react';
import { SECTOR_INDEXES, type SectorMapResponse } from '@bt/shared';
import { api } from '../api';
import { fmtBig } from '../format';
import { getInstrument } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar } from './common';
import { SECTOR_INDEX_INST, heat, sectorIndexOf } from './sector';
import { squarify, type Rect } from './treemap';

const REFRESH_MS = 60_000;
/** 업종 이름 띠 높이 */
const HEAD = 14;

export function Imap({ panel }: { panel: PanelState }) {
  const index = sectorIndexOf(panel);
  const [state, setState] = useState<{ index: string; data?: SectorMapResponse; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<SectorMapResponse>(`/api/sectors?index=${index}`)
        .then((data) => alive && setState({ index, data }))
        .catch((e: Error) => alive && setState((s) => (s?.index === index && s.data ? s : { index, error: e.message })));
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [index]);
  const cur = state?.index === index ? state : undefined;
  const data = cur?.data;

  // 패널 크기
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const Observer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver;
    const ro = new Observer((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sectors = (data?.sectors ?? []).filter((s) => s.members.length > 0);
  const sizes = sectors.map((s) => s.members.reduce((t, m) => t + m.mcap, 0));
  const sRects = squarify(sizes, { x: 0, y: 0, w: size.w, h: size.h });
  const label = SECTOR_INDEXES.find((x) => x.code === index)?.label ?? index;

  return (
    <>
      <TitleBar
        fn="IMAP"
        name="업종 타일"
        sub={label}
        fresh={data?.fresh}
        inst={getInstrument(SECTOR_INDEX_INST[index])}
        tools={
          <>
            {SECTOR_INDEXES.map((x) => (
              <button key={x.code} className={x.code === index ? 'on' : ''} onClick={() => patchPanel(panel.id, { args: [x.code] })} title={`IMAP ${x.code}`}>
                {x.label}
              </button>
            ))}
          </>
        }
      />
      <div className="pbody imap" ref={boxRef} style={{ overflow: 'hidden' }}>
        {sectors.map((s, i) => {
          const r = sRects[i];
          if (!r || r.w < 2 || r.h < 2) return null;
          const showHead = r.h > HEAD * 2 && r.w > 40;
          const inner: Rect = showHead ? { x: r.x, y: r.y + HEAD, w: r.w, h: r.h - HEAD } : r;
          const mRects = squarify(
            s.members.map((m) => m.mcap),
            inner,
          );
          const withChg = s.members.filter((m) => m.changePct !== undefined);
          const w = withChg.reduce((t, m) => t + m.mcap, 0);
          const sectorChg = s.changePct ?? (w > 0 ? withChg.reduce((t, m) => t + m.mcap * m.changePct!, 0) / w : undefined);
          return (
            <div key={s.code}>
              {showHead && (
                <div className="imap-head" style={{ left: r.x, top: r.y, width: r.w }} title={`${s.name} · 시가총액 ${fmtBig(s.mcap, 'KRW')} · ${s.count}종목`}>
                  <span>{s.name}</span>
                  {sectorChg !== undefined && <span className={sectorChg > 0 ? 'up' : sectorChg < 0 ? 'down' : 'flat'}>{`${sectorChg > 0 ? '+' : ''}${sectorChg.toFixed(2)}%`}</span>}
                </div>
              )}
              {s.members.map((m, k) => {
                const mr = mRects[k];
                if (!mr || mr.w < 1 || mr.h < 1) return null;
                const big = mr.w > 46 && mr.h > 30;
                return (
                  <div
                    key={m.id}
                    className="imap-tile"
                    style={{ left: mr.x, top: mr.y, width: mr.w, height: mr.h, background: heat(m.changePct) }}
                    onClick={() => setPanelSecurity(panel.id, m.id)}
                    title={`${m.name} ${m.code}\n${m.last !== undefined ? m.last.toLocaleString('en-US') : '—'} ${m.changePct !== undefined ? `${m.changePct > 0 ? '+' : ''}${m.changePct.toFixed(2)}%` : ''}\n시가총액 ${fmtBig(m.mcap, 'KRW')}`}
                  >
                    {mr.w > 30 && mr.h > 14 && <span className="imap-name">{m.name}</span>}
                    {big && m.changePct !== undefined && <span className="imap-chg">{`${m.changePct > 0 ? '+' : ''}${m.changePct.toFixed(2)}%`}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!cur && <div className="empty-body">불러오는 중…</div>}
        {cur?.error && !data && (
          <div className="empty-body">
            <span className="err">{cur.error}</span>
          </div>
        )}
        {data && sectors.length === 0 && <div className="empty-body">종목 마스터를 아직 받지 못해서 업종을 묶을 수 없어요</div>}
        {data?.liveError && <div className="imap-note">{data.liveError}</div>}
      </div>
    </>
  );
}
