// 공용 영업일·휴장일 달력(v0.6 첫 작업, 08 §4.3).
// - 미국(NYSE)·영국(LSE)·일본(TSE)은 규칙으로 계산해요(부활절, n번째 월요일, 대체 휴일, 춘분·추분 근사식).
// - 한국(KRX)은 양력 공휴일·대체 공휴일 규칙에 음력 명절(설·추석·부처님오신날)과 선거일 표를 더해요.
//   한국투자증권 키가 있으면 국내휴장일조회(CTCA0903R)로 받은 값이 이 계산보다 먼저예요(setHolidayOverrides).
// 날짜는 모두 그 나라의 현지 날짜 'YYYY-MM-DD'예요. 이 파일은 time.ts를 쓰지 않아요(time.ts가 이 파일을 써요).

export type CalendarMarket = 'KR' | 'US' | 'JP' | 'UK';

export const CALENDAR_MARKETS: Array<{ code: CalendarMarket; label: string; exchange: string }> = [
  { code: 'KR', label: '한국(KRX)', exchange: 'KRX' },
  { code: 'US', label: '미국(NYSE)', exchange: 'US' },
  { code: 'JP', label: '일본(TSE)', exchange: 'TSE' },
  { code: 'UK', label: '영국(LSE)', exchange: 'LSE' },
];

/** 거래소 id(time.ts EXCHANGES) → 달력 시장 */
export const EXCHANGE_CALENDAR: Record<string, CalendarMarket> = { KRX: 'KR', US: 'US', TSE: 'JP', LSE: 'UK' };

