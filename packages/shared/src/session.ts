// 종목의 장 상태(02 데이터 신선도 표시, 04 KIS). 화면은 '마감' 배지를, 서버는 실시간 구독과 조회 간격을 정할 때 써요.

import type { Instrument } from './instrument';
import { INDICES } from './static-instruments';
import { EXCHANGES, lastRegularClose, sessionState, type SessionState } from './time';

/** 장 시간 판정에 쓰는 거래소(EXCHANGES의 키). 코인·환율은 없어요 */
export function exchangeOf(inst: Instrument): string | undefined {
  if (inst.assetClass === 'EQUITY') return inst.market === 'US' ? 'US' : 'KRX';
  if (inst.assetClass === 'INDEX') return INDICES.find((d) => d.code === inst.code)?.exchange ?? inst.exchange;
  return undefined;
}

export function instrumentSession(inst: Instrument | undefined, now: number): SessionState | undefined {
  if (!inst) return undefined;
  const ex = exchangeOf(inst);
  const hours = ex ? EXCHANGES[ex] : undefined;
  return hours ? sessionState(hours, now) : undefined;
}

/** 값이 움직이는 시간인지: 정규장, 미국 주식은 프리·애프터마켓도. 코인은 늘 열려 있고, 환율은 일별 값이라 판단하지 않아요 */
export function tradingNow(inst: Instrument | undefined, now: number): boolean | undefined {
  if (!inst) return undefined;
  if (inst.assetClass === 'CRYPTO') return true;
  const s = instrumentSession(inst, now);
  if (!s) return undefined;
  return s === 'open' || (inst.assetClass === 'EQUITY' && inst.market === 'US' && s !== 'closed');
}

/**
 * 이 시각의 체결로 분봉을 만들어도 되는지: 값이 움직이는 시간이거나 정규장이 막 끝난 1분 안(국내 종가 단일가).
 * 장이 닫힌 뒤 조회한 값이나 정규장 밖의 이상한 봉은 분봉에 넣지 않아요. 판단할 수 없는 종목(환율)은 참이에요
 */
export function intradayAt(inst: Instrument, at: number): boolean {
  const open = tradingNow(inst, at);
  if (open !== false) return true;
  const ex = exchangeOf(inst);
  const hours = ex ? EXCHANGES[ex] : undefined;
  return !!hours && at - lastRegularClose(hours, at) < 60_000;
}
