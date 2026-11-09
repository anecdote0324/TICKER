// v0.6 매크로: ECOD 지표 상세, ECST 경제 통계, ECOF 지표 찾기, ECMX 세계 경제 매트릭스, IFMO 인플레이션 모니터,
// ECO 한국 발표 일정(국가데이터처 보도계획·한국은행 통계공표일정).
// 시계열 id: 'FRED:<시계열>', 'ECOS:<표>/<주기>/<항목>', 'KOSIS:<사용자 번호>'

import type { Freshness } from './freshness';

export type MacroTransform = 'level' | 'yoy' | 'mom' | 'diff' | 'yoyDiff';
export type MacroFreq = 'D' | 'W' | 'M' | 'Q' | 'A';
export type MacroGroup = '성장' | '물가' | '고용' | '대외' | '심리' | '기대인플레';

export interface MacroSeriesDef {
  id: string;
  name: string;
  country: 'US' | 'KR' | 'EU';
  group: MacroGroup;
  transform: MacroTransform;
  freq: MacroFreq;
  unit: string;
  digits?: number;
  /** 값에 곱할 수(단위 바꾸기) */
  scale?: number;
}

export const TRANSFORM_LABEL: Record<MacroTransform, string> = { level: '수준', yoy: '전년 대비 %', mom: '전기 대비 %', diff: '전기 대비 증감', yoyDiff: '전년 대비 증감' };

