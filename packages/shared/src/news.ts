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
