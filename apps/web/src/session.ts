// 종목의 장 상태: 실시간 값에 '마감'을 붙일지 정해요(02 데이터 신선도 표시). 판정은 서버와 같은 shared의 것을 써요.

import { instrumentSession, tradingNow, type SourceId, type SourceStatus } from '@bt/shared';

export const instSession = instrumentSession;

/** 장이 열려 있는지. 코인은 늘 열려 있고, 환율은 일별 값이라 판단하지 않아요 */
export const sessionOpen = tradingNow;

export function sourceConnected(sources: SourceStatus[], id: SourceId): boolean | undefined {
  const s = sources.find((x) => x.source === id);
  if (!s) return undefined;
  return s.state === 'connected';
}
