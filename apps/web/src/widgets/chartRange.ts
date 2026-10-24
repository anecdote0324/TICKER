// 차트의 기간 버튼과 보여 줄 봉 수(GP·GIP). 화면 코드와 떼어 테스트해요.

import type { BarInterval } from '@bt/shared';

/** GP 기간 버튼: 그 기간의 일봉 수(주봉·월봉은 나눠서 써요) */
export const GP_RANGES: Record<string, number> = { '1M': 21, '3M': 63, '6M': 126, '1Y': 250, MAX: Infinity };
/** GIP 기간 버튼: 그 기간의 초. 1D는 가장 최근 장(24시간 시장은 최근 24시간) */
export const GIP_RANGES: Record<string, number> = { '1H': 3600, '4H': 4 * 3600, '1D': 24 * 3600, MAX: Infinity };
export const GP_DEFAULT = '3M';
export const GIP_DEFAULT = '4H';
/** 분봉 사이가 이만큼 비면 다른 장(날)으로 봐요 */
const SESSION_GAP = 2 * 3600;
/** 오른쪽 끝의 여백(봉 수) */
export const RIGHT_PAD = 2;

/** 기간 버튼에 맞춰 보여 줄 봉 수 */
export function visibleBarCount(bars: Array<{ t: number }>, intraday: boolean, interval: BarInterval, range: string): number {
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
  // 장이 막 열려 봉이 몇 개 없어도 너무 크게 보이지 않게 30개는 자리를 잡아요
  return Math.max(30, bars.length - i);
}
