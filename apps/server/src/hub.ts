// 시세 중계: 화면 연결(여러 창)이 구독한 종목을 소스별 어댑터로 보내고, 받은 시세를 묶어서 돌려줘요.
// 여러 창에 같은 종목이 떠 있어도 한 번만 구독하고, 어떤 창에도 안 보이면 해제해요(01).

import { aggregateBars, intervalMinutes, intradayAt, isHourInterval, staticInstruments, supportsHourBars, type Bar, type BarInterval, type BarSeries, type Instrument, type Quote, type ServerMessage, type SourceStatus } from '@bt/shared';
import type { BinanceAdapter } from './adapters/binance';
import type { DemoAdapter } from './adapters/demo';
import type { EcbAdapter } from './adapters/ecb';
import type { KisAdapter } from './adapters/kis';
import type { Adapter, AdapterHost } from './adapters/types';
import { mergeBars, type History } from './history';
import type { Logger } from './util';

export interface Client {
  send(msg: ServerMessage): void;
  ids: Set<string>;
  /** 종목 목록이 준비되기 전에 들어온 구독 요청 */
  pending?: Set<string>;
}

const FLUSH_MS = 100;
/** 지난 시간봉을 이만큼(1년) 채워요. 한국투자증권은 분봉을 1년까지 보관해요 */
const HOUR_HISTORY_SEC = 365 * 86400;
/** 시간봉 사이가 이만큼(6일) 비면 빈 곳으로 보고 채워요(주말·짧은 연휴보다 길게) */
const HOUR_HOLE_SEC = 6 * 86400;

/**
 * 다음에 채울 자리(이 시각보다 오래된 시간봉을 받아요): 위에서부터 빈 곳의 위쪽 봉, 없으면 가장 오래된 봉(floor보다 새것일 때).
 * 이미 받아 본 자리(checked)는 건너뛰어요. 긴 연휴는 빈 곳처럼 보여도 한 번 받아 보고 넘어가요
 */
export function nextBackfillPoint(bars: Bar[], floor: number, checked: (t: number) => boolean): number | undefined {
  for (let i = bars.length - 1; i > 0; i--) {
    if (bars[i].t - bars[i - 1].t > HOUR_HOLE_SEC && !checked(bars[i].t)) return bars[i].t;
  }
  if (bars.length > 0 && bars[0].t > floor && !checked(bars[0].t)) return bars[0].t;
  return undefined;
}

export class Hub implements AdapterHost {
  instruments = new Map<string, Instrument>();
  private quotes = new Map<string, Quote>();
  private clients = new Set<Client>();
  private refs = new Map<string, number>();
  private routes = new Map<string, Adapter>();
  private pending = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  binance!: BinanceAdapter;
  ecb!: EcbAdapter;
  demo!: DemoAdapter;
  kis: KisAdapter | undefined;
  /** 분봉·이력 저장(없으면 저장하지 않아요. 테스트용) */
  history: History | undefined;
  /** 메모리에 잠시 둔 봉(같은 요청이 몰리지 않게) */
  private barCache = new Map<string, { at: number; series: Promise<BarSeries> }>();
  /** 지난 시간봉 채우기: 다음에 채울 종목(가장 최근에 연 것), 도는 중인지, 받아 본 자리(종목|시각) */
  private backfillNext: { inst: Instrument; adapter: Adapter } | null = null;
  private backfilling = false;
  private backfillChecked = new Set<string>();

  constructor(public log: Logger) {
    // 정해 둔 지수·환율은 마스터를 받기 전에도 알아요(켜자마자 WEI·환율 차트가 뜨게)
    for (const i of staticInstruments()) this.instruments.set(i.id, i);
  }

  private ready = false;
  private readyWaiters: Array<() => void> = [];