/** 앱에 넣어 둔 지표. ECOS 항목 코드는 StatisticItemList(sample 키)로 이름을 확인했어요(2026-11) */
export const MACRO_SERIES: MacroSeriesDef[] = [
  // 미국(FRED)
  { id: 'FRED:A191RL1Q225SBEA', name: '실질 GDP 성장률(전기 대비 연율)', country: 'US', group: '성장', transform: 'level', freq: 'Q', unit: '%', digits: 1 },
  { id: 'FRED:INDPRO', name: '산업생산', country: 'US', group: '성장', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:RSAFS', name: '소매판매', country: 'US', group: '성장', transform: 'mom', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:CPIAUCSL', name: 'CPI 소비자물가', country: 'US', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:CPILFESL', name: '근원 CPI(식품·에너지 제외)', country: 'US', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:PCEPI', name: 'PCE 물가', country: 'US', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:PCEPILFE', name: '근원 PCE 물가', country: 'US', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:PPIFIS', name: 'PPI 생산자물가(최종 수요)', country: 'US', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:UNRATE', name: '실업률', country: 'US', group: '고용', transform: 'level', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:PAYEMS', name: '비농업 고용', country: 'US', group: '고용', transform: 'diff', freq: 'M', unit: '천 명', digits: 0 },
  { id: 'FRED:ICSA', name: '신규 실업수당 청구', country: 'US', group: '고용', transform: 'level', freq: 'W', unit: '천 건', digits: 0, scale: 1 / 1000 },
  { id: 'FRED:BOPGSTB', name: '무역수지(상품·서비스)', country: 'US', group: '대외', transform: 'level', freq: 'M', unit: '억 달러', digits: 0, scale: 1 / 100 },
  { id: 'FRED:UMCSENT', name: '미시간대 소비자심리', country: 'US', group: '심리', transform: 'level', freq: 'M', unit: '', digits: 1 },
  { id: 'FRED:MICH', name: '미시간대 1년 기대인플레', country: 'US', group: '기대인플레', transform: 'level', freq: 'M', unit: '%', digits: 1 },
  { id: 'FRED:T5YIE', name: 'BEI 5년(손익분기 인플레)', country: 'US', group: '기대인플레', transform: 'level', freq: 'D', unit: '%', digits: 2 },
  { id: 'FRED:T10YIE', name: 'BEI 10년', country: 'US', group: '기대인플레', transform: 'level', freq: 'D', unit: '%', digits: 2 },
  { id: 'FRED:T5YIFR', name: '5년 뒤 5년 기대인플레', country: 'US', group: '기대인플레', transform: 'level', freq: 'D', unit: '%', digits: 2 },
  { id: 'FRED:DFII10', name: '미국 실질금리 10년(TIPS)', country: 'US', group: '기대인플레', transform: 'level', freq: 'D', unit: '%', digits: 2 },
  // 유로(FRED)
  { id: 'FRED:CP0000EZ19M086NEST', name: '유로 HICP 소비자물가', country: 'EU', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  // 한국(ECOS)
  { id: 'ECOS:200Y102/Q/10111', name: '실질 GDP 성장률(전기 대비)', country: 'KR', group: '성장', transform: 'level', freq: 'Q', unit: '%', digits: 1 },
  { id: 'ECOS:901Y033/M/A00', name: '전산업생산', country: 'KR', group: '성장', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y009/M/0', name: '소비자물가', country: 'KR', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y010/M/QB', name: '근원물가(농산물·석유류 제외)', country: 'KR', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y010/M/DB', name: '근원물가(식료품·에너지 제외)', country: 'KR', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:404Y014/M/*AA', name: '생산자물가', country: 'KR', group: '물가', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y027/M/I61BC', name: '실업률', country: 'KR', group: '고용', transform: 'level', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y027/M/I61BA', name: '취업자', country: 'KR', group: '고용', transform: 'yoyDiff', freq: 'M', unit: '천 명', digits: 0 },
  { id: 'ECOS:301Y013/M/000000', name: '경상수지', country: 'KR', group: '대외', transform: 'level', freq: 'M', unit: '억 달러', digits: 1, scale: 1 / 100 },
  { id: 'ECOS:901Y118/M/T002', name: '수출', country: 'KR', group: '대외', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:901Y118/M/T004', name: '수입', country: 'KR', group: '대외', transform: 'yoy', freq: 'M', unit: '%', digits: 1 },
  { id: 'ECOS:511Y002/M/FME', name: '소비자심리지수', country: 'KR', group: '심리', transform: 'level', freq: 'M', unit: '', digits: 1 },
  { id: 'ECOS:511Y003/M/FMB', name: '1년 기대인플레이션율', country: 'KR', group: '기대인플레', transform: 'level', freq: 'M', unit: '%', digits: 1 },
];

export const macroDef = (id: string) => MACRO_SERIES.find((d) => d.id === id);

export interface MacroObs {
  date: string;
  value: number;
}

export interface MacroSeries {
  id: string;
  /** 바꾼 값(전년 대비 등), 날짜순 */
  obs: MacroObs[];
  /** 원래 수준 값의 마지막 날짜 */
  lastDate?: string;
  /** 원천의 이름(검색으로 더한 시계열) */
  title?: string;
  units?: string;
}

export interface MacroResponse {
  series: MacroSeries[];
  missing: Array<{ id: string; reason: string }>;
  fresh: Freshness;
}

/** 주기마다 1년 앞 칸 수 */
const LAG: Record<MacroFreq, number> = { D: 260, W: 52, M: 12, Q: 4, A: 1 };

/** 수준 값 → 화면 값(전년 대비 등). 앞 칸이 모자라는 날은 빼요 */
export function applyTransform(raw: MacroObs[], transform: MacroTransform, freq: MacroFreq, scale = 1): MacroObs[] {
  const out: MacroObs[] = [];
  const lag = LAG[freq];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    let v: number | undefined;
    if (transform === 'level') v = p.value * scale;
    else if (transform === 'diff') v = i > 0 ? (p.value - raw[i - 1].value) * scale : undefined;
    else if (transform === 'mom') v = i > 0 && raw[i - 1].value ? (p.value / raw[i - 1].value - 1) * 100 : undefined;
    else if (transform === 'yoy') v = i >= lag && raw[i - lag].value ? (p.value / raw[i - lag].value - 1) * 100 : undefined;
    else v = i >= lag ? (p.value - raw[i - lag].value) * scale : undefined;
    if (v !== undefined && Number.isFinite(v)) out.push({ date: p.date, value: v });
  }
  return out;
}

/** ECOS 시점 문자열('202609', '2026Q3', '20261104', '2025') → YYYY-MM-DD(기간의 첫날) */
export function ecosTime(t: string): string {
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-01`;
  const q = t.match(/^(\d{4})Q([1-4])$/);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, '0')}-01`;
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  return t;
}

/** 화면에 보이는 기간: 월간 '2026-09', 분기 '2026 3분기', 그 밖에는 날짜 */
export function periodLabel(date: string, freq: MacroFreq): string {
  if (freq === 'M') return date.slice(0, 7);
  if (freq === 'Q') return `${date.slice(0, 4)} ${Math.floor(Number(date.slice(5, 7)) / 3) + 1}분기`;
  if (freq === 'A') return date.slice(0, 4);
  return date;
}

/** KOSIS 통계자료 응답(JSON 배열, 오류는 {err, errMsg}) → 항목별 시계열. jsonVD=Y가 아니면 따옴표 없는 키도 와요 */
export function parseKosis(text: string): { groups: Array<{ name: string; unit: string; freq: MacroFreq; obs: MacroObs[] }>; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    try {
      data = JSON.parse(text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'));
    } catch {
      return { groups: [], error: 'KOSIS 응답을 읽지 못했어요' };
    }
  }
  if (!Array.isArray(data)) {
    const e = data as { err?: string; errMsg?: string };
    return { groups: [], error: e?.errMsg ? `${e.errMsg}${e.err ? ` (${e.err})` : ''}` : 'KOSIS 응답에 자료가 없어요' };
  }
  const groups = new Map<string, { name: string; unit: string; freq: MacroFreq; obs: MacroObs[] }>();
  for (const r of data as Array<Record<string, string>>) {
    const v = Number(String(r.DT ?? '').replace(/,/g, ''));
    const prd = String(r.PRD_DE ?? '');
    if (!prd || !Number.isFinite(v) || r.DT === '' || r.DT === '-') continue;
    const name = [r.C1_NM, r.C2_NM, r.ITM_NM].filter(Boolean).join(' · ') || String(r.TBL_NM ?? 'KOSIS');
    const se = String(r.PRD_SE ?? '');
    const q = prd.match(/^(\d{4})(?:Q|0)?([1-4])$/);
    const freq: MacroFreq = se === 'Q' && q ? 'Q' : se === 'Y' || prd.length === 4 ? 'A' : se === 'D' || prd.length === 8 ? 'D' : 'M';
    const date = freq === 'Q' && q ? `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, '0')}-01` : ecosTime(prd);
    const g = groups.get(name) ?? { name, unit: String(r.UNIT_NM ?? ''), freq, obs: [] };
    g.obs.push({ date, value: v });
    groups.set(name, g);
  }
  for (const g of groups.values()) g.obs.sort((a, b) => a.date.localeCompare(b.date));
  return { groups: [...groups.values()] };
}

/** KOSIS 주소인지(apiKey는 서버가 넣어요). 다른 곳으로 요청을 보내지 않게 kosis.kr만 받아요 */
export function kosisUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'kosis.kr' && u.pathname.startsWith('/openapi/');
  } catch {
    return false;
  }
}

