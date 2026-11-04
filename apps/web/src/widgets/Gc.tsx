// GC 금리 커브(03 v0.3): 미국채(재무부)와 국고채(BOK ECOS) 커브, 비교 커브(1주·1개월·1년 전), 테너별 변동(bp), 스프레드.
// 인자: GC(둘 다), GC US(미국채), GC KR(국고채). 가로축은 만기의 제곱근이라 짧은 만기도 보여요.

import { useMemo, useState } from 'react';
import type { CurvesResponse, YieldCurve } from '@bt/shared';
import { dirClass } from '../format';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';
import { bp, curveAt, GC_COMPARE, spreads, tenorValue, xOfYears } from './gcCalc';

const POLL_MS = 30 * 60_000;
const COLOR: Record<string, string> = { UST: 'var(--accent)', KTB: '#4FC3F7' };
const W = 640;
const H = 260;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

const fmtBp = (v: number | undefined) => (v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

export function Gc({ panel }: { panel: PanelState }) {
  const which = panel.args?.[0] ?? 'ALL';
  const compare = panel.gcCompare && GC_COMPARE[panel.gcCompare] ? panel.gcCompare : '1M';
  const days = GC_COMPARE[compare].days;
  const res = usePoll<CurvesResponse>('/api/curves', POLL_MS);
  const all = res?.data?.curves ?? [];
  const curves = all.filter((c) => which === 'ALL' || (which === 'US' ? c.id === 'UST' : c.id === 'KTB'));
  const missing = (res?.data?.missing ?? []).filter((m) => which === 'ALL' || (which === 'US' ? m.id === 'UST' : m.id === 'KTB'));
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const geo = useMemo(() => {
    const pts: Array<{ years: number; v: number }> = [];
    for (const c of curves)
      for (const d of [0, days]) {
        const row = curveAt(c, d);
        for (const t of c.tenors) {
          const v = tenorValue(row, t.key);
          if (v !== undefined) pts.push({ years: t.years, v });
        }
      }
    if (pts.length === 0) return null;
    const maxX = xOfYears(Math.max(...pts.map((p) => p.years)));
    let lo = Math.min(...pts.map((p) => p.v));
    let hi = Math.max(...pts.map((p) => p.v));
    const pad = Math.max(0.1, (hi - lo) * 0.1);
    lo -= pad;
    hi += pad;
    const x = (years: number) => PAD.l + (xOfYears(years) / maxX) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const step = (hi - lo) / 5;
    const ticks = Array.from({ length: 6 }, (_, i) => lo + step * i);
    return { x, y, ticks };
  }, [curves, days]);

  const tools = (
    <>
      {(['ALL', 'US', 'KR'] as const).map((k) => (
        <button key={k} className={which === k ? 'on' : ''} title={k === 'ALL' ? 'GC' : `GC ${k}`} onClick={() => patchPanel(panel.id, { args: [k] })}>
          {k === 'ALL' ? '전체' : k === 'US' ? '미국채' : '국고채'}
        </button>
      ))}
      <span style={{ width: 8 }} />
      {Object.entries(GC_COMPARE).map(([k, d]) => (
        <button key={k} className={compare === k ? 'on' : ''} title={`비교: ${d.label} 커브(점선)`} onClick={() => patchPanel(panel.id, { gcCompare: k })}>
          {k}
        </button>
      ))}
    </>
  );

  return (
    <>
      <TitleBar fn="GC" name="금리 커브" sub={which === 'ALL' ? '미국채 · 국고채' : which === 'US' ? '미국채' : '국고채'} fresh={curves[0]?.fresh} tools={tools} />
      <div className="pbody gc">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !res.data && <div className="empty-body err">{res.error}</div>}
        {missing.map((m) => (
          <div key={m.id} className="gc-note label">
            {m.name}: {m.reason}
          </div>
        ))}
        {geo && (
          <svg className="gc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="#1c1c1c" />
                <text x={PAD.l - 6} y={geo.y(t) + 3} textAnchor="end" className="gc-tick">
                  {t.toFixed(2)}
                </text>
              </g>
            ))}
            {axisLabels(curves, geo.x).map((t) => (
              <text key={t.label} x={t.x} y={H - 10} textAnchor="middle" className="gc-tick">
                {t.label}
              </text>
            ))}
            {curves.map((c) =>
              [days, 0].map((d) => {
                const row = curveAt(c, d);
                const pts = c.tenors.flatMap((t) => {
                  const v = tenorValue(row, t.key);
                  return v === undefined ? [] : [{ t, v }];
                });
                return (
                  <g key={`${c.id}${d}`}>
                    <polyline
                      points={pts.map((p) => `${geo.x(p.t.years).toFixed(1)},${geo.y(p.v).toFixed(1)}`).join(' ')}
                      fill="none"
                      stroke={COLOR[c.id]}
                      strokeWidth={d ? 1 : 1.8}
                      strokeDasharray={d ? '4 3' : undefined}
                      opacity={d ? 0.55 : 1}
                    />
                    {!d &&
                      pts.map((p) => (
                        <circle
                          key={p.t.key}
                          cx={geo.x(p.t.years)}
                          cy={geo.y(p.v)}
                          r={3}
                          fill={COLOR[c.id]}
                          onMouseEnter={() => setHover({ x: geo.x(p.t.years), y: geo.y(p.v), text: `${c.name} ${p.t.label} ${p.v.toFixed(3)}%` })}
                        />
                      ))}
                  </g>
                );
              }),
            )}
            {hover && (
              <text x={Math.min(hover.x + 6, W - 150)} y={Math.max(hover.y - 8, 12)} className="gc-hover">
                {hover.text}
              </text>
            )}
          </svg>
        )}
        {curves.length > 0 && (
          <div className="gc-legend">
            {curves.map((c) => (
              <span key={c.id}>
                <i style={{ background: COLOR[c.id] }} /> {c.name} {curveAt(c, 0)?.date}
                <i className="dash" style={{ borderColor: COLOR[c.id] }} /> {GC_COMPARE[compare].label} {curveAt(c, days)?.date ?? '—'}
              </span>
            ))}
          </div>
        )}
        <div className="gc-tables">
          {curves.map((c) => (
            <CurveTable key={c.id} c={c} />
          ))}
          <SpreadTable curves={all} days={days} label={GC_COMPARE[compare].label} />
        </div>
      </div>
    </>
  );
}