const pad = (n: number) => String(n).padStart(2, '0');
export const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 그 날의 요일(0 일요일). 현지 날짜 기준이라 UTC 자정으로 계산해요 */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ymd에 날짜를 더해요 */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** m월의 n번째 w요일(n이 -1이면 마지막) */
function nthWeekday(y: number, m: number, w: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return ymdOf(y, m, 1 + ((w - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastW = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return ymdOf(y, m, lastDay - ((lastW - w + 7) % 7));
}

/** 부활절(그레고리력, 익명 계산법) */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymdOf(y, month, day);
}

type Holidays = Map<string, string>;

function us(y: number): Holidays {
  const h: Holidays = new Map();
  // 토요일이면 금요일, 일요일이면 월요일에 쉬어요. 1월 1일이 토요일이면 전년 12월 31일에는 쉬지 않아요(NYSE 규칙)
  const fixed = (m: number, d: number, name: string, skipFri = false) => {
    const ymd = ymdOf(y, m, d);
    const w = weekdayOf(ymd);
    if (w === 6) {
      if (!skipFri) h.set(addDays(ymd, -1), name);
    } else if (w === 0) h.set(addDays(ymd, 1), name);
    else h.set(ymd, name);
  };
  fixed(1, 1, '새해', true);
  h.set(nthWeekday(y, 1, 1, 3), '마틴 루서 킹 데이');
  h.set(nthWeekday(y, 2, 1, 3), '대통령의 날');
  h.set(addDays(easter(y), -2), '성금요일');
  h.set(nthWeekday(y, 5, 1, -1), '메모리얼 데이');
  if (y >= 2022) fixed(6, 19, '준틴스');
  fixed(7, 4, '독립기념일');
  h.set(nthWeekday(y, 9, 1, 1), '노동절');
  h.set(nthWeekday(y, 11, 4, 4), '추수감사절');
  fixed(12, 25, '크리스마스');
  return h;
}

function uk(y: number): Holidays {
  const h: Holidays = new Map();
  // 주말이면 다음 평일로(크리스마스·박싱데이가 겹치면 차례로 밀려요)
  const sub = (m: number, d: number, name: string) => {
    let ymd = ymdOf(y, m, d);
    while (weekdayOf(ymd) === 0 || weekdayOf(ymd) === 6 || h.has(ymd)) ymd = addDays(ymd, 1);
    h.set(ymd, name);
  };
  sub(1, 1, '새해');
  const e = easter(y);
  h.set(addDays(e, -2), '성금요일');
  h.set(addDays(e, 1), '부활절 월요일');
  h.set(nthWeekday(y, 5, 1, 1), '5월 초 공휴일');
  h.set(nthWeekday(y, 5, 1, -1), '봄 공휴일');
  h.set(nthWeekday(y, 8, 1, -1), '여름 공휴일');
  sub(12, 25, '크리스마스');
  sub(12, 26, '박싱 데이');
  return h;
}

function jp(y: number): Holidays {
  const h: Holidays = new Map();
  const set = (ymd: string, name: string) => h.set(ymd, name);
  const vernal = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const autumnal = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const nat: Array<[string, string]> = [
    [ymdOf(y, 1, 1), '설날'],
    [nthWeekday(y, 1, 1, 2), '성인의 날'],
    [ymdOf(y, 2, 11), '건국기념일'],
    [ymdOf(y, 2, 23), '천황탄생일'],
    [ymdOf(y, 3, vernal), '춘분의 날'],
    [ymdOf(y, 4, 29), '쇼와의 날'],
    [ymdOf(y, 5, 3), '헌법기념일'],
    [ymdOf(y, 5, 4), '녹색의 날'],
    [ymdOf(y, 5, 5), '어린이날'],
    [nthWeekday(y, 7, 1, 3), '바다의 날'],
    [ymdOf(y, 8, 11), '산의 날'],
    [nthWeekday(y, 9, 1, 3), '경로의 날'],
    [ymdOf(y, 9, autumnal), '추분의 날'],
    [nthWeekday(y, 10, 1, 2), '스포츠의 날'],
    [ymdOf(y, 11, 3), '문화의 날'],
    [ymdOf(y, 11, 23), '근로감사의 날'],
  ];
  for (const [d, n] of nat) set(d, n);
  // 대체 휴일: 공휴일이 일요일이면 그 뒤 첫 평일(공휴일이 아닌 날)
  for (const [d] of nat) {
    if (weekdayOf(d) !== 0) continue;
    let s = addDays(d, 1);
    while (h.has(s)) s = addDays(s, 1);
    set(s, '대체 휴일');
  }
  // 국민의 휴일: 공휴일 사이에 낀 평일
  for (const [d] of nat) {
    const mid = addDays(d, 1);
    if (!h.has(mid) && h.has(addDays(d, 2)) && weekdayOf(mid) !== 0) set(mid, '국민의 휴일');
  }
  // 도쿄증권거래소는 1월 2·3일과 12월 31일도 쉬어요
  set(ymdOf(y, 1, 2), '연초 휴장');
  set(ymdOf(y, 1, 3), '연초 휴장');
  set(ymdOf(y, 12, 31), '연말 휴장');
  return h;
}

/** 한국 음력 명절(설·추석은 전날·당일·다음날, 부처님오신날은 당일)과 선거일·임시공휴일. 표에 없는 해는 양력 공휴일만 계산해요 */
const KR_LUNAR: Record<number, { seollal: string; chuseok: string; buddha: string; extra?: Array<[string, string]> }> = {
  2024: { seollal: '2024-02-10', chuseok: '2024-09-17', buddha: '2024-05-15', extra: [['2024-04-10', '국회의원 선거'], ['2024-10-01', '국군의 날(임시공휴일)']] },
  2025: { seollal: '2025-01-29', chuseok: '2025-10-06', buddha: '2025-05-05', extra: [['2025-01-27', '임시공휴일'], ['2025-06-03', '대통령 선거']] },
  2026: { seollal: '2026-02-17', chuseok: '2026-09-25', buddha: '2026-05-24', extra: [['2026-06-03', '지방선거']] },
  2027: { seollal: '2027-02-07', chuseok: '2027-09-15', buddha: '2027-05-13' },
  2028: { seollal: '2028-01-27', chuseok: '2028-10-03', buddha: '2028-05-02', extra: [['2028-04-12', '국회의원 선거']] },
  2029: { seollal: '2029-02-13', chuseok: '2029-09-22', buddha: '2029-05-20' },
  2030: { seollal: '2030-02-03', chuseok: '2030-09-12', buddha: '2030-05-09', extra: [['2030-06-12', '지방선거']] },
};

function kr(y: number): Holidays {
  const h: Holidays = new Map();
  const set = (ymd: string, name: string) => {
    if (!h.has(ymd)) h.set(ymd, name);
  };
  const nextFree = (from: string) => {
    let s = addDays(from, 1);
    while (h.has(s) || weekdayOf(s) === 0 || weekdayOf(s) === 6) s = addDays(s, 1);
    return s;
  };
  const lunar = KR_LUNAR[y];
  // 설·추석: 사흘 중 하루가 일요일이거나 다른 공휴일과 겹치면 그 뒤 첫 평일이 대체 공휴일
  const fixedDays: Array<[string, string, boolean]> = [
    // [날짜, 이름, 토요일·일요일이면 대체 공휴일]
    [ymdOf(y, 1, 1), '신정', false],
    [ymdOf(y, 3, 1), '삼일절', true],
    [ymdOf(y, 5, 1), '근로자의 날', false],
    [ymdOf(y, 5, 5), '어린이날', true],
    [ymdOf(y, 6, 6), '현충일', false],
    [ymdOf(y, 8, 15), '광복절', true],
    [ymdOf(y, 10, 3), '개천절', true],
    [ymdOf(y, 10, 9), '한글날', true],
    [ymdOf(y, 12, 25), '크리스마스', y >= 2023],
  ];
  if (lunar) fixedDays.push([lunar.buddha, '부처님오신날', y >= 2023]);
  // 겹침을 알려면 먼저 모두 넣어요
  const multi: Array<[string[], string]> = lunar
    ? [
        [[addDays(lunar.seollal, -1), lunar.seollal, addDays(lunar.seollal, 1)], '설날'],
        [[addDays(lunar.chuseok, -1), lunar.chuseok, addDays(lunar.chuseok, 1)], '추석'],
      ]
    : [];
  const count = new Map<string, number>();
  const bump = (d: string) => count.set(d, (count.get(d) ?? 0) + 1);
  for (const [d, n] of fixedDays) {
    set(d, n);
    bump(d);
  }
  for (const [days, n] of multi)
    for (const d of days) {
      set(d, n);
      bump(d);
    }
  for (const [d, n] of lunar?.extra ?? []) set(d, n);
  // 대체 공휴일(겹친 날은 한 번만): 단일 공휴일이 주말(대체 대상만)이거나, 공휴일끼리 겹치거나, 설·추석 사흘에 일요일이 끼면
  // 그 뒤 첫 평일(쉬는 날 아님)을 대체 공휴일로 해요. 설·추석에 걸린 경우는 사흘의 마지막 날 뒤에서 찾아요
  const triggers: Array<[string, string]> = [];
  const periodOf = (d: string) => multi.find(([days]) => days.includes(d));
  const done = new Set<string>();
  for (const [d, n, weekend] of fixedDays) {
    if (done.has(d)) continue;
    const w = weekdayOf(d);
    const overlap = (count.get(d) ?? 0) > 1;
    if (overlap) {
      done.add(d);
      const period = periodOf(d);
      triggers.push([period ? period[0][2] : d, period ? period[1] : n]);
    } else if (weekend && (w === 0 || w === 6)) triggers.push([d, n]);
  }
  for (const [days, n] of multi) {
    for (const d of days) if (weekdayOf(d) === 0 && !done.has(d)) triggers.push([days[2], n]);
  }
  triggers.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  for (const [after, n] of triggers) set(nextFree(after), `${n} 대체공휴일`);
  // 한국거래소는 연말(12월 31일, 주말이면 그 앞 평일)에 쉬어요
  let last = ymdOf(y, 12, 31);
  while (weekdayOf(last) === 0 || weekdayOf(last) === 6) last = addDays(last, -1);
  set(last, '연말 휴장');
  return h;
}

const RULES: Record<CalendarMarket, (y: number) => Holidays> = { KR: kr, US: us, JP: jp, UK: uk };
const cache = new Map<string, Holidays>();

/** 한국투자증권 등에서 받은 값: 시장 → 날짜 → 쉬는 날이면 이름, 여는 날이면 null(계산과 다를 때 덮어써요) */
let overrides: Partial<Record<CalendarMarket, Record<string, string | null>>> = {};

export function setHolidayOverrides(next: Partial<Record<CalendarMarket, Record<string, string | null>>>) {
  overrides = next;
}

export function getHolidayOverrides() {
  return overrides;
}

/** 규칙으로만 계산한 그해 휴장일(받은 값을 덮어쓰기 전) */
export function ruleHolidaysOf(market: CalendarMarket, year: number): Holidays {
  const key = `${market}|${year}`;
  let base = cache.get(key);
  if (!base) {
    base = RULES[market](year);
    cache.set(key, base);
  }
  return base;
}

/** 그해 휴장일(주말 제외). 받은 값으로 덮어쓴 결과 */
export function holidaysOf(market: CalendarMarket, year: number): Holidays {
  const base = ruleHolidaysOf(market, year);
  const ov = overrides[market];
  if (!ov) return base;
  const out = new Map(base);
  for (const [d, v] of Object.entries(ov)) {
    if (!d.startsWith(`${year}-`)) continue;
    if (v === null) out.delete(d);
    else out.set(d, v);
  }
  return out;
}

/** 휴장일 이름(주말은 '주말'). 여는 날이면 undefined */
export function holidayName(market: CalendarMarket, ymd: string): string | undefined {
  const w = weekdayOf(ymd);
  const named = holidaysOf(market, Number(ymd.slice(0, 4))).get(ymd);
  if (named) return named;
  if (w === 0 || w === 6) return '주말';
  return undefined;
}

export function isBusinessDay(market: CalendarMarket, ymd: string): boolean {
  return holidayName(market, ymd) === undefined;
}

/** n영업일 뒤(n이 음수면 앞). 0이면 그날이 영업일이 아닐 때 다음 영업일 */
export function addBusinessDays(market: CalendarMarket, ymd: string, n: number): string {
  let d = ymd;
  if (n === 0) {
    while (!isBusinessDay(market, d)) d = addDays(d, 1);
    return d;
  }
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    if (isBusinessDay(market, d)) left--;
  }
  return d;
}

/** [from, to] 사이 영업일 수(양 끝 포함) */
export function businessDaysBetween(market: CalendarMarket, from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isBusinessDay(market, d)) n++;
  return n;
}

/** 여러 시장이 모두 여는 영업일(결제일 계산용) */
export function addJointBusinessDays(markets: CalendarMarket[], ymd: string, n: number): string {
  const ok = (d: string) => markets.every((m) => isBusinessDay(m, d));
  let d = ymd;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (ok(d)) left--;
  }
  return d;
}
