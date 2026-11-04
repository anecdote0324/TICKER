// 데모 시세: 한국투자증권 키를 넣기 전에 주식·지수 화면을 볼 수 있게 만든 가짜 값이에요.
// 실제 시세가 아니라서 모든 값에 '데모' 배지가 붙어요(02 데이터 신선도 표시).
// 출발점은 마스터 파일의 기준가(전일 종가)예요.

import { regularSessionOf, type Bar, type BarInterval, type BarSeries, type Freshness, type Instrument, type Quote, type SourceStatus } from '@bt/shared';
import { hash32, seededRandom } from '../util';
import type { Adapter, AdapterHost, BarsOptions } from './types';

const INDEX_LEVEL: Record<string, number> = {
  KOSPI: 2600,
  KOSDAQ: 750,
  KOSPI2: 350,
  SPX: 5800,
  INDU: 42000,
  CCMP: 18500,
  NDX: 20500,
  SOX: 5000,
  UKX: 8200,
  DAX: 19500,
  CAC: 7500,
  SX5E: 4900,
  NKY: 39000,
  HSI: 20000,
  SHCOMP: 3300,
  TWSE: 22500,
};

interface DemoState {
  inst: Instrument;
  prevClose: number;
  last: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  rnd: () => number;
}

export class DemoAdapter implements Adapter {
  readonly source = 'DEMO' as const;
  private states = new Map<string, DemoState>();
  private subscribed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private host: AdapterHost) {}

  canServe(inst: Instrument) {
    return inst.assetClass === 'EQUITY' || inst.assetClass === 'INDEX';
  }

  supportsIntraday() {
    return true;
  }

  async start() {
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private base(inst: Instrument): number {
    if (inst.refPrice && inst.refPrice > 0) return inst.refPrice;
    if (inst.assetClass === 'INDEX') return INDEX_LEVEL[inst.code] ?? 1000;
    return inst.market === 'US' ? 100 : 50_000;
  }

  private state(inst: Instrument): DemoState {
    let s = this.states.get(inst.id);
    if (!s) {
      const rnd = seededRandom(hash32(inst.id) ^ Math.floor(Date.now() / 86400_000));
      const prevClose = this.base(inst);
      const open = round(inst, prevClose * (1 + (rnd() - 0.5) * 0.01));
      s = { inst, prevClose, last: open, open, high: open, low: open, volume: Math.floor(rnd() * 1e6), rnd };
      this.states.set(inst.id, s);
    }
    return s;
  }

  private quote(s: DemoState): Quote {
    const now = Date.now();
    const fresh: Freshness = { source: 'DEMO', mode: 'demo', asOf: now, receivedAt: now };
    return {
      id: s.inst.id,
      last: s.last,
      prevClose: s.prevClose,
      change: s.last - s.prevClose,
      changePct: ((s.last - s.prevClose) / s.prevClose) * 100,
      open: s.open,
      high: s.high,
      low: s.low,
      volume: s.volume,
      turnover: s.volume * s.last,
      fresh,
    };
  }

  private tick() {
    for (const id of this.subscribed) {
      const s = this.states.get(id);
      if (!s) continue;
      // 종목마다 1~3초에 한 번 움직여요
      if (s.rnd() < 0.5) continue;
      const vol = s.inst.assetClass === 'INDEX' ? 0.0004 : 0.0025;
      const next = round(s.inst, s.last * (1 + (s.rnd() - 0.5) * 2 * vol));
      s.last = next;
      s.high = Math.max(s.high, next);
      s.low = Math.min(s.low, next);
      s.volume += Math.floor(s.rnd() * 500);
      this.host.emitQuote(this.quote(s));
    }
  }

  subscribe(insts: Instrument[]) {
    for (const inst of insts) {
      this.subscribed.add(inst.id);
      this.host.emitQuote(this.quote(this.state(inst)));
    }
  }

  unsubscribe(insts: Instrument[]) {
    for (const inst of insts) this.subscribed.delete(inst.id);
  }

  async bars(inst: Instrument, interval: BarInterval, opts?: BarsOptions): Promise<BarSeries> {
    const s = this.state(inst);
    const rnd = seededRandom(hash32(`${inst.id}:${interval}`));
    const now = Date.now();
    // 데모 시세는 처음 받은 만큼(일봉 400개)만 있어요
    if (opts?.before) return { id: inst.id, interval, bars: [], fresh: { source: 'DEMO', mode: 'demo', asOf: now, receivedAt: now } };
    const bars: Bar[] = [];
    if (interval === '1m' || interval === '5m') {
      // 오늘 09:00(KST)부터 지금까지, 장이 끝났으면 15:30까지
      const step = interval === '1m' ? 60 : 300;
      const startSec = Math.floor(startOfKstDay(now) / 1000) + 9 * 3600;
      const endSec = Math.min(Math.floor(now / 1000), startSec + 6.5 * 3600);
      const n = Math.max(30, Math.floor((endSec - startSec) / step));
      let p = s.open;
      for (let i = 0; i < n; i++) {
        const o = p;
        const c = round(inst, o * (1 + (rnd() - 0.5) * 0.004));
        const h = round(inst, Math.max(o, c) * (1 + rnd() * 0.001));
        const l = round(inst, Math.min(o, c) * (1 - rnd() * 0.001));
        bars.push({ t: startSec + i * step, o, h, l, c, v: Math.floor(rnd() * 20000) });
        p = c;
      }
      // 마지막 봉은 지금 시세에 맞춰요
      const last = bars[bars.length - 1];
      last.c = s.last;
      last.h = Math.max(last.h, s.last);
      last.l = Math.min(last.l, s.last);
    } else if (interval === '1h') {
      // 최근 90일의 평일 정규장 1시간봉(끝 값이 지금 시세가 되도록 거꾸로 만들어요)
      const nowSec = Math.floor(now / 1000);
      const times: number[] = [];
      for (let back = 90; back >= 0; back--) {
        const ses = regularSessionOf(inst, nowSec - back * 86400);
        if (!ses || ses.weekday === 0 || ses.weekday === 6) continue;
        for (let t = ses.open; t < ses.close && t <= nowSec; t += 3600) times.push(t);
      }
      const closes: number[] = [s.last];
      for (let i = 1; i < times.length; i++) closes.unshift(closes[0] / (1 + (rnd() - 0.49) * 0.008));
      for (let i = 0; i < times.length; i++) {
        const c = round(inst, closes[i]);
        const o = round(inst, i > 0 ? closes[i - 1] : c);
        const h = round(inst, Math.max(o, c) * (1 + rnd() * 0.004));
        const l = round(inst, Math.min(o, c) * (1 - rnd() * 0.004));
        bars.push({ t: times[i], o, h, l, c, v: Math.floor(rnd() * 2e6) });
      }
    } else {
      const day = 86400;
      const n = interval === '1d' ? 400 : interval === '1w' ? 260 : 120;
      const step = interval === '1d' ? day : interval === '1w' ? 7 * day : 30 * day;
      // 끝 값이 기준가가 되도록 거꾸로 만들어요
      const closes: number[] = [s.prevClose];
      for (let i = 1; i < n; i++) closes.unshift(closes[0] / (1 + (rnd() - 0.49) * 0.03 * Math.sqrt(step / day)));
      const todayStart = Math.floor(startOfKstDay(now) / 1000);
      for (let i = 0; i < n; i++) {
        const c = round(inst, closes[i]);
        const o = round(inst, i > 0 ? closes[i - 1] * (1 + (rnd() - 0.5) * 0.005) : c);
        const h = round(inst, Math.max(o, c) * (1 + rnd() * 0.012));
        const l = round(inst, Math.min(o, c) * (1 - rnd() * 0.012));
        bars.push({ t: todayStart - (n - i) * step, o, h, l, c, v: Math.floor(rnd() * 1e7) });
      }
      bars.push({ t: todayStart, o: s.open, h: s.high, l: s.low, c: s.last, v: s.volume });
    }
    return { id: inst.id, interval, bars, fresh: { source: 'DEMO', mode: 'demo', asOf: now, receivedAt: now } };
  }

  status(): SourceStatus {
    return { source: 'DEMO', state: 'connected', message: '한국투자증권 키를 넣으면 실제 시세로 바뀌어요', updatedAt: Date.now() };
  }
}

function startOfKstDay(ms: number): number {
  const kst = ms + 9 * 3600_000;
  return kst - (kst % 86400_000) - 9 * 3600_000;
}

/** 호가 단위 비슷하게 반올림 */
function round(inst: Instrument, v: number): number {
  if (inst.assetClass === 'INDEX' || inst.market === 'US') return Math.round(v * 100) / 100;
  if (v >= 500_000) return Math.round(v / 1000) * 1000;
  if (v >= 100_000) return Math.round(v / 500) * 500;
  if (v >= 50_000) return Math.round(v / 100) * 100;
  if (v >= 10_000) return Math.round(v / 50) * 50;
  if (v >= 5_000) return Math.round(v / 10) * 10;
  if (v >= 1_000) return Math.round(v / 5) * 5;
  return Math.round(v);
}
