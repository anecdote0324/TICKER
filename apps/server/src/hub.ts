// 시세 중계: 화면 연결(여러 창)이 구독한 종목을 소스별 어댑터로 보내고, 받은 시세를 묶어서 돌려줘요.
// 여러 창에 같은 종목이 떠 있어도 한 번만 구독하고, 어떤 창에도 안 보이면 해제해요(01).

import { aggregateBars, EXCHANGES, intervalMinutes, intradayAt, isHourInterval, lastRegularClose, overlapsRegular, sessionState, staticInstruments, supportsHourBars, type Bar, type BarInterval, type BarSeries, type Instrument, type Quote, type MostKind, type MostResponse, type SectorHistoryResponse, type SectorIndex, type SectorMapResponse, type SectorMember, type SectorRow, type SecurityProfile, type ServerMessage, type SourceStatus, CRYPTO_EXCLUDED_BASES } from '@bt/shared';
import type { BinanceAdapter } from './adapters/binance';
import type { DemoAdapter } from './adapters/demo';
import type { EcbAdapter } from './adapters/ecb';
import { kisPollFresh, type KisAdapter } from './adapters/kis';
import type { Adapter, AdapterHost } from './adapters/types';
import { mergeBars, type History } from './history';
import { krMaster } from './kr-master';
import type { NewsService } from './news';
import type { UsActivity } from './us-activity';
import type { Logger } from './util';

export interface Client {
  send(msg: ServerMessage): void;
  ids: Set<string>;
  /** 종목 목록이 준비되기 전에 들어온 구독 요청 */
  pending?: Set<string>;
}

