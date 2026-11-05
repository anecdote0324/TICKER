// v0.4 실적·기업행위(08 §2.3·2.5·2.6): EE 실적 추정치, ANR 투자의견·목표가, DVD 배당, CACS 기업행위, IPO 공모, EVTS 이벤트 캘린더.
// 국내는 한국투자증권 종목추정실적·종목투자의견과 예탁원 정보(ksdinfo)예요.

import type { Freshness } from './freshness';

/** EE: 한국투자증권 종목추정실적. 화면 라벨은 "KIS 제공 추정"(컨센서스라고 쓰지 않아요) */
export interface EstimateResponse {
  id: string;
  /** 열 머리(결산년월, 예: '2025.12', 'E'가 붙으면 추정) */
  periods: string[];
  /** 추정손익: 매출액·증감률·영업이익·증감률·순이익·증감률 */
  income: Array<{ label: string; values: Array<number | null>; pct?: boolean }>;
  /** 투자지표: EBITDA·EPS·증감률·PER·EV/EBITDA·ROE·부채비율·이자보상배율 */
  indicators: Array<{ label: string; values: Array<number | null>; pct?: boolean }>;
  fresh: Freshness;
  note?: string;
}

/** 종목추정실적 output2(6줄)·output3(8줄)의 줄 이름. 한국투자증권 API 문서의 순서예요 */
export const ESTIMATE_INCOME_LABELS = ['매출액', '매출액 증감률', '영업이익', '영업이익 증감률', '순이익', '순이익 증감률'];
export const ESTIMATE_INDICATOR_LABELS = ['EBITDA', 'EPS', 'EPS 증감률', 'PER', 'EV/EBITDA', 'ROE', '부채비율', '이자보상배율'];
/** 비율 줄(%·배)은 그대로, 나머지는 금액 */
export const ESTIMATE_PCT_LABELS = new Set(['매출액 증감률', '영업이익 증감률', '순이익 증감률', 'EPS 증감률', 'ROE', '부채비율']);

/** ANR: 증권사 투자의견 한 줄 */
export interface OpinionRow {
  date: string;
  broker?: string;
  opinion: string;
  prevOpinion?: string;
  target?: number;
  prevClose?: number;
  /** 목표가 대비 괴리율(%) */
  gap?: number;
}

export interface OpinionResponse {
  id: string;
  /** 최근 먼저(최근 1년) */
  rows: OpinionRow[];
  /** 최근 3개월 증권사별 마지막 의견 기준 */
  summary: { brokers: number; avgTarget?: number; maxTarget?: number; minTarget?: number; buy: number; hold: number; sell: number };
  fresh: Freshness;
}

/** 의견 문자열 → 매수·중립·매도 */
export function opinionClass(op: string): 'buy' | 'hold' | 'sell' | undefined {
  const s = op.toUpperCase().replace(/\s/g, '');
  if (/매도|SELL|UNDERPERFORM|REDUCE|비중축소/.test(s)) return 'sell';
  if (/중립|HOLD|NEUTRAL|MARKETPERFORM|보유|시장수익률/.test(s)) return 'hold';
  if (/매수|BUY|OUTPERFORM|OVERWEIGHT|비중확대|TRADINGBUY/.test(s)) return 'buy';
  return undefined;
}

/** 최근 3개월 증권사별 마지막 의견으로 요약해요(증권사 이름이 없으면 줄마다 따로) */
export function opinionSummary(rows: OpinionRow[], todayIso: string): OpinionResponse['summary'] {
  const cutoff = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 92 * 86400_000).toISOString().slice(0, 10);
  const latest = new Map<string, OpinionRow>();
  rows
    .filter((r) => r.date >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((r, i) => {
      const k = r.broker || `#${i}`;
      if (!latest.has(k)) latest.set(k, r);
    });
  const list = [...latest.values()];
  const targets = list.map((r) => r.target).filter((v): v is number => v !== undefined && v > 0);
  const cls = list.map((r) => opinionClass(r.opinion));
  return {
    brokers: list.length,
    avgTarget: targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : undefined,
    maxTarget: targets.length ? Math.max(...targets) : undefined,
    minTarget: targets.length ? Math.min(...targets) : undefined,
    buy: cls.filter((c) => c === 'buy').length,
    hold: cls.filter((c) => c === 'hold').length,
    sell: cls.filter((c) => c === 'sell').length,
  };
}

