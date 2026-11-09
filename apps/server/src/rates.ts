// GC 금리 커브(03 v0.3): 미국채는 재무부 일별 금리 XML(키 없음), 국고채는 BOK ECOS 시장금리 일별(817Y002, 인증키).
// 최근 약 400일을 받아 화면이 오늘·1주 전·1개월 전·1년 전 커브를 겹쳐요. 30분 동안 같은 값을 쓰고,
// 받지 못하면 마지막으로 받은 값(데이터 폴더의 rates-cache.json)을 보여 줘요.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EUR_TENORS, JGB_TENORS, KTB_ITEMS, parseEcbCsv, parseJgbCsv, ustTenor, type CurveId, type CurveTenor, type CurvesResponse, type YieldCurve } from '@bt/shared';
import { fetchJson, fetchText, type Logger } from './util';

const TTL_MS = 30 * 60_000;
const UST_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=';
const ECOS_BASE = 'https://ecos.bok.or.kr/api';
const JGB_ALL = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv';
const JGB_NOW = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv';
const ECB_YC = 'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.';
/** 국고채를 받을 기간(1년 전 비교와 여유) */
const KTB_DAYS = 400;

/** 미국채 XML 한 해치 → 날짜별 금리. BC_30YEARDISPLAY 같은 표시용 칸은 빼요 */
export function parseUstXml(xml: string): { tenors: CurveTenor[]; rows: YieldCurve['rows'] } {
  const tenors = new Map<string, CurveTenor>();
  const rows: YieldCurve['rows'] = [];
  for (const block of xml.split('<m:properties>').slice(1)) {
    const date = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/.exec(block)?.[1];
    if (!date) continue;
    const values: Record<string, number> = {};
    for (const m of block.matchAll(/<d:(BC_[A-Z0-9_]+)[^>]*>([-\d.]+)<\/d:\1>/g)) {
      const t = ustTenor(m[1]);
      const v = Number(m[2]);
      if (!t || !Number.isFinite(v)) continue;
      tenors.set(t.key, t);
      values[t.key] = v;
    }
    if (Object.keys(values).length) rows.push({ date, values });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { tenors: [...tenors.values()].sort((a, b) => a.years - b.years), rows };
}

interface EcosRow {
  TIME: string;
  DATA_VALUE: string;
  ITEM_CODE1: string;
}
interface EcosSearch {
  StatisticSearch?: { row?: EcosRow[] };
  RESULT?: { CODE: string; MESSAGE: string };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export class RatesService {
  private ecosKey: string | undefined;
  private cache: { at: number; res: Promise<CurvesResponse> } | null = null;
  private readonly cacheFile: string;

  constructor(
    dataDir: string,
    private log: Logger,
  ) {
    this.cacheFile = join(dataDir, 'rates-cache.json');
  }

  setEcosKey(key: string | undefined) {
    this.ecosKey = key;
    this.cache = null;
  }

  /** ECO(한국 지표)·PORT가 같은 인증키를 써요 */
  get ecosKeyValue(): string | undefined {
    return this.ecosKey;
  }

  /** ECOS 인증키 확인: 국고채 3년을 최근 열흘만 받아 봐요 */
  async testEcos(key: string): Promise<{ ok: boolean; message: string }> {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 14 * 86400_000);
      const r = await fetchJson<EcosSearch>(`${ECOS_BASE}/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/10/817Y002/D/${ymd(start)}/${ymd(end)}/010200000`, { timeoutMs: 15_000 });
      const row = r.StatisticSearch?.row?.at(-1);
      if (row) return { ok: true, message: `국고채 3년 ${row.DATA_VALUE}% (${dash(row.TIME)})를 받았어요` };
      return { ok: false, message: r.RESULT ? `${r.RESULT.MESSAGE} (${r.RESULT.CODE})` : '응답에 값이 없어요' };
    } catch (e) {
      return { ok: false, message: `ECOS에 연결하지 못했어요: ${(e as Error).message}` };
    }
  }

  curves(): Promise<CurvesResponse> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.res;
    const res = this.load();
    this.cache = { at: Date.now(), res };
    res.catch(() => (this.cache = null));
    return res;
  }

  private async load(): Promise<CurvesResponse> {
    const saved = await this.readCache();
    const curves: YieldCurve[] = [];
    const missing: CurvesResponse['missing'] = [];
    const take = async (id: CurveId, name: string, get: () => Promise<YieldCurve>) => {
      try {
        curves.push(await get());
      } catch (e) {
        const msg = (e as Error).message;
        const old = saved?.curves.find((c) => c.id === id);
        if (old) {
          this.log.warn(`${name} 금리를 받지 못해 저장해 둔 값을 써요: ${msg}`);
          curves.push(old);
        } else missing.push({ id, name, reason: msg });
      }
    };
    await take('UST', '미국채', () => this.ust());
    if (this.ecosKey) await take('KTB', '국고채', () => this.ktb(this.ecosKey!));
    else missing.push({ id: 'KTB', name: '국고채', reason: 'BOK ECOS 인증키를 넣으면 국고채 커브가 보여요(설정 → 데이터 연결)' });
    // v0.6: 일본 국채(재무성 CSV, 키 없음)·유로 AAA 국채(ECB 데이터 포털, 키 없음)
    await take('JGB', '일본 국채', () => this.jgb());
    await take('EUR', '유로 AAA 국채', () => this.eur());
    const res = { curves, missing };
    void writeFile(this.cacheFile, JSON.stringify({ curves })).catch(() => undefined);
    return res;
  }

  private async readCache(): Promise<{ curves: YieldCurve[] } | undefined> {
    try {
      return JSON.parse(await readFile(this.cacheFile, 'utf8')) as { curves: YieldCurve[] };
    } catch {
      return undefined;
    }
  }

  /** 미국채: 올해와 작년 XML(1년 전 비교용) */
  private async ust(): Promise<YieldCurve> {
    const year = new Date().getUTCFullYear();
    const parts = await Promise.all([year - 1, year].map((y) => fetchText(`${UST_URL}${y}`, { timeoutMs: 30_000 }).then(parseUstXml)));
    const tenors = new Map<string, CurveTenor>();
    for (const p of parts) for (const t of p.tenors) tenors.set(t.key, t);
    const rows = parts.flatMap((p) => p.rows);
    if (rows.length === 0) throw new Error('재무부 금리 XML에 값이 없어요');
    const last = rows[rows.length - 1].date;
    const now = Date.now();
    return {
      id: 'UST',
      name: '미국채',
      tenors: [...tenors.values()].sort((a, b) => a.years - b.years),
      rows: rows.slice(-KTB_DAYS),
      // 재무부는 뉴욕 장 마감 뒤 그날 금리를 올려요
      fresh: { source: 'TREASURY', mode: 'daily', asOf: Date.parse(`${last}T21:00:00Z`), asOfDate: last, receivedAt: now },
    };
  }

  /** 일본 국채: 재무성 전체 이력 CSV(지난달까지) + 이번 달 CSV. 서기 날짜예요 */
  private async jgb(): Promise<YieldCurve> {
    const [all, now] = await Promise.all([fetchText(JGB_ALL, { timeoutMs: 60_000 }), fetchText(JGB_NOW, { timeoutMs: 30_000 }).catch(() => '')]);
    const byDate = new Map<string, Record<string, number>>();
    for (const r of [...parseJgbCsv(all), ...parseJgbCsv(now)]) byDate.set(r.date, r.values);
    const rows = [...byDate.entries()].map(([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date)).slice(-KTB_DAYS);
    if (!rows.length) throw new Error('재무성 국채 금리 CSV에 값이 없어요');
    const last = rows[rows.length - 1].date;
    return {
      id: 'JGB',
      name: '일본 국채',
      tenors: JGB_TENORS.filter((t) => rows.some((r) => r.values[t.key] !== undefined)),
      rows,
      // 재무성은 도쿄 장 마감 뒤(한국 저녁) 그날 금리를 올려요
      fresh: { source: 'MOF', mode: 'daily', asOf: Date.parse(`${last}T09:00:00Z`), asOfDate: last, receivedAt: Date.now() },
    };
  }

  /** 유로 지역 AAA 국채 현물 금리(ECB YC): 테너마다 최근 400 관측 */
  private async eur(): Promise<YieldCurve> {
    const byDate = new Map<string, Record<string, number>>();
    // 테너를 '+'로 묶어 한 번에, 시작일로 범위를 줘요(lastNObservations는 느려요)
    const start = new Date(Date.now() - (KTB_DAYS + 200) * 86400_000).toISOString().slice(0, 10);
    const text = await fetchText(`${ECB_YC}${EUR_TENORS.map((t) => t.key).join('+')}?startPeriod=${start}&format=csvdata`, { timeoutMs: 60_000, headers: { 'User-Agent': 'TICKER-app' } });
    // (ECB 데이터 포털은 User-Agent가 없는 요청에 504로 답해요. 앱 이름을 붙여요)
    for (const o of parseEcbCsv(text)) if (o.series) byDate.set(o.date, { ...(byDate.get(o.date) ?? {}), [o.series]: o.value });
    const rows = [...byDate.entries()].map(([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) throw new Error('ECB 수익률 곡선에 값이 없어요');
    const last = rows[rows.length - 1].date;
    return {
      id: 'EUR',
      name: '유로 AAA 국채',
      tenors: EUR_TENORS.filter((t) => rows.some((r) => r.values[t.key] !== undefined)),
      rows,
      // ECB는 다음 영업일 정오(중부 유럽) 무렵 전날 곡선을 올려요
      fresh: { source: 'ECBDATA', mode: 'daily', asOf: Date.parse(`${last}T17:00:00Z`), asOfDate: last, receivedAt: Date.now() },
    };
  }

  /** 국고채: 테너마다 최근 400일(8번 조회) */
  private async ktb(key: string): Promise<YieldCurve> {
    const end = new Date();
    const start = new Date(end.getTime() - KTB_DAYS * 86400_000);
    const byDate = new Map<string, Record<string, number>>();
    for (const t of KTB_ITEMS) {
      const r = await fetchJson<EcosSearch>(`${ECOS_BASE}/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/1000/817Y002/D/${ymd(start)}/${ymd(end)}/${t.key}`, { timeoutMs: 20_000 });
      if (!r.StatisticSearch) {
        if (r.RESULT?.CODE === 'INFO-200') continue; // 이 테너는 자료 없음
        throw new Error(r.RESULT ? `${r.RESULT.MESSAGE} (${r.RESULT.CODE})` : 'ECOS 응답에 값이 없어요');
      }
      for (const row of r.StatisticSearch.row ?? []) {
        const v = Number(row.DATA_VALUE);
        if (!Number.isFinite(v)) continue;
        const d = dash(row.TIME);
        byDate.set(d, { ...(byDate.get(d) ?? {}), [t.key]: v });
      }
    }
    const rows = [...byDate.entries()].map(([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) throw new Error('ECOS 국고채 금리에 값이 없어요');
    const last = rows[rows.length - 1].date;
    return {
      id: 'KTB',
      name: '국고채',
      tenors: KTB_ITEMS.filter((t) => rows.some((r) => r.values[t.key] !== undefined)),
      rows,
      // 장내 국고채 금리는 오후에 정해져요(한국 15:30 마감 뒤)
      fresh: { source: 'ECOS', mode: 'daily', asOf: Date.parse(`${last}T07:00:00Z`), asOfDate: last, receivedAt: Date.now() },
    };
  }
}
