// 시간대와 장 상태 계산. 휴장일은 v0.6 영업일 달력([08] §4.3)에서 다뤄요. 지금은 주말만 쉬는 날로 봐요.

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = 일요일 */
  weekday: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatters.set(timeZone, fmt);
  }
  const out: Partial<ZonedParts> = {};
  for (const p of fmt.formatToParts(epochMs)) {
    switch (p.type) {
      case 'year':
        out.year = Number(p.value);
        break;
      case 'month':
        out.month = Number(p.value);
        break;
      case 'day':
        out.day = Number(p.value);
        break;
      case 'hour':
        out.hour = Number(p.value) % 24;
        break;
      case 'minute':
        out.minute = Number(p.value);
        break;
      case 'second':
        out.second = Number(p.value);
        break;
      case 'weekday':
        out.weekday = WEEKDAYS[p.value] ?? 0;
        break;
    }
  }
  return out as ZonedParts;
}

export const KST = 'Asia/Seoul';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatHm(epochMs: number, timeZone = KST): string {
  const p = zonedParts(epochMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatHms(epochMs: number, timeZone = KST): string {
  const p = zonedParts(epochMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function formatYmd(epochMs: number, timeZone = KST): string {
  const p = zonedParts(epochMs, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * 배지에 쓰는 시각 표기(02 데이터 신선도 표시).
 * 오늘이면 시각(14:03), 다른 날이면 날짜(10/21), 1년이 넘으면 연도까지(2025-10-21). 한국 시간 기준.
 */
export function formatBadgeTime(epochMs: number, now: number, timeZone = KST): string {
  const a = zonedParts(epochMs, timeZone);
  const b = zonedParts(now, timeZone);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return `${pad(a.hour)}:${pad(a.minute)}`;
  if (now - epochMs > 365 * 86400_000) return `${a.year}-${pad(a.month)}-${pad(a.day)}`;
  return `${a.month}/${a.day}`;
}

/** 'YYYY-MM-DD' 기준일을 배지 표기로. 원천의 기준일을 그대로 써요(시차로 옮기지 않아요). */
export function formatBadgeDate(ymd: string, now: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const today = zonedParts(now, KST);
  const ageDays = (Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(y, m - 1, d)) / 86400_000;
  if (ageDays > 365) return ymd;
  return `${m}/${d}`;
}

// ── 장 상태 ──

export type SessionState = 'open' | 'pre' | 'post' | 'closed';

export interface ExchangeHours {
  id: string;
  label: string;
  city: string;
  timeZone: string;
  /** 정규장 [시작, 끝) 분 단위(현지 시각). 점심 휴장이 있으면 여러 구간 */
  regular: Array<[number, number]>;
  pre?: [number, number];
  post?: [number, number];
}

const hm = (h: number, m = 0) => h * 60 + m;

export const EXCHANGES: Record<string, ExchangeHours> = {
  KRX: {
    id: 'KRX',
    label: '한국',
    city: '서울',
    timeZone: 'Asia/Seoul',
    regular: [[hm(9), hm(15, 30)]],
    pre: [hm(8, 30), hm(9)],
    post: [hm(15, 30), hm(18)],
  },
  TSE: {
    id: 'TSE',
    label: '일본',
    city: '도쿄',
    timeZone: 'Asia/Tokyo',
    regular: [
      [hm(9), hm(11, 30)],
      [hm(12, 30), hm(15, 30)],
    ],
  },
  LSE: {
    id: 'LSE',
    label: '영국',
    city: '런던',
    timeZone: 'Europe/London',
    regular: [[hm(8), hm(16, 30)]],
  },
  US: {
    id: 'US',
    label: '미국',
    city: '뉴욕',
    timeZone: 'America/New_York',
    regular: [[hm(9, 30), hm(16)]],
    pre: [hm(4), hm(9, 30)],
    post: [hm(16), hm(20)],
  },
};

export function sessionState(ex: ExchangeHours, now: number): SessionState {
  const p = zonedParts(now, ex.timeZone);
  if (p.weekday === 0 || p.weekday === 6) return 'closed';
  const min = p.hour * 60 + p.minute;
  if (ex.regular.some(([a, b]) => min >= a && min < b)) return 'open';
  if (ex.pre && min >= ex.pre[0] && min < ex.pre[1]) return 'pre';
  if (ex.post && min >= ex.post[0] && min < ex.post[1]) return 'post';
  return 'closed';
}

/**
 * 가장 최근 정규장이 끝난 시각(주말은 건너뛰어요. 휴장일은 모르고, 서머타임이 바뀌는 날은 1시간 어긋날 수 있어요).
 * 장이 끝난 뒤 받은 값의 기준 시각으로 써서 `마감 15:30`처럼 보여 줘요
 */
export function lastRegularClose(ex: ExchangeHours, now: number): number {
  const closeMin = ex.regular[ex.regular.length - 1][1];
  for (let back = 0; back < 8; back++) {
    const t = now - back * 86400_000;
    const p = zonedParts(t, ex.timeZone);
    if (p.weekday === 0 || p.weekday === 6) continue;
    const closeAt = t - ((p.hour * 60 + p.minute - closeMin) * 60 + p.second) * 1000 - (t % 1000);
    if (closeAt <= now) return closeAt;
  }
  return now;
}

export const SESSION_LABEL: Record<SessionState, string> = {
  open: '장중',
  pre: '개장전',
  post: '시간외',
  closed: '마감',
};
