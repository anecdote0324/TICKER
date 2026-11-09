// v0.6 매크로(ECOD·ECST·ECOF·ECMX·IFMO, ECO 한국 일정): 시계열(FRED·ECOS·KOSIS), 첫 발표 값(ALFRED), 지표 찾기,
// 세계 경제 매트릭스(세계은행), 한국 발표 일정(국가데이터처 보도계획·한국은행 통계공표일정).
// 시계열은 6시간, 매트릭스는 하루, 한국 일정은 12시간 동안 같은 값을 써요.

import {
  ECMX_COUNTRIES,
  ECMX_INDICATORS,
  MACRO_SERIES,
  applyTransform,
  ecosTime,
  kosisUrlOk,
  macroDef,
  parseBokStatCalendar,
  parseKosis,
  parseModsPlan,
  type KrRelease,
  type MacroFreq,
  type MacroObs,
  type MacroResponse,
  type MacroSearchHit,
  type MacroSearchResponse,
  type MacroSeries,
  type MatrixResponse,
  type VintageResponse,
} from '@bt/shared';
import { fetchJson, fetchText, type Logger } from './util';

const FRED = 'https://api.stlouisfed.org/fred';
const ECOS = 'https://ecos.bok.or.kr/api';
const WORLD_BANK = 'https://api.worldbank.org/v2';
const MODS_PLAN = 'https://mods.go.kr/newsPln.es?mid=a10305000000&bid=&act=list&oa_mm=';
const BOK_CAL = 'https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775&date=';
const TTL = 6 * 3600_000;
const UA = { 'User-Agent': 'TICKER-app' };
const YEARS = 12;

interface Raw {
  obs: MacroObs[];
  freq: MacroFreq;
  title?: string;
  units?: string;
}

const FRED_FREQ: Record<string, MacroFreq> = { D: 'D', W: 'W', BW: 'W', M: 'M', Q: 'Q', SA: 'A', A: 'A' };

export class MacroService {
  private fredKey?: string;
  private kosisKey?: string;
  private raw = new Map<string, { at: number; p: Promise<Raw> }>();
  private matrixCache?: { at: number; p: Promise<MatrixResponse> };
  private krCache?: { at: number; p: Promise<KrRelease[]> };
  private ecosTables?: Promise<Array<{ code: string; name: string; cycle: string }>>;

  constructor(
    private log: Logger,
    private ecosKey: () => string | undefined,
  ) {}

  setFredKey(k: string | undefined) {
    this.fredKey = k;
    this.clear();
  }

  setKosisKey(k: string | undefined) {
    this.kosisKey = k;
  }

  clear() {
    this.raw.clear();
    this.ecosTables = undefined;
  }

