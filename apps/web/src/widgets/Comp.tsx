// COMP 비교 차트(03 v0.2): 기준 종목과 비교 종목들의 수익률(기간 시작 = 0%)을 한 차트에 겹쳐요.
// 비교 종목은 커맨드 라인 인자(005930 COMP 000660 KOSPI). 안 붙이면 그 시장의 대표 지수와 비교해요.

import { useEffect, useRef, useState } from 'react';
import { ColorType, CrosshairMode, LineSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { slowestFreshness, type BarSeries, type Instrument } from '@bt/shared';
import { dirClass, fmtPrice } from '../format';
import { getBars } from '../stores/bars';
import { getInstrument, useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { COMP_DEFAULT, COMP_RANGES, benchmarkOf, commonStart, rangeStart, returnsFrom, type CompRange } from './comp';
import { cssVar, kstLabel, kstTick } from './PriceChart';
import { TitleBar } from './common';

/** 비교 종목 선 색(기준 종목은 강조 색) */
const COLORS = ['#4FC3F7', '#E040FB', '#69F0AE', '#F5F5F5', '#FF8A80'];
const REFRESH_MS = 60_000;

interface Line {
  inst: Instrument;
  color: string;
  points: Array<{ t: number; v: number }>;
  last?: number;
}

export function Comp({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  // 강조 색을 바꾸면 기준 종목 선을 다시 칠해요
  const accent = useStore(settings, (s) => s.display.accent);
  const range: CompRange = (COMP_RANGES as readonly string[]).includes(panel.compRange ?? '') ? (panel.compRange as CompRange) : COMP_DEFAULT;
  const explicit = (panel.args ?? []).filter((id) => id !== inst?.id);
  const bench = explicit.length === 0 ? benchmarkOf(inst) : undefined;
  const others = (bench ? [bench] : explicit).map((id) => getInstrument(id)).filter((x): x is Instrument => !!x);
  const ids = inst ? [inst.id, ...others.map((o) => o.id)] : [];
  const key = `${ids.join(',')}|${range}`;

  const [state, setState] = useState<{ key: string; lines?: Line[]; error?: string; fresh?: BarSeries['fresh'] } | null>(null);
  useEffect(() => {
    if (!inst) return;
    let alive = true;
    const all = [inst, ...others];
    const load = async () => {
      const got = await Promise.allSettled(all.map((x) => getBars(x.id, '1d', REFRESH_MS)));
      if (!alive) return;
      const ok = got.map((g) => (g.status === 'fulfilled' ? g.value : undefined));
      if (!ok[0]) {
        setState({ key, error: (got[0] as PromiseRejectedResult).reason?.message ?? '봉을 받지 못했어요' });
        return;
      }
      const series = ok.map((s) => s?.bars ?? []);
      const start = commonStart(
        series.filter((b) => b.length > 0),
        rangeStart(range, Date.now() / 1000),
      );
      const lines = all.map((x, i) => ({ inst: x, color: i === 0 ? '' : COLORS[(i - 1) % COLORS.length], points: returnsFrom(series[i], start), last: series[i].at(-1)?.c }));
      setState({ key, lines, fresh: slowestFreshness(ok.filter((s): s is BarSeries => !!s).map((s) => s.fresh)) });
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // key가 종목들과 기간을 모두 담아요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const cur = state?.key === key ? state : undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<'Line'>[] } | null>(null);

  // 차트 만들기
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#BDBDBD', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
      rightPriceScale: { borderColor: '#242424' },
      timeScale: { borderColor: '#242424', rightOffset: 2, tickMarkFormatter: kstTick },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#555', labelBackgroundColor: '#262626' }, horzLine: { color: '#555', labelBackgroundColor: '#262626' } },
      localization: { locale: 'ko-KR', timeFormatter: (t: number) => kstLabel(t, 'date'), priceFormatter: (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%` },
    });
    chartRef.current = { chart, series: [] };
    const Observer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver;
    const ro = new Observer((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      chart.resize(Math.floor(r.width), Math.floor(r.height));
      // 패널 크기가 바뀌면(최대화 등) 기간 전체가 다시 꽉 차게
      chart.timeScale().fitContent();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // 선 그리기
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    for (const s of c.series) c.chart.removeSeries(s);
    c.series = [];
    const main = cssVar('--accent') || '#FFA028';
    for (const [i, line] of (cur?.lines ?? []).entries()) {
      const s = c.chart.addSeries(LineSeries, { color: i === 0 ? main : line.color, lineWidth: i === 0 ? 2 : 1, priceLineVisible: false, lastValueVisible: true });
      s.setData(line.points.map((p) => ({ time: p.t as UTCTimestamp, value: p.v })));
      if (i === 0) s.createPriceLine({ price: 0, color: '#444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      c.series.push(s);
    }
    c.chart.timeScale().fitContent();
  }, [cur?.lines, accent]);

  const remove = (id: string) => patchPanel(panel.id, { args: explicit.filter((x) => x !== id) });
  return (
    <>
      <TitleBar
        fn="COMP"
        name="비교 차트"
        sub={inst ? `${inst.nameKo || inst.nameEn || inst.code} ${inst.code}` : undefined}
        fresh={cur?.fresh}
        inst={inst}
        tools={
          <>
            {COMP_RANGES.map((r) => (
              <button key={r} className={r === range ? 'on' : ''} onClick={() => patchPanel(panel.id, { compRange: r })}>
                {r}
              </button>
            ))}
          </>
        }
      />
      <div className="pbody" style={{ overflow: 'hidden' }}>
        <div className="comp-legend">
          {(cur?.lines ?? []).map((l, i) => {
            const total = l.points.at(-1)?.v;
            return (
              <span key={l.inst.id} className="comp-item">
                <i style={{ background: i === 0 ? 'var(--accent)' : l.color }} />
                <span className="comp-name">{l.inst.nameKo || l.inst.nameEn || l.inst.code}</span>
                <span className={`num ${dirClass(total)}`}>{total !== undefined ? `${total >= 0 ? '+' : ''}${total.toFixed(2)}%` : '—'}</span>
                <span className="num label">{fmtPrice(l.inst, l.last)}</span>
                {i > 0 && !bench && (
                  <button className="comp-x" title="비교에서 빼기" onClick={() => remove(l.inst.id)}>
                    ✕
                  </button>
                )}
                {i > 0 && bench && <span className="label">(대표 지수)</span>}
              </span>
            );
          })}
        </div>
        <div className="chart-box" ref={boxRef} />
        {inst && !cur && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
            <span className="label">불러오는 중…</span>
          </div>
        )}
        {cur?.error && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, zIndex: 4 }}>
            <span className="err">{cur.error}</span>
          </div>
        )}
        {inst && cur?.lines && others.length === 0 && (
          <div className="comp-hint label">비교 종목을 붙여 보세요 · 예: {inst.code} COMP 000660 KOSPI ⏎</div>
        )}
        {!inst && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, background: 'var(--panel)', zIndex: 4 }}>
            <div>종목이 필요해요</div>
            <div className="label">커맨드 라인에 기준 종목과 비교 종목을 입력하세요 · 예: 005930 COMP 000660 KOSPI ⏎</div>
          </div>
        )}
      </div>
    </>
  );
}
