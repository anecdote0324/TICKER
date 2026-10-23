// 봉 데이터 요청. 같은 종목·간격의 요청은 잠시 묶어서 한 번만 보내요.

import type { BarInterval, BarSeries } from '@bt/shared';
import { api } from '../api';

const cache = new Map<string, { at: number; p: Promise<BarSeries> }>();

export function getBars(id: string, interval: BarInterval, maxAgeMs = 60_000): Promise<BarSeries> {
  const key = `${id}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.p;
  const p = api.get<BarSeries>(`/api/bars?id=${encodeURIComponent(id)}&interval=${interval}`);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** 스파크라인용 최근 30개 종가 */
export async function getSpark(id: string): Promise<number[]> {
  const s = await getBars(id, '1d', 30 * 60_000);
  return s.bars.slice(-30).map((b) => b.c);
}
