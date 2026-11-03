// GP 가격 차트(1·2·4시간봉과 일·주·월봉 캔들, 거래량, 20·60봉 이동평균선)와 GIP 장중 차트(1분봉, 실시간이 주 목적).
// 왼쪽 위에 시가·고가·저가·종가와 신선도 배지를 붙여요(02).
// GP는 봉 크기(1시간~월)와 보이는 기간(1M~MAX)을 따로 골라요. 시간봉은 과거까지 이어서 보여 줘요.
// GIP는 늘 1분봉이고 1H·4H·1D·MAX는 보이는 기간이에요(1H는 1시간봉이 아니라 최근 1시간).
// 보이는 범위는 기간 버튼으로 배율을 정하고, 종목만 바꾸면 그 배율 그대로 가장 최근 봉으로 가요.
// 가격 축은 종목·기간이 바뀔 때마다 보이는 봉에 다시 맞춰요(손으로 당긴 가격 축이 다음 종목에 남지 않게).
// 종목을 바꾸면 새 봉이 올 때까지 앞 종목의 봉과 시고저종을 지우고 '불러오는 중'을 보여 줘요.

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
import { bucketStart, intervalMinutes, intradayAt, isHourInterval, regularAt, supportsHourBars, type Bar, type BarInterval, type BarSeries, type Instrument } from '@bt/shared';
import { FreshBadge } from '../components/FreshBadge';
import { fmtPrice, fmtBig, josa, priceDigits } from '../format';
import { getBars } from '../stores/bars';
import { useQuote } from '../stores/feed';
import { supports, useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { GIP_RANGES, GP_HOUR_DEFAULT, GP_RANGES, GIP_DEFAULT, GP_DEFAULT, RIGHT_PAD, visibleBarCount } from './chartRange';
import { TitleBar } from './common';

// 십자선 동기화: 한 차트에 마우스를 올리면 다른 차트에도 같은 시점에 세로선(02)
type CrossListener = (t: number | null, from: IChartApi) => void;
const crossListeners = new Set<CrossListener>();

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function kst(t: number) {
  return new Date((t + 9 * 3600) * 1000);
}

export function kstLabel(t: number, kind: 'full' | 'date') {
  const d = kst(t);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return kind === 'date' ? date : `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function kstTick(t: number, type: TickMarkType) {
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

/** GP 봉 크기 버튼(시간봉은 주식·코인만) */
const GP_INTERVALS = ['1h', '2h', '4h', '1d', '1w', '1M'] as const;
const GP_INTERVAL_LABEL: Record<(typeof GP_INTERVALS)[number], string> = { '1h': '1시간', '2h': '2시간', '4h': '4시간', '1d': '일', '1w': '주', '1M': '월' };

export function PriceChart({ panel, intraday }: { panel: PanelState; intraday: boolean }) {
  const inst = useInstrument(panel.securityId);
  // 봉 단위와 기간은 패널마다 기억해요(종목을 바꾸거나 앱을 다시 켜도 그대로). 시간봉이 없는 종목(지수·환율)은 일봉으로
  const hourOk = !!inst && supportsHourBars(inst);
  const gpInterval = panel.gpInterval ?? '1d';
  const interval: BarInterval = intraday ? '1m' : isHourInterval(gpInterval) && !hourOk ? '1d' : gpInterval;
  const hourly = isHourInterval(interval);
  // 시간봉은 기간을 따로 기억해요(처음은 1M. 일봉의 3M을 시간봉으로 보면 봉이 너무 촘촘해요)
  const gpRange = hourly ? (panel.gpHourRange ?? GP_HOUR_DEFAULT) : (panel.gpRange ?? GP_DEFAULT);
  const range = intraday ? (panel.gipRange && GIP_RANGES[panel.gipRange] ? panel.gipRange : GIP_DEFAULT) : GP_RANGES[gpRange] ? gpRange : GP_DEFAULT;
  // 가로축에 시각을 보여 줄지(분봉·시간봉)
  const timeMode = intraday || hourly;
  // 기간 버튼을 누를 때마다 늘려요. 같은 버튼을 다시 눌러도 기본 보기로 돌아가요
  const [fitTick, setFitTick] = useState(0);
  const pickRange = (r: string) => {
    patchPanel(panel.id, intraday ? { gipRange: r } : hourly ? { gpHourRange: r } : { gpRange: r });
    setFitTick((n) => n + 1);
  };
  const [series, setSeries] = useState<BarSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);
  // 실시간 시세로 고친 마지막 봉(시고저종 머리줄이 차트와 같은 값을 보이게)
  const [liveBar, setLiveBar] = useState<Bar | null>(null);
  const quote = useQuote(inst?.id);
  const upDown = useStore(settings, (s) => s.display.upDown);
  const accent = useStore(settings, (s) => s.display.accent);
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
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#BDBDBD', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
      rightPriceScale: { borderColor: '#242424' },
      timeScale: { borderColor: '#242424', rightOffset: RIGHT_PAD, timeVisible: timeMode, secondsVisible: false, tickMarkFormatter: (t: number, type: TickMarkType) => kstTick(t, type) },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#555', labelBackgroundColor: '#262626' }, horzLine: { color: '#555', labelBackgroundColor: '#262626' } },
      // 시간 축은 한국 시간으로 보여 줘요(배지 시각과 같은 기준)
      localization: { locale: 'ko-KR', timeFormatter: (t: number) => kstLabel(t, timeMode ? 'full' : 'date') },
    });
    // 현재가 꼬리표와 20봉선은 강조 색(앰버). 강조 색을 바꾸면 아래 색 효과에서 다시 칠해요
    const accentColor = cssVar('--accent') || '#FFA028';
    const candle = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineColor: accentColor });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    // 이동평균선은 가격 축 맞춤에서 빼요. 현재가에서 멀리 떨어진 60일선 때문에 캔들이 작게 몰리지 않게
    const maOptions = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null } as const;
    const ma20 = chart.addSeries(LineSeries, { ...maOptions, color: accentColor });
    const ma60 = chart.addSeries(LineSeries, { ...maOptions, color: '#BDBDBD' });
    // 환율처럼 종가만 있는 데이터는 캔들 대신 선으로 그려요
    const closeLine = chart.addSeries(LineSeries, { color: '#E6E6E6', lineWidth: 1, priceLineColor: accentColor, visible: false });
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
    // 크기는 차트가 놓인 창의 ResizeObserver로 따라가요. 떼어낸 창에서는 메인 창의 것이 크기 변화를 알려 주지 않아요
    const Observer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver;
    const ro = new Observer((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (r) chart.resize(Math.floor(r.width), Math.floor(r.height));
    });
    ro.observe(el);
    viewRef.current = null;
    barsIdRef.current = null;
    return () => {
      ro.disconnect();
      crossListeners.delete(listener);
      chart.timeScale().unsubscribeSizeChange(onSize);
      chart.remove();
      chartRef.current = null;
    };
  }, [timeMode]);

  // 등락 색(설정)
  useEffect(() => {
    const up = cssVar('--up') || '#1FBF3F';
    const down = cssVar('--down') || '#E8203C';
    const accentColor = cssVar('--accent') || '#FFA028';
    candleRef.current?.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, priceLineColor: accentColor });
    ma20Ref.current?.applyOptions({ color: accentColor });
    closeRef.current?.applyOptions({ priceLineColor: accentColor });
    const bars = barsRef.current;
    volRef.current?.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: b.v, color: (i > 0 && b.c < bars[i - 1].c) || b.c < b.o ? `${down}66` : `${up}66` })));
  }, [upDown, accent, series]);

  const noIntraday = !!inst && intraday && !supports('GIP', inst);

  // 시간봉은 1분마다 다시 받아요. 오늘 봉이 자라고, 내장 서버가 뒤에서 채운 지난 봉이 이어져요
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!hourly) return;
    const id = window.setInterval(() => setRefreshTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [hourly]);

  // 봉 받기
  useEffect(() => {
    if (!inst || noIntraday) return;
    let alive = true;
    setError(null);
    getBars(inst.id, interval, intraday ? 20_000 : hourly ? 55_000 : 5 * 60_000).then(
      (s) => alive && setSeries(s),
      (e: Error) => alive && (setError(e.message), setSeries(null)),
    );
    return () => {
      alive = false;
    };
  }, [inst?.id, interval, intraday, noIntraday, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 지금 종목·봉 단위의 봉(종목을 바꾼 직후에는 아직 없어요)
  const ready = series && inst && series.id === inst.id && series.interval === interval ? series : null;
  const viewBars = ready?.bars ?? null;

  // 데이터 넣기
  useEffect(() => {
    const c = candleRef.current;
    const chart = chartRef.current;
    if (!c || !chart) return;
    if (!ready || !viewBars) {
      // 종목을 바꾼 직후: 앞 종목의 봉을 지우고 새 봉을 기다려요(제목만 바뀌고 앞 종목의 차트가 남지 않게)
      if (barsIdRef.current !== null) {
        for (const x of [c, volRef.current, ma20Ref.current, ma60Ref.current, closeRef.current]) x?.setData([]);
        barsRef.current = [];
        barsIdRef.current = null;
        setHover(null);
        setLiveBar(null);
        // 빈 차트에 앞 종목의 가격 눈금이 남지 않게 가격 축을 잠깐 숨겨요
        chart.applyOptions({ rightPriceScale: { visible: false } });
      }
      return;
    }
    chart.applyOptions({ rightPriceScale: { visible: true } });
    setLiveBar(null);
    const bars = viewBars;
    barsRef.current = bars.slice();
    barsIdRef.current = ready.id;
    const d = priceDigits(inst, bars[bars.length - 1]?.c);
    c.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    const closeOnly = bars.length > 0 && bars.every((b) => b.o === b.c && b.h === b.c && b.l === b.c);
    c.applyOptions({ visible: !closeOnly });
    closeRef.current?.applyOptions({ visible: closeOnly, priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    closeRef.current?.setData(closeOnly ? bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.c })) : []);
    c.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    const up = cssVar('--up') || '#1FBF3F';
    const down = cssVar('--down') || '#E8203C';
    volRef.current?.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: b.v, color: (i > 0 && b.c < bars[i - 1].c) || b.c < b.o ? `${down}66` : `${up}66` })));
    // 이동평균선은 GP에만(일봉이면 20·60일, 시간봉이면 20·60봉)
    const withMa = !intraday;
    ma20Ref.current?.setData(withMa ? sma(bars, 20) : []);
    ma60Ref.current?.setData(withMa ? sma(bars, 60) : []);
    if (bars.length === 0) return;

    const ts = chart.timeScale();
    const key = `${interval}|${range}|${fitTick}`;
    const view = viewRef.current;
    const idChanged = view?.id !== ready.id;
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
    viewRef.current = { id: ready.id, key };
  }, [ready, range, interval, intraday, inst, fitTick]);

  // 실시간 시세로 마지막 봉 고치기
  useEffect(() => {
    const c = candleRef.current;
    const bars = barsRef.current;
    // 종목을 바꾼 직후에는 앞 종목의 봉이 남아 있어서, 새 종목 시세로 고치면 가격 축이 튀어요
    if (!c || !quote || bars.length === 0 || quote.id !== barsIdRef.current) return;
    const last = bars[bars.length - 1];
    if ((intraday || hourly) && inst) {
      // 시간봉은 정규장 시세로만 고쳐요(미국 애프터마켓 체결로 봉을 고치거나 만들지 않아요)
      if (hourly && !regularAt(inst, quote.fresh.asOf)) return;
      // 이 시세가 들어갈 봉 칸(1분봉, 시간봉은 정규장 시작에 맞춘 칸). 시간봉에서 마감 시각 정각의 종가(미국 16:00)는
      // 마지막 장중 칸에 넣어요(16시 칸을 새로 만들지 않게)
      const t = intraday ? Math.floor(quote.fresh.asOf / 60_000) * 60 : bucketStart(inst, Math.floor((quote.fresh.asOf - 1) / 1000), intervalMinutes(interval as '1h'));
      // 새 봉은 장중 체결로만 만들어요(장이 닫힌 뒤 조회한 값으로 봉을 더하면 가로축이 건너뛰어요)
      if (t > last.t) {
        if (!intradayAt(inst, quote.fresh.asOf)) return;
        const nb: Bar = { t, o: quote.last, h: quote.last, l: quote.last, c: quote.last, v: 0 };
        bars.push(nb);
        c.update({ time: t as UTCTimestamp, open: nb.o, high: nb.h, low: nb.l, close: nb.c });
        setLiveBar({ ...nb });
        return;
      }
    }
    last.c = quote.last;
    last.h = Math.max(last.h, quote.last);
    last.l = Math.min(last.l, quote.last);
    c.update({ time: last.t as UTCTimestamp, open: last.o, high: last.h, low: last.l, close: last.c });
    setLiveBar({ ...last });
  }, [quote, intraday, hourly]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = hover ?? liveBar ?? viewBars?.[viewBars.length - 1];
  const fresh = quote?.fresh ?? ready?.fresh;
  const loading = !!inst && !noIntraday && !error && !ready;
  const empty = !!ready && ready.bars.length === 0;
  const name = inst ? (inst.nameKo ?? inst.nameEn ?? inst.code) : '';
  const fnCode = intraday ? 'GIP' : 'GP';
  const tools = useMemo(
    () =>
      intraday ? (
        <>
          <span className="label" style={{ alignSelf: 'center', fontSize: 11, marginRight: 4 }} title="GIP는 늘 1분봉이에요. 시간봉은 GP에서 봐요(예: 005930 GP ⏎ → 1시간)">
            1분봉
          </span>
          {Object.keys(GIP_RANGES).map((r) => (
            <button
              key={r}
              className={range === r ? 'on' : ''}
              title={r === '1D' ? '보이는 기간: 가장 최근 장 전체(24시간 시장은 최근 24시간)' : r === 'MAX' ? '보이는 기간: 받아 둔 분봉 전체' : `보이는 기간: 최근 ${r === '1H' ? '1시간' : '4시간'}(1시간봉이 아니에요. 시간봉은 GP에서). 다시 누르면 처음 보기로`}
              onClick={() => pickRange(r)}
            >
              {r}
            </button>
          ))}
        </>
      ) : (
        <>
          {GP_INTERVALS.filter((iv) => hourOk || !isHourInterval(iv)).map((iv) => (
            <button key={iv} className={interval === iv ? 'on' : ''} title={`봉 크기: ${GP_INTERVAL_LABEL[iv]}봉${isHourInterval(iv) ? '(과거까지 이어서)' : ''}`} onClick={() => patchPanel(panel.id, { gpInterval: iv })}>
              {GP_INTERVAL_LABEL[iv]}
            </button>
          ))}
          <span style={{ width: 8 }} />
          {Object.keys(GP_RANGES).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} title="보이는 기간(다시 누르면 처음 보기로)" onClick={() => pickRange(r)}>
              {r}
            </button>
          ))}
        </>
      ),
    [interval, range, intraday, hourOk, panel.id], // eslint-disable-line react-hooks/exhaustive-deps
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
              <i style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--accent)', verticalAlign: 'middle' }} /> 20{' '}
              <i style={{ display: 'inline-block', width: 10, height: 2, background: '#BDBDBD', verticalAlign: 'middle' }} /> 60
            </span>
          )}
          <FreshBadge fresh={fresh} inst={inst} attribution={fresh?.source === 'ECB' ? 'ECB 기준환율 · Frankfurter' : undefined} />
        </div>
        <div className="chart-box" ref={boxRef} />
        {error && inst && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, zIndex: 4 }}>
            <span className="err">{error}</span>
          </div>
        )}
        {loading && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
            <span className="label">불러오는 중…</span>
          </div>
        )}
        {empty && !error && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
            <div>{intraday ? '아직 장중 분봉이 없어요' : '봉 데이터가 없어요'}</div>
            {intraday && <div className="label">장이 열리면 1분마다 봉이 생겨요</div>}
          </div>
        )}
        {noIntraday && (
          <div className="empty-body" style={{ position: 'absolute', inset: 0, background: 'var(--panel)', zIndex: 4 }}>
            <div>{josa(inst?.nameKo ?? inst?.code ?? '', '은', '는')} 데이터 소스가 분봉을 주지 않아서 GIP를 쓸 수 없어요</div>
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
