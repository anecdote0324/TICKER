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

/** 봉 단위. 1m·5m는 GIP 분봉, 1h·2h·4h는 GP 시간봉(과거까지 이어서), 1d·1w·1M은 GP 일·주·월봉 */
export type BarInterval = '1m' | '5m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M';

/** GP 시간봉 */
export const HOUR_INTERVALS = ['1h', '2h', '4h'] as const;
export type HourInterval = (typeof HOUR_INTERVALS)[number];

export function isHourInterval(iv: BarInterval | undefined): iv is HourInterval {
  return iv === '1h' || iv === '2h' || iv === '4h';
}

/** 봉 하나의 길이(분). 시간봉까지만 써요 */
export function intervalMinutes(iv: '1m' | '5m' | HourInterval): number {
  return { '1m': 1, '5m': 5, '1h': 60, '2h': 120, '4h': 240 }[iv];
}

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
  sources: Array<{ name: string; count: number; asOf?: string; error?: string; /** 앱에 넣은 사본으로 대신했으면 true */ snapshot?: boolean }>;
}

export interface BarsResponse extends BarSeries {}
