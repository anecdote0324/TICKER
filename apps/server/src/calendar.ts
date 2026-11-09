// 공용 영업일 달력(v0.6): 한국은 한국투자증권 국내휴장일조회로 받은 개장일 여부를 하루 한 번 받아 데이터 폴더(holidays-kr.json)에 두고,
// 규칙으로 계산한 휴장일(@bt/shared calendar.ts)과 다른 날만 덮어써요. 화면도 같은 값을 받아 써요(/api/calendar).

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addDays, CALENDAR_MARKETS, holidayName, ruleHolidaysOf, setHolidayOverrides, weekdayOf, type CalendarMarket } from '@bt/shared';
import type { KisAdapter } from './adapters/kis';
import type { Logger } from './util';

interface KrFile {
  /** 마지막으로 받은 날(한국 날짜) */
  fetchedOn?: string;
  /** 날짜 → 개장일 여부 Y·N */
  days: Record<string, 'Y' | 'N'>;
}

export interface CalendarResponse {
  overrides: Partial<Record<CalendarMarket, Record<string, string | null>>>;
  /** 한국 휴장일을 한국투자증권에서 마지막으로 받은 날 */
  krFetchedOn?: string;
  /** 앞으로의 휴장일(시장별, 오늘부터 1년, 주말 제외) */
  upcoming: Array<{ market: CalendarMarket; date: string; name: string }>;
}

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** KIS 국내휴장일조회 줄 → 날짜 → 개장일 여부 */
export function parseKrHolidays(rows: Array<Record<string, unknown>>): Record<string, 'Y' | 'N'> {
  const out: Record<string, 'Y' | 'N'> = {};
  for (const r of rows) {
    const d = String(r.bass_dt ?? '').trim();
    const open = String(r.opnd_yn ?? '').trim();
    if (!/^\d{8}$/.test(d) || (open !== 'Y' && open !== 'N')) continue;
    out[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = open;
  }
  return out;
}

/** 받은 개장일 여부와 규칙 계산이 다른 날만 덮어쓰기 값으로(주말은 그대로) */
export function krOverrides(days: Record<string, 'Y' | 'N'>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [d, open] of Object.entries(days)) {
    const w = weekdayOf(d);
    if (w === 0 || w === 6) continue;
    const computed = ruleHolidaysOf('KR', Number(d.slice(0, 4))).get(d);
    if (open === 'N' && !computed) out[d] = '휴장(한국투자증권)';
    else if (open === 'Y' && computed) out[d] = null;
  }
  return out;
}

export class CalendarService {
  private kr: KrFile = { days: {} };
  private loaded = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private dataDir: string,
    private kis: () => KisAdapter | undefined,
    private log: Logger,
  ) {}

  private get file() {
    return join(this.dataDir, 'holidays-kr.json');
  }

  private apply() {
    setHolidayOverrides({ KR: krOverrides(this.kr.days) });
  }

  async start() {
    try {
      this.kr = JSON.parse(await readFile(this.file, 'utf8')) as KrFile;
    } catch {
      this.kr = { days: {} };
    }
    this.loaded = true;
    this.apply();
    void this.refresh();
    // 켤 때 한국투자증권 연결이 늦게 준비되면 1분 뒤 한 번 더
    setTimeout(() => void this.refresh(), 60_000).unref?.();
    // 한 시간마다 날짜가 바뀌었는지 보고 하루 한 번 다시 받아요
    this.timer = setInterval(() => void this.refresh(), 3600_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 오늘 아직 받지 않았고 키가 있으면 받아요 */
  async refresh(force = false) {
    const kis = this.kis();
    const today = kstToday();
    if (!kis || (!force && this.kr.fetchedOn === today)) return;
    try {
      const rows = await kis.holidaysKr(today.replace(/-/g, ''));
      const days = parseKrHolidays(rows);
      if (!Object.keys(days).length) return;
      // 지난 날은 1년만 남겨요
      const keepFrom = addDays(today, -366);
      const merged: Record<string, 'Y' | 'N'> = {};
      for (const [d, v] of Object.entries({ ...this.kr.days, ...days })) if (d >= keepFrom) merged[d] = v;
      this.kr = { fetchedOn: today, days: merged };
      this.apply();
      await writeFile(this.file, JSON.stringify(this.kr));
      this.log.info(`국내 휴장일: 한국투자증권에서 ${Object.keys(days).length}일 받았어요`);
    } catch (e) {
      this.log.warn(`국내 휴장일을 받지 못했어요(규칙 계산으로 대신해요): ${(e as Error).message}`);
    }
  }

  get(): CalendarResponse {
    if (!this.loaded) this.apply();
    const today = kstToday();
    const until = addDays(today, 366);
    const upcoming: CalendarResponse['upcoming'] = [];
    for (const { code } of CALENDAR_MARKETS) {
      for (let d = today; d <= until; d = addDays(d, 1)) {
        const w = weekdayOf(d);
        if (w === 0 || w === 6) continue;
        const name = holidayName(code, d);
        if (name) upcoming.push({ market: code, date: d, name });
      }
    }
    return { overrides: { KR: krOverrides(this.kr.days) }, krFetchedOn: this.kr.fetchedOn, upcoming };
  }
}
