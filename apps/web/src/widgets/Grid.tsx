// GRID 소형 차트 격자(03 v0.3): 여러 지수·환율·종목의 작은 차트를 한눈에. 칸마다 이름, 현재가, 등락률, 기간 선(일봉 종가).
// 칸을 누르면 같은 연동 그룹의 패널이 그 종목으로 바뀌어요. 칸 목록은 패널마다 기억하고, 편집으로 더하거나 뺄 수 있어요.

import { useEffect, useMemo, useState } from 'react';
import type { Bar, Instrument } from '@bt/shared';
import { arrow, dirClass, fmtPct, fmtPrice } from '../format';
import { getBars } from '../stores/bars';
import { useQuotes } from '../stores/feed';
import { getInstrument, index } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar } from './common';

export const GRID_DEFAULT = ['IDX:KOSPI', 'IDX:KOSDAQ', 'IDX:SPX', 'IDX:CCMP', 'IDX:NKY', 'IDX:HSI', 'CUR:USDKRW', 'CUR:USDJPY', 'CRY:BTC'];
/** 기간 버튼: 일봉 개수 */
const GRID_RANGES: Record<string, number> = { '1M': 22, '3M': 64, '6M': 127, '1Y': 251 };

export function Grid({ panel }: { panel: PanelState }) {
  const ids = (panel.gridIds ?? GRID_DEFAULT).filter((id) => getInstrument(id));
  const range = panel.gridRange && GRID_RANGES[panel.gridRange] ? panel.gridRange : '3M';
  const [editing, setEditing] = useState(false);
  const quotes = useQuotes(ids);
  const setIds = (next: string[]) => patchPanel(panel.id, { gridIds: next });
  const tools = (
    <>
      {Object.keys(GRID_RANGES).map((r) => (
        <button key={r} className={range === r ? 'on' : ''} onClick={() => patchPanel(panel.id, { gridRange: r })}>
          {r}
        </button>
      ))}
      <span style={{ width: 8 }} />
      <button className={editing ? 'on' : ''} title="칸 더하기·빼기" onClick={() => setEditing((e) => !e)}>
        편집
      </button>
    </>
  );
  return (
    <>
      <TitleBar fn="GRID" name="소형 차트 격자" sub={`${ids.length}칸 · 일봉 ${range}`} tools={tools} />
      <div className="pbody grid-body">
        {editing && <GridAdd onAdd={(id) => !ids.includes(id) && setIds([...ids, id])} onReset={() => setIds(GRID_DEFAULT)} />}
        <div className="grid-cells">
          {ids.map((id) => {
            const inst = getInstrument(id)!;
            return (
              <GridCell
                key={id}
                inst={inst}
                last={quotes.get(id)?.last}
                pct={quotes.get(id)?.changePct}
                n={GRID_RANGES[range]}
                onPick={() => setPanelSecurity(panel.id, id)}
                onRemove={editing ? () => setIds(ids.filter((x) => x !== id)) : undefined}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

function GridCell(props: { inst: Instrument; last?: number; pct?: number; n: number; onPick: () => void; onRemove?: () => void }) {
  const { inst } = props;
  const [bars, setBars] = useState<Bar[] | null>(null);
  useEffect(() => {
    let alive = true;
    getBars(inst.id, '1d', 10 * 60_000).then(
      (s) => alive && setBars(s.bars),
      () => alive && setBars([]),
    );
    return () => {
      alive = false;
    };
  }, [inst.id]);
  const closes = useMemo(() => {
    const c = (bars ?? []).slice(-props.n).map((b) => b.c);
    // 마지막 값은 지금 시세로(일봉이 오늘 봉을 아직 안 고쳤어도 선 끝이 현재가)
    if (c.length && props.last !== undefined) c[c.length - 1] = props.last;
    return c;
  }, [bars, props.n, props.last]);
  const periodPct = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : undefined;
  const name = inst.nameKo || inst.nameEn || inst.code;
  return (
    <div className="grid-cell" onClick={props.onPick} title="누르면 연동 그룹이 이 종목으로 바뀌어요">
      <div className="grid-head">
        <span className="grid-name">{name}</span>
        <span className="cd">{inst.code}</span>
        {props.onRemove && (
          <button
            className="icon-btn"
            aria-label={`${name} 빼기`}
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove!();
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="grid-quote num">
        <span className="grid-last">{fmtPrice(inst, props.last ?? closes[closes.length - 1])}</span>
        <span className={dirClass(props.pct)}>
          {arrow(props.pct)}
          {props.pct !== undefined ? fmtPct(Math.abs(props.pct)).replace('+', '') : '—'}
        </span>
        <span className={`label ${dirClass(periodPct)}`} title="보이는 기간의 등락">
          {periodPct !== undefined ? fmtPct(periodPct) : ''}
        </span>
      </div>
      <MiniChart closes={closes} up={(periodPct ?? 0) >= 0} />
    </div>
  );
}

function MiniChart({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return <div className="grid-chart label">{closes.length ? '' : '불러오는 중…'}</div>;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const W = 200;
  const H = 60;
  const pts = closes.map((v, i) => [(i / (closes.length - 1)) * W, H - 2 - ((v - min) / (max - min || 1)) * (H - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="grid-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GridAdd({ onAdd, onReset }: { onAdd: (id: string) => void; onReset: () => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return index
      .search(q, { first: false })
      .sort((a, b) => a.tier - b.tier || a.sub - b.sub || (b.rec.inst.popularity ?? 0) - (a.rec.inst.popularity ?? 0))
      .slice(0, 6)
      .map((m) => m.rec.inst);
  }, [q]);
  return (
    <div className="grid-add">
      <input autoFocus placeholder="더할 종목·지수·환율 (Enter로 추가)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && results[0] && (onAdd(results[0].id), setQ(''))} />
      <button className="btn" onClick={onReset}>
        처음 칸으로
      </button>
      {results.map((r) => (
        <div key={r.id} className="row" onClick={() => (onAdd(r.id), setQ(''))}>
          <span className="nm">
            <span>{r.nameKo ?? r.nameEn}</span>
            <span className="cd">{r.code}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
