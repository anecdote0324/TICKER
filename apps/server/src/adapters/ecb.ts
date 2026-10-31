// 환율(04). 한국투자증권 키가 있으면 한국투자증권 환율 조회로 10초마다 받고('10초 주기' 배지),
// 키가 없거나 조회가 실패하면 ECB 기준환율(Frankfurter, 키 없음, 하루 한 번, '일별' 배지)을 써요.
// 차트의 일봉 이력은 늘 ECB 기준환율이에요(2년치를 한 번에 받을 수 있어요).

import { FX_PAIRS, isHourInterval, type Bar, type BarInterval, type BarSeries, type Freshness, type Instrument, type Quote, type SourceStatus } from '@bt/shared';
import { fetchJson, ymdUtc } from '../util';
import type { Adapter, AdapterHost } from './types';

const BASE = 'https://api.frankfurter.dev/v1';
const POLL_MS = 30 * 60_000;
/** 한국투자증권 환율 조회 간격 */
const LIVE_MS = 10_000;
/** 이보다 오래된 한국투자증권 환율은 쓰지 않고 ECB 기준환율로 돌아가요(조회가 몇 번 실패했을 때) */
const LIVE_STALE_MS = 60_000;

/** 실시간에 가까운 환율 소스(한국투자증권). 통화별 1달러당 값(지금·전일)을 줘요. 받지 못한 통화는 빠져요 */
export interface LiveFxSource {
  fxPerUsd(currencies: string[]): Promise<{ cur: Record<string, number>; prev: Record<string, number> }>;
}

interface Latest {
  date: string;
  rates: Record<string, number>;
}

interface Series {
  rates: Record<string, Record<string, number>>;
}

export class EcbAdapter implements Adapter {
  readonly source = 'ECB' as const;
  private state: SourceStatus['state'] = 'disconnected';
  private message = '';
  private timer: NodeJS.Timeout | null = null;
  /** 날짜별 USD 기준 환율: 최근 두 영업일 */
  private days: Array<{ date: string; usd: Record<string, number> }> = [];
  private receivedAt = 0;
  private subscribed = new Map<string, Instrument>();
  private live: LiveFxSource | undefined;
  private liveTimer: NodeJS.Timeout | null = null;
  /**
   * 한국투자증권에서 받은 통화별 1달러당 값과 받은 시각. 통화마다 따로 둬서, 한 통화가 한 번 실패해도(초당 한도 초과 등)
   * 그 통화만 앞 값을 1분까지 계속 써요. 통째로 바꾸면 그 통화가 든 칸만 ECB 값으로 바뀌었다 돌아오길 되풀이했어요
   */
  private liveRates = new Map<string, { cur: number; prev?: number; at: number }>();
  private liveWarnedAt = 0;

  constructor(private host: AdapterHost) {}

  canServe(inst: Instrument) {
    return inst.assetClass === 'CURNCY';
  }

  supportsIntraday() {
    return false;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
  }

  /** 한국투자증권 키를 넣거나 지우면 환율 소스를 바꿔요 */
  setLive(src: LiveFxSource | undefined) {
    this.live = src;
    this.liveRates.clear();
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    if (src) {
      this.liveTimer = setInterval(() => void this.refreshLive(), LIVE_MS);
      this.liveTimer.unref?.();
      void this.refreshLive();
    } else this.emitAll();
    this.host.emitStatus();
  }

  private async refreshLive() {
    const src = this.live;
    if (!src || this.subscribed.size === 0) return;
    const need = new Set<string>();
    for (const inst of this.subscribed.values()) {
      const pair = FX_PAIRS.find((p) => p.code === inst.code);
      if (pair) for (const c of [pair.base, pair.quote]) if (c !== 'USD') need.add(c);
    }
    try {
      const r = await src.fxPerUsd([...need]);
      if (this.live !== src) return;
      const at = Date.now();
      for (const [c, v] of Object.entries(r.cur)) this.liveRates.set(c, { cur: v, prev: r.prev[c], at });
      if (Object.keys(r.cur).length === 0) throw new Error('한국투자증권 환율 응답에 값이 없어요');
    } catch (e) {
      // 1분 동안 못 받으면 ECB 기준환율로 돌아가요(quote에서). 기록은 1분에 한 번만
      if (Date.now() - this.liveWarnedAt > 60_000) {
        this.liveWarnedAt = Date.now();
        this.host.log.warn(`환율(한국투자증권)을 받지 못했어요: ${(e as Error).message}`);
      }
    }
    this.emitAll();
  }

  private emitAll() {
    for (const inst of this.subscribed.values()) {
      const q = this.quote(inst);
      if (q) this.host.emitQuote(q);
    }
  }

  private async refresh() {
    try {
      this.state = this.days.length ? this.state : 'connecting';
      const end = new Date();
      const start = new Date(end.getTime() - 10 * 86400_000);
      const s = await fetchJson<Series>(`${BASE}/${ymdUtc(start)}..${ymdUtc(end)}?base=USD`, { timeoutMs: 15_000 });
      const dates = Object.keys(s.rates).sort();
      this.days = dates.slice(-2).map((d) => ({ date: d, usd: { ...s.rates[d], USD: 1 } }));
      this.receivedAt = Date.now();
      this.state = 'connected';
      this.message = `기준일 ${dates[dates.length - 1]}`;
      this.emitAll();
    } catch (e) {
      this.state = 'error';
      this.message = `환율을 받지 못했어요: ${(e as Error).message}`;
      this.host.log.warn(this.message);
    }
    this.host.emitStatus();
  }