const FLUSH_MS = 100;
/** 설명 창 간단 시세를 이만큼(10초) 다시 써요(05 §4.6) */
const SNAPSHOT_REUSE_MS = 10_000;
/** IMAP 종목 시세(30개씩 조회)와 업종 지수를 이만큼 다시 써요 */
const SECTOR_QUOTES_MS = 60_000;
const SECTOR_INDEX_MS = 30_000;
/** 코스피·코스닥 타일은 시가총액 상위 이만큼만(조회 7번) */
const SECTOR_TOP = 200;
/** 업종 지수 일봉을 다시 받는 간격 */
const SECTOR_HISTORY_MS = 20 * 3600_000;
/** MOST 순위를 이만큼(20초) 다시 써요 */
const MOST_CACHE_MS = 20_000;
/** DES 종목 개요를 이만큼(30초) 다시 써요. 여러 창에서 같은 종목을 열어도 한 번만 조회해요 */
const PROFILE_CACHE_MS = 30_000;
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
  /** 미국 종목 인기도 보강용 거래대금 기록(v0.2) */
  usActivity?: UsActivity;
  /** 뉴스·공시(DES의 DART 기업개황도 여기서) */
  news?: NewsService;
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
    // 미국 종목의 거래대금은 인기도 보강에 모아요(데모 값은 빼요)
    if (inst?.market === 'US' && q.fresh.source === 'KIS') this.usActivity?.record(inst.code, q.turnover);
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

  /**
   * before(초)보다 오래된 일·주·월봉 한 묶음(차트를 왼쪽 끝으로 끌거나 MAX를 누를 때). 더 없으면 빈 봉.
   * 시간·분봉은 처음 받을 때 저장분까지 모두 주므로 빈 봉이에요. 수정주가가 바뀔 수 있어서 저장하지 않고 그때그때 받아요
   */
  async olderBars(id: string, interval: BarInterval, before: number): Promise<BarSeries> {
    let inst = this.instruments.get(id);
    if (!inst && !this.ready) {
      await this.whenReady();
      inst = this.instruments.get(id);
    }
    if (!inst) throw new Error(`종목 ${id}를 찾을 수 없어요`);
    const now = Date.now();
    if (interval !== '1d' && interval !== '1w' && interval !== '1M') return { id, interval, bars: [], fresh: { source: this.route(inst).source, mode: 'poll', asOf: now, receivedAt: now } };
    const key = `${id}|${interval}|<${before}`;
    const hit = this.barCache.get(key);
    if (hit && now - hit.at < 10 * 60_000) return hit.series;
    const series = this.route(inst)
      .bars(inst, interval, { before })
      .then((s) => ({ ...s, bars: s.bars.filter((b) => b.t < before).sort((a, b) => a.t - b.t) }));
    this.barCache.set(key, { at: now, series });
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
    let bars = inSession(inst, interval, series.bars);
    if (inst.assetClass === 'EQUITY' && inst.market !== 'US' && (interval === '1m' || interval === '1h')) bars = await this.withKrClose(inst, interval, bars);
    return { ...series, bars };
  }

  /**
   * 국내 장 마감 동시호가(15:30) 체결을 분봉·시간봉에 넣어요. 한국투자증권 분봉에는 15:20 뒤 봉이 없어서
   * 마지막 봉이 그날 종가와 달랐어요(v0.1.0-beta.11 점검: GIP 마지막 봉 15:20 218,500, 종가 219,500).
   * 끝난 날마다 일봉의 종가·거래량(오늘은 장이 끝난 뒤의 지금 시세)으로 15:30 봉(1분봉)을 더하거나 15시 칸(시간봉)을 고쳐요
   */
  private async withKrClose(inst: Instrument, interval: '1m' | '1h', bars: Bar[]): Promise<Bar[]> {
    if (bars.length === 0) return bars;
    const KST = 9 * 3600;
    const dayOf = (t: number) => Math.floor((t + KST) / 86400);
    const close = new Map<number, { c: number; v?: number }>();
    const now = Date.now();
    const lastClose = lastRegularClose(EXCHANGES.KRX, now);
    // 일봉이 없을 때를 대비해 오늘(장이 끝났으면)은 지금 시세를 종가로 먼저 넣어 둬요
    const q = this.quotes.get(inst.id);
    if (q && sessionState(EXCHANGES.KRX, now) !== 'open' && q.fresh.asOf >= lastClose) close.set(dayOf(lastClose / 1000), { c: q.last, v: q.volume });
    // 일봉의 종가가 기준이에요. 마감 전에 받아 메모리에 둔 일봉이면 다시 받아요
    const key = `${inst.id}|1d`;
    if ((this.barCache.get(key)?.at ?? 0) < lastClose) this.barCache.delete(key);
    try {
      // 일봉의 시각은 그날 0시(UTC)예요
      for (const d of (await this.bars(inst.id, '1d')).bars) if (d.t % 86400 === 0) close.set(d.t / 86400, { c: d.c, v: d.v });
    } catch {
      // 일봉을 못 받으면 오늘(지금 시세)만 고쳐요
    }
    const out = bars.map((b) => ({ ...b }));
    const days = [...new Set(out.map((b) => dayOf(b.t)))];
    for (const day of days) {
      const auction = (day * 86400 - KST) + 15.5 * 3600;
      const info = close.get(day);
      // 아직 안 끝난 날(오늘 장중)은 건드리지 않아요
      if (!info || !(info.c > 0) || auction * 1000 > lastClose) continue;
      const own = out.filter((b) => dayOf(b.t) === day);
      const missingVol = info.v !== undefined ? Math.max(0, info.v - own.reduce((a, b) => a + b.v, 0)) : 0;
      if (interval === '1m') {
        if (own.some((b) => b.t >= auction)) continue;
        out.push({ t: auction, o: info.c, h: info.c, l: info.c, c: info.c, v: missingVol });
      } else {
        const slot = auction - 1800; // 15시 칸
        const bar = own.find((b) => b.t === slot);
        if (bar) {
          if (bar.c === info.c) continue;
          bar.c = info.c;
          bar.h = Math.max(bar.h, info.c);
          bar.l = Math.min(bar.l, info.c);
          bar.v += missingVol;
        } else out.push({ t: slot, o: info.c, h: info.c, l: info.c, c: info.c, v: missingVol });
      }
    }
    return out.sort((a, b) => a.t - b.t);
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

  /**
   * 설명 창 간단 시세(05 §4.6, v0.2): 받아 둔 시세가 10초 안이면 그것을, 아니면 소스에 한 번만 물어봐요(구독하지 않음).
   * 키가 없는 주식·지수는 데모 시세가 있을 때만
   */
  async snapshotQuote(id: string): Promise<Quote | undefined> {
    const have = this.quotes.get(id);
    if (have && Date.now() - have.fresh.receivedAt < SNAPSHOT_REUSE_MS) return have;
    const inst = this.instruments.get(id);
    if (!inst) return undefined;
    const ad = this.route(inst);
    if (ad === this.kis && this.kis) return (await this.kis.snapshot(inst)) ?? have;
    if (ad === this.binance && inst.feedSymbol) {
      const t = await this.binance.rest<{ lastPrice: string; openPrice: string; highPrice: string; lowPrice: string; volume: string; quoteVolume: string; closeTime: number }>(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(inst.feedSymbol)}`);
      const last = Number(t.lastPrice);
      const open = Number(t.openPrice);
      const now = Date.now();
      return {
        id,
        last,
        change: last - open,
        changePct: open ? ((last - open) / open) * 100 : 0,
        prevClose: open,
        high: Number(t.highPrice),
        low: Number(t.lowPrice),
        volume: Number(t.volume),
        turnover: Number(t.quoteVolume),
        fresh: { source: 'BINANCE', mode: 'poll', asOf: t.closeTime || now, receivedAt: now, intervalMs: SNAPSHOT_REUSE_MS },
      };
    }
    return have;
  }

  private profiles = new Map<string, { at: number; p: Promise<SecurityProfile> }>();

  /** DES 종목 개요(03 v0.2): 국내 종목 마스터의 칸과 한국투자증권 현재가 조회의 칸 */
  profile(id: string): Promise<SecurityProfile> {
    const hit = this.profiles.get(id);
    if (hit && Date.now() - hit.at < PROFILE_CACHE_MS) return hit.p;
    const p = this.loadProfile(id);
    this.profiles.set(id, { at: Date.now(), p });
    // 실패한 조회는 다시 쓰지 않아요
    p.catch(() => this.profiles.delete(id));
    return p;
  }

  private async loadProfile(id: string): Promise<SecurityProfile> {
    const inst = this.instruments.get(id);
    if (!inst) throw new Error(`종목 ${id}을(를) 찾지 못했어요`);
    if (inst.assetClass !== 'EQUITY') throw new Error('종목 개요는 주식만 볼 수 있어요');
    const out: SecurityProfile = { id, currency: inst.currency ?? (inst.market === 'US' ? 'USD' : 'KRW'), master: krMaster.profile(inst) };
    // DART 기업개황(국내, 인증키가 있을 때). 실패해도 나머지는 보여 줘요
    if (inst.market === 'KS' || inst.market === 'KQ') out.company = await this.news?.company(inst.code).catch((e: Error) => {
      this.log.warn(`DART 기업개황 ${inst.code}: ${e.message}`);
      return undefined;
    });
    if (!this.kis) out.liveError = '한국투자증권 키를 넣으면 PER·PBR·52주 고저도 보여요';
    else {
      try {
        out.live = await this.kis.profile(inst);
      } catch (e) {
        out.liveError = `한국투자증권 조회 실패: ${(e as Error).message}`;
      }
    }
    return out;
  }

  private mostCache = new Map<string, { at: number; p: Promise<MostResponse> }>();

  /** MOST 상위 종목(03 v0.2). 여러 창이 같은 시장을 열어도 20초 동안은 한 번만 조회해요 */
  most(market: 'KS' | 'KQ' | 'US' | 'CRYPTO', kind: MostKind): Promise<MostResponse> {
    const key = `${market}:${kind}`;
    const hit = this.mostCache.get(key);
    if (hit && Date.now() - hit.at < MOST_CACHE_MS) return hit.p;
    const p = this.loadMost(market, kind);
    this.mostCache.set(key, { at: Date.now(), p });
    p.catch(() => this.mostCache.delete(key));
    return p;
  }

  private async loadMost(market: 'KS' | 'KQ' | 'US' | 'CRYPTO', kind: MostKind): Promise<MostResponse> {
    if (market === 'CRYPTO') {
      if (!this.binance) throw new Error('Binance에 연결되지 않았어요');
      const t = Date.now();
      const rows = (await this.binance.tickers24h())
        .filter((x) => x.symbol.endsWith('USDT') && !CRYPTO_EXCLUDED_BASES.has(x.symbol.slice(0, -4)) && Number(x.quoteVolume) > 0)
        .map((x) => {
          const code = x.symbol.slice(0, -4);
          const last = Number(x.lastPrice);
          const open = Number(x.openPrice);
          const id = `CRY:${code}`;
          const inst = this.instruments.get(id);
          return {
            rank: 0,
            id: inst ? id : undefined,
            code,
            name: inst?.nameKo ?? code,
            last,
            change: last - open,
            changePct: open ? ((last - open) / open) * 100 : 0,
            volume: Number(x.volume),
            turnover: Number(x.quoteVolume),
          };
        });
      const by: Record<MostKind, (x: (typeof rows)[number]) => number> = {
        volume: (x) => x.turnover, // 코인은 종류마다 단위가 달라서 거래량 순위도 USDT 거래대금으로 매겨요
        turnover: (x) => x.turnover,
        gainers: (x) => x.changePct,
        losers: (x) => -x.changePct,
      };
      // 상승·하락률은 거래가 아주 적은 코인을 빼요(24시간 거래대금 100만 USDT 이상)
      const pool = kind === 'gainers' || kind === 'losers' ? rows.filter((x) => x.turnover >= 1e6) : rows;
      return {
        market,
        kind,
        currency: 'USDT',
        rows: pool.sort((a, b) => by[kind](b) - by[kind](a)).slice(0, 30).map((x, i) => ({ ...x, rank: i + 1 })),
        fresh: { source: 'BINANCE', mode: 'poll', asOf: t, receivedAt: t, intervalMs: 30_000, asOfFromReceipt: true },
        note: kind === 'volume' ? 'Binance USDT 현물 · 거래량은 USDT 거래대금 순' : kind === 'turnover' ? 'Binance USDT 현물' : 'Binance USDT 현물 · 24시간 거래대금 100만 USDT 이상',
      };
    }
    if (!this.kis) throw new Error('한국투자증권 키를 넣으면 국내·미국 상위 종목을 볼 수 있어요(코인은 MOST CRYPTO)');
    const { rows, fresh } = await this.kis.ranking(market, kind);
    if (market === 'US') for (const r of rows) this.usActivity?.record(r.code, r.turnover);
    for (const r of rows) {
      const inst = r.id ? this.instruments.get(r.id) : undefined;
      if (!inst) r.id = undefined;
      else if (market === 'US' && inst.nameKo) r.name = inst.nameKo;
    }
    return {
      market,
      kind,
      currency: market === 'US' ? 'USD' : 'KRW',
      rows,
      fresh,
      note: market === 'US' ? `한국투자증권 · 나스닥과 뉴욕 순위를 합침${kind === 'gainers' || kind === 'losers' ? ' · 1만 주 이상' : ''}` : '한국투자증권 순위',
    };
  }

  private sectorQuotes = new Map<string, { at: number; p: Promise<Map<string, { last: number; changePct: number; turnover?: number }>> }>();
  private sectorIdx = new Map<string, { at: number; p: Promise<Map<string, { name: string; last: number; changePct: number; turnover?: number }>> }>();

  private cached<T>(m: Map<string, { at: number; p: Promise<T> }>, key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const hit = m.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.p;
    const p = load();
    m.set(key, { at: Date.now(), p });
    p.catch(() => m.delete(key));
    return p;
  }

  /** HMAP·IMAP(03 v0.2): 공용 업종 분류(종목 마스터)로 업종과 종목을 묶고, 업종 지수와 종목 시세를 붙여요 */
  async sectorMap(index: SectorIndex): Promise<SectorMapResponse> {
    const isPref = (id: string) => this.instruments.get(id)?.flags?.includes('PREF') ?? false;
    const uni = krMaster.universe(index, isPref);
    const byMcap = [...uni].sort((a, b) => (b.info.marketCap ?? 0) - (a.info.marketCap ?? 0));
    const top = index === 'KOSPI2' ? byMcap : byMcap.slice(0, SECTOR_TOP);
    const out: SectorMapResponse = { index, sectors: [], asOf: krMaster.asOfDate(index === 'KOSDAQ' ? 'KQ' : 'KS') };
    let quotes = new Map<string, { last: number; changePct: number; turnover?: number }>();
    let idx = new Map<string, { name: string; last: number; changePct: number; turnover?: number }>();
    if (!this.kis) out.liveError = '한국투자증권 키를 넣으면 등락 색이 보여요(지금은 종목 마스터의 업종과 시가총액만)';
    else {
      const kis = this.kis;
      const [q, s] = await Promise.allSettled([
        this.cached(this.sectorQuotes, index, SECTOR_QUOTES_MS, () => kis.multiQuote(top.map((x) => x.code))),
        this.cached(this.sectorIdx, index, SECTOR_INDEX_MS, () => kis.sectorIndices(index)),
      ]);
      if (q.status === 'fulfilled') quotes = q.value;
      if (s.status === 'fulfilled') idx = s.value;
      const err = [q, s].find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined;
      if (err) out.liveError = `한국투자증권 조회 실패: ${(err.reason as Error).message}`;
      out.fresh = kisPollFresh(index === 'KOSDAQ' ? 'KQ' : 'KS', SECTOR_QUOTES_MS);
    }
    const topIds = new Set(top.map((x) => x.id));
    const groups = new Map<string, SectorRow>();
    for (const x of byMcap) {
      let g = groups.get(x.sector);
      if (!g) {
        const live = idx.get(x.sector);
        g = { code: x.sector, name: x.sectorName, changePct: live?.changePct, last: live?.last, turnover: live?.turnover, mcap: 0, count: 0, members: [] };
        groups.set(x.sector, g);
      }
      g.count++;
      g.mcap += x.info.marketCap ?? 0;
      if (!topIds.has(x.id)) continue;
      const q = quotes.get(x.code);
      const inst = this.instruments.get(x.id);
      const m: SectorMember = {
        id: x.id,
        code: x.code,
        name: inst?.nameKo ?? x.code,
        mcap: q && x.info.shares ? q.last * x.info.shares : (x.info.marketCap ?? 0),
        last: q?.last,
        changePct: q?.changePct,
        turnover: q?.turnover,
      };
      g.members.push(m);
    }
    for (const g of groups.values()) g.members.sort((a, b) => b.mcap - a.mcap);
    out.sectors = [...groups.values()].sort((a, b) => b.mcap - a.mcap);
    return out;
  }

  private sectorFill = new Set<SectorIndex>();
  private sectorBars = new Map<string, { at: number; bars: Bar[] }>();

  /** HMAP 기간별 등락: 업종 지수 일봉. 있는 것만 바로 돌려주고 모자란 것은 뒤에서 받아요(다음 요청에 보여요) */
  sectorHistory(index: SectorIndex): SectorHistoryResponse {
    const isPref = (id: string) => this.instruments.get(id)?.flags?.includes('PREF') ?? false;
    const sectors = new Map<string, string>();
    for (const x of krMaster.universe(index, isPref)) sectors.set(x.sector, x.sectorName);
    const rows: SectorHistoryResponse['rows'] = [];
    const missing: string[] = [];
    for (const [code, name] of sectors) {
      let hit = this.sectorBars.get(code);
      if (!hit && this.history) {
        const saved = this.history.load(`SECT:${code}`, '1d');
        if (saved.bars.length > 0 && saved.savedAt) this.sectorBars.set(code, (hit = { at: saved.savedAt, bars: saved.bars }));
      }
      if (hit) rows.push({ code, name, closes: hit.bars.map((b) => ({ t: b.t, c: b.c })) });
      if (!hit || Date.now() - hit.at > SECTOR_HISTORY_MS) missing.push(code);
    }
    if (!this.kis) return { index, rows, error: rows.length ? undefined : '한국투자증권 키를 넣으면 업종 지수의 기간별 등락이 보여요' };
    if (missing.length > 0 && !this.sectorFill.has(index)) {
      this.sectorFill.add(index);
      const kis = this.kis;
      void (async () => {
        for (const code of missing) {
          try {
            const bars = await kis.sectorDaily(code);
            if (bars.length === 0) continue;
            this.sectorBars.set(code, { at: Date.now(), bars });
            this.history?.save(`SECT:${code}`, '1d', bars);
          } catch (e) {
            this.log.warn(`업종 지수 ${code} 일봉을 받지 못했어요: ${(e as Error).message}`);
          }
        }
      })().finally(() => this.sectorFill.delete(index));
    }
    const t = Date.now();
    return { index, rows, fresh: { source: 'KIS', mode: 'daily', asOf: t, receivedAt: t, asOfDate: new Date(t + 9 * 3600_000).toISOString().slice(0, 10) } };
  }

  quoteSnapshot(ids: string[]): Quote[] {
    return ids.map((id) => this.quotes.get(id)).filter((q): q is Quote => !!q);
  }
}

/**
 * 분봉은 장중 봉만 보여 줘요. 예전에 장이 닫힌 뒤 만든 봉이나 정규장 밖의 봉이 저장돼 있어도 차트에 섞지 않아요.
 * 미국 시간봉은 정규장과 겹치는 칸만(한국투자증권 60분봉은 프리·애프터마켓까지 와서, 애프터마켓 16주 체결이 현재가처럼 보였어요)
 */
function inSession(inst: Instrument, interval: BarInterval, bars: Bar[]): Bar[] {
  if (interval === '1h') return inst.assetClass === 'EQUITY' && inst.market === 'US' ? bars.filter((b) => overlapsRegular(inst, b.t, 60)) : bars;
  if (interval !== '1m' && interval !== '5m') return bars;
  return bars.filter((b) => intradayAt(inst, b.t * 1000));
}
