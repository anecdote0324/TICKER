// v0.6 중앙은행: CENB 중앙은행, FOMC FOMC 결과, DOTS 점도표, WIRP 정책금리 경로(근사), CSDR 국가 신용등급(근사).
// 서버가 받은 HTML·CSV·RSS를 여기의 순수 함수로 읽어요(테스트하기 쉽게).

import type { Freshness } from './freshness';

// ── 정책금리(BIS WS_CBPOL) ──

/** BIS REF_AREA 코드 기준. 나라 이름·중앙은행 이름은 화면용 */
export const POLICY_BANKS: Array<{ area: string; country: string; bank: string; meetings?: MeetingBank }> = [
  { area: 'US', country: '미국', bank: '연준(Fed)', meetings: 'FED' },
  { area: 'XM', country: '유로', bank: 'ECB', meetings: 'ECB' },
  { area: 'JP', country: '일본', bank: '일본은행(BOJ)', meetings: 'BOJ' },
  { area: 'KR', country: '한국', bank: '한국은행', meetings: 'BOK' },
  { area: 'GB', country: '영국', bank: '영란은행(BOE)' },
  { area: 'CN', country: '중국', bank: '인민은행' },
  { area: 'CA', country: '캐나다', bank: '캐나다은행' },
  { area: 'AU', country: '호주', bank: '호주중앙은행' },
  { area: 'NZ', country: '뉴질랜드', bank: '뉴질랜드중앙은행' },
  { area: 'CH', country: '스위스', bank: '스위스중앙은행' },
  { area: 'SE', country: '스웨덴', bank: '릭스방크' },
  { area: 'NO', country: '노르웨이', bank: '노르웨이중앙은행' },
  { area: 'IN', country: '인도', bank: '인도중앙은행' },
  { area: 'BR', country: '브라질', bank: '브라질중앙은행' },
  { area: 'MX', country: '멕시코', bank: '멕시코중앙은행' },
];

export type MeetingBank = 'FED' | 'ECB' | 'BOJ' | 'BOK';

export const MEETING_BANK_NAMES: Record<MeetingBank, string> = { FED: 'FOMC', ECB: 'ECB 통화정책회의', BOJ: 'BOJ 금융정책결정회의', BOK: '금통위(통화정책방향)' };

export interface PolicyRate {
  area: string;
  rate: number;
  /** 마지막 값의 날짜(YYYY-MM-DD) */
  date: string;
  /** 마지막으로 바뀐 날과 바뀌기 전 값 */
  changed?: { date: string; from: number };
  /** 1년 전(그날 이전 가장 가까운) 값 */
  yearAgo?: number;
  /** 그래프용(주 1회 간격, 오래된 것부터) */
  spark: number[];
}

