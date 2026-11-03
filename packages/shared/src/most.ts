// MOST 상위 종목(03 v0.2): 시장 하나의 거래량·거래대금·상승률·하락률 상위.

import type { Freshness } from './freshness';

export type MostKind = 'volume' | 'turnover' | 'gainers' | 'losers';

export const MOST_KINDS: Array<{ code: MostKind; label: string }> = [
  { code: 'volume', label: '거래량' },
  { code: 'turnover', label: '거래대금' },
  { code: 'gainers', label: '상승률' },
  { code: 'losers', label: '하락률' },
];

export interface MostRow {
  rank: number;
  /** 종목 목록에 있으면 그 id(누르면 연동 그룹이 그 종목으로 바뀌어요) */
  id?: string;
  code: string;
  name: string;
  last: number;
  change?: number;
  changePct: number;
  volume?: number;
  turnover?: number;
}

export interface MostResponse {
  market: string;
  kind: MostKind;
  /** 가격 통화: KRW, USD, USDT */
  currency: string;
  rows: MostRow[];
  fresh: Freshness;
  /** 표 아래에 적는 출처·조건 */
  note?: string;
}
