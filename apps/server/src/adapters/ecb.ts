// 환율: ECB 기준환율(Frankfurter, 키 없음). 하루 한 번 갱신되는 값이라 '일별' 배지가 붙어요.
// KIS 환율 조회(04 1순위 후보)는 실제로 붙여 본 뒤에 주기 조회로 바꿔요(07 확인할 것).

import { FX_PAIRS, type Bar, type BarSeries, type Freshness, type Instrument, type Quote, type SourceStatus } from '@bt/shared';
import { fetchJson, ymdUtc } from '../util';
import type { Adapter, AdapterHost } from './types';

const BASE = 'https://api.frankfurter.dev/v1';
const POLL_MS = 30 * 60_000;

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
      for (const inst of this.subscribed.values()) {
        const q = this.quote(inst);
        if (q) this.host.emitQuote(q);
      }
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

  private quote(inst: Instrument): Quote | undefined {
    const pair = FX_PAIRS.find((p) => p.code === inst.code);
    if (!pair || this.days.length === 0) return undefined;
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
    for (const inst of insts) {
      this.subscribed.set(inst.id, inst);
      const q = this.quote(inst);
      if (q) this.host.emitQuote(q);
    }
  }

  unsubscribe(insts: Instrument[]) {
    for (const inst of insts) this.subscribed.delete(inst.id);
  }

  async bars(inst: Instrument, interval: '1m' | '5m' | '1d' | '1w' | '1M'): Promise<BarSeries> {
    const pair = FX_PAIRS.find((p) => p.code === inst.code);
    if (!pair) throw new Error(`환율 ${inst.code}를 찾을 수 없어요`);
    if (interval === '1m' || interval === '5m') throw new Error('환율 소스에 분봉이 없어요');
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
    return { source: 'ECB', state: this.state, message: this.message, intervalMs: POLL_MS, updatedAt: Date.now() };
  }
}
