// GP 가격 차트(일·주·월봉 캔들, 거래량, 20일·60일 이동평균선)와 GIP 장중 차트(분봉).
// 왼쪽 위에 시가·고가·저가·종가와 신선도 배지를 붙여요(02).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  TickMarkType,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, BarInterval, BarSeries, Instrument } from '@bt/shared';
import { FreshBadge } from '../components/FreshBadge';
import { fmtPrice, fmtBig, priceDigits } from '../format';
import { getBars } from '../stores/bars';
import { useQuote } from '../stores/feed';
import { supports, useInstrument } from '../stores/instruments';
import type { PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

const RANGES: Record<string, number> = { '3M': 63, '6M': 126, '1Y': 250, MAX: 100000 };

// 십자선 동기화: 한 차트에 마우스를 올리면 다른 차트에도 같은 시점에 세로선(02)
type CrossListener = (t: number | null, from: IChartApi) => void;
const crossListeners = new Set<CrossListener>();

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function kst(t: number) {
  return new Date((t + 9 * 3600) * 1000);
}

function kstLabel(t: number, kind: 'full' | 'date') {
  const d = kst(t);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return kind === 'date' ? date : `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function kstTick(t: number, type: TickMarkType) {
  const d = kst(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getUTCFullYear());
    case TickMarkType.Month:
      return `${d.getUTCMonth() + 1}월`;
    case TickMarkType.DayOfMonth:
      return `${d.getUTCDate()}일`;
    default:
      return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
}

function sma(bars: Bar[], n: number) {
  const out: Array<{ time: Time; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= n) sum -= bars[i - n].c;
    if (i >= n - 1) out.push({ time: bars[i].t as UTCTimestamp, value: sum / n });
  }
  return out;
}

export function PriceChart({ panel, intraday }: { panel: PanelState; intraday: boolean }) {
  const inst = useInstrument(panel.securityId);
  const [interval, setInterval] = useState<BarInterval>(intraday ? '1m' : '1d');
  const [range, setRange] = useState('6M');
  const [series, setSeries] = useState<BarSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);
  const quote = useQuote(inst?.id);
  const upDown = useStore(settings, (s) => s.display.upDown);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const closeRef = useRef<ISeriesApi<'Line'> | null>(null);
  const barsRef = useRef<Bar[]>([]);

  useEffect(() => setInterval(intraday ? '1m' : '1d'), [intraday]);

  // 차트 만들기
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0A0A0A' }, textColor: '#8C8C8C', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      rightPriceScale: { borderColor: '#242424' },
      timeScale: { borderColor: '#242424', timeVisible: intraday, secondsVisible: false, tickMarkFormatter: (t: number, type: TickMarkType) => kstTick(t, type) },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#555', labelBackgroundColor: '#262626' }, horzLine: { color: '#555', labelBackgroundColor: '#262626' } },
      // 시간 축은 한국 시간으로 보여 줘요(배지 시각과 같은 기준)
      localization: { locale: 'ko-KR', timeFormatter: (t: number) => kstLabel(t, intraday ? 'full' : 'date') },
    });
    const candle = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineColor: '#FB8B1E' });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const ma20 = chart.addSeries(LineSeries, { color: '#FB8B1E', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ma60 = chart.addSeries(LineSeries, { color: '#BDBDBD', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    // 환율처럼 종가만 있는 데이터는 캔들 대신 선으로 그려요
    const closeLine = chart.addSeries(LineSeries, { color: '#E6E6E6', lineWidth: 1, priceLineColor: '#FB8B1E', visible: false });
    closeRef.current = closeLine;
    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;
    ma20Ref.current = ma20;
    ma60Ref.current = ma60;
    chart.subscribeCrosshairMove((p) => {
      const t = p.time as number | undefined;
      setHover(t !== undefined ? (barsRef.current.find((b) => b.t === t) ?? null) : null);
      if (p.sourceEvent) crossListeners.forEach((l) => l(t ?? null, chart));
    });
    const listener: CrossListener = (t, from) => {
      if (from === chart) return;
      if (t === null) chart.clearCrosshairPosition();
      else {
        const b = barsRef.current.find((x) => x.t === t);
        if (b) chart.setCrosshairPosition(b.c, t as UTCTimestamp, candle);
      }
    };
    crossListeners.add(listener);
    return () => {
      crossListeners.delete(listener);
      chart.remove();
      chartRef.current = null;
    };
  }, [intraday]);

  // 등락 색(설정)
  useEffect(() => {
    const up = cssVar('--up') || '#3FD08A';
    const down = cssVar('--down') || '#FF5F57';
    candleRef.current?.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    const bars = barsRef.current;
    volRef.current?.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: b.v, color: (i > 0 && b.c < bars[i - 1].c) || b.c < b.o ? `${down}66` : `${up}66` })));
  }, [upDown, series]);

  const noIntraday = !!inst && intraday && !supports('GIP', inst);

  // 봉 받기
  useEffect(() => {
    if (!inst || noIntraday) return;
    let alive = true;
    setError(null);
    getBars(inst.id, interval, intraday ? 20_000 : 5 * 60_000).then(
      (s) => alive && setSeries(s),
      (e: Error) => alive && (setError(e.message), setSeries(null)),
    );
    return () => {
      alive = false;
    };
  }, [inst?.id, interval, intraday, noIntraday]); // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 넣기
  useEffect(() => {
    const c = candleRef.current;
    if (!c || !series || !inst) return;
    const bars = series.bars;
    barsRef.current = bars.slice();
    const d = priceDigits(inst, bars[bars.length - 1]?.c);
    c.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    const closeOnly = bars.length > 0 && bars.every((b) => b.o === b.c && b.h === b.c && b.l === b.c);
    c.applyOptions({ visible: !closeOnly });
    closeRef.current?.applyOptions({ visible: closeOnly, priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    closeRef.current?.setData(closeOnly ? bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.c })) : []);
    c.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    const up = cssVar('--up') || '#3FD08A';
    const down = cssVar('--down') || '#FF5F57';
    volRef.current?.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: b.v, color: (i > 0 && b.c < bars[i - 1].c) || b.c < b.o ? `${down}66` : `${up}66` })));
    const daily = !intraday;
    ma20Ref.current?.setData(daily ? sma(bars, 20) : []);
    ma60Ref.current?.setData(daily ? sma(bars, 60) : []);
    const n = intraday ? bars.length : Math.min(bars.length, RANGES[range] / (interval === '1w' ? 5 : interval === '1M' ? 21 : 1));
    if (bars.length > 0) chartRef.current?.timeScale().setVisibleLogicalRange({ from: bars.length - n - 0.5, to: bars.length + 2 });
  }, [series, range, interval, intraday, inst]);

  // 실시간 시세로 마지막 봉 고치기
  useEffect(() => {
    const c = candleRef.current;
    const bars = barsRef.current;
    if (!c || !quote || bars.length === 0) return;
    const last = bars[bars.length - 1];
    if (intraday) {
      const t = Math.floor(quote.fresh.asOf / 60_000) * 60;
      if (t > last.t) {
        const nb: Bar = { t, o: quote.last, h: quote.last, l: quote.last, c: quote.last, v: 0 };
        bars.push(nb);
        c.update({ time: t as UTCTimestamp, open: nb.o, high: nb.h, low: nb.l, close: nb.c });
        return;
      }
    }
    last.c = quote.last;
    last.h = Math.max(last.h, quote.last);
    last.l = Math.min(last.l, quote.last);
    c.update({ time: last.t as UTCTimestamp, open: last.o, high: last.h, low: last.l, close: last.c });
  }, [quote, intraday]);

  const shown = hover ?? series?.bars[series.bars.length - 1];
  const fresh = quote?.fresh ?? series?.fresh;
  const name = inst ? (inst.nameKo ?? inst.nameEn ?? inst.code) : '';
  const fnCode = intraday ? 'GIP' : 'GP';
  const tools = useMemo(
    () =>
      intraday ? null : (
        <>
          {(['1d', '1w', '1M'] as BarInterval[]).map((iv) => (
            <button key={iv} className={interval === iv ? 'on' : ''} onClick={() => setInterval(iv)}>
              {iv === '1d' ? '일' : iv === '1w' ? '주' : '월'}
            </button>
          ))}
          <span style={{ width: 8 }} />
          {Object.keys(RANGES).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </>
      ),
    [interval, range, intraday],
  );

  return (
    <>
      <TitleBar
        fn={fnCode}
        name={inst ? `${intraday ? '장중 차트' : '가격 차트'} · ${name}` : intraday ? '장중 차트' : '가격 차트'}
        sub={inst ? `${inst.code}${inst.market ? ` ${inst.market}` : ''}` : undefined}
        tools={tools}
      />
      <div className="pbody" style={{ overflow: 'hidden' }}>
        <div className="chart-ohlc">
          {shown && (
            <>
              <span>
                시 <b>{fmtPrice(inst, shown.o)}</b>
              </span>
              <span>
                고 <b>{fmtPrice(inst, shown.h)}</b>
              </span>
              <span>
                저 <b>{fmtPrice(inst, shown.l)}</b>
              </span>
              <span>
                종 <b>{fmtPrice(inst, shown.c)}</b>
              </span>
              {shown.v > 0 && (
                <span>
                  량 <b>{fmtBig(shown.v)}</b>
                </span>
              )}
            </>
          )}
          {!intraday && (
            <span>
              <i style={{ display: 'inline-block', width: 10, height: 2, background: '#FB8B1E', verticalAlign: 'middle' }} /> 20{' '}
              <i style={{ display: 'inline-block', width: 10, height: 2, background: '#BDBDBD', verticalAlign: 'middle' }} /> 60
            </span>
          )}
          <FreshBadge fresh={fresh} inst={inst} attribution={inst?.assetClass === 'CURNCY' ? 'ECB 기준환율 · Frankfurter' : undefined} />
        </div>
        <div className="chart-box" ref={boxRef} />
        {error && inst && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0 }}>
            <span className="err">{error}</span>
          </div>
        )}
        {noIntraday && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, background: 'var(--panel)', zIndex: 4 }}>
            <div>{inst?.nameKo ?? inst?.code}은(는) 데이터 소스가 분봉을 주지 않아서 GIP를 쓸 수 없어요</div>
            <div className="label">GP(일봉)를 써 보세요 · 예: {inst?.code} GP ⏎</div>
          </div>
        )}
        {!inst && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, background: 'var(--panel)', zIndex: 4 }}>
            <div>종목이 필요해요</div>
            <div className="label">커맨드 라인에 종목을 입력하세요 · 예: 005930 {fnCode} ⏎</div>
          </div>
        )}
      </div>
    </>
  );
}

export type { Instrument };
