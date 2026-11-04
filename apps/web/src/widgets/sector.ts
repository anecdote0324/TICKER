// HMAP·IMAP 공용: 패널의 지수, 등락 색, 기간 등락 계산.

import { MAP_INDEXES, SECTOR_INDEXES, type MapIndex, type SectorIndex } from '@bt/shared';
import type { PanelState } from '../stores/panels';

export function sectorIndexOf(panel: PanelState): SectorIndex {
  const a = panel.args?.[0];
  return (SECTOR_INDEXES.find((x) => x.code === a)?.code ?? 'KOSPI') as SectorIndex;
}

/** IMAP: 국내 지수 셋과 미국 지수 둘(SPX·NDX) */
export function mapIndexOf(panel: PanelState): MapIndex {
  const a = panel.args?.[0];
  return MAP_INDEXES.find((x) => x.code === a)?.code ?? 'KOSPI';
}

/** 배지가 장 상태를 알 수 있게 넘길 지수 종목 */
export const SECTOR_INDEX_INST: Record<MapIndex, string> = { KOSPI: 'IDX:KOSPI', KOSDAQ: 'IDX:KOSDAQ', KOSPI2: 'IDX:KOSPI2', SPX: 'IDX:SPX', NDX: 'IDX:NDX' };

/**
 * 등락률 → 칸 배경. full(%)에서 가장 진하고, 0이면 어두운 회색. 등락 색은 설정(--up·--down)을 따라요
 */
export function heat(pct: number | undefined, full = 3): string {
  if (pct === undefined || !Number.isFinite(pct)) return '#1a1a1a';
  const k = Math.min(1, Math.abs(pct) / full);
  if (k < 0.02) return '#262626';
  const mix = Math.round(18 + k * 72);
  return `color-mix(in srgb, var(${pct > 0 ? '--up' : '--down'}) ${mix}%, #141414)`;
}

export const PERIODS = [
  { code: '1D', label: '오늘', full: 3 },
  { code: '1W', label: '1주', full: 6 },
  { code: '1M', label: '1개월', full: 10 },
  { code: '3M', label: '3개월', full: 20 },
  { code: 'YTD', label: '올해', full: 30 },
] as const;
export type PeriodCode = (typeof PERIODS)[number]['code'];

/** 기간이 시작하기 전 마지막 종가 대비 지금 값의 등락(%). 일봉 t는 그날 0시(UTC 기준 날짜) */
export function periodReturn(closes: Array<{ t: number; c: number }>, current: number | undefined, period: Exclude<PeriodCode, '1D'>, nowSec: number): number | undefined {
  if (closes.length === 0) return undefined;
  const cur = current ?? closes[closes.length - 1].c;
  let cutoff: number;
  if (period === 'YTD') cutoff = Date.UTC(new Date(nowSec * 1000).getUTCFullYear(), 0, 1) / 1000;
  else cutoff = nowSec - { '1W': 7, '1M': 30, '3M': 91 }[period] * 86400;
  // 기간 시작 전날까지의 마지막 종가가 기준
  let base: number | undefined;
  for (const x of closes) {
    if (x.t < cutoff) base = x.c;
    else break;
  }
  if (base === undefined || !(base > 0)) return undefined;
  return (cur / base - 1) * 100;
}
