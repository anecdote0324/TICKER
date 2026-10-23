// Binance 공개 시세(04 Binance). USDT 현물만, 계정·키 없이 써요.
// 일반 주소가 막히면 시세 전용 주소(data-api / data-stream.binance.vision)로 바꿔 연결해요.

import type { Bar, BarInterval, BarSeries, Freshness, Instrument, SourceStatus } from '@bt/shared';
import { fetchJson, HttpError } from '../util';
import type { Adapter, AdapterHost } from './types';

const REST_BASES = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS_BASES = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

interface MiniTicker {
  e: string;
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  closeTime: number;
  count: number;
}

export class BinanceAdapter implements Adapter {
  readonly source = 'BINANCE' as const;
  private restIdx = 0;
  private wsIdx = 0;
  private ws: WebSocket | null = null;
  private state: SourceStatus['state'] = 'disconnected';
  private message = '';
  private subscribed = new Map<string, Instrument>();
  private latest = new Map<string, MiniTicker>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private stopped = false;
  private lastMessageAt = 0;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(private host: AdapterHost) {}

  canServe(inst: Instrument) {
    return inst.assetClass === 'CRYPTO';
  }

  supportsIntraday() {
    return true;
  }

  async start() {
    this.stopped = false;
    this.connect();
    // 24시간마다 끊기는 것과 조용히 멈춘 연결을 감지해서 다시 연결해요
    this.watchdog = setInterval(() => {
      if (this.state === 'connected' && Date.now() - this.lastMessageAt > 15_000) {
        this.host.log.warn('Binance 메시지가 15초 동안 없어서 다시 연결해요');
        this.ws?.close();
      }
    }, 5000);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.ws?.close();
    this.ws = null;
  }

  private setState(state: SourceStatus['state'], message = '') {
    this.state = state;
    this.message = message;
    this.host.emitStatus();
  }

  private connect() {
    if (this.stopped) return;
    const base = WS_BASES[this.wsIdx % WS_BASES.length];
    const url = `${base}/stream?streams=!miniTicker@arr`;
    this.setState('connecting', base.includes('vision') ? '시세 전용 주소로 연결 중' : '연결 중');
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect(String(e));
      return;
    }
    this.ws = ws;
    // 응답 없이 멈춘 연결은 8초 뒤에 끊고 다음 주소로 넘어가요
    const openTimer = setTimeout(() => {
      if (!opened && this.ws === ws) {
        this.ws = null;
        this.wsIdx++;
        try {
          ws.close();
        } catch {
          // 무시
        }
        this.scheduleReconnect('연결 시간이 지났어요');
      }
    }, 8000);
    ws.onopen = () => {
      clearTimeout(openTimer);
      opened = true;
      this.backoff = 1000;
      this.lastMessageAt = Date.now();
      this.setState('connected', base.includes('vision') ? '시세 전용 주소' : '');
      this.host.log.info(`Binance 연결: ${base}`);
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(String(ev.data)) as { data?: MiniTicker[] };
        if (Array.isArray(msg.data)) this.onTickers(msg.data);
      } catch {
        // 형식이 다른 메시지는 무시해요
      }
    };
    ws.onerror = () => {
      // close에서 처리해요
    };
    ws.onclose = () => {
      clearTimeout(openTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened) this.wsIdx++; // 연결이 안 되면 다음 주소로
      this.scheduleReconnect(opened ? '연결이 끊겼어요' : '연결할 수 없어요');
    };
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped) return;
    this.setState('disconnected', `${reason} · 다시 연결 중`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  private onTickers(list: MiniTicker[]) {
    const now = Date.now();
    for (const t of list) {
      this.latest.set(t.s, t);
      const inst = this.subscribed.get(t.s);
      if (inst) this.host.emitQuote(this.toQuote(inst, t, now));
    }
  }

  private toQuote(inst: Instrument, t: MiniTicker, now: number) {
    const last = Number(t.c);
    const open = Number(t.o);
    const fresh: Freshness = { source: 'BINANCE', mode: 'realtime', asOf: t.E, receivedAt: now };
    return {
      id: inst.id,
      last,
      prevClose: open,
      change: last - open,
      changePct: open ? ((last - open) / open) * 100 : 0,
      open,
      high: Number(t.h),
      low: Number(t.l),
      volume: Number(t.v),
      turnover: Number(t.q),
      fresh,
    };
  }

  subscribe(insts: Instrument[]) {
    const now = Date.now();
    for (const inst of insts) {
      const sym = inst.feedSymbol ?? `${inst.code}USDT`;
      this.subscribed.set(sym, inst);
      const t = this.latest.get(sym);
      if (t) this.host.emitQuote(this.toQuote(inst, t, now));
    }
  }

  unsubscribe(insts: Instrument[]) {
    for (const inst of insts) this.subscribed.delete(inst.feedSymbol ?? `${inst.code}USDT`);
  }

  /** REST 호출. 일반 주소가 막히면(451·403 등) 시세 전용 주소로 바꿔요 */
  async rest<T>(path: string): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < REST_BASES.length; i++) {
      const base = REST_BASES[(this.restIdx + i) % REST_BASES.length];
      try {
        const r = await fetchJson<T>(`${base}${path}`, { timeoutMs: 15_000 });
        this.restIdx = (this.restIdx + i) % REST_BASES.length;
        return r;
      } catch (e) {
        lastErr = e;
        if (e instanceof HttpError && e.status === 400) throw e;
      }
    }
    throw lastErr;
  }

  async tickers24h(): Promise<Ticker24h[]> {
    return this.rest<Ticker24h[]>('/api/v3/ticker/24hr');
  }

  async bars(inst: Instrument, interval: BarInterval): Promise<BarSeries> {
    const sym = inst.feedSymbol ?? `${inst.code}USDT`;
    const map: Record<BarInterval, string> = { '1m': '1m', '5m': '5m', '1d': '1d', '1w': '1w', '1M': '1M' };
    const limit = interval === '1m' ? 1000 : 500;
    const rows = await this.rest<Array<[number, string, string, string, string, string]>>(
      `/api/v3/klines?symbol=${sym}&interval=${map[interval]}&limit=${limit}`,
    );
    const bars: Bar[] = rows.map((k) => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    const now = Date.now();
    return { id: inst.id, interval, bars, fresh: { source: 'BINANCE', mode: 'realtime', asOf: now, receivedAt: now } };
  }

  status(): SourceStatus {
    return { source: 'BINANCE', state: this.state, message: this.message, updatedAt: Date.now() };
  }
}
