// 한국투자증권 Open API(04 KIS). 국내·미국 주식 실시간과 조회, 국내·해외 지수 조회.
// 이 개발 환경에서는 KIS 서버에 접속할 수 없어서, 요청·응답 형식은 KIS 공식 예제 코드를 기준으로 만들었어요.
// 실제 계정으로 붙여 볼 때 07의 "확인할 것"을 함께 확인해요.

import { createHash } from 'node:crypto';
import {
  EXCHANGES,
  INDICES,
  lastRegularClose,
  sessionState,
  usesRealtimeSlot,
  type Bar,
  type BarInterval,
  type BarSeries,
  type Freshness,
  type Instrument,
  type Quote,
  type SourceStatus,
} from '@bt/shared';
import { fetchJson, HttpError, sleep, withTimeout } from '../util';
import { RequestBudget, SlotAllocator, type Priority } from './kis-budget';
import type { Adapter, AdapterHost } from './types';

export interface KisCredentials {
  appKey: string;
  appSecret: string;
  env: 'real' | 'virtual';
}

/** 저장해 둔 토큰. keyId는 어느 키(앱키·서버)로 받은 토큰인지예요(키를 바꾸면 다시 받아요) */
export interface SavedKisToken {
  token: string;
  expiresAt: number;
  keyId?: string;
}

export interface KisTokenStore {
  load(): Promise<SavedKisToken | undefined>;
  save(t: SavedKisToken): Promise<void>;
}

const ENDPOINTS = {
  // 실전 한도는 초당 20건으로 안내돼요. 보내는 시각과 받는 시각이 어긋나도 넘지 않게 여유를 둬요(실제로 18건에서 초과를 받았어요)
  real: { rest: 'https://openapi.koreainvestment.com:9443', ws: 'ws://ops.koreainvestment.com:21000', perSecond: 15 },
  virtual: { rest: 'https://openapivts.koreainvestment.com:29443', ws: 'ws://ops.koreainvestment.com:31000', perSecond: 2 },
};

/** 시험용으로 접속 주소를 바꿔요(가짜 KIS 서버). 배포판은 쓰지 않아요 */
export interface KisEndpoints {
  rest: string;
  ws: string;
}

/** 실시간 구독 슬롯 한도(예제 코드는 40개로 막아 둠, 07 확인할 것) */
const WS_LIMIT = 40;

type KisRow = Record<string, string>;
interface KisResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output?: KisRow;
  output1?: KisRow | KisRow[];
  output2?: KisRow[];
}

/** 국내 주식 실시간 체결(H0STCNT0) 한 건의 칸 수 */
const H0STCNT0_FIELDS = 46;
/** 해외 주식 실시간 체결(HDFSCNT0) 한 건의 칸 수 */
const HDFSCNT0_FIELDS = 26;

export class KisAdapter implements Adapter {
  /** 단계마다 기다리는 시간(테스트에서 줄여 써요) */
  static timeouts = { step: 25_000, tokenStore: 5000 };
  readonly source = 'KIS' as const;
  private budget: RequestBudget;
  private slots = new SlotAllocator(WS_LIMIT);
  private token: SavedKisToken | undefined;
  private tokenPromise: Promise<string> | null = null;
  private approvalKey: string | undefined;
  private ws: WebSocket | null = null;
  private wsSubs = new Set<string>();
  private state: SourceStatus['state'] = 'disconnected';
  private message = '';
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 2000;
  /** 실시간 키(tr_id|tr_key) → 종목 */
  private byKey = new Map<string, Instrument>();
  private subscribed = new Map<string, Instrument>();
  private pollTimer: NodeJS.Timeout | null = null;
  private pollCursor = 0;
  private lastPoll = new Map<string, number>();
  /** 같은 조회 실패를 1분에 한 번만 기록해요 */
  private warned = new Map<string, number>();
  /** 최근 실패(진단 정보) */
  private recentErrors: string[] = [];
  private wsOpenedAt = 0;
  private lastWsMessageAt = 0;
  /** 구독을 보냈지만 아직 답이 없는 키(보낸 순서) */
  private wsPending: string[] = [];
  /** 한국투자증권이 받아 준 실시간 구독 */
  private wsAccepted = new Set<string>();
  /** 거절된 구독(MAX SUBSCRIBE OVER 등). 다시 시도할 때까지 몇 초 간격 조회로 받아요 */
  private wsRejected = new Set<string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = 60_000;

  constructor(
    private host: AdapterHost,
    private cred: KisCredentials,
    private tokenStore: KisTokenStore,
    private endpoints?: KisEndpoints,
  ) {
    this.budget = new RequestBudget(ENDPOINTS[cred.env].perSecond);
  }

  /** 같은 키(앱키·앱시크릿·서버)인지. 같은 키를 다시 저장하면 실시간 연결을 새로 만들지 않아요 */
  sameCredentials(c: KisCredentials) {
    return c.appKey === this.cred.appKey && c.appSecret === this.cred.appSecret && c.env === this.cred.env;
  }

