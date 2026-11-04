// v0.4 DART 종목 정보(08 §2.3·2.5): MGMT 경영진, RELS 관계사(타법인 출자), HDS 보유자, OWN 내부자 매매, ERN 실적 이력, CF 공시 검색.
// 국내 주식만(OpenDART). 정기보고서 주요정보는 가장 최근 보고서(분기·반기·사업)에서 가져와요.

import type { Freshness } from './freshness';

/** 정기보고서 코드: 1분기 11013, 반기 11012, 3분기 11014, 사업 11011 */
export const DART_REPORTS: Record<string, string> = { '11013': '1분기보고서', '11012': '반기보고서', '11014': '3분기보고서', '11011': '사업보고서' };

export interface DartPeriod {
  year: number;
  reprt: string;
  /** '2026 3분기보고서' */
  label: string;
}

export interface Executive {
  name: string;
  position: string;
  /** 등기임원·미등기임원 */
  registered?: string;
  fullTime?: string;
  duty?: string;
  career?: string;
  tenure?: string;
  gender?: string;
  birth?: string;
  /** 최대주주와의 관계 */
  relation?: string;
}

export interface MgmtResponse {
  id: string;
  period?: DartPeriod;
  executives: Executive[];
  /** 임원 전체 보수(구분별 인원·총액·1인 평균, 원) */
  pay: Array<{ group: string; count?: number; total?: number; avg?: number }>;
  /** 5억 원 이상 개인별 보수 */
  topPay: Array<{ name: string; position?: string; total?: number }>;
  fresh: Freshness;
}

export interface RelsRow {
  name: string;
  purpose?: string;
  firstAcq?: string;
  shares?: number;
  /** 지분율(%) */
  pct?: number;
  /** 장부가액(원) */
  book?: number;
  /** 피출자회사 최근 사업연도 총자산·당기순이익(원) */
  assets?: number;
  netIncome?: number;
}

export interface RelsResponse {
  id: string;
  period?: DartPeriod;
  rows: RelsRow[];
  fresh: Freshness;
}

export interface HoldersResponse {
  id: string;
  period?: DartPeriod;
  /** 최대주주와 특수관계인(기말) */
  largest: Array<{ name: string; relation?: string; kind?: string; shares?: number; pct?: number; sharesStart?: number; pctStart?: number }>;
  /** 5% 대량보유 보고(최근 먼저) */
  major: Array<{ date: string; reporter: string; shares?: number; pct?: number; chgShares?: number; chgPct?: number; reason?: string; url: string }>;
  /** 임원·주요주주 소유 보고(최근 먼저). OWN이 주가 차트에 표시해요 */
  insiders: InsiderRow[];
  fresh: Freshness;
}

export interface InsiderRow {
  date: string;
  reporter: string;
  /** 등기·비등기 임원 */
  registered?: string;
  position?: string;
  /** 주요주주 여부 */
  mainHolder?: string;
  shares?: number;
  /** 증감 주식 수(+ 매수, − 매도) */
  change?: number;
  pct?: number;
  url: string;
}

export interface DisclosureRow {
  date: string;
  corp: string;
  code?: string;
  title: string;
  filer?: string;
  url: string;
  /** 비고(유: 코스닥, 연: 연결 등) */
  rm?: string;
}

/** CF 공시 종류(OpenDART pblntf_ty) */
export const DISCLOSURE_TYPES: Array<{ code: string; label: string }> = [
  { code: '', label: '전체' },
  { code: 'A', label: '정기' },
  { code: 'B', label: '주요사항' },
  { code: 'C', label: '발행' },
  { code: 'D', label: '지분' },
  { code: 'E', label: '기타' },
  { code: 'I', label: '거래소' },
  { code: 'F', label: '감사' },
  { code: 'J', label: '공정위' },
];

export interface DisclosureResponse {
  id?: string;
  type: string;
  rows: DisclosureRow[];
  fresh: Freshness;
}

/** ERN: 실적 발표(잠정실적 공시) 한 줄과 그 분기 실적·발표일 주가 반응 */
export interface EarningsRow {
  date: string;
  title: string;
  url: string;
  /** 발표한 분기('2026Q3') */
  quarter?: string;
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
  /** 전년 같은 분기 대비(%) */
  revenueYoY?: number;
  operatingYoY?: number;
  /** 발표일 종가의 전일 대비(%)와 다음 날까지(%) */
  reaction1d?: number;
  reaction2d?: number;
}

export interface EarningsResponse {
  id: string;
  rows: EarningsRow[];
  fresh: Freshness;
  note?: string;
}

/** 발표일 → 그 발표가 다루는 분기(발표일 전날까지 끝난 가장 최근 분기) */
export function quarterBefore(dateIso: string): string {
  const [y, m] = dateIso.split('-').map(Number);
  // 1~3월 발표 → 전년 4분기, 4~6월 → 1분기, 7~9월 → 2분기, 10~12월 → 3분기
  const q = Math.floor((m - 1) / 3);
  return q === 0 ? `${y - 1}Q4` : `${y}Q${q}`;
}

/** OpenDART 숫자 칸('1,234', '-', '') */
export function dartNum(v: unknown): number | undefined {
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (t === '' || t === '-') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
