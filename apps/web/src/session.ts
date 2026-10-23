// 종목의 장 상태: 실시간 값에 '마감'을 붙일지 정해요(02 데이터 신선도 표시).

import { EXCHANGES, INDICES, sessionState, type Instrument, type SessionState, type SourceId, type SourceStatus } from '@bt/shared';

export function exchangeOf(inst: Instrument): string | undefined {
  if (inst.assetClass === 'EQUITY') return inst.market === 'US' ? 'US' : 'KRX';
  if (inst.assetClass === 'INDEX') return INDICES.find((d) => d.code === inst.code)?.exchange ?? inst.exchange;
  return undefined;
}

export function instSession(inst: Instrument | undefined, now: number): SessionState | undefined {
  if (!inst) return undefined;
  const ex = exchangeOf(inst);
  if (!ex) return undefined;
  const hours = EXCHANGES[ex];
  return hours ? sessionState(hours, now) : undefined;
}

/** 장이 열려 있는지. 코인은 늘 열려 있고, 환율은 일별 값이라 판단하지 않아요 */
export function sessionOpen(inst: Instrument | undefined, now: number): boolean | undefined {
  if (!inst) return undefined;
  if (inst.assetClass === 'CRYPTO') return true;
  const s = instSession(inst, now);
  if (!s) return undefined;
  return s === 'open' || (inst.market === 'US' && (s === 'pre' || s === 'post'));
}

export function sourceConnected(sources: SourceStatus[], id: SourceId): boolean | undefined {
  const s = sources.find((x) => x.source === id);
  if (!s) return undefined;
  return s.state === 'connected';
}
