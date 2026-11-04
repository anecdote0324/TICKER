// ECO 경제 캘린더(03 v0.3).
// - BEA 공표일정(release_dates.json, 키 없음): 발표 시각까지 와요
// - FRED releases/dates(키): 날짜만 와서, 주요 발표에는 관례 시각(뉴욕)을 붙이고 '관례 시각'으로 표시해요
// - 실제·이전 값: FRED 시계열의 가장 최근 두 값(물가는 전년 대비 %, 고용은 전월 대비 증감 등)
// - 한국: BOK ECOS 100대 통계지표(KeyStatisticList)의 최근 값. 한국 발표 일정은 아직 형식을 확인하지 못했어요(07)
// - BLS 공표일정은 자동 요청을 403으로 막아서 쓰지 않아요(04)

import { zonedToUtc, type EcoEvent, type EcoKeyStat, type EcoResponse } from '@bt/shared';
import { fetchJson, type Logger } from './util';

const NY = 'America/New_York';
const BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json';
const FRED = 'https://api.stlouisfed.org/fred';
const ECOS = 'https://ecos.bok.or.kr/api';

/** 값 바꾸기: level 그대로, yoy 전년 같은 달 대비 %, mom 전월 대비 %, diff 전기 대비 증감 */
type Transform = 'level' | 'yoy' | 'mom' | 'diff';

export interface IndicatorDef {
  /** 원천 이름에 들어가는 글자(소문자로 비교) */
  match: string;
  name: string;
  /** FRED만 날짜를 줘요. 관례 시각(뉴욕) */
  usualTime?: string;
  series?: { id: string; transform: Transform; unit: string; digits?: number; scale?: number };
}

/** 보여 줄 발표: 앞에서부터 이름이 맞는 것을 써요 */
export const INDICATORS: IndicatorDef[] = [
  { match: 'gross domestic product by state', name: '주별 GDP·개인소득' },
  { match: 'gross domestic product', name: 'GDP(실질, 전기 대비 연율)', series: { id: 'A191RL1Q225SBEA', transform: 'level', unit: '%', digits: 1 } },
  { match: 'personal income and outlays', name: '개인소득·지출(PCE 물가)', series: { id: 'PCEPI', transform: 'yoy', unit: '%', digits: 1 } },
  { match: 'international trade in goods and services', name: '무역수지(상품·서비스)', series: { id: 'BOPGSTB', transform: 'level', unit: '억 달러', scale: 1 / 100, digits: 0 } },
  { match: 'international transactions', name: '경상수지(분기)' },
  { match: 'consumer price index', name: 'CPI 소비자물가(전년 대비)', usualTime: '08:30', series: { id: 'CPIAUCSL', transform: 'yoy', unit: '%', digits: 1 } },
  { match: 'employment situation', name: '고용보고서(비농업 고용 증감)', usualTime: '08:30', series: { id: 'PAYEMS', transform: 'diff', unit: '천 명', digits: 0 } },
  { match: 'producer price index', name: 'PPI 생산자물가(전년 대비)', usualTime: '08:30', series: { id: 'PPIFIS', transform: 'yoy', unit: '%', digits: 1 } },
  { match: 'advance monthly sales for retail', name: '소매판매(전월 대비)', usualTime: '08:30', series: { id: 'RSAFS', transform: 'mom', unit: '%', digits: 1 } },
  { match: 'industrial production and capacity utilization', name: '산업생산(전월 대비)', usualTime: '09:15', series: { id: 'INDPRO', transform: 'mom', unit: '%', digits: 1 } },
  { match: 'job openings and labor turnover', name: 'JOLTS 구인 건수', usualTime: '10:00', series: { id: 'JTSJOL', transform: 'level', unit: '천 건', digits: 0 } },
  { match: 'unemployment insurance weekly claims', name: '신규 실업수당 청구', usualTime: '08:30', series: { id: 'ICSA', transform: 'level', unit: '천 건', scale: 1 / 1000, digits: 0 } },
  { match: 'new residential construction', name: '주택 착공(연율)', usualTime: '08:30', series: { id: 'HOUST', transform: 'level', unit: '천 호', digits: 0 } },
  { match: 'fomc press release', name: 'FOMC 기준금리(상단)', usualTime: '14:00', series: { id: 'DFEDTARU', transform: 'level', unit: '%', digits: 2 } },
  { match: 'surveys of consumers', name: '미시간대 소비자심리', usualTime: '10:00', series: { id: 'UMCSENT', transform: 'level', unit: '', digits: 1 } },
  { match: 'employment cost index', name: '고용비용지수', usualTime: '08:30' },
  { match: 'advance durable goods', name: '내구재 주문', usualTime: '08:30' },
];

export function indicatorOf(name: string): IndicatorDef | undefined {
  const n = name.toLowerCase();
  return INDICATORS.find((d) => n.includes(d.match));
}