  /** 이 키로 받은 토큰인지 알아보는 값(앱키·서버의 해시 앞부분). 키 자체는 남기지 않아요 */
  private get keyId() {
    return createHash('sha256').update(`${this.cred.env}|${this.cred.appKey}`).digest('hex').slice(0, 16);
  }

  private get ep() {
    return { ...ENDPOINTS[this.cred.env], ...this.endpoints };
  }

  canServe(inst: Instrument) {
    return inst.assetClass === 'EQUITY' || inst.assetClass === 'INDEX';
  }

  supportsIntraday(inst: Instrument) {
    // 지수 분봉 제공 여부는 확인 필요(07). 확인 전에는 지수 GIP를 보여 주지 않아요
    return inst.assetClass === 'EQUITY';
  }

  async start() {
    this.stopped = false;
    this.pollTimer = setInterval(() => this.pollTick(), 250);
    try {
      await this.getToken();
      this.connectWs();
    } catch (e) {
      this.setState('error', `토큰 발급 실패: ${(e as Error).message}`);
    }
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    // 한국투자증권은 키마다 실시간 등록 수를 세요. 닫기 전에 등록을 풀어서 다음 연결이 한도에 걸리지 않게 해요
    for (const k of this.wsSubs) {
      const [tr, key] = k.split('|');
      this.sendWs(tr, key, false);
    }
    this.wsSubs.clear();
    this.ws?.close();
    this.ws = null;
  }

  private setState(state: SourceStatus['state'], message = '') {
    this.state = state;
    this.message = message;
    this.host.emitStatus();
  }

