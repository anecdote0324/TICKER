// HMAP 업종 히트맵·IMAP 업종 타일(03 v0.2)과 공용 업종 분류(08 §4.2).

import type { Freshness } from './freshness';

/** 업종을 볼 지수. KOSPI2는 코스피200 */
export type SectorIndex = 'KOSPI' | 'KOSDAQ' | 'KOSPI2';

/** HMAP·IMAP 인자: 코스피(기본)·코스닥·코스피200. KS·KQ도 받아요 */
export const SECTOR_INDEXES: Array<{ code: SectorIndex; label: string; aliases: string[] }> = [
  { code: 'KOSPI', label: '코스피', aliases: ['KS'] },
  { code: 'KOSDAQ', label: '코스닥', aliases: ['KQ'] },
  { code: 'KOSPI2', label: '코스피200', aliases: ['KOSPI200', 'K200'] },
];

export interface SectorMember {
  id: string;
  code: string;
  name: string;
  /** 시가총액(원). 시세가 있으면 현재가 × 상장주식수, 없으면 종목 마스터(전일) */
  mcap: number;
  last?: number;
  changePct?: number;
  turnover?: number;
}

export interface SectorRow {
  /** 업종 지수 코드(0013 전기·전자, 2013 코스피200 정보기술) */
  code: string;
  name: string;
  /** 업종 지수의 오늘 등락률(한국투자증권 업종 지수) */
  changePct?: number;
  last?: number;
  turnover?: number;
  /** 업종 종목 시가총액 합(원) */
  mcap: number;
  /** 종목 수(지수 안 전체) */
  count: number;
  /** 타일에 그릴 종목(시가총액 큰 순). 코스피·코스닥은 시가총액 상위 200종목 안에서만 */
  members: SectorMember[];
}

export interface SectorMapResponse {
  index: SectorIndex;
  sectors: SectorRow[];
  fresh?: Freshness;
  /** 등락을 받지 못한 이유(키 없음 등). 업종과 종목 배치는 종목 마스터로 그려요 */
  liveError?: string;
  /** 종목 마스터 날짜 */
  asOf?: string;
}

/** HMAP 기간별 등락: 업종 지수 일봉 종가(오래된 것부터) */
export interface SectorHistoryResponse {
  index: SectorIndex;
  rows: Array<{ code: string; name: string; closes: Array<{ t: number; c: number }> }>;
  fresh?: Freshness;
  error?: string;
}
