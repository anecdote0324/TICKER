// 숫자 표기: 자릿수 폭이 같은 숫자를 오른쪽 정렬해서 값이 바뀌어도 흔들리지 않게 해요(02 원칙 4).

import type { Instrument } from '@bt/shared';

export function priceDigits(inst: Instrument | undefined, v: number | undefined): number {
  if (!inst || v === undefined) return 2;
  switch (inst.assetClass) {
    case 'EQUITY':
      return inst.market === 'US' ? 2 : 0;
    case 'INDEX':
      return 2;
    case 'CURNCY':
      return v >= 100 ? 2 : v >= 1 ? 4 : 6;
    case 'CRYPTO':
      return v >= 1000 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 5 : 8;
  }
}

const fmtCache = new Map<number, Intl.NumberFormat>();
function nf(d: number) {
  let f = fmtCache.get(d);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    fmtCache.set(d, f);
  }
  return f;
}

export function fmtPrice(inst: Instrument | undefined, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return nf(priceDigits(inst, v)).format(v);
}

export function fmtNum(v: number | undefined, d = 2): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return nf(d).format(v);
}

export function fmtPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 등락: ▲▼를 늘 붙여요(색만으로 구분하지 않기, 02 원칙 5) */
export function arrow(v: number | undefined): string {
  if (!v) return ' ';
  return v > 0 ? '▲' : '▼';
}

export function dirClass(v: number | undefined): string {
  if (!v) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/** 거래대금: 원화는 억·조, 그 밖은 K·M·B */
export function fmtBig(v: number | undefined, currency?: string): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (currency === 'KRW') {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
    if (v >= 1e8) return `${Math.round(v / 1e8).toLocaleString('en-US')}억`;
    return `${Math.round(v / 1e4).toLocaleString('en-US')}만`;
  }
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/** 받침에 맞는 조사(은/는, 이/가 등)를 붙여요. 한글로 끝나지 않으면 두 형태를 함께 적어요(AAPL은(는)) */
export function josa(word: string, withBatchim: string, without: string): string {
  const ch = word.charCodeAt(word.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return word + ((ch - 0xac00) % 28 ? withBatchim : without);
  return `${word}${withBatchim}(${without})`;
}
