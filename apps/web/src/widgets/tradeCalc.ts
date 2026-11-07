// HP·AQR·VAP 계산(화면 없이 시험할 수 있게 따로 둬요).

import { formatYmd, type Bar, type Instrument } from '@bt/shared';

export type HpRow = Bar & { changePct?: number };

/** 봉마다 앞 봉 종가 대비 등락률. bars는 오래된 것부터 */
export function withChange(bars: Bar[]): HpRow[] {
  return bars.map((b, i) => {
    const prev = bars[i - 1]?.c;
    return { ...b, changePct: prev ? (b.c / prev - 1) * 100 : undefined };
  });
}

/** 마지막 거래 세션의 봉만: 마지막 봉부터 거꾸로, 앞 봉과 3시간 넘게 떨어진 곳에서 끊어요(미국 장은 한국 날짜를 넘어가서 날짜로 자르지 않아요) */
export function lastSession(bars: Bar[], gapSec = 3 * 3600): Bar[] {
  if (!bars.length) return [];
  let i = bars.length - 1;
  while (i > 0 && bars[i].t - bars[i - 1].t <= gapSec) i--;
  return bars.slice(i);
}

const csvCell = (v: string | number | undefined) => {
  if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** HP 표 → CSV(머리줄 한국어). rows는 표 순서(최신 먼저) 그대로 */
export function hpCsv(rows: HpRow[], inst: Pick<Instrument, 'code' | 'nameKo' | 'nameEn'>): string {
  const name = inst.nameKo || inst.nameEn || inst.code;
  const lines = [['종목코드', '종목명', '날짜', '시가', '고가', '저가', '종가', '등락률(%)', '거래량'].join(',')];
  for (const r of rows) {
    lines.push([inst.code, name, formatYmd(r.t * 1000), r.o, r.h, r.l, r.c, r.changePct === undefined ? undefined : Number(r.changePct.toFixed(4)), r.v].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** 파일 이름은 영문·숫자만(운영체제마다 한글 이름이 깨지지 않게): HP_005930_1d_20261107.csv */
export function hpFileName(inst: Pick<Instrument, 'code'>, interval: string, now: number): string {
  const code = inst.code.replace(/[^A-Za-z0-9.-]/g, '_');
  const iv = interval === '1M' ? '1mo' : interval;
  return `HP_${code}_${iv}_${formatYmd(now).replace(/-/g, '')}.csv`;
}
