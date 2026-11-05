// SI 미국(v0.4): FINRA 공매도 잔고(Consolidated Short Interest). 회원사가 한 달에 두 번(15일·월말 결제일) 보고한 잔고를 공개해요.
// FINRA Query API(api.finra.org)는 이 데이터를 키 없이 줘요. 12시간 캐시.

import type { ShortInterestResponse, ShortInterestRow } from '@bt/shared';
import { fetchJson } from './util';

const URL_SI = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest';
const TTL = 12 * 3600_000;

interface FinraRow {
  settlementDate?: string;
  currentShortPositionQuantity?: number;
  previousShortPositionQuantity?: number;
  changePercent?: number;
  averageDailyVolumeQuantity?: number;
  daysToCoverQuantity?: number;
  symbolCode?: string;
}

/** 앱 표기(BRK/B) → FINRA 표기(BRK.B) */
export const finraSymbol = (code: string) => code.replace('/', '.');

export function parseShortInterest(rows: FinraRow[]): ShortInterestRow[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => r.settlementDate && typeof r.currentShortPositionQuantity === 'number')
    .map((r) => ({
      date: r.settlementDate!.slice(0, 10),
      shares: r.currentShortPositionQuantity!,
      previous: r.previousShortPositionQuantity,
      changePct: typeof r.changePercent === 'number' ? r.changePercent : undefined,
      avgVolume: r.averageDailyVolumeQuantity,
      daysToCover: r.daysToCoverQuantity,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    // 고친 보고(revision)로 같은 결제일이 두 번 오면 하나만
    .filter((r) => (seen.has(r.date) ? false : (seen.add(r.date), true)));
}

export class FinraService {
  private cache = new Map<string, { at: number; p: Promise<ShortInterestResponse> }>();

  shortInterest(id: string, code: string): Promise<ShortInterestResponse> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < TTL) return hit.p;
    const p = (async () => {
      const now = Date.now();
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const body = {
        limit: 60,
        compareFilters: [{ compareType: 'EQUAL', fieldName: 'symbolCode', fieldValue: finraSymbol(code) }],
        dateRangeFilters: [{ fieldName: 'settlementDate', startDate: iso(now - 400 * 86400_000), endDate: iso(now) }],
      };
      const rows = await fetchJson<FinraRow[]>(URL_SI, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), timeoutMs: 30_000 });
      const out = parseShortInterest(Array.isArray(rows) ? rows : []);
      const last = out[0]?.date;
      return {
        id,
        rows: out,
        fresh: { source: 'FINRA', mode: 'daily', asOf: last ? Date.parse(`${last}T21:00:00Z`) : now, asOfDate: last, receivedAt: now },
      } satisfies ShortInterestResponse;
    })();
    this.cache.set(id, { at: Date.now(), p });
    p.catch(() => this.cache.delete(id));
    return p;
  }
}
