// v0.6 금리 시계열(BTMM·OIS·FICM): ECOS(기준금리·콜·CD·CP·국고·회사채)와 FRED(연방기금 목표·EFFR·SOFR·단기국채·국채·회사채 OAS·€STR)
// 최근 약 400일. 시계열마다 따로 받아 하나가 실패해도 나머지는 보여요. 3시간 캐시, 받은 값은 데이터 폴더(money-cache.json)에 둬요.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MONEY_SERIES, SOVM_COUNTRIES, type MoneySeries, type MoneySeriesResponse, type SovereignResponse } from '@bt/shared';
import { fetchJson, type Logger } from './util';

const FRED = 'https://api.stlouisfed.org/fred';
const WORLD_BANK = 'https://api.worldbank.org/v2';
const FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny';
const ECOS = 'https://ecos.bok.or.kr/api';
const TTL = 3 * 3600_000;
const DAYS = 400;

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export class MoneyService {
  private fredKey?: string;
  private cache?: { at: number; p: Promise<MoneySeriesResponse> };
  private sov?: { at: number; p: Promise<SovereignResponse> };

  constructor(
    private dataDir: string,
    private log: Logger,
    private ecosKey: () => string | undefined,
  ) {}

  setFredKey(key: string | undefined) {
    this.fredKey = key;
    this.cache = undefined;
  }

  clear() {
    this.cache = undefined;
  }

  private async fred(code: string): Promise<MoneySeries['obs']> {
    const start = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
    const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
      `${FRED}/series/observations?series_id=${code}&api_key=${encodeURIComponent(this.fredKey!)}&file_type=json&observation_start=${start}`,
      { timeoutMs: 20_000 },
    );
    return (r.observations ?? []).map((o) => ({ date: o.date, value: Number(o.value) })).filter((o) => Number.isFinite(o.value));
  }

  private async ecos(code: string): Promise<MoneySeries['obs']> {
    const [table, item] = code.split('/');
    const r = await fetchJson<{ StatisticSearch?: { row?: Array<{ TIME: string; DATA_VALUE: string }> }; RESULT?: { CODE: string; MESSAGE: string } }>(
      `${ECOS}/StatisticSearch/${encodeURIComponent(this.ecosKey()!)}/json/kr/1/1000/${table}/D/${ymd(Date.now() - DAYS * 86400_000)}/${ymd(Date.now())}/${item}`,
      { timeoutMs: 20_000 },
    );
    if (!r.StatisticSearch) {
      if (r.RESULT?.CODE === 'INFO-200') return [];
      throw new Error(r.RESULT ? `${r.RESULT.MESSAGE} (${r.RESULT.CODE})` : 'ECOS 응답에 값이 없어요');
    }
    return (r.StatisticSearch.row ?? []).map((x) => ({ date: dash(x.TIME), value: Number(x.DATA_VALUE) })).filter((o) => Number.isFinite(o.value));
  }

  /** SOVM: 세계은행 중앙정부 부채/GDP(키 없음)와 미국 재무부 FiscalData 연방 부채(키 없음). 하루 캐시 */
  sovereign(): Promise<SovereignResponse> {
    if (this.sov && Date.now() - this.sov.at < 24 * 3600_000) return this.sov.p;
    const p = (async (): Promise<SovereignResponse> => {
      const errors: string[] = [];
      const countries: SovereignResponse['countries'] = SOVM_COUNTRIES.map((c) => ({ iso3: c.iso3, name: c.name }));
      try {
        const codes = SOVM_COUNTRIES.map((c) => c.iso2).join(';');
        const r = await fetchJson<[unknown, Array<{ countryiso3code: string; date: string; value: number | null }> | null]>(`${WORLD_BANK}/country/${codes}/indicator/GC.DOD.TOTL.GD.ZS?format=json&mrv=8&per_page=200`, { timeoutMs: 20_000 });
        for (const c of countries) {
          const obs = (r[1] ?? []).filter((x) => x.countryiso3code === c.iso3 && x.value !== null).sort((a, b) => b.date.localeCompare(a.date));
          if (obs[0]) Object.assign(c, { debtGdp: obs[0].value!, year: obs[0].date, prevDebtGdp: obs[1]?.value ?? undefined });
        }
      } catch (e) {
        errors.push(`세계은행: ${(e as Error).message}`);
      }
      let usDebt: SovereignResponse['usDebt'];
      try {
        const r = await fetchJson<{ data?: Array<{ record_date: string; tot_pub_debt_out_amt: string }> }>(`${FISCAL}?sort=-record_date&page%5Bsize%5D=2&fields=record_date,tot_pub_debt_out_amt`, { timeoutMs: 20_000 });
        const [a, b] = r.data ?? [];
        if (a) usDebt = { date: a.record_date, total: Number(a.tot_pub_debt_out_amt), prev: b ? Number(b.tot_pub_debt_out_amt) : undefined };
      } catch (e) {
        errors.push(`FiscalData: ${(e as Error).message}`);
      }
      const now = Date.now();
      return { countries, usDebt, errors, fresh: { source: 'WORLDBANK', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
    })();
    this.sov = { at: Date.now(), p };
    p.catch(() => (this.sov = undefined));
    return p;
  }

  get(): Promise<MoneySeriesResponse> {
    if (this.cache && Date.now() - this.cache.at < TTL) return this.cache.p;
    const p = this.load();
    this.cache = { at: Date.now(), p };
    p.catch(() => (this.cache = undefined));
    return p;
  }

  private async load(): Promise<MoneySeriesResponse> {
    const file = join(this.dataDir, 'money-cache.json');
    let saved: MoneySeries[] = [];
    try {
      saved = (JSON.parse(await readFile(file, 'utf8')) as { series: MoneySeries[] }).series ?? [];
    } catch {
      saved = [];
    }
    const series: MoneySeries[] = [];
    const missing: MoneySeriesResponse['missing'] = [];
    for (const def of MONEY_SERIES) {
      if (def.source === 'FRED' && !this.fredKey) {
        missing.push({ id: def.id, reason: 'FRED API 키가 없어요(설정 → 데이터 연결)' });
        continue;
      }
      if (def.source === 'ECOS' && !this.ecosKey()) {
        missing.push({ id: def.id, reason: 'ECOS 인증키가 없어요(설정 → 데이터 연결)' });
        continue;
      }
      try {
        const obs = (def.source === 'FRED' ? await this.fred(def.code) : await this.ecos(def.code)).sort((a, b) => a.date.localeCompare(b.date));
        if (obs.length) series.push({ id: def.id, obs });
        else missing.push({ id: def.id, reason: '값이 없어요' });
      } catch (e) {
        const old = saved.find((s) => s.id === def.id);
        if (old) series.push(old);
        missing.push({ id: def.id, reason: (e as Error).message });
      }
    }
    if (series.length) void writeFile(file, JSON.stringify({ series })).catch(() => undefined);
    if (missing.some((m) => !/키가 없어요/.test(m.reason))) this.log.warn(`금리 시계열 일부를 받지 못했어요: ${missing.map((m) => `${m.id} ${m.reason}`).join(' / ')}`);
    const now = Date.now();
    return { series, missing, fresh: { source: 'ECOS', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
  }
}
