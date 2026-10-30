// 차트의 기간 버튼과 보여 줄 봉 수(GP·GIP). 화면 코드와 떼어 테스트해요.

import type { Bar, BarInterval } from '@bt/shared';

/** GP 기간 버튼: 그 기간의 일봉 수(주봉·월봉은 나눠서 써요) */
export const GP_RANGES: Record<string, number> = { '1M': 21, '3M': 63, '6M': 126, '1Y': 250, MAX: Infinity };
/** GIP 기간 버튼(보이는 기간이에요. 봉 크기가 아니에요): 그 기간의 초. 1D는 가장 최근 장(24시간 시장은 최근 24시간) */
export const GIP_RANGES: Record<string, number> = { '1H': 3600, '4H': 4 * 3600, '1D': 24 * 3600, MAX: Infinity };
/** GIP 봉 크기(분). 받은 1분봉을 묶어서 만들어요 */
export const GIP_MINUTES = [1, 5, 15, 60] as const;
export const GIP_MINUTES_DEFAULT = 1;
export const GP_DEFAULT = '3M';
export const GIP_DEFAULT = '4H';
/** 분봉 사이가 이만큼 비면 다른 장(날)으로 봐요 */
const SESSION_GAP = 2 * 3600;
/** 오른쪽 끝의 여백(봉 수) */
export const RIGHT_PAD = 2;

/**
 * 1분봉을 N분봉으로 묶어요. 시각 경계(한국 시간 정각·15분·5분)에 맞추고, 시가는 처음·종가는 마지막 봉, 거래량은 더해요.
 * 60분봉이면 미국 장 첫 봉은 09:00~10:00(뉴욕) 칸에 09:30~09:59가 들어가요
 */
export function aggregateBars(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return bars;
  const size = minutes * 60;
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / size) * size;
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

/** 기간 버튼에 맞춰 보여 줄 봉 수. minutes는 GIP 봉 크기(분) */
export function visibleBarCount(bars: Array<{ t: number }>, intraday: boolean, interval: BarInterval, range: string, minutes = 1): number {
  if (bars.length === 0) return 0;
  if (!intraday) {
    const days = GP_RANGES[range] ?? GP_RANGES[GP_DEFAULT];
    const per = interval === '1w' ? 5 : interval === '1M' ? 21 : 1;
    return Math.max(1, Math.min(bars.length, Math.ceil(days / per)));
  }
  const span = GIP_RANGES[range] ?? GIP_RANGES[GIP_DEFAULT];
  if (span === Infinity) return bars.length;
  const last = bars[bars.length - 1].t;
  let i = bars.length - 1;
  // 시간으로 세요(거래가 드문 종목은 빈 분이 있어요). 1D는 장이 바뀌는 곳(긴 빈틈)에서 멈춰요
  while (i > 0 && last - bars[i - 1].t < span && (range !== '1D' || bars[i].t - bars[i - 1].t < SESSION_GAP)) i--;
  // 장이 막 열려 봉이 몇 개 없어도 너무 크게 보이지 않게 자리를 잡아요(1분봉 30개, 큰 봉은 8개)
  return Math.max(Math.max(8, Math.ceil(30 / minutes)), bars.length - i);
}
