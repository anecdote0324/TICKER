// v0.6 외환: FIXI 공식 고시환율(ECB 기준환율 Frankfurter, ECOS 매매기준율, FRED H.10)과
// FRD·WCRS의 단기 금리(FRED SOFR·EFFR·€STR, ECOS CD91·콜). 출처마다 따로 받아서 하나가 실패해도 나머지는 보여요. 3시간 캐시.

import type { FixingRow, FixingSource, FixingsResponse, MoneyRate, MoneyRatesResponse } from '@bt/shared';
import { fetchJson, type Logger } from './util';

const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const FRED = 'https://api.stlouisfed.org/fred';
const ECOS = 'https://ecos.bok.or.kr/api';
const TTL = 3 * 3600_000;

/** ECOS 주요국 통화의 대원화환율(731Y001, 매매기준율) 항목 */
export const ECOS_FX_ITEMS: Array<{ item: string; pair: string; unit?: string }> = [
  { item: '0000001', pair: 'USD/KRW' },
  { item: '0000002', pair: 'JPY/KRW', unit: '100엔당' },
  { item: '0000003', pair: 'EUR/KRW' },
  { item: '0000053', pair: 'CNY/KRW' },
];

/** FRED H.10(연준 정오 뉴욕 매수율) 시계열 */
export const FRED_H10: Array<{ id: string; pair: string }> = [
  { id: 'DEXKOUS', pair: 'USD/KRW' },
  { id: 'DEXJPUS', pair: 'USD/JPY' },
  { id: 'DEXUSEU', pair: 'EUR/USD' },
  { id: 'DEXUSUK', pair: 'GBP/USD' },
  { id: 'DEXCHUS', pair: 'USD/CNY' },
  { id: 'DEXUSAL', pair: 'AUD/USD' },
];

/** 단기 금리 시계열 */
export const FRED_MONEY: Array<{ id: string; ccy: string; name: string }> = [
  { id: 'SOFR', ccy: 'USD', name: 'SOFR' },
  { id: 'EFFR', ccy: 'USD', name: 'EFFR' },
  { id: 'ECBESTRVOLWGTTRMDMNRT', ccy: 'EUR', name: '€STR' },
];
export const ECOS_MONEY: Array<{ item: string; ccy: string; name: string }> = [
  { item: '010502000', ccy: 'KRW', name: 'CD91' },
  { item: '010101000', ccy: 'KRW', name: '콜' },
];

interface EcosRow {
  TIME: string;
  DATA_VALUE: string;
}
interface EcosSearch {
  StatisticSearch?: { row?: EcosRow[] };
  RESULT?: { CODE: string; MESSAGE: string };
}

const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