/** 시계열 → (최근, 이전, 최근 기간) 문자열 */
export function transformSeries(obs: Array<{ date: string; value: string }>, s: NonNullable<IndicatorDef['series']>): { latest?: string; previous?: string; period?: string } {
  const pts = obs.map((o) => ({ date: o.date, v: Number(o.value) })).filter((o) => Number.isFinite(o.v));
  const at = (i: number): number | undefined => {
    const p = pts[i];
    if (!p) return undefined;
    if (s.transform === 'level') return p.v * (s.scale ?? 1);
    if (s.transform === 'diff') return i > 0 ? (p.v - pts[i - 1].v) * (s.scale ?? 1) : undefined;
    if (s.transform === 'mom') return i > 0 ? (p.v / pts[i - 1].v - 1) * 100 : undefined;
    // 전년 같은 달: 12개 앞(월간 자료)
    return i >= 12 ? (p.v / pts[i - 12].v - 1) * 100 : undefined;
  };
  const fmt = (v: number | undefined) => (v === undefined ? undefined : `${v.toFixed(s.digits ?? 1)}${s.unit ? ` ${s.unit}` : ''}`.replace(' %', '%'));
  const n = pts.length;
  return { latest: fmt(at(n - 1)), previous: fmt(at(n - 2)), period: pts[n - 1]?.date.slice(0, 7) };
}

/** 한국 100대 통계지표에서 보여 줄 이름(들어가면) */
const KOREA_KEYS = ['기준금리', '경제성장률', '소비자물가', '생산자물가', '실업률', '고용률', '경상수지', '수출', '수입', '산업생산', '국고채', '원/달러'];

/**
 * ICE BofA 크레딧 스프레드(OAS, %p). FRED는 최근 3년만 줘서 v0.3부터 매일 받아 history.db에 쌓아요(04).
 * 뒤 버전(크레딧 화면)이 이 이력을 써요
 */
export const CREDIT_SPREADS: Array<{ id: string; name: string }> = [
  { id: 'BAMLH0A0HYM2', name: '미국 하이일드 OAS' },
  { id: 'BAMLC0A0CM', name: '미국 투자등급 회사채 OAS' },
  { id: 'BAMLC0A4CBBB', name: '미국 BBB 회사채 OAS' },
  { id: 'BAMLEMCBPIOAS', name: '신흥국 회사채 OAS' },
];

/** 쌓아 둘 곳(History.save와 같은 모양) */
export interface SpreadStore {
  save(id: string, interval: '1d', bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>): void;
}

export class EcoService {
  private fredKey?: string;
  private cache: { at: number; res: Promise<EcoResponse> } | null = null;
  private spreadTimer?: NodeJS.Timeout;

  constructor(
    private log: Logger,
    /** GC와 같은 ECOS 인증키 */
    private ecosKey: () => string | undefined,
  ) {}

  setFredKey(key: string | undefined) {
    this.fredKey = key;
    this.cache = null;
    if (key && this.store) void this.archiveSpreads();
  }

  private store?: SpreadStore;

  /** 크레딧 스프레드 쌓기 시작: 켤 때 한 번, 그 뒤 12시간마다(키가 있을 때만) */
  startSpreadArchive(store: SpreadStore | undefined) {
    this.store = store;
    if (!store) return;
    void this.archiveSpreads();
    this.spreadTimer = setInterval(() => void this.archiveSpreads(), 12 * 3600_000);
    this.spreadTimer.unref?.();
  }