  /** 종목 목록이 준비될 때까지(최대 30초) 기다려요 */
  private whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
      setTimeout(resolve, 30_000).unref?.();
    });
  }

  setInstruments(list: Instrument[]) {
    this.instruments = new Map(list.map((i) => [i.id, i]));
    this.ready = true;
    for (const f of this.readyWaiters.splice(0)) f();
    // 목록이 준비되기 전에 들어온 구독을 이제 처리해요
    for (const c of this.clients) {
      if (c.pending?.size) {
        const ids = [...c.pending];
        c.pending.clear();
        this.subscribe(c, ids);
      }
    }
  }

  /** 직접 조회로 찾은 종목을 목록에 더해요(다음 마스터를 받을 때까지) */
  addInstrument(inst: Instrument) {
    this.instruments.set(inst.id, inst);
  }

  get demoMode() {
    return !this.kis;
  }

  route(inst: Instrument): Adapter {
    if (inst.assetClass === 'CRYPTO') return this.binance;
    if (inst.assetClass === 'CURNCY') return this.ecb;
    return this.kis ?? this.demo;
  }

  supportsIntraday(inst: Instrument): boolean {
    return this.route(inst).supportsIntraday(inst);
  }

  addClient(c: Client) {
    this.clients.add(c);
    c.send({ type: 'status', sources: this.statuses() });
  }

  removeClient(c: Client) {
    this.clients.delete(c);
    this.unsubscribe(c, [...c.ids]);
  }

  subscribe(c: Client, ids: string[]) {
    const fresh: Instrument[] = [];
    const snapshot: Quote[] = [];
    for (const id of ids) {
      if (c.ids.has(id)) continue;
      const inst = this.instruments.get(id);
      if (!inst) {
        if (!this.ready) (c.pending ??= new Set()).add(id);
        continue;
      }
      c.ids.add(id);
      const n = (this.refs.get(id) ?? 0) + 1;
      this.refs.set(id, n);
      if (n === 1) fresh.push(inst);
      const q = this.quotes.get(id);
      if (q) snapshot.push(q);
    }
    if (snapshot.length) c.send({ type: 'quotes', quotes: snapshot });
    this.routeSubscribe(fresh);
  }

  unsubscribe(c: Client, ids: string[]) {
    const gone: Instrument[] = [];
    for (const id of ids) {
      c.pending?.delete(id);
      if (!c.ids.delete(id)) continue;
      const n = (this.refs.get(id) ?? 1) - 1;
      if (n <= 0) {
        this.refs.delete(id);
        const inst = this.instruments.get(id);
        if (inst) gone.push(inst);
      } else this.refs.set(id, n);
    }
    this.routeUnsubscribe(gone);
  }

  private routeSubscribe(insts: Instrument[]) {
    const by = new Map<Adapter, Instrument[]>();
    for (const inst of insts) {
      const a = this.route(inst);
      this.routes.set(inst.id, a);
      by.set(a, [...(by.get(a) ?? []), inst]);
    }
    for (const [a, list] of by) a.subscribe(list);
  }

  private routeUnsubscribe(insts: Instrument[]) {
    const by = new Map<Adapter, Instrument[]>();
    for (const inst of insts) {
      const a = this.routes.get(inst.id);
      this.routes.delete(inst.id);
      this.quotes.delete(inst.id);
      if (a) by.set(a, [...(by.get(a) ?? []), inst]);
    }
    for (const [a, list] of by) a.unsubscribe(list);
  }

  /** 한국투자증권 키를 넣거나 지우면 주식·지수 구독을 새 소스로 옮겨요 */
  async setKis(kis: KisAdapter | undefined) {
    const old = this.kis;
    if (old === kis) return;
    // 이전 연결을 먼저 닫아요. 한국투자증권은 키마다 실시간 등록 수를 세서, 두 연결이 겹치면 새 연결의 구독이 거절돼요(MAX SUBSCRIBE OVER)
    old?.stop();
    this.kis = kis;
    // 환율도 한국투자증권 키가 있으면 10초마다 받고, 없으면 ECB 기준환율로(04 환율)
    this.ecb?.setLive?.(kis);
    if (kis) await kis.start().catch((e) => this.log.warn(`KIS 시작 실패: ${(e as Error).message}`));
    const moving: Instrument[] = [];
    for (const [id, a] of this.routes) {
      const inst = this.instruments.get(id);
      if (!inst) continue;
      const next = this.route(inst);
      if (next !== a) {
        a.unsubscribe([inst]);
        this.quotes.delete(id);
        moving.push(inst);
      }
    }
    this.barCache.clear();
    this.routeSubscribe(moving);
    this.emitStatus();
  }

  emitQuote(q: Quote) {
    // 구독이 끝난 종목의 늦게 온 값은 버려요
    if (!this.refs.has(q.id)) return;
    // 값이 없는 응답(0)은 실제 값처럼 보이지 않게 버려요. 화면은 —로 남아요
    if (!Number.isFinite(q.last) || q.last <= 0) return;
    this.quotes.set(q.id, q);
    // 분봉은 지금 체결된 값으로만 만들어요. 장이 닫힌 뒤 조회한 마감 값으로 봉을 만들면 정규장 밖에 봉이 생겨요
    const inst = this.instruments.get(q.id);
    if (q.fresh.receivedAt - q.fresh.asOf < 120_000 && (!inst || intradayAt(inst, q.fresh.asOf))) this.history?.onQuote(q);
    this.pending.add(q.id);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush() {
    this.flushTimer = null;
    if (this.pending.size === 0) return;
    const ids = this.pending;
    this.pending = new Set();
    for (const c of this.clients) {
      const quotes: Quote[] = [];
      for (const id of ids) {
        // 보내기 전에 구독이 끝나거나 소스가 바뀌어 지워진 값은 건너뛰어요(빈 값이 섞이면 화면이 그 묶음을 버려요)
        const q = c.ids.has(id) ? this.quotes.get(id) : undefined;
        if (q) quotes.push(q);
      }
      if (quotes.length) c.send({ type: 'quotes', quotes });
    }
  }

  statuses(): SourceStatus[] {
    const list = [this.binance.status(), this.ecb.status()];
    list.push(this.kis ? this.kis.status() : this.demo.status());
    return list;
  }

  emitStatus() {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      const msg: ServerMessage = { type: 'status', sources: this.statuses() };
      for (const c of this.clients) c.send(msg);
    }, 200);
  }

  async bars(id: string, interval: BarInterval): Promise<BarSeries> {
    let inst = this.instruments.get(id);
    // 켜자마자 들어온 요청: 종목 목록(마스터)을 받는 동안 기다려요
    if (!inst && !this.ready) {
      await this.whenReady();
      inst = this.instruments.get(id);
    }
    if (!inst) throw new Error(`종목 ${id}를 찾을 수 없어요`);
    if (isHourInterval(interval)) {
      if (!supportsHourBars(inst)) throw new Error(`${inst.nameKo ?? inst.code}은(는) 시간봉이 없어요`);
      // 2·4시간봉은 1시간봉을 묶어서 만들어요(국내 09·11·13·15시, 코인은 UTC 정각)
      if (interval !== '1h') {
        const base = await this.bars(id, '1h');
        return { ...base, interval, bars: aggregateBars(inst, base.bars, intervalMinutes(interval)) };
      }
    }
    const key = `${id}|${interval}`;
    // 분봉 30초, 시간봉 1분(오늘 봉이 자라고 지난 봉이 채워져요), 일·주·월봉 10분
    const ttl = interval === '1m' || interval === '5m' ? 30_000 : interval === '1h' ? 60_000 : 10 * 60_000;
    const hit = this.barCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.series;
    const series = this.fetchBars(inst, interval);
    this.barCache.set(key, { at: Date.now(), series });
    series.catch(() => this.barCache.delete(key));
    return series;
  }

  /** 소스에서 받은 봉을 저장해 둔 봉과 합쳐요. 소스가 막히면 저장해 둔 봉을 멈춤 배지로 보여 줘요 */
  private async fetchBars(inst: Instrument, interval: BarInterval): Promise<BarSeries> {
    const adapter = this.route(inst);
    const keep = adapter.source !== 'DEMO' && this.history;
    let series: BarSeries;
    // 시간봉은 저장해 둔 봉의 마지막 날부터만 받아요(그 앞은 저장분과 뒤에서 채운 것)
    const storedHours = interval === '1h' && keep ? this.history!.load(inst.id, '1h').bars : [];
    try {
      series = await adapter.bars(inst, interval, storedHours.length ? { after: storedHours[storedHours.length - 1].t } : undefined);
    } catch (e) {
      const saved = keep ? this.history!.load(inst.id, interval) : undefined;
      if (!saved?.bars.length) throw e;
      this.log.warn(`${inst.id} 봉을 소스에서 받지 못해 저장해 둔 봉을 써요: ${(e as Error).message}`);
      const at = saved.savedAt ?? saved.bars[saved.bars.length - 1].t * 1000;
      return { id: inst.id, interval, bars: inSession(inst, interval, saved.bars), fresh: { source: adapter.source, mode: 'poll', asOf: at, receivedAt: at, intervalMs: 60_000 } };
    }
    if (!keep) return series;
    try {
      this.history!.save(inst.id, interval, series.bars);
      // 분봉은 소스가 주는 범위(오늘·최근 몇 시간)보다 앞의 저장분과 지금 만들고 있는 봉까지 이어 붙여요
      if (interval === '1m') {
        const live = this.history!.liveBar(inst.id);
        let bars = mergeBars(this.history!.load(inst.id, interval).bars, series.bars);
        if (live && (bars.length === 0 || live.t > bars[bars.length - 1].t)) bars = [...bars, live];
        series = { ...series, bars: bars.slice(-Math.max(series.bars.length, 2000)) };
      }
      if (interval === '1h') {
        series = { ...series, bars: mergeBars(storedHours, series.bars) };
        this.queueBackfill(inst, adapter);
      }
    } catch (e) {
      this.log.warn(`봉 저장 실패: ${(e as Error).message}`);
    }
    return { ...series, bars: inSession(inst, interval, series.bars) };
  }

  /** 지난 시간봉을 뒤에서 조금씩 채워요(한 번에 한 종목, 가장 최근에 연 종목 먼저). 다음 새로 고침 때 차트에 보여요 */
  private queueBackfill(inst: Instrument, adapter: Adapter) {
    if (!adapter.olderHourBars || !this.history) return;
    this.backfillNext = { inst, adapter };
    if (!this.backfilling) void this.runBackfill();
  }

  private async runBackfill() {
    this.backfilling = true;
    try {
      while (this.backfillNext && this.history) {
        const { inst, adapter } = this.backfillNext;
        // 키를 바꿔 소스가 바뀌었으면 그만해요(다음에 시간봉을 열 때 새 소스로 다시 해요)
        if (this.route(inst) !== adapter) {
          this.backfillNext = null;
          continue;
        }
        const stored = this.history.load(inst.id, '1h').bars;
        const before = nextBackfillPoint(stored, Date.now() / 1000 - HOUR_HISTORY_SEC, (t) => this.backfillChecked.has(`${inst.id}|${t}`));
        if (before === undefined) {
          if (this.backfillNext?.inst.id === inst.id) this.backfillNext = null;
          continue;
        }
        this.backfillChecked.add(`${inst.id}|${before}`);
        try {
          const older = (await adapter.olderHourBars!(inst, before)).filter((b) => b.t < before);
          if (older.length) this.history.save(inst.id, '1h', older);
        } catch (e) {
          // 다음에 이 종목 시간봉을 열 때 다시 해요
          this.backfillChecked.delete(`${inst.id}|${before}`);
          this.log.warn(`${inst.id} 지난 시간봉을 받지 못했어요: ${(e as Error).message}`);
          if (this.backfillNext?.inst.id === inst.id) this.backfillNext = null;
        }
      }
    } finally {
      this.backfilling = false;
    }
  }

  quoteSnapshot(ids: string[]): Quote[] {
    return ids.map((id) => this.quotes.get(id)).filter((q): q is Quote => !!q);
  }
}

/** 분봉은 장중 봉만 보여 줘요. 예전에 장이 닫힌 뒤 만든 봉이나 정규장 밖의 봉이 저장돼 있어도 차트에 섞지 않아요 */
function inSession(inst: Instrument, interval: BarInterval, bars: Bar[]): Bar[] {
  if (interval !== '1m' && interval !== '5m') return bars;
  return bars.filter((b) => intradayAt(inst, b.t * 1000));
}