/** 관측값(오래된 것부터 아무 순서) → 마지막 값과 그 앞 값 */
export function lastTwo(obs: Array<{ date: string; value: number }>): { date: string; value: number; prev?: number } | undefined {
  const xs = obs.filter((o) => Number.isFinite(o.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (!xs.length) return undefined;
  const last = xs[xs.length - 1];
  return { date: last.date, value: last.value, prev: xs.length > 1 ? xs[xs.length - 2].value : undefined };
}

/** Frankfurter(ECB 기준환율, 유로 기준) 두 날 → 원화·달러 기준 통화쌍 */
export function ecbRows(latest: { date: string; rates: Record<string, number> }, prev?: { rates: Record<string, number> }): FixingRow[] {
  const out: FixingRow[] = [];
  const r = { ...latest.rates, EUR: 1 };
  const p = prev ? { ...prev.rates, EUR: 1 } : undefined;
  const cross = (a: string, b: string, src: Record<string, number>) => (src[a] && src[b] ? src[b] / src[a] : undefined);
  const pairs: Array<[string, string, string?]> = [
    ['EUR', 'USD'],
    ['USD', 'KRW'],
    ['EUR', 'KRW'],
    ['USD', 'JPY'],
    ['GBP', 'USD'],
    ['USD', 'CNY'],
    ['AUD', 'USD'],
  ];
  for (const [a, b] of pairs) {
    const v = cross(a, b, r);
    if (v === undefined) continue;
    out.push({ pair: `${a}/${b}`, value: v, date: latest.date, prev: p ? cross(a, b, p) : undefined });
  }
  return out;
}

export class FxService {
  private fredKey?: string;
  private cache = new Map<string, { at: number; p: Promise<unknown> }>();

  constructor(
    private log: Logger,
    private ecosKey: () => string | undefined,
  ) {}

  setFredKey(key: string | undefined) {
    this.fredKey = key;
    this.cache.clear();
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
    const p = load();
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  private async fred(id: string, days = 20): Promise<Array<{ date: string; value: number }>> {
    if (!this.fredKey) throw new Error('FRED API 키가 없어요(설정 → 데이터 연결)');
    const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
      `${FRED}/series/observations?series_id=${id}&api_key=${encodeURIComponent(this.fredKey)}&file_type=json&observation_start=${start}`,
      { timeoutMs: 15_000 },
    );
    return (r.observations ?? []).map((o) => ({ date: o.date, value: Number(o.value) })).filter((o) => Number.isFinite(o.value));
  }

  private async ecos(table: string, item: string, days = 20): Promise<Array<{ date: string; value: number }>> {
    const key = this.ecosKey();
    if (!key) throw new Error('ECOS 인증키가 없어요(설정 → 데이터 연결)');
    const r = await fetchJson<EcosSearch>(`${ECOS}/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/100/${table}/D/${ymd(Date.now() - days * 86400_000)}/${ymd(Date.now())}/${item}`, { timeoutMs: 15_000 });
    if (!r.StatisticSearch) {
      if (r.RESULT?.CODE === 'INFO-200') return [];
      throw new Error(r.RESULT ? `${r.RESULT.MESSAGE} (${r.RESULT.CODE})` : 'ECOS 응답에 값이 없어요');
    }
    return (r.StatisticSearch.row ?? []).map((x) => ({ date: dash(x.TIME), value: Number(x.DATA_VALUE) }));
  }

  fixings(): Promise<FixingsResponse> {
    return this.cached('fixings', async () => {
      const sources: FixingSource[] = [];
      // ECB 기준환율(Frankfurter): 영업일 중부 유럽 시간 16시 무렵
      const ecb: FixingSource = { id: 'ECB', name: 'ECB 기준환율', basis: '영업일 중부 유럽 시간 16시(한국 밤 0시 무렵) 고시, 유로 기준을 교차 계산', rows: [] };
      try {
        const latest = await fetchJson<{ date: string; rates: Record<string, number> }>(`${FRANKFURTER}/latest?base=EUR`, { timeoutMs: 15_000 });
        const day = new Date(Date.parse(`${latest.date}T00:00:00Z`) - 5 * 86400_000).toISOString().slice(0, 10);
        const hist = await fetchJson<{ rates: Record<string, Record<string, number>> }>(`${FRANKFURTER}/${day}..${latest.date}?base=EUR`, { timeoutMs: 15_000 }).catch(() => undefined);
        const days = hist ? Object.keys(hist.rates).sort() : [];
        const prevDay = days.filter((d) => d < latest.date).pop();
        ecb.rows = ecbRows(latest, prevDay && hist ? { rates: hist.rates[prevDay] } : undefined);
      } catch (e) {
        ecb.error = (e as Error).message;
      }
      sources.push(ecb);
      // ECOS 매매기준율
      const ecos: FixingSource = { id: 'ECOS', name: '매매기준율(한국은행 ECOS)', basis: '서울외국환중개 고시 매매기준율(영업일 오전 9시 무렵), 원화 기준', rows: [] };
      try {
        for (const x of ECOS_FX_ITEMS) {
          const l = lastTwo(await this.ecos('731Y001', x.item));
          if (l) ecos.rows.push({ pair: x.pair, value: l.value, date: l.date, prev: l.prev, unit: x.unit });
        }
      } catch (e) {
        ecos.error = (e as Error).message;
      }
      sources.push(ecos);
      // FRED H.10
      const h10: FixingSource = { id: 'FRED', name: '연준 H.10(FRED)', basis: '뉴욕 정오 매수율(영업일), 다음 주 월요일에 한 주치가 올라와요', rows: [] };
      try {
        for (const x of FRED_H10) {
          const l = lastTwo(await this.fred(x.id, 30));
          if (l) h10.rows.push({ pair: x.pair, value: l.value, date: l.date, prev: l.prev });
        }
      } catch (e) {
        h10.error = (e as Error).message;
      }
      sources.push(h10);
      const now = Date.now();
      return { sources, fresh: { source: 'ECB', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
    });
  }

  moneyRates(): Promise<MoneyRatesResponse> {
    return this.cached('money', async () => {
      const rates: MoneyRate[] = [];
      const errors: string[] = [];
      for (const x of FRED_MONEY) {
        try {
          const l = lastTwo(await this.fred(x.id));
          if (l) rates.push({ ccy: x.ccy, name: x.name, value: l.value, date: l.date, source: 'FRED' });
        } catch (e) {
          errors.push(`${x.name}: ${(e as Error).message}`);
          if (/키가 없어요/.test((e as Error).message)) break;
        }
      }
      for (const x of ECOS_MONEY) {
        try {
          const l = lastTwo(await this.ecos('817Y002', x.item));
          if (l) rates.push({ ccy: x.ccy, name: x.name, value: l.value, date: l.date, source: 'ECOS' });
        } catch (e) {
          errors.push(`${x.name}: ${(e as Error).message}`);
          if (/인증키가 없어요/.test((e as Error).message)) break;
        }
      }
      const now = Date.now();
      if (errors.length) this.log.warn(`단기 금리 일부를 받지 못했어요: ${errors.join(' / ')}`);
      return { rates, errors, fresh: { source: 'FRED', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
    });
  }
}
