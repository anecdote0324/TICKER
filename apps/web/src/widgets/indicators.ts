// GP 보조지표(02 차트): 이동평균선, 볼린저 밴드, 일목균형표, RSI, MACD. 계산만 여기서 하고 그리기는 PriceChart가 해요.
// 모든 함수는 봉 배열과 같은 길이의 배열을 돌려줘요(값이 아직 없는 앞부분은 undefined).

import type { Bar, BarInterval } from '@bt/shared';

export type IndicatorId = 'ma5' | 'ma20' | 'ma60' | 'ma120' | 'ma200' | 'bb' | 'ichimoku' | 'rsi' | 'macd';

export interface IndicatorDef {
  id: IndicatorId;
  label: string;
  /** 지표 메뉴의 묶음: 이동평균, 가격 위에 겹쳐 그리기, 아래 창 */
  group: 'ma' | 'overlay' | 'pane';
  /** 범례 색(여러 선이면 대표 색) */
  color: string;
  desc: string;
}

export const INDICATORS: IndicatorDef[] = [
  { id: 'ma5', label: '5', group: 'ma', color: '#26C6DA', desc: '5봉 이동평균' },
  { id: 'ma20', label: '20', group: 'ma', color: 'var(--accent)', desc: '20봉 이동평균' },
  { id: 'ma60', label: '60', group: 'ma', color: '#BDBDBD', desc: '60봉 이동평균' },
  { id: 'ma120', label: '120', group: 'ma', color: '#42A5F5', desc: '120봉 이동평균' },
  { id: 'ma200', label: '200', group: 'ma', color: '#EC407A', desc: '200봉 이동평균' },
  { id: 'bb', label: '볼린저 밴드', group: 'overlay', color: '#9575CD', desc: '20봉 이동평균 ± 표준편차 2배' },
  { id: 'ichimoku', label: '일목균형표', group: 'overlay', color: '#29B6F6', desc: '전환선 9, 기준선 26, 선행스팬 1·2(26봉 앞), 후행스팬(26봉 뒤)' },
  { id: 'rsi', label: 'RSI', group: 'pane', color: '#FFCA28', desc: 'RSI 14, 70·30 기준선' },
  { id: 'macd', label: 'MACD', group: 'pane', color: '#29B6F6', desc: 'MACD 12·26, 시그널 9, 히스토그램' },
];

/** 처음 GP를 열면 켜져 있는 지표(지금까지와 같은 20·60선) */
export const DEFAULT_INDICATORS: IndicatorId[] = ['ma20', 'ma60'];

export const MA_PERIOD: Partial<Record<IndicatorId, number>> = { ma5: 5, ma20: 20, ma60: 60, ma120: 120, ma200: 200 };

type Series = Array<number | undefined>;

export function sma(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 지수 이동평균. 첫 값은 앞 n개의 단순 평균이에요 */
export function ema(values: Series, n: number): Series {
  const out: Series = new Array(values.length).fill(undefined);
  const k = 2 / (n + 1);
  let prev: number | undefined;
  let seed: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    if (prev === undefined) {
      seed.push(v);
      if (seed.length === n) {
        prev = seed.reduce((a, b) => a + b, 0) / n;
        out[i] = prev;
        seed = [];
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 볼린저 밴드: 가운데(단순 이동평균)와 위·아래(± k × 모표준편차) */
export function bollinger(closes: number[], n = 20, k = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = sma(closes, n);
  const upper: Series = new Array(closes.length).fill(undefined);
  const lower: Series = new Array(closes.length).fill(undefined);
  for (let i = n - 1; i < closes.length; i++) {
    const m = mid[i]!;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (closes[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

/** RSI(와일더 평균). 첫 값은 n+1번째 봉에 생겨요 */
export function rsi(closes: number[], n = 14): Series {
  const out: Series = new Array(closes.length).fill(undefined);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = val();
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): { macd: Series; signal: Series; hist: Series } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Series = closes.map((_, i) => (f[i] !== undefined && s[i] !== undefined ? f[i]! - s[i]! : undefined));
  const sig = ema(line, signal);
  const hist: Series = line.map((v, i) => (v !== undefined && sig[i] !== undefined ? v - sig[i]! : undefined));
  return { macd: line, signal: sig, hist };
}

/** 기간 안 최고가와 최저가의 가운데 */
function midHL(bars: Bar[], i: number, n: number): number | undefined {
  if (i < n - 1) return undefined;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - n + 1; j <= i; j++) {
    if (bars[j].h > hi) hi = bars[j].h;
    if (bars[j].l < lo) lo = bars[j].l;
  }
  return (hi + lo) / 2;
}

/**
 * 일목균형표. 선행스팬 1·2는 shift봉 앞에 그려서 봉 배열보다 shift만큼 길어요(앞날 시각은 futureTimes로).
 * 후행스팬은 종가를 shift봉 뒤에 그려요(배열 i 자리 = i+shift번째 봉의 종가)
 */
export function ichimoku(bars: Bar[], conv = 9, base = 26, spanB = 52, shift = 26) {
  const tenkan: Series = bars.map((_, i) => midHL(bars, i, conv));
  const kijun: Series = bars.map((_, i) => midHL(bars, i, base));
  const lead1: Series = new Array(bars.length + shift).fill(undefined);
  const lead2: Series = new Array(bars.length + shift).fill(undefined);
  for (let i = 0; i < bars.length; i++) {
    if (tenkan[i] !== undefined && kijun[i] !== undefined) lead1[i + shift] = (tenkan[i]! + kijun[i]!) / 2;
    lead2[i + shift] = midHL(bars, i, spanB);
  }
  const lagging: Series = bars.map((_, i) => (i + shift < bars.length ? bars[i + shift].c : undefined));
  return { tenkan, kijun, lead1, lead2, lagging };
}

/**
 * 마지막 봉 뒤 n개 봉의 시각(선행스팬을 앞날에 그리려고). 일봉은 평일만(코인은 매일), 주봉 7일, 월봉 한 달,
 * 시간봉은 봉 간격만큼(장 시간은 따지지 않은 어림이에요)
 */
export function futureTimes(lastT: number, n: number, interval: BarInterval, everyDay = false): number[] {
  const out: number[] = [];
  let t = lastT;
  for (let k = 0; k < n; k++) {
    if (interval === '1M') {
      const d = new Date(t * 1000);
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()) / 1000;
    } else if (interval === '1w') t += 7 * 86400;
    else if (interval === '1d') {
      t += 86400;
      // 한국 시간 기준 요일(봉 시각은 그날 00:00 KST 근처예요)
      while (!everyDay && [0, 6].includes(new Date((t + 9 * 3600) * 1000).getUTCDay())) t += 86400;
    } else t += (interval === '1h' ? 1 : interval === '2h' ? 2 : interval === '4h' ? 4 : 1 / 60) * 3600;
    out.push(t);
  }
  return out;
}

/** 저장된 값에서 아는 지표만, 처음이면 기본 */
export function activeIndicators(saved: string[] | undefined): IndicatorId[] {
  if (!saved) return DEFAULT_INDICATORS;
  const ids = new Set(INDICATORS.map((d) => d.id));
  return saved.filter((x): x is IndicatorId => ids.has(x as IndicatorId));
}

/** 과거 봉을 앞에 붙여요(같은 시각이면 뒤의 것) */
export function prependBars(older: Bar[], bars: Bar[]): Bar[] {
  if (older.length === 0) return bars;
  const first = bars.length ? bars[0].t : Infinity;
  return [...older.filter((b) => b.t < first), ...bars];
}