  async archiveSpreads(): Promise<number> {
    const key = this.fredKey;
    if (!key || !this.store) return 0;
    let saved = 0;
    for (const s of CREDIT_SPREADS) {
      try {
        const start = new Date(Date.now() - 3 * 366 * 86400_000).toISOString().slice(0, 10);
        const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
          `${FRED}/series/observations?series_id=${s.id}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}`,
          { timeoutMs: 30_000 },
        );
        const bars = (r.observations ?? [])
          .map((o) => ({ t: Math.floor(Date.parse(`${o.date}T00:00:00Z`) / 1000), v: Number(o.value) }))
          .filter((o) => Number.isFinite(o.v) && Number.isFinite(o.t))
          .map((o) => ({ t: o.t, o: o.v, h: o.v, l: o.v, c: o.v, v: 0 }));
        if (bars.length) this.store.save(`FRED:${s.id}`, '1d', bars);
        saved += bars.length;
      } catch (e) {
        this.log.warn(`크레딧 스프레드 ${s.id}를 받지 못했어요: ${(e as Error).message}`);
      }
    }
    if (saved) this.log.info(`크레딧 스프레드 ${saved}개 값을 저장했어요(history.db)`);
    return saved;
  }

  async testFred(key: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(`${FRED}/series/observations?series_id=DGS10&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=1`, { timeoutMs: 15_000 });
      const o = r.observations?.[0];
      return o ? { ok: true, message: `미국 10년물 ${o.value}% (${o.date})를 받았어요` } : { ok: false, message: '응답에 값이 없어요' };
    } catch (e) {
      const m = (e as Error).message;
      return { ok: false, message: /400|403/.test(m) ? 'FRED API 키가 맞지 않아요' : `FRED에 연결하지 못했어요: ${m}` };
    }
  }

  get(): Promise<EcoResponse> {
    if (this.cache && Date.now() - this.cache.at < 3 * 3600_000) return this.cache.res;
    const res = this.load();
    this.cache = { at: Date.now(), res };
    res.catch(() => (this.cache = null));
    return res;
  }

  private async load(): Promise<EcoResponse> {
    const now = Date.now();
    const from = now - 14 * 86400_000;
    const to = now + 30 * 86400_000;
    const events: EcoEvent[] = [];
    const missing: EcoResponse['missing'] = [];
    // BEA: 시각까지
    try {
      const bea = await fetchJson<Record<string, { release_dates?: string[] }>>(BEA_URL, { timeoutMs: 20_000 });
      for (const [name, v] of Object.entries(bea)) {
        const def = indicatorOf(name);
        for (const iso of new Set(v.release_dates ?? [])) {
          const at = Date.parse(iso);
          if (!Number.isFinite(at) || at < from || at > to) continue;
          events.push({ id: `BEA:${name}:${iso}`, at, time: 'exact', country: 'US', name: def?.name ?? name, sourceName: name, source: 'BEA' });
        }
      }
    } catch (e) {
      missing.push({ what: 'BEA 공표일정', reason: (e as Error).message });
    }
    // FRED: 날짜만(주요 발표만, BEA와 겹치는 것은 빼요)
    if (this.fredKey) {
      try {
        const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
        const q = new URLSearchParams({ api_key: this.fredKey, file_type: 'json', realtime_start: ymd(from), realtime_end: ymd(to), include_release_dates_with_no_data: 'true', limit: '1000', sort_order: 'asc' });
        const r = await fetchJson<{ release_dates?: Array<{ release_id: number; release_name: string; date: string }> }>(`${FRED}/releases/dates?${q}`, { timeoutMs: 20_000 });
        const beaNames = new Set(events.map((e) => indicatorOf(e.sourceName)?.match).filter(Boolean));
        for (const d of r.release_dates ?? []) {
          const def = indicatorOf(d.release_name);
          if (!def || beaNames.has(def.match)) continue;
          const at = def.usualTime ? zonedToUtc(d.date, def.usualTime, NY) : Date.parse(`${d.date}T12:00:00Z`);
          events.push({ id: `FRED:${d.release_id}:${d.date}`, at, time: def.usualTime ? 'usual' : 'none', country: 'US', name: def.name, sourceName: d.release_name, source: 'FRED' });
        }
        // 실제·이전 값(지표마다 시계열 한 번)
        const need = new Map<string, NonNullable<IndicatorDef['series']>>();
        for (const e of events) {
          const s = indicatorOf(e.sourceName)?.series;
          if (s) need.set(s.id, s);
        }
        const values = new Map<string, ReturnType<typeof transformSeries>>();
        for (const [id, s] of need) {
          try {
            const o = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(
              `${FRED}/series/observations?series_id=${id}&api_key=${encodeURIComponent(this.fredKey)}&file_type=json&sort_order=desc&limit=14`,
              { timeoutMs: 15_000 },
            );
            values.set(id, transformSeries([...(o.observations ?? [])].reverse(), s));
          } catch (e) {
            this.log.warn(`FRED ${id}를 받지 못했어요: ${(e as Error).message}`);
          }
        }
        for (const e of events) {
          const s = indicatorOf(e.sourceName)?.series;
          const v = s ? values.get(s.id) : undefined;
          if (v) Object.assign(e, v);
        }
      } catch (e) {
        missing.push({ what: 'FRED 발표일', reason: (e as Error).message });
      }
    } else missing.push({ what: 'FRED', reason: 'FRED API 키를 넣으면 CPI·고용보고서 같은 발표일과 최근 값이 보여요(설정 → 데이터 연결)' });
    events.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name, 'ko'));
    // 한국 주요 지표(최근 값)
    const korea: EcoKeyStat[] = [];
    const ek = this.ecosKey();
    if (ek) {
      try {
        const r = await fetchJson<{ KeyStatisticList?: { row?: Array<{ CLASS_NAME: string; KEYSTAT_NAME: string; DATA_VALUE: string; CYCLE: string; UNIT_NAME: string }> } }>(
          `${ECOS}/KeyStatisticList/${encodeURIComponent(ek)}/json/kr/1/120`,
          { timeoutMs: 20_000 },
        );
        for (const x of r.KeyStatisticList?.row ?? []) {
          if (!KOREA_KEYS.some((k) => x.KEYSTAT_NAME.includes(k))) continue;
          korea.push({ group: x.CLASS_NAME, name: x.KEYSTAT_NAME, value: x.DATA_VALUE, unit: x.UNIT_NAME, cycle: x.CYCLE });
        }
      } catch (e) {
        missing.push({ what: 'BOK ECOS 주요 지표', reason: (e as Error).message });
      }
    } else missing.push({ what: '한국 지표', reason: 'BOK ECOS 인증키를 넣으면 한국 주요 지표의 최근 값이 보여요(설정 → 데이터 연결)' });
    return { events, korea, missing, fresh: { source: this.fredKey ? 'FRED' : 'BEA', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
  }
}
