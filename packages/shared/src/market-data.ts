// 시세·봉 데이터와 서버 ↔ 화면 메시지 형식

import type { Freshness, SourceId } from './freshness';
import type { Instrument } from './instrument';

export interface Quote {
  id: string;
  last: number;
  prevClose?: number;
  change?: number;
  changePct?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  /** 거래대금(원화, 달러, USDT 등 가격 통화 기준) */
  turnover?: number;
  bid?: number;
  ask?: number;
  fresh: Freshness;
}

export type BarInterval = '1m' | '5m' | '1d' | '1w' | '1M';

export interface Bar {
  /** 봉 시작 시각(초, UTC) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BarSeries {
  id: string;
  interval: BarInterval;
  bars: Bar[];
  fresh: Freshness;
}

export type SourceState = 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';

export interface SourceStatus {
  source: SourceId;
  state: SourceState;
  /** 사람이 읽는 상태 설명 */
  message?: string;
  /** KIS 실시간 구독 사용량 */
  wsUsed?: number;
  wsLimit?: number;
  /** 슬롯이 모자라 주기 조회로 받는 종목 수 */
  wsOverflow?: number;
  /** 주기 조회 간격(환율 등) */
  intervalMs?: number;
  updatedAt: number;
}

// ── WebSocket 메시지 ──

export type ClientMessage =
  | { type: 'subscribe'; ids: string[] }
  | { type: 'unsubscribe'; ids: string[] }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'hello'; serverTime: number; demo: boolean }
  | { type: 'quotes'; quotes: Quote[] }
  | { type: 'bar'; id: string; interval: BarInterval; bar: Bar; fresh: Freshness }
  | { type: 'status'; sources: SourceStatus[] }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string };

// ── REST 응답 ──

export interface InstrumentsResponse {
  instruments: Instrument[];
  /** 색인을 만든 시각 */
  builtAt: number;
  /** 종목 마스터 상태 */
  sources: Array<{ name: string; count: number; asOf?: string; error?: string }>;
}

export interface BarsResponse extends BarSeries {}
