// 시세 중계: 화면 연결(여러 창)이 구독한 종목을 소스별 어댑터로 보내고, 받은 시세를 묶어서 돌려줘요.
// 여러 창에 같은 종목이 떠 있어도 한 번만 구독하고, 어떤 창에도 안 보이면 해제해요(01).

import type { BarInterval, BarSeries, Instrument, Quote, ServerMessage, SourceStatus } from '@bt/shared';
import type { BinanceAdapter } from './adapters/binance';
import type { DemoAdapter } from './adapters/demo';
import type { EcbAdapter } from './adapters/ecb';
import type { KisAdapter } from './adapters/kis';
import type { Adapter, AdapterHost } from './adapters/types';
import type { Logger } from './util';

export interface Client {
  send(msg: ServerMessage): void;
  ids: Set<string>;
  /** 종목 목록이 준비되기 전에 들어온 구독 요청 */
  pending?: Set<string>;
}

const FLUSH_MS = 100;

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
  /** 메모리에 잠시 둔 봉(같은 요청이 몰리지 않게) */
  private barCache = new Map<string, { at: number; series: Promise<BarSeries> }>();

  constructor(public log: Logger) {}

  private ready = false;

  setInstruments(list: Instrument[]) {
    this.instruments = new Map(list.map((i) => [i.id, i]));
    this.ready = true;
    // 목록이 준비되기 전에 들어온 구독을 이제 처리해요
    for (const c of this.clients) {
      if (c.pending?.size) {
        const ids = [...c.pending];
        c.pending.clear();
        this.subscribe(c, ids);
      }
    }
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
    this.kis = kis;
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
    old?.stop();
    this.barCache.clear();
    this.routeSubscribe(moving);
    this.emitStatus();
  }

  emitQuote(q: Quote) {
    // 구독이 끝난 종목의 늦게 온 값은 버려요
    if (!this.refs.has(q.id)) return;
    this.quotes.set(q.id, q);
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
      for (const id of ids) if (c.ids.has(id)) quotes.push(this.quotes.get(id)!);
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
    const inst = this.instruments.get(id);
    if (!inst) throw new Error(`종목 ${id}를 찾을 수 없어요`);
    const key = `${id}|${interval}`;
    const ttl = interval === '1m' || interval === '5m' ? 30_000 : 10 * 60_000;
    const hit = this.barCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.series;
    const series = this.route(inst).bars(inst, interval);
    this.barCache.set(key, { at: Date.now(), series });
    series.catch(() => this.barCache.delete(key));
    return series;
  }

  quoteSnapshot(ids: string[]): Quote[] {
    return ids.map((id) => this.quotes.get(id)).filter((q): q is Quote => !!q);
  }
}
