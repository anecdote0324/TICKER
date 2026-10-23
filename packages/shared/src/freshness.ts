// 데이터 신선도 정보와 배지 계산(02 데이터 신선도 표시).
// 서버는 모든 시장 데이터에 Freshness를 붙이고, 화면은 이 정보만 보고 배지를 그려요.

import { formatBadgeDate, formatBadgeTime } from './time';

export type SourceId = 'KIS' | 'BINANCE' | 'FX' | 'DEMO';

export const SOURCE_LABEL: Record<SourceId, string> = {
  KIS: '한국투자증권',
  BINANCE: 'Binance',
  FX: '환율 (ExchangeRate-API)',
  DEMO: '데모 데이터',
};

/**
 * 받는 방식.
 * - realtime: WebSocket으로 오는 대로
 * - poll: 정해진 간격으로 다시 조회
 * - delayed: 원천이 늦게 줌
 * - daily: 하루 한 번(asOfDate가 기준일)
 * - release: 월·분기·연 단위 발표
 * - demo: 실제 시세가 아닌 데모 값(키를 넣기 전)
 */
export type FeedMode = 'realtime' | 'poll' | 'delayed' | 'daily' | 'release' | 'demo';

export interface Freshness {
  source: SourceId;
  mode: FeedMode;
  /** 원천이 매긴 시각(ms). 원천이 주지 않으면 받은 시각으로 대신하고 asOfFromReceipt를 켜요 */
  asOf: number;
  /** 서버가 받은 시각(ms) */
  receivedAt: number;
  /** 주기 조회 간격(ms) */
  intervalMs?: number;
  /** 원천 지연 시간(ms) */
  delayMs?: number;
  /** daily: 'YYYY-MM-DD', release: 'YYYY-MM' 또는 'YYYY Q2' */
  asOfDate?: string;
  /** release 주기 */
  period?: 'W' | 'M' | 'Q' | 'Y';
  asOfFromReceipt?: boolean;
}

export type BadgeState = 'realtime' | 'poll' | 'delayed' | 'daily' | 'release' | 'closed' | 'stale' | 'demo';

export interface Badge {
  state: BadgeState;
  /** 제목 줄·차트에 붙는 긴 배지. 실시간이면 null */
  long: string | null;
  /** 표의 행·시세 흐름 띠에 붙는 짧은 배지. 실시간이면 null */
  short: string | null;
  /** 멈춤: 배경을 칠해 반전 */
  inverted: boolean;
}

export interface BadgeContext {
  now: number;
  /** 이 값을 주는 소스의 연결 상태. false면 실시간 값은 멈춤이에요 */
  sourceConnected?: boolean;
  /** 이 종목의 장이 열려 있는지. false면 실시간 값에 '마감'을 붙여요 */
  sessionOpen?: boolean;
}