/** BIS 데이터 API CSV(REF_AREA·TIME_PERIOD·OBS_VALUE 칸) → 나라별 날짜순 값 */
export function parseBisCsv(csv: string): Map<string, Array<{ date: string; value: number }>> {
  const out = new Map<string, Array<{ date: string; value: number }>>();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return out;
  const head = splitCsv(lines[0]);
  const ai = head.indexOf('REF_AREA');
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  if (ai < 0 || ti < 0 || vi < 0) return out;
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    const v = Number(c[vi]);
    if (!c[vi] || !Number.isFinite(v) || !/^\d{4}-\d{2}-\d{2}$/.test(c[ti] ?? '')) continue;
    const list = out.get(c[ai]) ?? [];
    list.push({ date: c[ti], value: v });
    out.set(c[ai], list);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 날짜순 값 → 지금 값, 마지막 변경, 1년 전, 주 단위 그래프 */
export function summarizePolicy(area: string, obs: Array<{ date: string; value: number }>): PolicyRate | undefined {
  const last = obs[obs.length - 1];
  if (!last) return undefined;
  let changed: PolicyRate['changed'];
  for (let i = obs.length - 1; i > 0; i--) {
    if (Math.abs(obs[i].value - obs[i - 1].value) > 1e-9) {
      changed = { date: obs[i].date, from: obs[i - 1].value };
      break;
    }
  }
  const yearAgoDate = shiftDate(last.date, -365);
  let yearAgo: number | undefined;
  for (const o of obs) {
    if (o.date > yearAgoDate) break;
    yearAgo = o.value;
  }
  const spark: number[] = [];
  for (let i = obs.length - 1; i >= 0; i -= 7) spark.unshift(obs[i].value);
  return { area, rate: last.value, date: last.date, changed, yearAgo, spark };
}

export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ── 회의 일정 ──

export interface Meeting {
  bank: MeetingBank;
  /** 결정을 발표하는 날(이틀 회의면 둘째 날), YYYY-MM-DD(그 나라 날짜) */
  date: string;
  /** FOMC: 경제 전망(SEP·점도표)을 내는 회의 */
  sep?: boolean;
  statementUrl?: string;
  minutesUrl?: string;
  projectionsUrl?: string;
}

const EN_MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const FED = 'https://www.federalreserve.gov';

/** 연준 FOMC 일정 페이지(fomccalendars.htm) → 회의(결정일), 성명·의사록·전망 자료 링크 */
export function parseFomcCalendar(html: string): Meeting[] {
  const out: Meeting[] = [];
  const heads = [...html.matchAll(/(\d{4}) FOMC Meetings/g)];
  for (let h = 0; h < heads.length; h++) {
    const year = Number(heads[h][1]);
    const seg = html.slice(heads[h].index!, h + 1 < heads.length ? heads[h + 1].index : undefined);
    // 회의 하나 = class에 'fomc-meeting' 낱말이 그대로 있는 div(색칠한 줄의 'fomc-meeting--shaded'·'fomc-meeting__month'는 아님)
    const blocks = seg.split(/<div class="(?:[^"]*\s)?fomc-meeting(?=[\s"])[^"]*"/).slice(1);
    for (const b of blocks) {
      const month = b.match(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>/)?.[1]?.trim();
      const dates = b.match(/fomc-meeting__date[^>]*>([^<]+)</)?.[1]?.trim();
      if (!month || !dates || /notation vote|unscheduled|conference call/i.test(dates)) continue;
      const months = month.split('/').map((m) => EN_MONTHS[m.trim().slice(0, 3).toLowerCase()]);
      const days = dates.match(/\d+/g)?.map(Number) ?? [];
      if (!months[0] || !days.length) continue;
      const lastDay = days[days.length - 1];
      // "Apr/May 30-1"처럼 달을 넘기면 끝날은 뒤 달
      const m = months.length > 1 && days.length > 1 && lastDay < days[0] ? months[months.length - 1] : months[0];
      const link = (re: RegExp) => {
        const x = b.match(re)?.[1];
        return x ? FED + x : undefined;
      };
      out.push({
        bank: 'FED',
        date: `${year}-${pad(m)}-${pad(lastDay)}`,
        sep: dates.includes('*'),
        statementUrl: link(/href="(\/newsevents\/pressreleases\/monetary\d{8}a\.htm)"/),
        minutesUrl: link(/href="(\/monetarypolicy\/fomcminutes\d{8}\.htm)"/),
        projectionsUrl: link(/href="(\/monetarypolicy\/fomcprojtabl\d{8}\.htm)"/),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 한국은행 통화정책방향 결정회의 목록(연도별) → 회의일. "01월 15일(목)" 모양 */
export function parseBokSchedule(html: string, year: number): Meeting[] {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const start = text.indexOf('회의일자');
  const body = start >= 0 ? text.slice(start) : text;
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const m of body.matchAll(/(\d{2})월 (\d{2})일\s*\(([월화수목금토일])\)/g)) {
    const date = `${year}-${m[1]}-${m[2]}`;
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ bank: 'BOK', date });
  }
  return out;
}

/** ECB 회의 일정 페이지 → 통화정책 회의의 결정일(기자회견이 있는 날) */
export function parseEcbSchedule(html: string): Meeting[] {
  const out: Meeting[] = [];
  for (const m of html.matchAll(/<dt>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    const desc = m[4].replace(/<[^>]+>/g, ' ');
    if (/non-monetary/i.test(desc) || !/monetary policy meeting/i.test(desc)) continue;
    if (/Day 1/i.test(desc) && !/press conference/i.test(desc)) continue;
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    // 이틀 회의를 날마다 적은 경우는 둘째 날만
    const prev = out[out.length - 1];
    if (prev && Date.parse(date) - Date.parse(prev.date) <= 86400_000) out.pop();
    out.push({ bank: 'ECB', date });
  }
  return out;
}

/** 일본은행 금융정책결정회의 일정(연도별 표의 첫 칸 "Jan. 22 (Thurs.), 23 (Fri.)") → 결정일(둘째 날) */
export function parseBojSchedule(html: string): Meeting[] {
  const out: Meeting[] = [];
  const heads = [...html.matchAll(/<h2 id="p(\d{4})">/g)];
  for (let h = 0; h < heads.length; h++) {
    const year = Number(heads[h][1]);
    const seg = html.slice(heads[h].index!, h + 1 < heads.length ? heads[h + 1].index : undefined);
    const tbody = seg.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    for (const row of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const first = row[1].match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1];
      if (!first) continue;
      const text = first.replace(/<[^>]+>/g, ' ').replace(/\[PDF[^\]]*\]/g, ' ').replace(/\s+/g, ' ');
      let month = 0;
      let day = 0;
      for (const t of text.matchAll(/([A-Z][a-z]+)\.?\s+(\d{1,2})|,\s*(\d{1,2})\s*\(/g)) {
        if (t[1]) {
          const mm = EN_MONTHS[t[1].slice(0, 3).toLowerCase()];
          if (!mm) continue;
          month = mm;
          day = Number(t[2]);
        } else day = Number(t[3]);
      }
      if (month && day) out.push({ bank: 'BOJ', date: `${year}-${pad(month)}-${pad(day)}` });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 성명·의사록 ──

export type StatementKind = 'statement' | 'minutes' | 'projections' | 'pressconf' | 'other';

export interface CbDocument {
  bank: 'FED' | 'BOK';
  kind: StatementKind;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  url: string;
  /** 성명 본문(FOMC 성명·한은 통화정책방향은 본문까지) */
  text?: string;
}

/** 연준 보도자료(성명) HTML → 본문 문단 */
export function parseFedStatement(html: string): string {
  const art = html.indexOf('id="article"');
  const start = html.indexOf('<div class="col-xs-12 col-sm-8 col-md-8">', art >= 0 ? art : 0);
  if (start < 0) return '';
  let seg = html.slice(start, start + 40_000);
  const stop = seg.search(/For media inquiries|Implementation Note issued|Last Update:/);
  if (stop > 0) seg = seg.slice(0, stop);
  return htmlToText(seg);
}

export function htmlToText(seg: string): string {
  return decode(
    seg
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** 연준 통화정책 보도자료 RSS 제목 → 종류 */
export function fedKind(title: string): StatementKind {
  if (/issues FOMC statement/i.test(title)) return 'statement';
  if (/^Minutes of the Federal Open Market Committee/i.test(title)) return 'minutes';
  if (/economic projections/i.test(title)) return 'projections';
  return 'other';
}

/** 한국은행 보도자료 제목 → 종류(통화정책방향 결정문, 금통위 의사록) */
export function bokKind(title: string): StatementKind {
  if (/^통화정책방향\s*\(/.test(title)) return 'statement';
  if (/금융통화위원회 의사록/.test(title)) return 'minutes';
  if (/기자간담회/.test(title)) return 'pressconf';
  return 'other';
}

// ── 점도표(SEP) ──

export interface DotPlot {
  /** 회의 결정일 YYYY-MM-DD */
  meeting: string;
  url: string;
  /** 열 이름: 연도들과 'Longer run' */
  years: string[];
  /** 금리(범위의 가운데) → 열마다 위원 수 */
  dots: Array<{ rate: number; counts: number[] }>;
  /** 표 1의 중간값: 변수 → 열마다 값(없으면 null) */
  medians: Array<{ key: 'gdp' | 'unemp' | 'pce' | 'core' | 'ffr'; values: Array<number | null>; prev: Array<number | null> }>;
}

function tableRows(table: string): string[][] {
  const rows: string[][] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    rows.push([...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()));
  }
  return rows;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(s.replace(/[^\d.\-]/g, ''));
  return s.trim() && s.trim() !== '-' && Number.isFinite(v) ? v : null;
};

/** 연준 경제 전망 자료(fomcprojtabl*.htm) → 점도표(그림 2)와 중간값(표 1) */
export function parseSep(html: string, url: string, meeting: string): DotPlot | undefined {
  const f2 = html.search(/Figure 2\. FOMC participants/);
  if (f2 < 0) return undefined;
  const t2 = html.slice(f2).match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!t2) return undefined;
  const rows2 = tableRows(t2);
  const years = (rows2[0] ?? []).slice(1);
  const dots = rows2
    .slice(1)
    .map((r) => ({ rate: Number(r[0]), counts: r.slice(1).map((c) => Number(c) || 0) }))
    .filter((d) => Number.isFinite(d.rate));
  const medians: DotPlot['medians'] = [];
  const t1i = html.search(/Table 1\. Economic projections/);
  if (t1i >= 0) {
    const t1 = html.slice(t1i).match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
    const rows1 = tableRows(t1);
    const n = years.length;
    const keys: Array<[DotPlot['medians'][number]['key'], RegExp]> = [
      ['gdp', /^Change in real GDP/],
      ['unemp', /^Unemployment rate/],
      ['pce', /^PCE inflation/],
      ['core', /^Core PCE inflation/],
      ['ffr', /^Federal funds rate/],
    ];
    for (const [key, re] of keys) {
      const i = rows1.findIndex((r) => re.test(r[0] ?? ''));
      if (i < 0) continue;
      const row = rows1[i];
      const prevRow = /projection$/i.test(rows1[i + 1]?.[0] ?? '') ? rows1[i + 1] : [];
      // 중간값 칸은 변수 이름 뒤 처음 n칸(근원 PCE처럼 장기 칸이 없으면 n-1칸)
      const take = (r: string[]) => {
        const cells = r.slice(1);
        const vals = cells.slice(0, n).map(num);
        // 장기 칸이 없는 줄: 범위("2.0–2.4")가 중간값 자리에 끼면 그 앞까지만
        const firstRange = cells.findIndex((c) => /–|-\d/.test(c) && !/^-$/.test(c));
        if (firstRange >= 0 && firstRange < n) return [...cells.slice(0, firstRange).map(num), ...Array(n - firstRange).fill(null)];
        return vals;
      };
      medians.push({ key, values: take(row), prev: prevRow.length ? take(prevRow) : [] });
    }
  }
  return { meeting, url, years, dots, medians };
}

/** 점도표 열의 중간값(위원 금리를 늘어놓은 가운데, 짝수면 두 값의 평균) */
export function dotMedian(dots: DotPlot['dots'], col: number): number | undefined {
  const xs: number[] = [];
  for (const d of dots) for (let k = 0; k < (d.counts[col] ?? 0); k++) xs.push(d.rate);
  if (!xs.length) return undefined;
  xs.sort((a, b) => a - b);
  const h = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[h] : (xs[h - 1] + xs[h]) / 2;
}

// ── 응답 ──

export interface CentralBankResponse {
  rates: PolicyRate[];
  meetings: Meeting[];
  documents: CbDocument[];
  dots?: DotPlot;
  /** 받지 못한 출처와 이유 */
  errors: string[];
  fresh: Freshness;
}

// ── CSDR 국가 신용등급(근사: 수동 관리 표) ──

export interface SovereignRating {
  iso: string;
  country: string;
  sp?: string;
  moodys?: string;
  fitch?: string;
  /** 사용자가 고친 날(YYYY-MM-DD). 없으면 앱에 넣어 둔 값 */
  editedAt?: string;
}

/** 앱에 넣어 둔 장기 외화 등급. 무료 API가 없어 손으로 관리해요(바뀐 등급은 화면에서 고쳐요) */
export const RATINGS_AS_OF = '2025-12';
export const DEFAULT_RATINGS: SovereignRating[] = [
  { iso: 'US', country: '미국', sp: 'AA+', moodys: 'Aa1', fitch: 'AA+' },
  { iso: 'KR', country: '한국', sp: 'AA', moodys: 'Aa2', fitch: 'AA-' },
  { iso: 'JP', country: '일본', sp: 'A+', moodys: 'A1', fitch: 'A' },
  { iso: 'CN', country: '중국', sp: 'A+', moodys: 'A1', fitch: 'A' },
  { iso: 'DE', country: '독일', sp: 'AAA', moodys: 'Aaa', fitch: 'AAA' },
  { iso: 'GB', country: '영국', sp: 'AA', moodys: 'Aa3', fitch: 'AA-' },
  { iso: 'FR', country: '프랑스', sp: 'A+', moodys: 'Aa3', fitch: 'A+' },
  { iso: 'IT', country: '이탈리아', sp: 'BBB+', moodys: 'Baa2', fitch: 'BBB+' },
  { iso: 'ES', country: '스페인', sp: 'A+', moodys: 'A3', fitch: 'A' },
  { iso: 'CA', country: '캐나다', sp: 'AAA', moodys: 'Aaa', fitch: 'AA+' },
  { iso: 'AU', country: '호주', sp: 'AAA', moodys: 'Aaa', fitch: 'AAA' },
  { iso: 'CH', country: '스위스', sp: 'AAA', moodys: 'Aaa', fitch: 'AAA' },
  { iso: 'IN', country: '인도', sp: 'BBB', moodys: 'Baa3', fitch: 'BBB-' },
  { iso: 'BR', country: '브라질', sp: 'BB', moodys: 'Ba1', fitch: 'BB' },
  { iso: 'MX', country: '멕시코', sp: 'BBB', moodys: 'Baa2', fitch: 'BBB-' },
];

const SP_SCALE = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
const MOODYS_SCALE = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'];

/** 등급 → 단계(0 = 최고). S&P·피치와 무디스를 같은 자로 맞춰요. 모르는 값은 undefined */
export function ratingNotch(r: string | undefined): number | undefined {
  if (!r) return undefined;
  const t = r.trim();
  const i = SP_SCALE.indexOf(t.toUpperCase());
  if (i >= 0) return i;
  const j = MOODYS_SCALE.findIndex((x) => x.toLowerCase() === t.toLowerCase());
  return j >= 0 ? j : undefined;
}

/** 투자등급(BBB-·Baa3 이상)인지 */
export const isInvestmentGrade = (r: string | undefined) => {
  const n = ratingNotch(r);
  return n === undefined ? undefined : n <= 9;
};
