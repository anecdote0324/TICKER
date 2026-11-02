// 한국투자증권 Open API(04 KIS). 국내·미국 주식 실시간과 조회, 국내·해외 지수 조회.
// 이 개발 환경에서는 KIS 서버에 접속할 수 없어서, 요청·응답 형식은 KIS 공식 예제 코드를 기준으로 만들었어요.
// 실제 계정으로 붙여 볼 때 07의 "확인할 것"을 함께 확인해요.

import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import {
  aggregateBars,
  EXCHANGES,
  exchangeOf,
  INDICES,
  lastRegularClose,
  sessionState,
  tradingNow,
  usesRealtimeSlot,
  zonedParts,
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
import type { Adapter, AdapterHost, BarsOptions } from './types';

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

/** 국내 주식 실시간 체결(H0STCNT0) 한 건의 칸 수(공식 예제 ccnl_krx는 47칸. 묶여 오면 전체 칸 수를 건수로 나눠 써요) */
const H0STCNT0_FIELDS = 47;
/** 해외 주식 실시간 체결(HDFSCNT0) 한 건의 칸 수(맨 앞 RSYM 포함) */
const HDFSCNT0_FIELDS = 26;
/** 구독 요청 사이 간격. 공식 예제는 요청마다 0.05초 쉬어요 */
const WS_SEND_GAP_MS = 50;
/**
 * 환율 코드(해외지수 마스터 frgn_code.mst의 X 구분, FHKST03030100 시장 구분 X). 마스터의 이름이 `엔/달러`(1달러당 엔)처럼
 * 1달러당 값이면 그대로, `달러/유로`(1유로당 달러)처럼 달러로 매긴 값이면 usdPer를 켜고 뒤집어 1달러당 값으로 써요
 */
const KIS_FX: Record<string, { code: string; usdPer?: boolean }> = {
  KRW: { code: 'FX@KRW' },
  JPY: { code: 'FX@JPY' },
  CNY: { code: 'FX@CNY' },
  EUR: { code: 'FX@EUR', usdPer: true },
  GBP: { code: 'FX@GBP', usdPer: true },
  AUD: { code: 'FX@AUD', usdPer: true },
};

/** 국내 시간봉을 처음 열 때 바로 받는 거래일 수. 그 앞은 허브가 뒤에서 조금씩 채워요 */
const KR_HOUR_RECENT_DAYS = 5;
/** 지난 국내 시간봉을 한 번에 채우는 거래일 수(1분봉 약 35번 조회) */
const KR_HOUR_CHUNK_DAYS = 10;
/** 국내 장이 닫혔을 때 분봉을 거꾸로 받기 시작하는 시각. 15:30 장 마감 단일가 봉에 초가 붙어 와도 빠지지 않게 15:30:59부터 */
const KR_CLOSE_HMS = '153059';
/** 장중인데 지수 값이 이만큼 그대로면 장중에 갱신되지 않는 지수로 봐요 */
const STUCK_MS = 15 * 60_000;
/** 장이 닫힌 종목은 이 간격으로만 다시 확인해요(값이 바뀌지 않아요) */
const CLOSED_POLL_MS = 5 * 60_000;
/** 정규장이 끝난 뒤에도 종가가 확정될 때까지 이만큼은 장중처럼 다뤄요 */
const CLOSE_GRACE_MS = 10 * 60_000;
/** 장이 열리고 닫힘에 맞춰 실시간 구독을 다시 나누는 간격 */
const REPLAN_MS = 30_000;

/**
 * 값이 움직이는 시간인지. 장이 닫힌 종목은 실시간 슬롯을 쓰지 않고 몇 분 간격으로만 확인해요(04 KIS).
 * 국내 주식은 장 시작 전(동시호가)부터, 미국 주식은 프리·애프터마켓에도 받아요. 정규장이 끝난 뒤 10분은 종가 확정을 기다려요
 */
export function marketActive(inst: Instrument, now: number): boolean {
  if (tradingNow(inst, now) !== false) return true;
  const exId = exchangeOf(inst);
  const ex = exId ? EXCHANGES[exId] : undefined;
  if (!ex) return true;
  if (inst.assetClass === 'EQUITY' && inst.market !== 'US' && sessionState(ex, now) === 'pre') return true;
  return now - lastRegularClose(ex, now) < CLOSE_GRACE_MS;
}

/** 장이 닫혔을 때 값의 기준 시각(가장 최근 정규장 마감) */
function closeTime(inst: Instrument, now: number): number {
  const exId = exchangeOf(inst);
  const ex = exId ? EXCHANGES[exId] : undefined;
  return ex ? lastRegularClose(ex, now) : now;
}

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
  private lastPlanAt = 0;
  /** 보낼 구독 요청(간격을 두고 보내요) */
  private wsOut: string[] = [];
  private wsOutTimer: NodeJS.Timeout | null = null;
  /** 분봉 응답 견본(진단 정보) */
  private barSamples: Record<string, unknown> = {};
  /** 종목별로 같은 값이 이어진 시작 시각(장중에 갱신되지 않는 지수 찾기) */
  private sameValue = new Map<string, { v: number; since: number }>();

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
    this.wsOut = [];
    if (this.wsOutTimer) clearTimeout(this.wsOutTimer);
    this.wsOutTimer = null;
    for (const k of this.wsSubs) {
      const [tr, key] = k.split('|');
      this.sendWs(tr, key, false, true);
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
      barSamples: this.barSamples,
    };
  }

  /**
   * 분봉 응답의 첫 줄과 마지막 줄 몇 개를 진단 정보에 남겨요(TR마다 마지막 한 번).
   * 장 마감 단일가(15:30) 봉이 오는지, 봉 시각이 시작인지 끝인지 같은 것을 실제 응답으로 확인하려고요
   */
  private sampleRows(tr: string, code: string, request: string, rows: KisRow[], pick: (x: KisRow) => string[]) {
    this.barSamples[tr] = { code, request, at: new Date().toISOString(), count: rows.length, newest: rows.slice(0, 3).map(pick), oldest: rows.slice(-3).map(pick) };
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
        // 초과를 받으면 초당 호출 수도 줄여요. 화면에서 바로 한 요청(차트 열기)은 한 번 더 기다려 봐요.
        // 다시 보낼 때도 초당 호출 수 안에서 차례를 기다려요(그냥 보내면 여러 요청이 한꺼번에 다시 나가서 또 초과를 받아요)
        if (attempt < (pri === 0 ? 3 : 2) && r.message.includes('EGW00201')) {
          this.budget.throttled();
          await sleep(300 + Math.random() * 300 + attempt * 400);
          await this.budget.waitTurn();
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
      this.wsOut = [];
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

  private sendWs(trId: string, trKey: string, subscribe: boolean, now = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.approvalKey) return;
    const msg = JSON.stringify({
      header: { approval_key: this.approvalKey, custtype: 'P', tr_type: subscribe ? '1' : '2', 'content-type': 'utf-8' },
      body: { input: { tr_id: trId, tr_key: trKey } },
    });
    if (now) {
      this.ws.send(msg);
      return;
    }
    this.wsOut.push(msg);
    this.drainWs();
  }

  /** 구독 요청을 0.05초 간격으로 보내요(공식 예제와 같게) */
  private drainWs() {
    if (this.wsOutTimer) return;
    const next = this.wsOut.shift();
    if (!next) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(next);
    this.wsOutTimer = setTimeout(() => {
      this.wsOutTimer = null;
      this.drainWs();
    }, WS_SEND_GAP_MS);
  }

  private wsKey(inst: Instrument): [string, string] | undefined {
    if (!usesRealtimeSlot(inst)) return undefined;
    if (inst.market === 'US') return ['HDFSCNT0', `D${inst.feedSymbol ?? `${inst.exchange ?? 'NAS'}${inst.code}`}`];
    return ['H0STCNT0', inst.code];
  }

  /** 실시간 구독을 쓸 키인지: 장이 열린 종목만 슬롯을 써요 */
  private wsEligible(key: string, now: number): boolean {
    const inst = this.byKey.get(key);
    return !!inst && marketActive(inst, now);
  }

  /** 슬롯 배분 결과에 맞춰 구독을 더하고 빼요. 장이 닫힌 종목은 구독을 풀고 몇 분 간격 조회로 돌려요 */
  private syncWs() {
    const now = Date.now();
    this.lastPlanAt = now;
    const plan = this.slots.plan((k) => this.wsEligible(k, now));
    const planned = new Set(plan.ws);
    // 장이 닫혀 구독하지 않을 키는 거절 목록에서도 빼요
    for (const k of [...this.wsRejected]) if (!planned.has(k)) this.wsRejected.delete(k);
    // 거절된 키는 다시 시도할 때까지 구독하지 않고 조회로 받아요
    const want = new Set(plan.ws.filter((k) => !this.wsRejected.has(k)));
    let freed = false;
    for (const k of [...this.wsSubs]) {
      if (!want.has(k)) {
        const [tr, key] = k.split('|');
        this.sendWs(tr, key, false);
        this.wsSubs.delete(k);
        if (this.wsAccepted.delete(k)) freed = true;
      }
    }
    // 자리가 나면(장이 닫힌 종목의 구독을 풀었으면) 거절된 구독을 곧 다시 시도해요
    if (freed && this.wsRejected.size > 0) this.scheduleResubscribe(2000);
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
      this.scheduleResubscribe(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10 * 60_000);
    }
  }

  /** 거절된 구독을 잠시 뒤 다시 시도해요 */
  private scheduleResubscribe(delay: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.wsRejected.clear();
      this.syncWs();
    }, delay);
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
          // 공식 예제처럼 받은 내용을 pong 프레임으로 돌려줘요(일반 메시지로 보내면 요청으로 읽힐 수 있어요)
          if (this.ws?.readyState === WebSocket.OPEN) this.ws.pong(Buffer.from(raw));
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
    const known = trId === 'H0STCNT0' ? H0STCNT0_FIELDS : trId === 'HDFSCNT0' ? HDFSCNT0_FIELDS : 0;
    if (!known) return;
    // 여러 건이 묶여 오면 전체 칸 수를 건수로 나눠요(칸이 늘어도 다음 건이 어긋나지 않게)
    const size = count > 1 && fields.length % count === 0 ? fields.length / count : known;
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

  /**
   * 장이 열린 종목의 조회 간격: 남는 예산을 조회할 종목 수로 나눠요(최소 3초).
   * 장이 닫힌 종목과 해외 지수는 몇 분·1분 간격이라 거의 쓰지 않아서 세지 않아요
   */
  private pollInterval(now = Date.now(), targets = this.pollTargets()): number {
    const n = targets.filter((i) => !isOverseasIndex(i) && marketActive(i, now)).length;
    if (n === 0) return 5000;
    return Math.max(3000, Math.ceil((n / this.budget.spare()) * 1000));
  }

  /** 이 종목의 조회 간격. interval은 장이 열린 종목의 조회 간격(pollInterval)이에요 */
  private intervalFor(inst: Instrument, now = Date.now(), interval?: number): number {
    if (!marketActive(inst, now)) return CLOSED_POLL_MS;
    const itv = interval ?? this.pollInterval(now);
    // 해외 지수는 1분마다(04 KIS)
    return isOverseasIndex(inst) ? Math.max(itv, 60_000) : itv;
  }

  private pollTargets(): Instrument[] {
    // 실시간으로 받지 못하는 종목(지수, 슬롯 밖, 거절됨, 실시간 연결 끊김)을 조회해요
    return [...this.subscribed.values()].filter((inst) => !this.isLive(inst));
  }

  private pollTick() {
    const now = Date.now();
    // 장이 열리고 닫히면 실시간 구독을 다시 나눠요
    if (now - this.lastPlanAt >= REPLAN_MS && this.state === 'connected') this.syncWs();
    const targets = this.pollTargets();
    if (targets.length === 0) return;
    const interval = this.pollInterval(now, targets);
    for (let i = 0; i < targets.length; i++) {
      const inst = targets[(this.pollCursor + i) % targets.length];
      const itv = this.intervalFor(inst, now, interval);
      if (now - (this.lastPoll.get(inst.id) ?? 0) >= itv) {
        this.lastPoll.set(inst.id, now);
        void this.pollOne(inst, 1, itv);
        this.pollCursor = (this.pollCursor + i + 1) % targets.length;
        break;
      }
    }
  }

  private async pollOne(inst: Instrument, pri: Priority, intervalMs = this.intervalFor(inst)) {
    try {
      const q = await this.fetchQuote(inst, pri, intervalMs);
      if (q) this.host.emitQuote(q);
    } catch (e) {
      this.noteError(`조회 실패(${inst.assetClass === 'INDEX' ? '지수' : inst.market === 'US' ? '미국' : '국내'}): ${(e as Error).message}`);
    }
  }

  private async fetchQuote(inst: Instrument, pri: Priority, intervalMs: number): Promise<Quote | undefined> {
    const now = () => Date.now();
    // 장이 끝난 뒤 조회한 값은 마감 값이라 기준 시각을 마감 시각으로 둬요(`마감 15:30`, `마감 10/30`)
    const fresh = (): Freshness => {
      const t = now();
      if (tradingNow(inst, t) === false) return { source: 'KIS', mode: 'poll', asOf: closeTime(inst, t), receivedAt: t, intervalMs };
      return { source: 'KIS', mode: 'poll', asOf: t, receivedAt: t, intervalMs, asOfFromReceipt: true };
    };
    // 실시간으로 받는 종목의 처음 값(조회)은 실시간 값으로 다뤄요. 체결이 없으면(거래 드문 종목) 이 값이 최신이에요.
    // 주기 조회로 다루면 다시 조회하지 않아서 1분 뒤 `⚠ 멈춤`이 붙었어요
    const snapshot = (): Freshness => {
      if (!this.isLive(inst)) return fresh();
      const t = now();
      return { source: 'KIS', mode: 'realtime', asOf: tradingNow(inst, t) === false ? closeTime(inst, t) : t, receivedAt: t };
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
      // 기간을 열흘로 잡아서, 현재가 칸이 비면(다우존스) 가장 최근 일봉으로 대신해요
      const t = Date.now();
      const r = await this.get(
        '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
        'FHKST03030100',
        { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: def.kis.code, FID_INPUT_DATE_1: ymdKst(t - 10 * 86400_000), FID_INPUT_DATE_2: ymdKst(t), FID_PERIOD_DIV_CODE: 'D' },
        pri,
      );
      const o = (Array.isArray(r.output1) ? r.output1[0] : r.output1) as KisRow | undefined;
      const last = Number(o?.ovrs_nmix_prpr);
      const days = (r.output2 ?? []).filter((x) => x.stck_bsop_date && Number(x.ovrs_nmix_prpr) > 0).sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
      if (last > 0) {
        const change = Number(o!.ovrs_nmix_prdy_vrss);
        // 장중인데 값이 15분 넘게 그대로면 한국투자증권이 그 지수를 장중에 갱신하지 않는 거예요(CAC 40이 월요일에 금요일 값 그대로였어요).
        // 실시간처럼 보이지 않게 가장 최근 일봉 날짜로 '일별'을 붙여요
        const since = this.unchangedSince(inst.id, last, t);
        const stuck = tradingNow(inst, t) === true && t - since > STUCK_MS;
        const ymd = days[0]?.stck_bsop_date ?? ymdKst(since);
        const fr: Freshness = stuck ? { source: 'KIS', mode: 'daily', asOf: dateSec(ymd) * 1000, receivedAt: t, asOfDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` } : fresh();
        return { id: inst.id, last, change, changePct: Number(o!.prdy_ctrt), prevClose: last - change, fresh: fr };
      }
      // 값이 없으면 0으로 보여 주지 않고 비워 둬요(코드가 틀렸거나 제공하지 않는 지수)
      if (days.length === 0) throw new Error(`해외 지수 ${def.kis.code}의 값이 없어요`);
      const d = days[0];
      const close = Number(d.ovrs_nmix_prpr);
      const prev = days[1] ? Number(days[1].ovrs_nmix_prpr) : undefined;
      const ymd = d.stck_bsop_date;
      return {
        id: inst.id,
        last: close,
        prevClose: prev,
        change: prev !== undefined ? close - prev : undefined,
        changePct: prev ? ((close - prev) / prev) * 100 : undefined,
        open: Number(d.ovrs_nmix_oprc) || undefined,
        high: Number(d.ovrs_nmix_hgpr) || undefined,
        low: Number(d.ovrs_nmix_lwpr) || undefined,
        fresh: { source: 'KIS', mode: 'daily', asOf: dateSec(ymd) * 1000, receivedAt: t, asOfDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` },
      };
    }
    return undefined;
  }

  /**
   * 환율 일·주·월봉(통화별 1달러당 값, 오래된 것부터). 기간별시세에 시장 구분 X, 한 번에 100건.
   * 일봉은 150일씩 3번(약 14개월). 환율 차트가 지금 환율(10초)과 같은 출처의 봉을 쓰게 해요
   */
  async fxBarsPerUsd(c: string, period: 'D' | 'W' | 'M'): Promise<Bar[]> {
    const def = KIS_FX[c];
    if (!def) throw new Error(`${c} 환율 코드가 없어요`);
    const out: Bar[] = [];
    let end = Date.now();
    const span = period === 'D' ? 150 : period === 'W' ? 700 : 3000;
    for (let page = 0; page < (period === 'D' ? 3 : 1); page++) {
      const r = await this.get(
        '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
        'FHKST03030100',
        { FID_COND_MRKT_DIV_CODE: 'X', FID_INPUT_ISCD: def.code, FID_INPUT_DATE_1: ymdKst(end - span * 86400_000), FID_INPUT_DATE_2: ymdKst(end), FID_PERIOD_DIV_CODE: period },
        0,
      );
      const rows = (r.output2 ?? []).filter((x) => x.stck_bsop_date && Number(x.ovrs_nmix_prpr) > 0);
      if (rows.length === 0) break;
      for (const x of rows) {
        const cl = Number(x.ovrs_nmix_prpr);
        const o = Number(x.ovrs_nmix_oprc) || cl;
        const h = Number(x.ovrs_nmix_hgpr) || Math.max(o, cl);
        const l = Number(x.ovrs_nmix_lwpr) || Math.min(o, cl);
        const t = dateSec(x.stck_bsop_date);
        // 달러로 매긴 값(달러/유로)은 뒤집어요. 뒤집으면 고가·저가가 바뀌어요
        out.push(def.usdPer ? { t, o: 1 / o, h: 1 / l, l: 1 / h, c: 1 / cl, v: 0 } : { t, o, h, l, c: cl, v: 0 });
      }
      const oldest = rows.reduce((a, b) => (b.stck_bsop_date < a.stck_bsop_date ? b : a)).stck_bsop_date;
      end = dateSec(oldest) * 1000 - 86400_000;
      if (rows.length < 100) break;
    }
    return dedupe(out);
  }

  /** 같은 값이 언제부터 이어졌는지 */
  private unchangedSince(id: string, v: number, t: number): number {
    const cur = this.sameValue.get(id);
    if (cur && cur.v === v) return cur.since;
    this.sameValue.set(id, { v, since: t });
    return t;
  }

  // ── 환율 ──

  /**
   * 통화별 1달러당 값(지금·전일). 환율 화면(FXC·MON의 원/달러 등)이 10초마다 불러요(04 환율).
   * 기간별시세(FHKST03030100)에 시장 구분 X와 마스터의 환율 코드를 넣어요. 현재가가 비면 가장 최근 일봉으로 대신해요
   */
  async fxPerUsd(currencies: string[]): Promise<{ cur: Record<string, number>; prev: Record<string, number> }> {
    const cur: Record<string, number> = {};
    const prev: Record<string, number> = {};
    const t = Date.now();
    await Promise.all(
      currencies.map(async (c) => {
        const def = KIS_FX[c];
        if (!def) return;
        try {
          const r = await this.get(
            '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
            'FHKST03030100',
            { FID_COND_MRKT_DIV_CODE: 'X', FID_INPUT_ISCD: def.code, FID_INPUT_DATE_1: ymdKst(t - 10 * 86400_000), FID_INPUT_DATE_2: ymdKst(t), FID_PERIOD_DIV_CODE: 'D' },
            1,
          );
          const o = (Array.isArray(r.output1) ? r.output1[0] : r.output1) as KisRow | undefined;
          let v = Number(o?.ovrs_nmix_prpr);
          let p = v - Number(o?.ovrs_nmix_prdy_vrss);
          if (!(v > 0)) {
            const days = (r.output2 ?? []).filter((x) => x.stck_bsop_date && Number(x.ovrs_nmix_prpr) > 0).sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
            v = Number(days[0]?.ovrs_nmix_prpr);
            p = Number(days[1]?.ovrs_nmix_prpr);
          }
          if (!(v > 0)) throw new Error(`${def.code}의 값이 없어요`);
          cur[c] = def.usdPer ? 1 / v : v;
          if (p > 0) prev[c] = def.usdPer ? 1 / p : p;
        } catch (e) {
          this.noteError(`환율 조회 실패(${def.code}): ${(e as Error).message}`);
        }
      }),
    );
    return { cur, prev };
  }

  // ── 봉 ──

  async bars(inst: Instrument, interval: BarInterval, opts?: BarsOptions): Promise<BarSeries> {
    const now = Date.now();
    let bars: Bar[] = [];
    if (interval === '1m' || interval === '5m') {
      bars = inst.market === 'US' ? await this.usMinute(inst) : await this.krMinute(inst);
    } else if (interval === '1h' || interval === '2h' || interval === '4h') {
      // 시간봉은 주식만(지수 분봉은 확인 전). 2·4시간봉은 허브가 1시간봉을 묶어서 만들어요
      if (inst.assetClass !== 'EQUITY') throw new Error('지수는 아직 시간봉이 없어요');
      bars = inst.market === 'US' ? await this.usBars(inst, 60, 2, '', 0) : await this.krHours(inst, opts?.after);
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

  /**
   * 국내 GIP 1분봉: 가장 최근 하루. 주식일별분봉조회(한 번에 120건)로 받아요. 당일분봉조회(30건)로 받으면 장 하루에 13번이라
   * 초당 한도에 걸려 차트가 10~15초 늦게 떴어요(v0.1.0-beta.11). 장중인데 오늘 봉이 안 오면 당일분봉조회로 받아요
   */
  private async krMinute(inst: Instrument): Promise<Bar[]> {
    const now = Date.now();
    const today = ymdKst(now);
    const hms = hmsKst(now);
    const started = isWeekday(today) && hms >= '090000';
    const date = started ? today : prevWeekday(today);
    const hour = started && hms < '153000' ? hms : KR_CLOSE_HMS;
    // 휴장일이면 앞 거래일로 넘어가되, 하루치를 받으면 멈춰요
    const bars = await this.krMinutesBack(inst, date, hour, weekdaysBack(date, 7), 8, 0, true);
    if (bars.length === 0 && sessionState(EXCHANGES.KRX, now) === 'open') return this.krMinuteToday(inst);
    return bars;
  }

  /** 당일분봉조회(FHKST03010200, 한 번에 30건). 일별분봉조회가 오늘 봉을 주지 않을 때만 써요 */
  private async krMinuteToday(inst: Instrument): Promise<Bar[]> {
    const out: Bar[] = [];
    const now = Date.now();
    // 당일 분봉만 와요. 장중이 아니면(장 전·마감 뒤·주말) 15:30부터 거꾸로 받아요.
    // 지금 시각(예: 00:34)으로 요청하면 정규장 밖의 봉이 와서 차트가 깨졌어요
    let hour = sessionState(EXCHANGES.KRX, now) === 'open' ? hmsKst(now) : '153000';
    let day: string | undefined;
    // 한 번에 30개(30분)씩 거꾸로 와요. 장 전체는 약 13번
    for (let page = 0; page < 14; page++) {
      const r = await this.get(
        '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
        'FHKST03010200',
        { FID_ETC_CLS_CODE: '', FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inst.code, FID_INPUT_HOUR_1: hour, FID_PW_DATA_INCU_YN: 'Y' },
        0,
      );
      const rows = (r.output2 ?? []).filter((x) => x.stck_cntg_hour && x.stck_bsop_date);
      if (rows.length === 0) break;
      // 가장 최근 하루의 정규장(09:00~15:30) 봉만 써요
      const regular = rows.filter((x) => x.stck_cntg_hour >= '090000' && x.stck_cntg_hour <= '153059');
      day ??= regular[0]?.stck_bsop_date;
      for (const x of regular) {
        if (x.stck_bsop_date !== day) continue;
        out.push({ t: kstSec(x.stck_bsop_date, `${x.stck_cntg_hour.slice(0, 4)}00`), o: +x.stck_oprc, h: +x.stck_hgpr, l: +x.stck_lwpr, c: +x.stck_prpr, v: +x.cntg_vol });
      }
      const oldest = rows[rows.length - 1];
      if ((day && oldest.stck_bsop_date !== day) || oldest.stck_cntg_hour <= '090000') break;
      const prev = minusMinute(oldest.stck_cntg_hour);
      const next = prev > '153000' ? '153000' : prev;
      // 같은 시각을 다시 요청하게 되면(정규장 밖 봉만 옴) 그만해요
      if (next === hour) break;
      hour = next;
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
    return this.usBars(inst, 1, 4, '', 0);
  }

  /**
   * 미국 N분봉(해외주식분봉조회, 한 번에 120건). 다음 조회는 NEXT=1과 KEYB(가장 오래된 봉의 N분 전, 현지 시각)로 이어 받아요.
   * keyb를 주면 그 시각부터 거꾸로 받아요(지난 시간봉 채우기)
   */
  private async usBars(inst: Instrument, nmin: number, pages: number, keyb: string, pri: Priority): Promise<Bar[]> {
    const out: Bar[] = [];
    let next = keyb ? '1' : '';
    for (let page = 0; page < pages; page++) {
      const r = await this.get(
        '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice',
        'HHDFS76950200',
        { AUTH: '', EXCD: inst.exchange ?? 'NAS', SYMB: inst.code, NMIN: String(nmin), PINC: '1', NEXT: next, NREC: '120', FILL: '', KEYB: keyb },
        pri,
      );
      const rows = (r.output2 ?? []).filter((x) => x.xymd && x.xhms);
      if (rows.length === 0) break;
      for (const x of rows) {
        // 현지 시각을 그대로 UTC로 바꾸려면 시차가 필요해요. 한국 시각(kymd·khms)이 있으면 그걸 써요
        const t = x.kymd && x.khms ? kstSec(x.kymd, x.khms) : kstSec(x.xymd, x.xhms);
        out.push({ t, o: +x.open, h: +x.high, l: +x.low, c: +x.last, v: +x.evol });
      }
      const oldest = rows.reduce((a, b) => (`${b.xymd}${b.xhms}` < `${a.xymd}${a.xhms}` ? b : a));
      next = '1';
      keyb = minusMinutes(oldest.xymd, oldest.xhms, nmin);
    }
    return dedupe(out);
  }

  /**
   * 국내 1시간봉: 주식일별분봉조회(FHKST03010230, 1분봉 120건씩, 최대 1년)로 받은 1분봉을 묶어요(09·10·…·15시 칸).
   * 처음에는 최근 5거래일, 저장해 둔 봉이 있으면(after) 그날부터만 받아요. 그 앞은 olderHourBars로 뒤에서 채워요
   */
  private async krHours(inst: Instrument, after?: number): Promise<Bar[]> {
    const now = Date.now();
    const today = ymdKst(now);
    const hms = hmsKst(now);
    // 오늘 장이 시작했으면 지금부터, 아니면 앞 거래일 15:30부터 거꾸로
    const started = isWeekday(today) && hms >= '090000';
    const date = started ? today : prevWeekday(today);
    const hour = started && hms < '153000' ? hms : KR_CLOSE_HMS;
    const recent = weekdaysBack(date, KR_HOUR_RECENT_DAYS - 1);
    const stored = after ? ymdKst(after * 1000) : '';
    const until = stored > recent ? stored : recent;
    return aggregateBars(inst, await this.krMinutesBack(inst, date, hour, until, 40, 0), 60);
  }

  /** before(초)보다 오래된 1시간봉 한 묶음: 국내는 10거래일, 미국은 240개. 화면 요청보다 뒤로 미뤄요(우선순위 2) */
  async olderHourBars(inst: Instrument, before: number): Promise<Bar[]> {
    if (inst.assetClass !== 'EQUITY') return [];
    let bars: Bar[];
    if (inst.market === 'US') {
      // KEYB는 현지 시각이에요
      const p = zonedParts((before - 3600) * 1000, EXCHANGES.US.timeZone);
      const keyb = `${p.year}${pad2(p.month)}${pad2(p.day)}${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
      bars = await this.usBars(inst, 60, 2, keyb, 2);
    } else {
      let date = ymdKst(before * 1000);
      let hour = minusMinute(hmsKst(before * 1000));
      if (hour < '090000') {
        date = prevWeekday(date);
        hour = KR_CLOSE_HMS;
      }
      const until = weekdaysBack(date, KR_HOUR_CHUNK_DAYS - 1);
      bars = aggregateBars(inst, await this.krMinutesBack(inst, date, hour, until, 50, 2), 60);
    }
    return bars.filter((b) => b.t < before);
  }

  /**
   * 국내 1분봉을 (date, hour)부터 거꾸로 이어 받아요(한 번에 120건). until 날짜(YYYYMMDD)의 09:00까지 받거나 maxCalls에서 멈춰요.
   * 다음 요청은 가장 오래된 봉의 1분 전이고, 09:00에 닿으면 앞 평일 15:30부터예요. 휴장일(빈 응답)은 7일까지 건너뛰어요
   */
  private async krMinutesBack(inst: Instrument, date: string, hour: string, until: string, maxCalls: number, pri: Priority, oneDay = false): Promise<Bar[]> {
    const out: Bar[] = [];
    let empties = 0;
    let sampled = false;
    let day: string | undefined;
    for (let call = 0; call < maxCalls && date >= until; call++) {
      const r = await this.get(
        '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
        'FHKST03010230',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inst.code, FID_INPUT_HOUR_1: hour, FID_INPUT_DATE_1: date, FID_PW_DATA_INCU_YN: 'Y', FID_FAKE_TICK_INCU_YN: '' },
        pri,
      );
      const at = date + hour;
      // 요청한 시각과 그 앞의 봉만(새것부터)
      const rows = (r.output2 ?? [])
        .filter((x) => x.stck_bsop_date && x.stck_cntg_hour && Number(x.stck_prpr) > 0 && x.stck_bsop_date + x.stck_cntg_hour <= at)
        .sort((a, b) => (b.stck_bsop_date + b.stck_cntg_hour).localeCompare(a.stck_bsop_date + a.stck_cntg_hour));
      if (!sampled) {
        // 거르기 전의 응답 그대로(15:30 뒤 봉이 오는지도 보이게)
        sampled = true;
        const raw = [...(r.output2 ?? [])].sort((a, b) => `${b.stck_bsop_date}${b.stck_cntg_hour}`.localeCompare(`${a.stck_bsop_date}${a.stck_cntg_hour}`));
        this.sampleRows('FHKST03010230', inst.code, at, raw, (x) => [x.stck_bsop_date, x.stck_cntg_hour, x.stck_prpr, x.stck_oprc, x.stck_hgpr, x.stck_lwpr, x.cntg_vol]);
      }
      if (rows.length === 0) {
        if (++empties > 7) break;
        date = prevWeekday(date);
        hour = KR_CLOSE_HMS;
        continue;
      }
      empties = 0;
      // 하루치만 받을 때는 처음 받은 날(가장 최근 거래일)의 봉만 써요. 응답에 앞 날 봉이 섞여 와도요
      day ??= rows[0].stck_bsop_date;
      for (const x of rows) {
        // 정규장(09:00~15:30) 봉만 써요
        // 15:30대 봉(장 마감 단일가)은 초가 붙어 와도 받아요. 봉 시각은 분으로 맞춰요
        if (x.stck_bsop_date < until || x.stck_cntg_hour < '090000' || x.stck_cntg_hour > '153059') continue;
        if (oneDay && x.stck_bsop_date !== day) continue;
        out.push({ t: kstSec(x.stck_bsop_date, `${x.stck_cntg_hour.slice(0, 4)}00`), o: +x.stck_oprc, h: +x.stck_hgpr, l: +x.stck_lwpr, c: +x.stck_prpr, v: +x.cntg_vol });
      }
      const oldest = rows[rows.length - 1];
      if (oneDay && oldest.stck_bsop_date !== day) break;
      if (oldest.stck_cntg_hour <= '090000') {
        // 하루치만 받을 때(GIP)는 그날 09:00에 닿으면 멈춰요
        if (oneDay && out.length > 0) break;
        date = prevWeekday(oldest.stck_bsop_date);
        hour = KR_CLOSE_HMS;
      } else {
        date = oldest.stck_bsop_date;
        hour = minusMinute(oldest.stck_cntg_hour);
      }
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
      wsOverflow: this.slots.overflow((k) => this.wsEligible(k, Date.now())) + rejected,
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYYMMDD'가 평일인지 */
function isWeekday(ymd: string): boolean {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
  return d !== 0 && d !== 6;
}

/** 앞 평일('YYYYMMDD'). 휴장일은 모르고 주말만 건너뛰어요 */
function prevWeekday(ymd: string): string {
  let t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  do t -= 86400_000;
  while ([0, 6].includes(new Date(t).getUTCDay()));
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** n평일 앞('YYYYMMDD') */
function weekdaysBack(ymd: string, n: number): string {
  let d = ymd;
  for (let i = 0; i < n; i++) d = prevWeekday(d);
  return d;
}

/** 현지 날짜·시각에서 n분 앞(YYYYMMDDHHMMSS). 해외 분봉의 다음 조회 KEYB */
function minusMinutes(ymd: string, hms: string, n: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6)) - n * 60_000);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
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

function isOverseasIndex(inst: Instrument) {
  return inst.assetClass === 'INDEX' && INDICES.find((d) => d.code === inst.code)?.kis?.kind === 'overseas';
}