export function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}분`;
  return `${Math.round(ms / 3_600_000)}시간`;
}

const PERIOD_SHORT: Record<NonNullable<Freshness['period']>, string> = {
  W: '주간',
  M: '월간',
  Q: '분기',
  Y: '연간',
};

/** 주기 조회·지연 값이 멈췄는지: 마지막 성공 뒤 주기의 3배와 1분 중 긴 시간이 지났을 때 */
export function isPollStale(f: Freshness, now: number): boolean {
  const interval = f.intervalMs ?? 60_000;
  return now - f.receivedAt > Math.max(interval * 3, 60_000);
}

export function computeBadge(f: Freshness | undefined, ctx: BadgeContext): Badge | null {
  if (!f) return null;
  const { now } = ctx;
  switch (f.mode) {
    case 'demo':
      return { state: 'demo', long: '데모', short: '데모', inverted: false };
    case 'realtime': {
      if (ctx.sourceConnected === false) {
        return { state: 'stale', long: `⚠ 멈춤 ${formatBadgeTime(f.receivedAt, now)}`, short: '⚠', inverted: true };
      }
      if (ctx.sessionOpen === false) {
        return { state: 'closed', long: `마감 ${formatBadgeTime(f.asOf, now)}`, short: '마감', inverted: false };
      }
      return { state: 'realtime', long: null, short: null, inverted: false };
    }
    case 'poll':
    case 'delayed': {
      if (isPollStale(f, now) || ctx.sourceConnected === false) {
        return { state: 'stale', long: `⚠ 멈춤 ${formatBadgeTime(f.receivedAt, now)}`, short: '⚠', inverted: true };
      }
      // 두 상태에 걸치면 더 늦은 쪽(지연)을 보여요
      if (f.delayMs && f.delayMs > 0) {
        return { state: 'delayed', long: `${formatInterval(f.delayMs)} 지연`, short: '지연', inverted: false };
      }
      if (ctx.sessionOpen === false) {
        return { state: 'closed', long: `마감 ${formatBadgeTime(f.asOf, now)}`, short: '마감', inverted: false };
      }
      const interval = f.intervalMs ?? 60_000;
      return { state: 'poll', long: `${formatInterval(interval)} 주기`, short: formatInterval(interval), inverted: false };
    }
    case 'daily': {
      const date = f.asOfDate ? formatBadgeDate(f.asOfDate, now) : formatBadgeTime(f.asOf, now);
      return { state: 'daily', long: `일별 ${date}`, short: '일별', inverted: false };
    }
    case 'release': {
      const label = f.asOfDate ?? formatBadgeTime(f.asOf, now);
      return {
        state: 'release',
        long: `기준 ${label}`,
        short: f.period ? PERIOD_SHORT[f.period] : '기준',
        inverted: false,
      };
    }
  }
}

const MODE_RANK: Record<FeedMode, number> = {
  realtime: 0,
  poll: 1,
  delayed: 2,
  daily: 3,
  release: 4,
  demo: 5,
};

function lateness(f: Freshness): number {
  return MODE_RANK[f.mode] * 1e12 + (f.delayMs ?? 0) + (f.intervalMs ?? 0) / 1000;
}

/**
 * 여러 값으로 계산한 값의 신선도: 입력 중 가장 늦은 상태를 따라가요.
 * 예: 실시간 주가 × 30초 주기 환율 → 30초 주기.
 */
export function slowestFreshness(list: Array<Freshness | undefined>): Freshness | undefined {
  let worst: Freshness | undefined;
  for (const f of list) {
    if (!f) continue;
    if (!worst || lateness(f) > lateness(worst)) worst = f;
  }
  return worst;
}

const MODE_LABEL: Record<FeedMode, string> = {
  realtime: '실시간',
  poll: '주기 조회',
  delayed: '지연',
  daily: '하루 한 번',
  release: '발표 주기',
  demo: '데모(실제 시세 아님)',
};

/** 배지에 마우스를 올렸을 때 보여 줄 자세한 정보 */
export function freshnessDetail(f: Freshness, now: number): Array<[string, string]> {
  const rows: Array<[string, string]> = [['출처', SOURCE_LABEL[f.source]]];
  let how = MODE_LABEL[f.mode];
  if (f.mode === 'poll' && f.intervalMs) how = `${formatInterval(f.intervalMs)} 주기`;
  if (f.delayMs) how += ` · ${formatInterval(f.delayMs)} 지연`;
  rows.push(['갱신 방식', how]);
  rows.push([
    '기준 시각',
    (f.asOfDate ?? formatBadgeTime(f.asOf, now)) + (f.asOfFromReceipt ? ' (원천이 시각을 주지 않아 받은 시각)' : ''),
  ]);
  rows.push(['받은 시각', formatBadgeTime(f.receivedAt, now)]);
  if (f.mode === 'poll' && f.intervalMs) rows.push(['다음 갱신', formatBadgeTime(f.receivedAt + f.intervalMs, now)]);
  return rows;
}