  // ── 인증 ──

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 10 * 60_000) return this.token.token;
    if (!this.token) {
      // 저장해 둔 토큰을 못 읽어도(보안 저장소가 늦거나 실패) 새로 받으면 돼요
      const saved = await withTimeout(this.tokenStore.load(), KisAdapter.timeouts.tokenStore, '저장해 둔 토큰을 제때 읽지 못했어요').catch((e: Error) => {
        this.host.log.warn(`KIS ${e.message}`);
        return undefined;
      });
      // 다른 키(앱키를 바꿨거나 실전·모의를 바꿈)로 받은 토큰은 쓰지 않아요
      if (saved && saved.keyId === this.keyId && saved.expiresAt - Date.now() > 10 * 60_000) {
        this.token = saved;
        this.host.log.info(`KIS 저장해 둔 토큰을 써요(${Math.round((saved.expiresAt - Date.now()) / 3600_000)}시간 남음)`);
        return saved.token;
      }
    }
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        // 토큰은 1분에 한 번만 발급돼요. 24시간 동안 다시 써요
        const r = await fetchJson<{ access_token: string; expires_in: number }>(`${this.ep.rest}/oauth2/tokenP`, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cred.appKey, appsecret: this.cred.appSecret }),
          timeoutMs: 15_000,
        });
        if (!r.access_token) throw new Error('토큰 응답에 access_token이 없어요');
        this.token = { token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000, keyId: this.keyId };
        this.host.log.info(`KIS 토큰 발급(${Math.round(r.expires_in / 3600)}시간)`);
        // 토큰 저장이 늦거나 실패해도 이번 실행은 메모리의 토큰으로 계속해요(다음 실행 때 다시 받아요)
        await withTimeout(this.tokenStore.save(this.token), KisAdapter.timeouts.tokenStore, '토큰을 제때 저장하지 못했어요').catch((e: Error) => this.host.log.warn(`KIS ${e.message}`));
        return r.access_token;
      })().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async getApprovalKey(): Promise<string> {
    if (this.approvalKey) return this.approvalKey;
    const r = await fetchJson<{ approval_key: string }>(`${this.ep.rest}/oauth2/Approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cred.appKey, secretkey: this.cred.appSecret }),
      timeoutMs: 15_000,
    });
    if (!r.approval_key) throw new Error('응답에 approval_key가 없어요');
    this.approvalKey = r.approval_key;
    this.host.log.info('KIS 실시간 접속키 발급');
    return r.approval_key;
  }

  /**
   * 연결 테스트: 토큰을 받고 삼성전자 현재가를 한 번 조회해요.
   * 단계마다 시간을 정해서 늦어도 끝나고, 실패하면 어느 단계에서 막혔는지 알려 줘요
   */
  async test(): Promise<{ ok: boolean; message: string }> {
    let step = '토큰 받기';
    try {
      const late = `한국투자증권이 ${KisAdapter.timeouts.step / 1000}초 동안 응답하지 않았어요`;
      await withTimeout(this.getToken(), KisAdapter.timeouts.step, late);
      step = '삼성전자 현재가 조회';
      const r = await withTimeout(
        this.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' }, 0),
        KisAdapter.timeouts.step,
        late,
      );
      const p = (r.output as KisRow | undefined)?.stck_prpr;
      if (!p) return { ok: false, message: `연결은 됐지만 현재가 응답에 값이 없어요(${step})` };
      return { ok: true, message: `연결됐어요 · 삼성전자 현재가 ${Number(p).toLocaleString('ko-KR')}원` };
    } catch (e) {
      const msg = (e as Error).message + (e instanceof HttpError && e.body ? ` · ${e.body.slice(0, 200)}` : '');
      this.noteError(`연결 테스트(${step}): ${msg}`);
      return { ok: false, message: `연결하지 못했어요(${step}): ${msg}` };
    }
  }

  /** 실패를 진단 정보에 남기고, 같은 실패는 1분에 한 번만 기록해요 */
  private noteError(msg: string) {
    this.recentErrors.push(`${new Date().toISOString()} ${msg}`);
    if (this.recentErrors.length > 20) this.recentErrors.shift();
    const key = msg.slice(0, 80);
    const now = Date.now();
    if (now - (this.warned.get(key) ?? 0) < 60_000) return;
    this.warned.set(key, now);
    this.host.log.warn(`KIS ${msg}`);
  }

  /** 진단 정보(설정 → 정보 → 진단 정보 복사). 키·토큰은 넣지 않아요 */
  diagnostics() {
    return {
      env: this.cred.env,
      state: this.state,
      message: this.message,
      tokenHoursLeft: this.token ? Math.round((this.token.expiresAt - Date.now()) / 360_000) / 10 : null,
      wsOpenSec: this.wsOpenedAt ? Math.round((Date.now() - this.wsOpenedAt) / 1000) : null,
      lastWsMessageSecAgo: this.lastWsMessageAt ? Math.round((Date.now() - this.lastWsMessageAt) / 1000) : null,
      wsSubscribed: this.wsSubs.size,
      wsAccepted: this.wsAccepted.size,
      wsRejected: this.wsRejected.size,
      wsPending: this.wsPending.length,
      subscribed: this.subscribed.size,
      budget: this.budget.usage(),
      recentErrors: this.recentErrors.slice(-10),
    };
  }

  // ── 목록에 없는 코드 직접 조회(05 §4.5, §13) ──

  /**
   * 종목 마스터에 없는 코드(오늘 상장, 오래된 파일)를 KIS 상품 기본 정보로 찾아요. 없으면 오류를 던져요.
   * 국내: 주식 기본 조회(CTPF1002R), 미국: 해외주식 상품 기본 정보(CTPF1702R)를 나스닥·뉴욕·아멕스 순서로. 필드 이름은 실제 계정으로 확인 필요(07)
   */
  async lookup(code: string, market: 'KR' | 'US'): Promise<Instrument> {
    if (market === 'KR') {
      const r = await this.get('/uapi/domestic-stock/v1/quotations/search-stock-info', 'CTPF1002R', { PRDT_TYPE_CD: '300', PDNO: code }, 0);
      const o = r.output as KisRow | undefined;
      const name = o?.prdt_abrv_name || o?.prdt_name;
      if (!o || !name) throw new Error(`${code}를 한국투자증권에서도 찾지 못했어요`);
      const mk = o.mket_id_cd === 'KSQ' || o.excg_dvsn_cd === '02' ? 'KQ' : 'KS';
      return { id: `EQ:${mk}:${code}`, assetClass: 'EQUITY', market: mk, code, nameKo: name, exchange: 'KRX', currency: 'KRW', flags: ['LOOKUP'] };
    }
    for (const [type, ex] of [
      ['512', 'NAS'],
      ['513', 'NYS'],
      ['529', 'AMS'],
    ] as const) {
      try {
        const r = await this.get('/uapi/overseas-price/v1/quotations/search-info', 'CTPF1702R', { PRDT_TYPE_CD: type, PDNO: code }, 0);
        const o = r.output as KisRow | undefined;
        const nameEn = o?.prdt_eng_name;
        if (!o || !(nameEn || o.prdt_name)) continue;
        return { id: `EQ:US:${code}`, assetClass: 'EQUITY', market: 'US', code, nameEn: nameEn || undefined, nameKo: o.prdt_name || undefined, exchange: ex, currency: 'USD', flags: ['LOOKUP'] };
      } catch {
        // 다음 거래소
      }
    }
    throw new Error(`${code}를 한국투자증권에서도 찾지 못했어요`);
  }

  // ── REST ──

  private async get(path: string, trId: string, params: Record<string, string>, pri: Priority): Promise<KisResponse> {
    return this.budget.schedule(pri, async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await this.fetchOnce(path, trId, params).catch((e: Error) => e);
        if (!(r instanceof Error)) return r;
        // 초당 거래건수 초과(EGW00201): 모든 조회를 잠깐 멈추고 이 자리에서 다시 해요.
        // 대기줄에 다시 서면 자리를 잡은 채 자기 차례를 기다려서, 자리가 다 차면 대기줄 전체가 멈춰요
        if (attempt < 2 && r.message.includes('EGW00201')) {
          this.budget.pause(1000);
          await sleep(1100 + attempt * 400);
          continue;
        }
        throw r;
      }
    });
  }

  private async fetchOnce(path: string, trId: string, params: Record<string, string>): Promise<KisResponse> {
    {
      const token = await this.getToken();
      const qs = new URLSearchParams(params).toString();
      try {
        const r = await fetchJson<KisResponse>(`${this.ep.rest}${path}?${qs}`, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            appkey: this.cred.appKey,
            appsecret: this.cred.appSecret,
            tr_id: trId,
            custtype: 'P',
          },
          timeoutMs: 10_000,
        });
        if (r.rt_cd !== '0') throw new Error(`${trId} ${r.msg_cd} ${r.msg1}`.trim());
        return r;
      } catch (e) {
        // 한국투자증권의 오류 내용(msg_cd·msg1)이 응답 본문에 있어서 함께 알려 줘요
        if (e instanceof HttpError) throw new Error(`${trId} ${e.message}${e.body ? ` · ${e.body.slice(0, 200)}` : ''}`);
        throw e;
      }
    }
  }

  // ── 실시간 ──

  private async connectWs() {
    if (this.stopped) return;
    this.setState('connecting', '실시간 연결 중');
    let key: string;
    try {
      key = await this.getApprovalKey();
    } catch (e) {
      this.scheduleReconnect(`실시간 접속키 발급 실패: ${(e as Error).message}`);
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.ep.ws);
    } catch (e) {
      this.scheduleReconnect(`실시간 서버 주소를 열 수 없어요: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    let opened = false;
    // 방화벽 등으로 연결이 열리지도 끊기지도 않으면 15초 뒤 다시 해요(그동안은 몇 초 간격 조회로 받아요)
    const openTimer = setTimeout(() => {
      if (!opened && this.ws === ws) {
        this.noteError('실시간 서버(ops.koreainvestment.com)에 15초 안에 연결하지 못했어요');
        ws.close();
      }
    }, 15_000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(openTimer);
      this.backoff = 2000;
      this.wsOpenedAt = Date.now();
      this.wsSubs.clear();
      this.wsPending = [];
      this.wsAccepted.clear();
      this.host.log.info('KIS 실시간 연결');
      this.setState('connected');
      this.syncWs();
    };
    ws.onmessage = (ev) => {
      this.lastWsMessageAt = Date.now();
      this.onWsMessage(String(ev.data));
    };
    ws.onerror = () => this.noteError(opened ? '실시간 연결 오류' : '실시간 서버에 연결하지 못했어요');
    ws.onclose = (ev) => {
      clearTimeout(openTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.wsOpenedAt = 0;
      this.host.log.info(`KIS 실시간 끊김(코드 ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`);
      this.scheduleReconnect(opened ? '실시간 연결이 끊겼어요' : '실시간 서버에 연결할 수 없어요');
    };
    void key;
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped) return;
    this.setState('disconnected', `${reason} · 다시 연결 중`);
    this.reconnectTimer = setTimeout(() => void this.connectWs(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60_000);
  }

  private sendWs(trId: string, trKey: string, subscribe: boolean) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.approvalKey) return;
    this.ws.send(
      JSON.stringify({
        header: { approval_key: this.approvalKey, custtype: 'P', tr_type: subscribe ? '1' : '2', 'content-type': 'utf-8' },
        body: { input: { tr_id: trId, tr_key: trKey } },
      }),
    );
  }

  private wsKey(inst: Instrument): [string, string] | undefined {
    if (!usesRealtimeSlot(inst)) return undefined;
    if (inst.market === 'US') return ['HDFSCNT0', `D${inst.feedSymbol ?? `${inst.exchange ?? 'NAS'}${inst.code}`}`];
    return ['H0STCNT0', inst.code];
  }

  /** 슬롯 배분 결과에 맞춰 구독을 더하고 빼요 */
  private syncWs() {
    const plan = this.slots.plan();
    // 거절된 키는 다시 시도할 때까지 구독하지 않고 조회로 받아요
    const want = new Set(plan.ws.filter((k) => !this.wsRejected.has(k)));
    for (const k of [...this.wsSubs]) {
      if (!want.has(k)) {
        const [tr, key] = k.split('|');
        this.sendWs(tr, key, false);
        this.wsSubs.delete(k);
        this.wsAccepted.delete(k);
      }
    }
    for (const k of want) {
      if (!this.wsSubs.has(k)) {
        const [tr, key] = k.split('|');
        if (this.ws?.readyState === WebSocket.OPEN) this.wsPending.push(k);
        this.sendWs(tr, key, true);
        this.wsSubs.add(k);
      }
    }
    this.host.emitStatus();
  }

  /** 구독 요청에 대한 답(성공·거절). 답에 종목이 없으면 보낸 순서로 맞춰요 */
  private onSubscribeReply(trId: string, trKey: string | undefined, ok: boolean, msg: string) {
    let k = trKey ? `${trId}|${trKey}` : undefined;
    const i = this.wsPending.findIndex((p) => (k ? p === k : p.startsWith(`${trId}|`)));
    if (i >= 0) {
      k ??= this.wsPending[i];
      this.wsPending.splice(i, 1);
    }
    if (!k || !this.wsSubs.has(k)) return;
    if (/UNSUBSCRIBE/i.test(msg)) return;
    if (ok) {
      this.wsAccepted.add(k);
      if (this.wsRejected.size === 0) this.retryDelay = 60_000;
      return;
    }
    // 거절: 이 종목은 몇 초 간격 조회로 받고, 잠시 뒤 다시 구독해 봐요(한국투자증권 쪽에 이전 연결의 등록이 남아 있을 수 있어요)
    this.wsSubs.delete(k);
    this.wsAccepted.delete(k);
    this.wsRejected.add(k);
    this.noteError(`실시간 구독 거절(${trId}): ${msg} · 몇 초 간격 조회로 받고 ${Math.round(this.retryDelay / 1000)}초 뒤 다시 시도해요`);
    this.host.emitStatus();
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.wsRejected.clear();
        this.syncWs();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10 * 60_000);
    }
  }

  /** 이 종목을 지금 실시간으로 받고 있는지(구독이 받아들여졌거나 답을 기다리는 중) */
  private isLive(inst: Instrument): boolean {
    const k = this.wsKey(inst);
    if (!k || this.state !== 'connected') return false;
    const key = `${k[0]}|${k[1]}`;
    return this.wsSubs.has(key) && !this.wsRejected.has(key);
  }

  private onWsMessage(raw: string) {
    if (raw.startsWith('{')) {
      try {
        const j = JSON.parse(raw) as { header?: { tr_id?: string; tr_key?: string }; body?: { msg1?: string; rt_cd?: string } };
        const trId = j.header?.tr_id;
        // 연결 확인 신호는 그대로 돌려보내요
        if (trId === 'PINGPONG') {
          if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(raw);
        } else if (trId && j.body?.rt_cd !== undefined) {
          if (trId === 'H0STCNT0' || trId === 'HDFSCNT0') this.onSubscribeReply(trId, j.header?.tr_key || undefined, j.body.rt_cd === '0', j.body.msg1 ?? '');
          else if (j.body.rt_cd !== '0') this.noteError(`실시간(${trId}): ${j.body.msg1}`);
        }
      } catch {
        // 무시
      }
      return;
    }
    // 0|TR_ID|건수|데이터^데이터…  (1이면 암호화된 체결통보: 쓰지 않아요)
    const parts = raw.split('|');
    if (parts.length < 4 || parts[0] !== '0') return;
    const trId = parts[1];
    const count = Number(parts[2]) || 1;
    const fields = parts[3].split('^');
    const size = trId === 'H0STCNT0' ? H0STCNT0_FIELDS : trId === 'HDFSCNT0' ? HDFSCNT0_FIELDS : 0;
    if (!size) return;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const f = fields.slice(i * size, (i + 1) * size);
      if (f.length < 15) continue;
      if (trId === 'H0STCNT0') this.onDomesticTick(f, now);
      else this.onOverseasTick(f, now);
    }
  }

  private onDomesticTick(f: string[], now: number) {
    const inst = this.byKey.get(`H0STCNT0|${f[0]}`);
    if (!inst) return;
    const last = Number(f[2]);
    const change = Number(f[4]);
    const fresh: Freshness = { source: 'KIS', mode: 'realtime', asOf: kstTodayAt(f[1], now), receivedAt: now };
    this.host.emitQuote({
      id: inst.id,
      last,
      change,
      changePct: Number(f[5]),
      prevClose: last - change,
      open: Number(f[7]),
      high: Number(f[8]),
      low: Number(f[9]),
      ask: Number(f[10]),
      bid: Number(f[11]),
      volume: Number(f[13]),
      turnover: Number(f[14]),
      fresh,
    });
  }

  private onOverseasTick(f: string[], now: number) {
    const inst = this.byKey.get(`HDFSCNT0|D${f[0]}`) ?? this.byKey.get(`HDFSCNT0|${f[0]}`);
    if (!inst) return;
    const last = Number(f[11]);
    const sign = f[12];
    const neg = sign === '4' || sign === '5';
    const change = Math.abs(Number(f[13])) * (neg ? -1 : 1);
    const rate = Math.abs(Number(f[14])) * (neg ? -1 : 1);
    const fresh: Freshness = { source: 'KIS', mode: 'realtime', asOf: kstAt(f[6], f[7]) ?? now, receivedAt: now };
    this.host.emitQuote({
      id: inst.id,
      last,
      change,
      changePct: rate,
      prevClose: last - change,
      open: Number(f[8]),
      high: Number(f[9]),
      low: Number(f[10]),
      bid: Number(f[15]),
      ask: Number(f[16]),
      volume: Number(f[20]),
      turnover: Number(f[21]),
      fresh,
    });
  }

  subscribe(insts: Instrument[]) {
    for (const inst of insts) {
      this.subscribed.set(inst.id, inst);
      const k = this.wsKey(inst);
      if (k) {
        const key = `${k[0]}|${k[1]}`;
        this.byKey.set(key, inst);
        this.slots.add(key);
      }
      // 처음 값은 바로 조회해요
      void this.pollOne(inst, 0);
    }
    this.syncWs();
  }

  unsubscribe(insts: Instrument[]) {
    for (const inst of insts) {
      this.subscribed.delete(inst.id);
      const k = this.wsKey(inst);
      if (k) {
        const key = `${k[0]}|${k[1]}`;
        this.byKey.delete(key);
        this.slots.remove(key);
      }
    }
    this.syncWs();
  }

  // ── 조회(실시간 슬롯 밖 종목과 지수) ──

  /** 조회 간격: 남는 예산을 조회할 종목 수로 나눠요(최소 3초) */
  private pollInterval(): number {
    const n = this.pollTargets().length;
    if (n === 0) return 5000;
    return Math.max(3000, Math.ceil((n / this.budget.spare()) * 1000));
  }

  private pollTargets(): Instrument[] {
    // 실시간으로 받지 못하는 종목(지수, 슬롯 밖, 거절됨, 실시간 연결 끊김)을 조회해요
    return [...this.subscribed.values()].filter((inst) => !this.isLive(inst));
  }

  private pollTick() {
    const targets = this.pollTargets();
    if (targets.length === 0) return;
    const interval = this.pollInterval();
    const now = Date.now();
    for (let i = 0; i < targets.length; i++) {
      const inst = targets[(this.pollCursor + i) % targets.length];
      const itv = inst.assetClass === 'INDEX' && !isDomesticIndex(inst) ? Math.max(interval, 60_000) : interval;
      if (now - (this.lastPoll.get(inst.id) ?? 0) >= itv) {
        this.lastPoll.set(inst.id, now);
        void this.pollOne(inst, 1, itv);
        this.pollCursor = (this.pollCursor + i + 1) % targets.length;
        break;
      }
    }
  }

  private async pollOne(inst: Instrument, pri: Priority, intervalMs = this.pollInterval()) {
    try {
      const q = await this.fetchQuote(inst, pri, intervalMs);
      if (q) this.host.emitQuote(q);
    } catch (e) {
      this.noteError(`조회 실패(${inst.assetClass === 'INDEX' ? '지수' : inst.market === 'US' ? '미국' : '국내'}): ${(e as Error).message}`);
    }
  }

  private async fetchQuote(inst: Instrument, pri: Priority, intervalMs: number): Promise<Quote | undefined> {
    const now = () => Date.now();
    const fresh = (): Freshness => ({ source: 'KIS', mode: 'poll', asOf: now(), receivedAt: now(), intervalMs, asOfFromReceipt: true });
    // 실시간으로 받는 종목의 처음 값(조회)은 실시간 값으로 다뤄요. 체결이 없으면(장 마감, 거래 드문 종목) 이 값이 최신이에요.
    // 주기 조회로 다루면 다시 조회하지 않아서 1분 뒤 `⚠ 멈춤`이 붙었어요. 장이 끝났으면 기준 시각을 마감 시각으로 둬요
    const snapshot = (): Freshness => {
      if (!this.isLive(inst)) return fresh();
      const ex = EXCHANGES[inst.market === 'US' ? 'US' : 'KRX'];
      const t = now();
      const open = sessionState(ex, t) === 'open' || (inst.market === 'US' && sessionState(ex, t) !== 'closed');
      return { source: 'KIS', mode: 'realtime', asOf: open ? t : lastRegularClose(ex, t), receivedAt: t };
    };
    if (inst.assetClass === 'EQUITY' && inst.market !== 'US') {
      const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inst.code }, pri);
      const o = r.output as KisRow;
      const last = Number(o.stck_prpr);
      const change = Number(o.prdy_vrss);
      return {
        id: inst.id,
        last,
        change,
        changePct: Number(o.prdy_ctrt),
        prevClose: last - change,
        open: Number(o.stck_oprc),
        high: Number(o.stck_hgpr),
        low: Number(o.stck_lwpr),
        volume: Number(o.acml_vol),
        turnover: Number(o.acml_tr_pbmn),
        fresh: snapshot(),
      };
    }
    if (inst.assetClass === 'EQUITY' && inst.market === 'US') {
      const r = await this.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: inst.exchange ?? 'NAS', SYMB: inst.code }, pri);
      const o = r.output as KisRow;
      const last = Number(o.last);
      const prev = Number(o.base);
      return {
        id: inst.id,
        last,
        prevClose: prev,
        change: last - prev,
        changePct: prev ? ((last - prev) / prev) * 100 : 0,
        volume: Number(o.tvol),
        turnover: Number(o.tamt),
        fresh: snapshot(),
      };
    }
    if (inst.assetClass === 'INDEX') {
      const def = INDICES.find((d) => d.code === inst.code);
      if (!def?.kis) return undefined;
      if (def.kis.kind === 'domestic') {
        const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-index-price', 'FHPUP02100000', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: def.kis.code }, pri);
        const o = r.output as KisRow;
        const last = Number(o.bstp_nmix_prpr);
        const change = Number(o.bstp_nmix_prdy_vrss);
        return {
          id: inst.id,
          last,
          change,
          changePct: Number(o.bstp_nmix_prdy_ctrt),
          prevClose: last - change,
          open: Number(o.bstp_nmix_oprc),
          high: Number(o.bstp_nmix_hgpr),
          low: Number(o.bstp_nmix_lwpr),
          volume: Number(o.acml_vol),
          fresh: fresh(),
        };
      }
      const today = ymdKst(Date.now());
      const r = await this.get(
        '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
        'FHKST03030100',
        { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: def.kis.code, FID_INPUT_DATE_1: today, FID_INPUT_DATE_2: today, FID_PERIOD_DIV_CODE: 'D' },
        pri,
      );
      const o = (Array.isArray(r.output1) ? r.output1[0] : r.output1) as KisRow;
      const last = Number(o.ovrs_nmix_prpr);
      const change = Number(o.ovrs_nmix_prdy_vrss);
      return { id: inst.id, last, change, changePct: Number(o.prdy_ctrt), prevClose: last - change, fresh: fresh() };
    }
    return undefined;
  }

  // ── 봉 ──

  async bars(inst: Instrument, interval: BarInterval): Promise<BarSeries> {
    const now = Date.now();
    let bars: Bar[] = [];
    if (interval === '1m' || interval === '5m') {
      bars = inst.market === 'US' ? await this.usMinute(inst) : await this.krMinute(inst);
    } else if (inst.assetClass === 'INDEX') {
      bars = await this.indexDaily(inst, interval);
    } else if (inst.market === 'US') {
      bars = await this.usDaily(inst, interval);
    } else {
      bars = await this.krDaily(inst, interval);
    }
    bars.sort((a, b) => a.t - b.t);
    return { id: inst.id, interval, bars, fresh: { source: 'KIS', mode: 'poll', asOf: now, receivedAt: now, intervalMs: 60_000, asOfFromReceipt: true } };
  }

  private async krDaily(inst: Instrument, interval: BarInterval): Promise<Bar[]> {
    const period = interval === '1w' ? 'W' : interval === '1M' ? 'M' : 'D';
    const out: Bar[] = [];
    let end = new Date();
    // 한 번에 100개까지 와요. 일봉은 약 400개(4번)
    for (let page = 0; page < 4; page++) {
      const start = new Date(end.getTime() - (period === 'D' ? 150 : period === 'W' ? 700 : 3000) * 86400_000);
      const r = await this.get(
        '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
        'FHKST03010100',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inst.code, FID_INPUT_DATE_1: ymdKst(start.getTime()), FID_INPUT_DATE_2: ymdKst(end.getTime()), FID_PERIOD_DIV_CODE: period, FID_ORG_ADJ_PRC: '0' },
        0,
      );
      const rows = (r.output2 ?? []).filter((x) => x.stck_bsop_date);
      if (rows.length === 0) break;
      for (const x of rows) out.push({ t: dateSec(x.stck_bsop_date), o: +x.stck_oprc, h: +x.stck_hgpr, l: +x.stck_lwpr, c: +x.stck_clpr, v: +x.acml_vol });
      const oldest = rows[rows.length - 1].stck_bsop_date;
      end = new Date(dateSec(oldest) * 1000 - 86400_000);
      if (rows.length < 100) break;
    }
    return dedupe(out);
  }

  private async krMinute(inst: Instrument): Promise<Bar[]> {
    const out: Bar[] = [];
    let hour = hmsKst(Date.now());
    if (hour > '153000') hour = '153000';
    // 한 번에 30개(30분)씩 거꾸로 와요. 장 전체는 약 13번
    for (let page = 0; page < 14; page++) {
      const r = await this.get(
        '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
        'FHKST03010200',
        { FID_ETC_CLS_CODE: '', FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inst.code, FID_INPUT_HOUR_1: hour, FID_PW_DATA_INCU_YN: 'Y' },
        0,
      );
      const rows = (r.output2 ?? []).filter((x) => x.stck_cntg_hour);
      if (rows.length === 0) break;
      for (const x of rows) {
        out.push({ t: kstSec(x.stck_bsop_date, x.stck_cntg_hour), o: +x.stck_oprc, h: +x.stck_hgpr, l: +x.stck_lwpr, c: +x.stck_prpr, v: +x.cntg_vol });
      }
      const oldest = rows[rows.length - 1].stck_cntg_hour;
      if (oldest <= '090000') break;
      hour = minusMinute(oldest);
    }
    return dedupe(out);
  }

  private async usDaily(inst: Instrument, interval: BarInterval): Promise<Bar[]> {
    const gubn = interval === '1w' ? '1' : interval === '1M' ? '2' : '0';
    const out: Bar[] = [];
    let bymd = '';
    for (let page = 0; page < 4; page++) {
      const r = await this.get('/uapi/overseas-price/v1/quotations/dailyprice', 'HHDFS76240000', { AUTH: '', EXCD: inst.exchange ?? 'NAS', SYMB: inst.code, GUBN: gubn, BYMD: bymd, MODP: '1' }, 0);
      const rows = (r.output2 ?? []).filter((x) => x.xymd);
      if (rows.length === 0) break;
      for (const x of rows) out.push({ t: dateSec(x.xymd), o: +x.open, h: +x.high, l: +x.low, c: +x.clos, v: +x.tvol });
      bymd = ymdKst(dateSec(rows[rows.length - 1].xymd) * 1000 - 86400_000);
      if (rows.length < 100) break;
    }
    return dedupe(out);
  }

  private async usMinute(inst: Instrument): Promise<Bar[]> {
    const out: Bar[] = [];
    let next = '';
    let keyb = '';
    for (let page = 0; page < 4; page++) {
      const r = await this.get(
        '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice',
        'HHDFS76950200',
        { AUTH: '', EXCD: inst.exchange ?? 'NAS', SYMB: inst.code, NMIN: '1', PINC: '1', NEXT: next, NREC: '120', FILL: '', KEYB: keyb },
        0,
      );
      const rows = (r.output2 ?? []).filter((x) => x.xymd && x.xhms);
      if (rows.length === 0) break;
      for (const x of rows) {
        // 현지 시각을 그대로 UTC로 바꾸려면 시차가 필요해요. 한국 시각(kymd·khms)이 있으면 그걸 써요
        const t = x.kymd && x.khms ? kstSec(x.kymd, x.khms) : kstSec(x.xymd, x.xhms);
        out.push({ t, o: +x.open, h: +x.high, l: +x.low, c: +x.last, v: +x.evol });
      }
      const oldest = rows[rows.length - 1];
      next = '1';
      keyb = `${oldest.xymd}${oldest.xhms}`;
    }
    return dedupe(out);
  }

  private async indexDaily(inst: Instrument, interval: BarInterval): Promise<Bar[]> {
    const def = INDICES.find((d) => d.code === inst.code);
    if (!def?.kis) return [];
    const period = interval === '1w' ? 'W' : interval === '1M' ? 'M' : 'D';
    const end = new Date();
    const start = new Date(end.getTime() - 150 * 86400_000);
    if (def.kis.kind === 'domestic') {
      const r = await this.get(
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: def.kis.code, FID_INPUT_DATE_1: ymdKst(start.getTime()), FID_INPUT_DATE_2: ymdKst(end.getTime()), FID_PERIOD_DIV_CODE: period },
        0,
      );
      return (r.output2 ?? [])
        .filter((x) => x.stck_bsop_date)
        .map((x) => ({ t: dateSec(x.stck_bsop_date), o: +x.bstp_nmix_oprc, h: +x.bstp_nmix_hgpr, l: +x.bstp_nmix_lwpr, c: +x.bstp_nmix_prpr, v: +x.acml_vol }));
    }
    const r = await this.get(
      '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
      'FHKST03030100',
      { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: def.kis.code, FID_INPUT_DATE_1: ymdKst(start.getTime()), FID_INPUT_DATE_2: ymdKst(end.getTime()), FID_PERIOD_DIV_CODE: period },
      0,
    );
    return (r.output2 ?? [])
      .filter((x) => x.stck_bsop_date)
      .map((x) => ({ t: dateSec(x.stck_bsop_date), o: +x.ovrs_nmix_oprc, h: +x.ovrs_nmix_hgpr, l: +x.ovrs_nmix_lwpr, c: +x.ovrs_nmix_prpr, v: +x.acml_vol }));
  }

  status(): SourceStatus {
    const rejected = this.wsRejected.size;
    return {
      source: 'KIS',
      state: this.state,
      message: this.message || (rejected ? `실시간 구독 ${rejected}개가 거절돼 몇 초 간격 조회로 받고 있어요` : ''),
      wsUsed: Math.max(0, this.wsSubs.size),
      wsLimit: WS_LIMIT,
      wsOverflow: this.slots.overflow + rejected,
      updatedAt: Date.now(),
    };
  }

  budgetUsage() {
    return this.budget.usage();
  }
}