// ── ECO 한국 발표 일정 ──

export interface KrRelease {
  /** YYYY-MM-DD(한국 날짜) */
  date: string;
  /** HH:MM(한국 시간). 원천에 없으면 undefined */
  time?: string;
  title: string;
  source: 'MODS' | 'BOK';
}

/** 국가데이터처 보도계획 표(보도일자 "11.03.( 화 )", 보도시간, 보도자료명) → 통계 발표만("2026년 10월 소비자물가동향"처럼 연도로 시작) */
export function parseModsPlan(html: string, year: number): KrRelease[] {
  const i = html.indexOf('<tbody>', html.indexOf('보도일자'));
  if (i < 0) return [];
  const body = html.slice(i, html.indexOf('</tbody>', i));
  const out: KrRelease[] = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const d = cells[0]?.match(/(\d{1,2})\.(\d{1,2})\./);
    const title = cells[2] ?? '';
    // 행사·포상·세미나 같은 보도는 빼요
    if (!d || !/^\d{4}년/.test(title) || /개최|포상|세미나|간담회|회의|협약|업무협약|MOU/.test(title)) continue;
    const time = cells[1]?.match(/^(\d{1,2}):(\d{2})$/);
    out.push({ date: `${year}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`, time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : undefined, title, source: 'MODS' });
  }
  return out;
}

/** 한국은행 월간통계 공표일정 달력(칸마다 날짜와 통계 이름) → 발표 */
export function parseBokStatCalendar(html: string, year: number, month: number): KrRelease[] {
  const i = html.indexOf('<tbody>', html.indexOf('월간통계공표일정'));
  if (i < 0) return [];
  const body = html.slice(i, html.indexOf('</tbody>', i));
  const out: KrRelease[] = [];
  for (const td of body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const day = td[1].replace(/<ul[\s\S]*<\/ul>/, '').replace(/<[^>]+>/g, ' ').match(/\d{1,2}/)?.[0];
    if (!day) continue;
    for (const t of td[1].matchAll(/title='([^']+)'/g)) {
      out.push({ date: `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`, title: t[1].trim(), source: 'BOK' });
    }
  }
  return out;
}