  private async fredRaw(code: string, freqHint?: MacroFreq): Promise<Raw> {
    if (!this.fredKey) throw new Error('FRED API 키가 없어요(설정 → 데이터 연결)');
    const key = encodeURIComponent(this.fredKey);
    let freq = freqHint;
    let title: string | undefined;
    let units: string | undefined;
    if (!freq) {
      const meta = await fetchJson<{ seriess?: Array<{ title: string; units: string; frequency_short: string }> }>(`${FRED}/series?series_id=${encodeURIComponent(code)}&api_key=${key}&file_type=json`, { timeoutMs: 15_000 });
      const m = meta.seriess?.[0];
      if (!m) throw new Error('FRED에 없는 시계열이에요');
      freq = FRED_FREQ[m.frequency_short] ?? 'M';
      title = m.title;
      units = m.units;
    }
    const years = freq === 'D' ? 3 : freq === 'W' ? 5 : YEARS;
    const start = new Date(Date.now() - years * 366 * 86400_000).toISOString().slice(0, 10);
    const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
      `${FRED}/series/observations?series_id=${encodeURIComponent(code)}&api_key=${key}&file_type=json&observation_start=${start}`,
      { timeoutMs: 25_000 },
    );
    return { obs: (r.observations ?? []).map((o) => ({ date: o.date, value: Number(o.value) })).filter((o) => Number.isFinite(o.value)), freq, title, units };
  }

  private async ecosRaw(spec: string): Promise<Raw> {
    const key = this.ecosKey();
    if (!key) throw new Error('ECOS 인증키가 없어요(설정 → 데이터 연결)');
    const [table, cycle, item] = spec.split('/');
    const now = new Date();
    const y0 = now.getUTCFullYear() - YEARS;
    const range =
      cycle === 'Q' ? [`${y0}Q1`, `${now.getUTCFullYear()}Q4`] : cycle === 'A' ? [`${y0}`, `${now.getUTCFullYear()}`] : [`${y0}01`, `${now.getUTCFullYear()}12`];
    const r = await fetchJson<{ StatisticSearch?: { row?: Array<{ TIME: string; DATA_VALUE: string; ITEM_NAME1?: string; UNIT_NAME?: string }> }; RESULT?: { CODE: string; MESSAGE: string } }>(
      `${ECOS}/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/2000/${table}/${cycle}/${range[0]}/${range[1]}/${encodeURIComponent(item)}`,
      { timeoutMs: 25_000 },
    );
    if (!r.StatisticSearch) {
      if (r.RESULT?.CODE === 'INFO-200') return { obs: [], freq: cycle as MacroFreq };
      throw new Error(r.RESULT ? `${r.RESULT.MESSAGE} (${r.RESULT.CODE})` : 'ECOS 응답에 값이 없어요');
    }
    const rows = r.StatisticSearch.row ?? [];
    return {
      obs: rows.map((x) => ({ date: ecosTime(x.TIME), value: Number(x.DATA_VALUE) })).filter((o) => Number.isFinite(o.value)),
      freq: cycle as MacroFreq,
      title: rows[0]?.ITEM_NAME1,
      units: rows[0]?.UNIT_NAME,
    };
  }

  private getRaw(id: string): Promise<Raw> {
    const hit = this.raw.get(id);
    if (hit && Date.now() - hit.at < TTL) return hit.p;
    const def = macroDef(id);
    const p = id.startsWith('FRED:') ? this.fredRaw(id.slice(5), def?.freq) : id.startsWith('ECOS:') ? this.ecosRaw(id.slice(5)) : Promise.reject(new Error('모르는 시계열이에요'));
    const sorted = p.then((r) => ({ ...r, obs: r.obs.sort((a, b) => a.date.localeCompare(b.date)) }));
    this.raw.set(id, { at: Date.now(), p: sorted });
    sorted.catch(() => this.raw.delete(id));
    return sorted;
  }

  /** 여러 시계열(앱 지표는 정해진 바꾸기, 검색으로 더한 FRED 시계열은 수준 값) */
  async series(ids: string[]): Promise<MacroResponse> {
    const out: MacroSeries[] = [];
    const missing: MacroResponse['missing'] = [];
    await Promise.all(
      ids.slice(0, 40).map(async (id) => {
        try {
          const raw = await this.getRaw(id);
          const def = macroDef(id);
          const obs = def ? applyTransform(raw.obs, def.transform, def.freq, def.scale) : raw.obs;
          if (!obs.length) missing.push({ id, reason: '값이 없어요' });
          out.push({ id, obs, lastDate: raw.obs[raw.obs.length - 1]?.date, title: raw.title, units: raw.units });
        } catch (e) {
          missing.push({ id, reason: (e as Error).message });
        }
      }),
    );
    const order = new Map(ids.map((id, i) => [id, i]));
    out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const now = Date.now();
    return { series: out, missing, fresh: { source: ids.some((i) => i.startsWith('FRED:')) ? 'FRED' : 'ECOS', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
  }

  /** ECOD: FRED 시계열의 첫 발표 값(ALFRED output_type=4)으로 다시 계산한 값 */
  async vintage(id: string): Promise<VintageResponse> {
    if (!id.startsWith('FRED:')) return { id, initial: [], error: 'ECOS·KOSIS는 수정 이력을 주지 않아요' };
    if (!this.fredKey) return { id, initial: [], error: 'FRED API 키가 없어요(설정 → 데이터 연결)' };
    const def = macroDef(id);
    try {
      const start = new Date(Date.now() - 4 * 366 * 86400_000).toISOString().slice(0, 10);
      const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
        `${FRED}/series/observations?series_id=${encodeURIComponent(id.slice(5))}&api_key=${encodeURIComponent(this.fredKey)}&file_type=json&observation_start=${start}&realtime_start=1776-07-04&realtime_end=9999-12-31&output_type=4`,
        { timeoutMs: 25_000 },
      );
      const raw = (r.observations ?? []).map((o) => ({ date: o.date, value: Number(o.value) })).filter((o) => Number.isFinite(o.value));
      return { id, initial: def ? applyTransform(raw, def.transform, def.freq, def.scale) : raw };
    } catch (e) {
      return { id, initial: [], error: (e as Error).message };
    }
  }

  /** ECOF: 앱 지표, FRED 검색(키), ECOS 통계표 이름(인증키) */
  async search(q: string): Promise<MacroSearchResponse> {
    const query = q.trim();
    const hits: MacroSearchHit[] = [];
    const missing: string[] = [];
    if (!query) return { hits, missing };
    const low = query.toLowerCase();
    for (const d of MACRO_SERIES) {
      if (d.name.toLowerCase().includes(low) || d.id.toLowerCase().includes(low) || d.group.includes(query)) {
        hits.push({ id: d.id, source: 'APP', title: d.name, detail: `${d.country === 'KR' ? '한국' : d.country === 'US' ? '미국' : '유로'} · ${d.group} · ${d.id.split(':')[0]}` });
      }
    }
    const tasks: Array<Promise<void>> = [];
    if (this.fredKey) {
      tasks.push(
        fetchJson<{ seriess?: Array<{ id: string; title: string; frequency_short: string; units_short: string; popularity: number; observation_end: string }> }>(
          `${FRED}/series/search?search_text=${encodeURIComponent(query)}&api_key=${encodeURIComponent(this.fredKey)}&file_type=json&limit=40&order_by=popularity&sort_order=desc`,
          { timeoutMs: 15_000 },
        )
          .then((r) => {
            for (const s of r.seriess ?? []) {
              hits.push({ id: `FRED:${s.id}`, source: 'FRED', title: s.title, detail: `${s.id} · ${s.frequency_short} · ${s.units_short} · ~${s.observation_end}`, url: `https://fred.stlouisfed.org/series/${s.id}`, popularity: s.popularity });
            }
          })
          .catch((e: Error) => void missing.push(`FRED 검색: ${e.message}`)),
      );
    } else missing.push('FRED 검색은 FRED API 키가 있어야 해요');
    if (this.ecosKey()) {
      tasks.push(
        this.ecosTableList()
          .then((tables) => {
            for (const t of tables.filter((x) => x.name.toLowerCase().includes(low)).slice(0, 30)) {
              hits.push({ source: 'ECOS', title: t.name, detail: `ECOS 통계표 ${t.code}${t.cycle ? ` · ${t.cycle}` : ''}`, url: 'https://ecos.bok.or.kr/' });
            }
          })
          .catch((e: Error) => void missing.push(`ECOS 통계표: ${e.message}`)),
      );
    } else missing.push('ECOS 통계표 찾기는 ECOS 인증키가 있어야 해요');
    await Promise.all(tasks);
    return { hits, missing };
  }

  private ecosTableList(): Promise<Array<{ code: string; name: string; cycle: string }>> {
    if (!this.ecosTables) {
      this.ecosTables = fetchJson<{ StatisticTableList?: { row?: Array<{ STAT_CODE: string; STAT_NAME: string; CYCLE: string | null; SRCH_YN: string }> } }>(
        `${ECOS}/StatisticTableList/${encodeURIComponent(this.ecosKey()!)}/json/kr/1/10000`,
        { timeoutMs: 30_000 },
      ).then((r) => (r.StatisticTableList?.row ?? []).filter((x) => x.SRCH_YN === 'Y').map((x) => ({ code: x.STAT_CODE, name: x.STAT_NAME, cycle: x.CYCLE ?? '' })));
      this.ecosTables.catch(() => (this.ecosTables = undefined));
    }
    return this.ecosTables;
  }

  /** ECST: 사용자가 KOSIS에서 만든 OpenAPI 주소(인증키는 여기서 넣어요) */
  async kosis(url: string): Promise<{ groups: ReturnType<typeof parseKosis>['groups']; error?: string }> {
    if (!kosisUrlOk(url)) return { groups: [], error: 'KOSIS OpenAPI 주소(https://kosis.kr/openapi/…)만 쓸 수 있어요' };
    if (!this.kosisKey) return { groups: [], error: 'KOSIS 인증키가 없어요(설정 → 데이터 연결)' };
    const u = new URL(url);
    u.searchParams.set('apiKey', this.kosisKey);
    u.searchParams.set('format', 'json');
    u.searchParams.set('jsonVD', 'Y');
    try {
      return parseKosis(await fetchText(u.toString(), { headers: UA, timeoutMs: 25_000 }));
    } catch (e) {
      return { groups: [], error: (e as Error).message.replace(this.kosisKey, '…') };
    }
  }

  async testKosis(key: string): Promise<{ ok: boolean; message: string }> {
    // 통계목록(국가데이터처 주제별)을 한 번 받아 봐요
    try {
      const t = await fetchText(`https://kosis.kr/openapi/statisticsList.do?method=getList&apiKey=${encodeURIComponent(key)}&vwCd=MT_ZTITLE&parentListId=&format=json&jsonVD=Y`, { headers: UA, timeoutMs: 15_000 });
      if (/"?err"?\s*:/.test(t)) {
        const m = t.match(/errMsg"?\s*:\s*"([^"]+)"/)?.[1];
        return { ok: false, message: m ? `KOSIS: ${m}` : 'KOSIS 인증키가 맞지 않아요' };
      }
      return { ok: true, message: 'KOSIS 통계 목록을 받았어요' };
    } catch (e) {
      return { ok: false, message: `KOSIS에 연결하지 못했어요: ${(e as Error).message.replace(key, '…')}` };
    }
  }

  /** ECMX: 세계은행 지표 × 나라(최근 값과 그 앞 해) */
  matrix(): Promise<MatrixResponse> {
    if (this.matrixCache && Date.now() - this.matrixCache.at < 24 * 3600_000) return this.matrixCache.p;
    const p = (async (): Promise<MatrixResponse> => {
      const cells: MatrixResponse['cells'] = {};
      const errors: string[] = [];
      const codes = ECMX_COUNTRIES.map((c) => c.iso2).join(';');
      await Promise.all(
        ECMX_INDICATORS.map(async (ind) => {
          try {
            const r = await fetchJson<[unknown, Array<{ countryiso3code: string; date: string; value: number | null }> | null]>(`${WORLD_BANK}/country/${codes}/indicator/${ind.code}?format=json&mrv=6&per_page=500`, { timeoutMs: 25_000 });
            const m: Record<string, { value: number; year: string; prev?: number }> = {};
            for (const c of ECMX_COUNTRIES) {
              const obs = (r[1] ?? []).filter((x) => x.countryiso3code === c.iso3 && x.value !== null).sort((a, b) => b.date.localeCompare(a.date));
              if (obs[0]) m[c.iso3] = { value: obs[0].value!, year: obs[0].date, prev: obs[1]?.value ?? undefined };
            }
            cells[ind.code] = m;
          } catch (e) {
            errors.push(`${ind.name}: ${(e as Error).message}`);
          }
        }),
      );
      const now = Date.now();
      return { cells, errors, fresh: { source: 'WORLDBANK', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
    })();
    this.matrixCache = { at: Date.now(), p };
    p.catch(() => (this.matrixCache = undefined));
    return p;
  }

  /** ECO 한국 일정: 이번 달과 다음 달(국가데이터처는 시각까지, 한국은행은 날짜만) */
  krReleases(): Promise<KrRelease[]> {
    if (this.krCache && Date.now() - this.krCache.at < 12 * 3600_000) return this.krCache.p;
    const p = (async () => {
      const kst = new Date(Date.now() + 9 * 3600_000);
      const months = [0, 1].map((k) => {
        const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + k, 1));
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
      });
      const out: KrRelease[] = [];
      let failed = 0;
      for (const { y, m } of months) {
        const mm = String(m).padStart(2, '0');
        // 국가데이터처 보도계획은 올해 달만 골라요(다음 해 1월은 연도가 바뀐 뒤에 올라와요)
        if (y === kst.getUTCFullYear()) {
          try {
            out.push(...parseModsPlan(await fetchText(MODS_PLAN + mm, { headers: UA, timeoutMs: 20_000 }), y));
          } catch (e) {
            failed++;
            this.log.warn(`국가데이터처 보도계획(${m}월)을 받지 못했어요: ${(e as Error).message}`);
          }
        }
        try {
          out.push(...parseBokStatCalendar(await fetchText(`${BOK_CAL}${y}-${mm}`, { headers: UA, timeoutMs: 20_000 }), y, m));
        } catch (e) {
          failed++;
          this.log.warn(`한국은행 통계공표일정(${y}-${mm})을 받지 못했어요: ${(e as Error).message}`);
        }
      }
      if (!out.length && failed) throw new Error('한국 발표 일정을 받지 못했어요');
      return out;
    })();
    this.krCache = { at: Date.now(), p };
    p.catch(() => (this.krCache = undefined));
    return p;
  }
}