  private rate(usd: Record<string, number>, base: string, quote: string): number | undefined {
    const b = usd[base];
    const q = usd[quote];
    if (!b || !q) return undefined;
    return q / b;
  }

  /** 한 통화의 한국투자증권 1달러당 값(1분 안에 받은 것만). 달러는 늘 1 */
  private liveRate(c: string): { cur: number; prev?: number; at: number } | undefined {
    if (c === 'USD') return { cur: 1, prev: 1, at: Infinity };
    const r = this.liveRates.get(c);
    return r && Date.now() - r.at <= LIVE_STALE_MS ? r : undefined;
  }

  /** 두 통화 모두 한국투자증권 값이 1분 안에 받은 것이면 그 값으로 계산해요 */
  private liveQuote(inst: Instrument, base: string, quote: string): Quote | undefined {
    if (!this.live) return undefined;
    const b = this.liveRate(base);
    const q = this.liveRate(quote);
    if (!b || !q) return undefined;
    const last = q.cur / b.cur;
    const prevClose = b.prev && q.prev ? q.prev / b.prev : undefined;
    // 기준 시각은 두 값 중 오래된 쪽
    const at = Math.min(b.at, q.at);
    return {
      id: inst.id,
      last,
      prevClose,
      change: prevClose !== undefined ? last - prevClose : undefined,
      changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : undefined,
      fresh: { source: 'KIS', mode: 'poll', asOf: at, receivedAt: at, intervalMs: LIVE_MS, asOfFromReceipt: true },
    };
  }

  private quote(inst: Instrument): Quote | undefined {
    const pair = FX_PAIRS.find((p) => p.code === inst.code);
    if (!pair) return undefined;
    const live = this.liveQuote(inst, pair.base, pair.quote);
    if (live) return live;
    if (this.days.length === 0) return undefined;
    const cur = this.days[this.days.length - 1];
    const prev = this.days.length > 1 ? this.days[0] : undefined;
    const last = this.rate(cur.usd, pair.base, pair.quote);
    if (last === undefined) return undefined;
    const prevClose = prev ? this.rate(prev.usd, pair.base, pair.quote) : undefined;
    const fresh: Freshness = {
      source: 'ECB',
      mode: 'daily',
      asOf: Date.parse(`${cur.date}T15:00:00Z`),
      asOfDate: cur.date,
      receivedAt: this.receivedAt,
    };
    return {
      id: inst.id,
      last,
      prevClose,
      change: prevClose !== undefined ? last - prevClose : undefined,
      changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : undefined,
      fresh,
    };
  }

  subscribe(insts: Instrument[]) {
    let fresh = false;
    for (const inst of insts) {
      this.subscribed.set(inst.id, inst);
      const q = this.quote(inst);
      if (q) this.host.emitQuote(q);
      const pair = FX_PAIRS.find((p) => p.code === inst.code);
      if (pair && !this.liveQuote(inst, pair.base, pair.quote)) fresh = true;
    }
    // 새 통화가 생기면 다음 주기를 기다리지 않고 바로 받아요
    if (fresh && this.live) void this.refreshLive();
  }

  unsubscribe(insts: Instrument[]) {
    for (const inst of insts) this.subscribed.delete(inst.id);
  }

  async bars(inst: Instrument, interval: BarInterval): Promise<BarSeries> {
    const pair = FX_PAIRS.find((p) => p.code === inst.code);
    if (!pair) throw new Error(`환율 ${inst.code}를 찾을 수 없어요`);
    if (interval === '1m' || interval === '5m') throw new Error('환율 소스에 분봉이 없어요');
    if (isHourInterval(interval)) throw new Error('환율 소스에 시간봉이 없어요');
    const end = new Date();
    const start = new Date(end.getTime() - 2 * 365 * 86400_000);
    const s = await fetchJson<Series>(`${BASE}/${ymdUtc(start)}..${ymdUtc(end)}?base=${pair.base}&symbols=${pair.quote}`, { timeoutMs: 20_000 });
    const bars: Bar[] = Object.keys(s.rates)
      .sort()
      .map((d) => {
        const c = s.rates[d][pair.quote];
        return { t: Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000), o: c, h: c, l: c, c, v: 0 };
      });
    const lastDate = Object.keys(s.rates).sort().pop() ?? ymdUtc(end);
    const now = Date.now();
    return {
      id: inst.id,
      interval,
      bars,
      fresh: { source: 'ECB', mode: 'daily', asOf: Date.parse(`${lastDate}T15:00:00Z`), asOfDate: lastDate, receivedAt: now },
    };
  }

  status(): SourceStatus {
    const live = !!this.live && [...this.liveRates.keys()].some((c) => this.liveRate(c));
    if (live) return { source: 'ECB', state: 'connected', message: '한국투자증권 환율 10초마다(차트 일봉은 ECB 기준환율)', intervalMs: LIVE_MS, updatedAt: Date.now() };
    return { source: 'ECB', state: this.state, message: this.message, intervalMs: POLL_MS, updatedAt: Date.now() };
  }
}