/** DVD: 배당 한 줄 */
export interface DividendRow {
  /** 기준일 YYYY-MM-DD */
  recordDate: string;
  /** 결산·중간·분기 */
  kind: string;
  /** 주당 현금배당(원) */
  cash?: number;
  /** 현금배당률(액면 대비 %) */
  cashRate?: number;
  /** 주식배당률(%) */
  stockRate?: number;
  payDate?: string;
  stockKind?: string;
  /** 기준일 종가 대비 시가배당률(%, 종가를 알 때) */
  yieldPct?: number;
}

export interface DividendResponse {
  id: string;
  /** 'KRW' 국내(예탁원), 'USD' 미국(한국투자증권 해외 권리) */
  currency?: string;
  rows: DividendRow[];
  /** 최근 1년 주당 배당 합과 지금 가격 기준 배당수익률 */
  trailing?: { cash: number; yieldPct?: number };
  fresh: Freshness;
}

/** CACS·EVTS: 기업 이벤트 */
export type CorpEventType = 'dividend' | 'paidin' | 'bonus' | 'capdcrs' | 'merger' | 'revsplit' | 'deposit' | 'meeting' | 'ipo' | 'listing' | 'ir' | 'earnings';

export const CORP_EVENT_LABEL: Record<CorpEventType, string> = {
  dividend: '배당 기준일',
  paidin: '유상증자',
  bonus: '무상증자',
  capdcrs: '감자',
  merger: '합병·분할',
  revsplit: '액면 변경',
  deposit: '의무보유(보호예수)',
  meeting: '주주총회',
  ipo: '공모 청약',
  listing: '신규 상장',
  ir: 'IR(기업설명회) 공시',
  earnings: '실적 발표(잠정)',
};

export interface CorpEvent {
  /** YYYY-MM-DD */
  date: string;
  type: CorpEventType;
  code: string;
  name?: string;
  /** 한 줄 설명(배정률, 공모가, 주총 사유 등) */
  detail?: string;
  /** 원문(DART 공시 뷰어) */
  url?: string;
}

export interface CorpEventsResponse {
  /** 종목을 주면 그 종목만(지난 2년~앞으로 1년), 없으면 시장 전체(지난 7일~앞으로 30일) */
  id?: string;
  /** 날짜 순(종목은 최근 먼저, 시장은 가까운 날 먼저) */
  events: CorpEvent[];
  fresh: Freshness;
  errors?: string[];
}

/** IPO: 공모 한 줄 */
export interface IpoRow {
  code: string;
  name?: string;
  /** 공모가(원) */
  price?: number;
  /** 청약 시작·끝(YYYY-MM-DD) */
  subscrFrom?: string;
  subscrTo?: string;
  payDate?: string;
  listDate?: string;
  leadMgr?: string;
  /** 상장 뒤 지금 가격(상장했으면) */
  last?: number;
  /** 공모가 대비 수익률(%) */
  returnPct?: number;
}

export interface IpoResponse {
  rows: IpoRow[];
  fresh: Freshness;
}

/** 'YYYYMMDD', 'YYYY/MM/DD', 'YYYY.MM.DD' → 'YYYY-MM-DD'(없으면 undefined) */
export function ksdDate(v: unknown): string | undefined {
  const m = /(\d{4})[./-]?(\d{2})[./-]?(\d{2})/.exec(String(v ?? ''));
  if (!m || m[1] === '0000') return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** '2024.03.13~2024.03.14' 같은 기간 → [시작, 끝] */
export function ksdRange(v: unknown): [string | undefined, string | undefined] {
  const parts = String(v ?? '').split(/~|-(?=\d{4})/);
  const a = ksdDate(parts[0]);
  const b = ksdDate(parts[1] ?? parts[0]);
  return [a, b ?? a];
}
