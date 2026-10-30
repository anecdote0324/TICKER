// 종목의 장 상태(02 데이터 신선도 표시, 04 KIS). 화면은 '마감' 배지를, 서버는 실시간 구독과 조회 간격을 정할 때 써요.

import type { Instrument } from './instrument';
import type { Bar } from './market-data';
import { INDICES } from './static-instruments';
import { EXCHANGES, lastRegularClose, sessionState, zonedParts, type SessionState } from './time';

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

/** GP 시간봉(1·2·4시간)을 줄 수 있는 종목: 주식과 코인. 지수는 분봉 제공을 확인하지 못했고, 환율은 하루 한 번 값이에요 */
export function supportsHourBars(inst: Pick<Instrument, 'assetClass'>): boolean {
  return inst.assetClass === 'EQUITY' || inst.assetClass === 'CRYPTO';
}

/** t(초)가 속한 현지 날짜의 정규장 시작·끝(초)과 요일(0 = 일요일). 장 시간이 없는 종목(코인·환율)은 없어요 */
export function regularSessionOf(inst: Instrument, t: number): { open: number; close: number; weekday: number } | undefined {
  const ex = exchangeOf(inst);
  const hours = ex ? EXCHANGES[ex] : undefined;
  if (!hours) return undefined;
  const p = zonedParts(t * 1000, hours.timeZone);
  const midnight = t - (p.hour * 3600 + p.minute * 60 + p.second);
  return { open: midnight + hours.regular[0][0] * 60, close: midnight + hours.regular[hours.regular.length - 1][1] * 60, weekday: p.weekday };
}

/**
 * 봉 칸의 시작 시각(초). 주식·지수는 그날 정규장 시작에 맞추고(국내 09:00, 미국 09:30 뉴욕),
 * 코인처럼 장 시간이 없는 종목은 UTC 정각에 맞춰요(Binance의 4시간봉과 같아요: 한국 시간 09·13·17·21·01·05시).
 * 국내 2시간봉은 09·11·13·15시, 4시간봉은 09·13시에 시작해요
 */
export function bucketStart(inst: Instrument, t: number, minutes: number): number {
  const size = minutes * 60;
  const ex = exchangeOf(inst);
  const hours = ex ? EXCHANGES[ex] : undefined;
  if (!hours) return Math.floor(t / size) * size;
  const p = zonedParts(t * 1000, hours.timeZone);
  const sinceMidnight = p.hour * 3600 + p.minute * 60 + p.second;
  const open = hours.regular[0][0] * 60;
  return t - sinceMidnight + open + Math.floor((sinceMidnight - open) / size) * size;
}

/** 작은 봉(1분봉·1시간봉)을 큰 봉으로 묶어요. 시가는 처음, 종가는 마지막 봉, 거래량은 더해요. bars는 시각 순이어야 해요 */
export function aggregateBars(inst: Instrument, bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = bucketStart(inst, b.t, minutes);
    const cur = out[out.length - 1];
    if (cur && cur.t === t) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    } else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return out;
}