/** 한국 발표 이름 → 앱 지표(최근 값·ECOD 연결) */
export const KR_RELEASE_SERIES: Array<{ match: RegExp; id: string; name: string }> = [
  { match: /소비자물가동향/, id: 'ECOS:901Y009/M/0', name: '소비자물가(전년 대비)' },
  { match: /고용동향/, id: 'ECOS:901Y027/M/I61BC', name: '고용동향(실업률)' },
  { match: /산업활동동향/, id: 'ECOS:901Y033/M/A00', name: '산업활동동향(전산업생산)' },
  { match: /생산자물가/, id: 'ECOS:404Y014/M/*AA', name: '생산자물가(전년 대비)' },
  { match: /국제수지/, id: 'ECOS:301Y013/M/000000', name: '국제수지(경상수지)' },
  { match: /국내총생산|국민소득/, id: 'ECOS:200Y102/Q/10111', name: 'GDP(실질, 전기 대비)' },
  { match: /소비자동향조사/, id: 'ECOS:511Y002/M/FME', name: '소비자동향조사(소비자심리지수)' },
];

/** 한국은행 발표 관례 시각(달력에는 시각이 없어요) */
export const BOK_USUAL_TIME: Array<{ match: RegExp; time: string }> = [
  { match: /국제수지|국내총생산|국민소득/, time: '08:00' },
  { match: /생산자물가|수출입물가|소비자동향|기업경기|경제심리/, time: '06:00' },
  { match: /통화 및 유동성/, time: '12:00' },
];

// ── ECMX 세계 경제 매트릭스(세계은행) ──

export const ECMX_INDICATORS: Array<{ code: string; name: string; unit: string; digits: number }> = [
  { code: 'NY.GDP.MKTP.KD.ZG', name: '실질 GDP 성장률', unit: '%', digits: 1 },
  { code: 'FP.CPI.TOTL.ZG', name: '소비자물가 상승률', unit: '%', digits: 1 },
  { code: 'SL.UEM.TOTL.ZS', name: '실업률', unit: '%', digits: 1 },
  { code: 'BN.CAB.XOKA.GD.ZS', name: '경상수지/GDP', unit: '%', digits: 1 },
  { code: 'GC.DOD.TOTL.GD.ZS', name: '정부 부채/GDP', unit: '%', digits: 0 },
  { code: 'NY.GDP.PCAP.CD', name: '1인당 GDP', unit: '달러', digits: 0 },
];

export const ECMX_COUNTRIES: Array<{ iso2: string; iso3: string; name: string }> = [
  { iso2: 'KR', iso3: 'KOR', name: '한국' },
  { iso2: 'US', iso3: 'USA', name: '미국' },
  { iso2: 'JP', iso3: 'JPN', name: '일본' },
  { iso2: 'CN', iso3: 'CHN', name: '중국' },
  { iso2: 'DE', iso3: 'DEU', name: '독일' },
  { iso2: 'GB', iso3: 'GBR', name: '영국' },
  { iso2: 'FR', iso3: 'FRA', name: '프랑스' },
  { iso2: 'IT', iso3: 'ITA', name: '이탈리아' },
  { iso2: 'CA', iso3: 'CAN', name: '캐나다' },
  { iso2: 'AU', iso3: 'AUS', name: '호주' },
  { iso2: 'IN', iso3: 'IND', name: '인도' },
  { iso2: 'BR', iso3: 'BRA', name: '브라질' },
  { iso2: 'MX', iso3: 'MEX', name: '멕시코' },
  { iso2: 'ID', iso3: 'IDN', name: '인도네시아' },
  { iso2: 'VN', iso3: 'VNM', name: '베트남' },
];

export interface MatrixCell {
  value: number;
  year: string;
  prev?: number;
}

export interface MatrixResponse {
  /** 지표 코드 → 나라(iso3) → 값 */
  cells: Record<string, Record<string, MatrixCell>>;
  errors: string[];
  fresh: Freshness;
}

// ── ECOF 지표 찾기 ──

export interface MacroSearchHit {
  /** ECOD로 열 수 있는 id(FRED:…), ECOS 통계표는 열 수 없어요 */
  id?: string;
  source: 'APP' | 'FRED' | 'ECOS';
  title: string;
  detail: string;
  /** 원천 페이지 */
  url?: string;
  popularity?: number;
}

export interface MacroSearchResponse {
  hits: MacroSearchHit[];
  missing: string[];
}

// ── ECOD 지표 상세(발표 이력·수정) ──

export interface VintageResponse {
  id: string;
  /** 바꾼 값: 첫 발표로 계산한 값(ALFRED 첫 발표 수준으로 다시 계산) */
  initial: MacroObs[];
  error?: string;
}
