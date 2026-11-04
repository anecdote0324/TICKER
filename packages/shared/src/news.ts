// N 뉴스·공시(03 v0.2): RSS 헤드라인과 DART 공시. 서버가 뉴스 아카이브에 쌓은 것을 화면이 읽어요.

import type { Freshness } from './freshness';

export interface NewsItem {
  id: string;
  kind: 'news' | 'disclosure';
  /** 줄에 붙는 짧은 출처 이름: 연합, 한경, MarketWatch, DART */
  source: string;
  sourceId: string;
  lang: 'ko' | 'en';
  title: string;
  /** 원문(기사·DART 공시 뷰어) 주소 */
  url: string;
  /** 시각(ms) */
  published: number;
  /** 날짜만 알 때(DART의 지난 공시) */
  dateOnly?: boolean;
  /** 공시 회사 */
  corpName?: string;
  stockCode?: string;
}

export interface NewsSourceStatus {
  id: string;
  name: string;
  kind: 'news' | 'disclosure';
  ok?: boolean;
  /** 마지막으로 받은 시각(ms) */
  at?: number;
  error?: string;
  /** 마지막에 받은 줄 수 */
  count?: number;
}

export interface NewsResponse {
  items: NewsItem[];
  fresh: Freshness;
  /** 종목으로 걸렀는지 */
  filtered: boolean;
  /** DART 인증키 */
  dart: 'on' | 'off';
  sources: NewsSourceStatus[];
  /** 아카이브에 쌓인 전체 줄 수 */
  archived: number;
}

// ── v0.4 뉴스 보기(TOP·NI·NSE·FIRS) ──

/** TOP: 여러 출처가 같이 다룬 헤드라인을 한 줄로 묶고 점수를 매겨요 */
export interface TopNewsItem extends NewsItem {
  score: number;
  /** 같은 이야기를 다룬 다른 줄 수와 출처 */
  dupes: number;
  otherSources: string[];
}

export interface NewsViewResponse {
  items: NewsItem[];
  fresh: Freshness;
  archived: number;
  /** 검색이면 찾은 수(아카이브 전체에서) */
  total?: number;
}

export interface TopNewsResponse {
  items: TopNewsItem[];
  fresh: Freshness;
  archived: number;
}

/** NI 주제: 제목에 이 말이 들어가면 그 주제예요(대소문자 무시) */
export const NEWS_TOPICS: Array<{ code: string; label: string; pattern: string }> = [
  { code: 'earnings', label: '실적', pattern: '실적|어닝|영업이익|매출액|순이익|흑자|적자|earnings|revenue|profit|guidance|EPS' },
  { code: 'rates', label: '금리·채권', pattern: '금리|국채|채권|국고채|연준|기준금리|금통위|FOMC|Fed|yield|bond|Treasur' },
  { code: 'fx', label: '환율', pattern: '환율|달러|원화|엔화|위안|dollar|currenc|forex|yen' },
  { code: 'semis', label: '반도체', pattern: '반도체|HBM|메모리|D램|낸드|파운드리|chip|semiconductor|Nvidia|엔비디아|TSMC' },
  { code: 'battery', label: '2차전지', pattern: '배터리|2차전지|이차전지|양극재|음극재|리튬|battery|lithium' },
  { code: 'bio', label: '바이오', pattern: '바이오|제약|신약|임상|FDA|biotech|pharma|drug' },
  { code: 'commodities', label: '원자재', pattern: '유가|원유|금값|금 가격|구리|천연가스|oil|crude|gold|copper|OPEC|commodit' },
  { code: 'crypto', label: '코인', pattern: '비트코인|가상자산|암호화폐|코인|이더리움|bitcoin|crypto|ether|stablecoin' },
  { code: 'realestate', label: '부동산', pattern: '부동산|아파트|주택|분양|전세|real estate|housing|mortgage' },
  { code: 'ma', label: 'M&A', pattern: '인수|합병|M&A|매각|경영권|공개매수|acquisition|acquire|merger|takeover|buyout' },
  { code: 'policy', label: '정책·관세', pattern: '정부|규제|정책|법안|관세|세제|tariff|regulation|policy|sanction' },
  { code: 'ipo', label: '공모·상장', pattern: '공모|상장|IPO|청약|listing' },
];

/** FIRS 속보: 제목에 이 말이 있으면 속보로 봐요 */
export const BREAKING_PATTERN = '속보|\\[1보\\]|1보\\]|긴급|단독|breaking|urgent|just in|alert';