// ── 날짜 도우미(모두 한국 시간 기준) ──

const KST_MS = 9 * 3600_000;

function ymdKst(ms: number): string {
  const d = new Date(ms + KST_MS);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function hmsKst(ms: number): string {
  const d = new Date(ms + KST_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

/** 'YYYYMMDD' → 그날 00:00 UTC(초). 일봉은 날짜만 의미가 있어요 */
function dateSec(ymd: string): number {
  return Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 1000);
}

/** 한국 날짜·시각 → 초 */
function kstSec(ymd: string, hms: string): number {
  return Math.floor((Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6)) - KST_MS) / 1000);
}

function kstAt(ymd: string | undefined, hms: string | undefined): number | undefined {
  if (!ymd || !hms || ymd.length !== 8) return undefined;
  return kstSec(ymd, hms) * 1000;
}

/** 오늘(한국) HHMMSS → ms */
function kstTodayAt(hms: string, now: number): number {
  return kstSec(ymdKst(now), hms) * 1000;
}

function minusMinute(hms: string): string {
  const s = +hms.slice(0, 2) * 3600 + +hms.slice(2, 4) * 60 + +hms.slice(4, 6) - 60;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
}

function dedupe(bars: Bar[]): Bar[] {
  const m = new Map<number, Bar>();
  for (const b of bars) if (Number.isFinite(b.c) && b.c > 0) m.set(b.t, b);
  return [...m.values()].sort((a, b) => a.t - b.t);
}

function isDomesticIndex(inst: Instrument) {
  return INDICES.find((d) => d.code === inst.code)?.kis?.kind === 'domestic';
}
