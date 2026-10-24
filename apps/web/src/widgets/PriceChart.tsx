// GP 가격 차트(일·주·월봉 캔들, 거래량, 20일·60일 이동평균선)와 GIP 장중 차트(분봉).
// 왼쪽 위에 시가·고가·저가·종가와 신선도 배지를 붙여요(02).
// 보이는 범위: 기간 버튼(GP 1M~MAX, GIP 1H~MAX)으로 배율을 정하고, 종목만 바꾸면 그 배율 그대로 가장 최근 봉으로 가요.
// 가격 축은 종목·기간이 바뀔 때마다 보이는 봉에 다시 맞춰요(손으로 당긴 가격 축이 다음 종목에 남지 않게).

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
import { patchPanel, type PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { GIP_RANGES, GP_RANGES, GIP_DEFAULT, GP_DEFAULT, RIGHT_PAD, visibleBarCount } from './chartRange';
import { TitleBar } from './common';

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
  // 봉 단위와 기간은 패널마다 기억해요(종목을 바꾸거나 앱을 다시 켜도 그대로)
  const interval: BarInterval = intraday ? '1m' : (panel.gpInterval ?? '1d');
  const range = intraday ? (panel.gipRange && GIP_RANGES[panel.gipRange] ? panel.gipRange : GIP_DEFAULT) : panel.gpRange && GP_RANGES[panel.gpRange] ? panel.gpRange : GP_DEFAULT;
  // 기간 버튼을 누를 때마다 늘려요. 같은 버튼을 다시 눌러도 기본 보기로 돌아가요
  const [fitTick, setFitTick] = useState(0);
  const pickRange = (r: string) => {
    patchPanel(panel.id, intraday ? { gipRange: r } : { gpRange: r });
    setFitTick((n) => n + 1);
  };
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
  const barsIdRef = useRef<string | null>(null);
  // 지금 보이는 범위를 어떤 기준으로 맞췄는지(종목 id, 봉 단위·기간·버튼 누름)
  const viewRef = useRef<{ id: string; key: string } | null>(null);
  // 차트 크기가 아직 0이라 미뤄 둔 범위 맞추기
  const pendingFit = useRef<(() => void) | null>(null);

  // 차트 만들기
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0A0A0A' }, textColor: '#8C8C8C', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      rightPriceScale: { borderColor: '#242424' },
      timeScale: { borderColor: '#242424', rightOffset: RIGHT_PAD, timeVisible: intraday, secondsVisible: false, tickMarkFormatter: (t: number, type: TickMarkType) => kstTick(t, type) },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#555', labelBackgroundColor: '#262626' }, horzLine: { color: '#555', labelBackgroundColor: '#262626' } },
      // 시간 축은 한국 시간으로 보여 줘요(배지 시각과 같은 기준)
      localization: { locale: 'ko-KR', timeFormatter: (t: number) => kstLabel(t, intraday ? 'full' : 'date') },
    });
    const candle = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineColor: '#FB8B1E' });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    // 이동평균선은 가격 축 맞춤에서 빼요. 현재가에서 멀리 떨어진 60일선 때문에 캔들이 작게 몰리지 않게
    const maOptions = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null } as const;
    const ma20 = chart.addSeries(LineSeries, { ...maOptions, color: '#FB8B1E' });
    const ma60 = chart.addSeries(LineSeries, { ...maOptions, color: '#BDBDBD' });
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
    // 크기가 0일 때 범위를 맞추면 배율이 가장 작게 굳어요. 크기가 생기면 그때 맞춰요
    const onSize = (w: number) => {
      if (w > 0 && pendingFit.current) {
        const fit = pendingFit.current;
        pendingFit.current = null;
        fit();
      }
    };
    chart.timeScale().subscribeSizeChange(onSize);
    viewRef.current = null;
    return () => {
      crossListeners.delete(listener);
      chart.timeScale().unsubscribeSizeChange(onSize);
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
    const chart = chartRef.current;
    // 종목을 바꾼 직전에는 앞 종목의 봉이 남아 있어요. 새 봉이 올 때까지 기다려요
    if (!c || !chart || !series || !inst || series.id !== inst.id || series.interval !== interval) return;
    const bars = series.bars;
    barsRef.current = bars.slice();
    barsIdRef.current = series.id;
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
    if (bars.length === 0) return;

    const ts = chart.timeScale();
    const key = `${interval}|${range}|${fitTick}`;
    const view = viewRef.current;
    const idChanged = view?.id !== series.id;
    if (!view || view.key !== key) {
      // 처음이거나 봉 단위·기간 버튼이 바뀌었으면 그 기간에 맞춰요
      const n = visibleBarCount(bars, intraday, interval, range);
      const fit = () => chart.timeScale().setVisibleLogicalRange({ from: bars.length - n - 0.5, to: bars.length - 1 + RIGHT_PAD + 0.5 });
      if (ts.width() > 0) fit();
      else pendingFit.current = fit;
    } else if (idChanged) {
      // 종목만 바뀌었으면 지금 배율 그대로 가장 최근 봉으로
      ts.scrollToPosition(RIGHT_PAD, false);
    }
    if (!view || view.key !== key || idChanged) {
      // 가격 축은 보이는 봉에 다시 맞춰요(손으로 당겨 꺼진 자동 맞춤을 다시 켜요)
      chart.priceScale('right').applyOptions({ autoScale: true });
    }
    viewRef.current = { id: series.id, key };
  }, [series, range, interval, intraday, inst, fitTick]);

  // 실시간 시세로 마지막 봉 고치기
  useEffect(() => {
    const c = candleRef.current;
    const bars = barsRef.current;
    // 종목을 바꾼 직후에는 앞 종목의 봉이 남아 있어서, 새 종목 시세로 고치면 가격 축이 튀어요
    if (!c || !quote || bars.length === 0 || quote.id !== barsIdRef.current) return;
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
      intraday ? (
        <>
          {Object.keys(GIP_RANGES).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} title={r === '1D' ? '가장 최근 장 전체(24시간 시장은 최근 24시간)' : '이 기간으로 보기(다시 누르면 처음 보기로)'} onClick={() => pickRange(r)}>
              {r}
            </button>
          ))}
        </>
      ) : (
        <>
          {(['1d', '1w', '1M'] as const).map((iv) => (
            <button key={iv} className={interval === iv ? 'on' : ''} onClick={() => patchPanel(panel.id, { gpInterval: iv })}>
              {iv === '1d' ? '일' : iv === '1w' ? '주' : '월'}
            </button>
          ))}
          <span style={{ width: 8 }} />
          {Object.keys(GP_RANGES).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} title="이 기간으로 보기(다시 누르면 처음 보기로)" onClick={() => pickRange(r)}>
              {r}
            </button>
          ))}
        </>
      ),
    [interval, range, intraday, panel.id], // eslint-disable-line react-hooks/exhaustive-deps
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