/** 가로축 라벨: 모든 커브의 테너를 합치고, 앞 라벨과 28px 안으로 붙으면 빼요(짧은 만기가 겹치지 않게) */
function axisLabels(curves: YieldCurve[], x: (years: number) => number) {
  const seen = new Map<number, string>();
  for (const c of curves) for (const t of c.tenors) if (!seen.has(t.years)) seen.set(t.years, t.label);
  const out: Array<{ label: string; x: number }> = [];
  for (const [years, label] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const px = x(years);
    if (out.length && px - out[out.length - 1].x < 28) continue;
    out.push({ label, x: px });
  }
  return out;
}

function CurveTable({ c }: { c: YieldCurve }) {
  const now = curveAt(c, 0);
  const rows = Object.entries(GC_COMPARE).map(([k, d]) => [k, curveAt(c, d.days)] as const);
  return (
    <table className="gc-table">
      <thead>
        <tr>
          <th style={{ color: COLOR[c.id] }}>{c.name}</th>
          <th>금리</th>
          {rows.map(([k]) => (
            <th key={k}>{k} bp</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {c.tenors.map((t) => {
          const v = tenorValue(now, t.key);
          return (
            <tr key={t.key}>
              <td>{t.label}</td>
              <td className="num">{v === undefined ? '—' : v.toFixed(3)}</td>
              {rows.map(([k, r]) => {
                const d = bp(v, tenorValue(r, t.key));
                return (
                  <td key={k} className={`num ${dirClass(d)}`}>
                    {fmtBp(d)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SpreadTable({ curves, days, label }: { curves: YieldCurve[]; days: number; label: string }) {
  const s = spreads(curves, days);
  if (s.length === 0) return null;
  return (
    <table className="gc-table">
      <thead>
        <tr>
          <th>스프레드</th>
          <th>bp</th>
          <th>{label} 대비</th>
        </tr>
      </thead>
      <tbody>
        {s.map((x) => (
          <tr key={x.label}>
            <td>{x.label}</td>
            <td className={`num ${dirClass(x.now)}`}>{fmtBp(x.now)}</td>
            <td className={`num ${dirClass(x.change)}`}>{fmtBp(x.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
