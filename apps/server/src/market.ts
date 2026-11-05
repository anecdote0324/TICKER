// v0.4 지수·ETF·호가: MEMB·MOV(ETF 구성으로 지수 구성 근사), ETF 분석과 FFLO(앱이 모은 상장 주수 기록), BQ 10호가.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  etfFlows,
  MEMB_KR_ETF,
  US_MAP_ETF,
  withContribution,
  type BookMarket,
  type EtfNavRow,
  type EtfResponse,
  type Freshness,
  type Instrument,
  type MembIndex,
  type MembResponse,
  type MembRow,
  type OrderbookResponse,
  type SectorMapResponse,
} from '@bt/shared';
import type { KisAdapter } from './adapters/kis';
import { fetchJson, HttpError } from './util';

const KRX_ETF_URL = 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd';

/** KRX ETF 일별매매정보 한 줄에서 쓰는 칸(값은 모두 문자열) */
export interface KrxEtfDay {
  shares: number;
  nav?: number;
  netAssets?: number;
}

/** KRX ETF 일별매매정보 응답 → 종목코드 → 상장 좌수·NAV·순자산. ISU_CD가 12자리 표준코드면 가운데 6자리가 단축코드예요 */
export function parseKrxEtf(res: { OutBlock_1?: Array<Record<string, string>> }): Map<string, KrxEtfDay> {
  const out = new Map<string, KrxEtfDay>();
  for (const o of res.OutBlock_1 ?? []) {
    const raw = String(o.ISU_CD ?? o.ISU_SRT_CD ?? '').trim();
    const code = raw.length === 12 ? raw.slice(3, 9) : raw.replace(/^A/, '');
    const shares = num(o.LIST_SHRS);
    if (!code || !shares) continue;
    out.set(code, { shares, nav: num(o.NAV), netAssets: num(o.INVSTASST_NETASST_TOTAMT) });
  }
  return out;
}

type Row = Record<string, string>;

const num = (v: unknown): number | undefined => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  const n = Number(t);
  return t === '' || !Number.isFinite(n) ? undefined : n;
};
const signed = (v: unknown, sign: unknown) => {
  const n = num(v);
  if (n === undefined) return undefined;
  return sign === '4' || sign === '5' ? -Math.abs(n) : sign === '1' || sign === '2' ? Math.abs(n) : n;
};
const day = (v: unknown) => {
  const t = String(v ?? '');
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '';
};
const kstIso = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

/** ETF 구성종목 줄 → 지수 구성 줄(현금·선물처럼 6자리 종목코드가 아닌 줄은 빼요) */
export function parseComponents(rows: Row[]): MembRow[] {
  return rows
    .map((o) => ({
      code: String(o.stck_shrn_iscd ?? '').trim(),
      name: String(o.hts_kor_isnm ?? '').trim(),
      weight: num(o.etf_cnfg_issu_rlim),
      last: num(o.stck_prpr) || undefined,
      changePct: signed(o.prdy_ctrt, o.prdy_vrss_sign),
    }))
    .filter((r) => /^[0-9A-Z]{6}$/.test(r.code) && r.name)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}

export function parseNavDaily(rows: Row[]): EtfNavRow[] {
  return rows
    .map((o) => ({ date: day(o.stck_bsop_date), close: num(o.stck_clpr), nav: num(o.nav), gap: num(o.dprt) }))
    .filter((r) => r.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function parseBook(book: Row, expected: Row): Pick<OrderbookResponse, 'time' | 'asks' | 'bids' | 'totalAsk' | 'totalBid' | 'expected'> {
  const asks: OrderbookResponse['asks'] = [];
  const bids: OrderbookResponse['bids'] = [];
  for (let i = 1; i <= 10; i++) {
    const ap = num(book[`askp${i}`]);
    const bp = num(book[`bidp${i}`]);
    if (ap) asks.push({ price: ap, qty: num(book[`askp_rsqn${i}`]) ?? 0, change: num(book[`askp_rsqn_icdc${i}`]) });
    if (bp) bids.push({ price: bp, qty: num(book[`bidp_rsqn${i}`]) ?? 0, change: num(book[`bidp_rsqn_icdc${i}`]) });
  }
  const t = String(book.aspr_acpt_hour ?? '').padStart(6, '0');
  const ep = num(expected.antc_cnpr);
  return {
    time: /^\d{6}$/.test(t) && t !== '000000' ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : undefined,
    asks,
    bids,
    totalAsk: num(book.total_askp_rsqn),
    totalBid: num(book.total_bidp_rsqn),
    expected: ep ? { price: ep, qty: num(expected.antc_vol) } : undefined,
  };
}

interface ShareRecord {
  date: string;
  shares: number;
  nav?: number;
}

export class MarketService {
  private cache = new Map<string, { at: number; p: Promise<unknown> }>();
  private shares?: Record<string, ShareRecord[]>;
  private krxKey?: string;
  /** KRX 날짜별 ETF 자료(지난 날은 바뀌지 않아서 데이터 폴더 krx-etf.json에 둬요) */
  private krxDays?: Record<string, Record<string, KrxEtfDay>>;

  constructor(
    private dataDir: string | undefined,
    private kis: () => KisAdapter | undefined,
    private instruments: () => Map<string, Instrument>,
    private usMap: (index: 'SPX' | 'NDX') => Promise<SectorMapResponse>,
  ) {}

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
    const p = load();
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  private needKis(): KisAdapter {
    const k = this.kis();
    if (!k) throw new Error('한국투자증권 키를 넣으면 보여요(설정 → 데이터 연결)');
    return k;
  }

  private fresh(ms: number, market: 'KS' | 'US' = 'KS'): Freshness {
    const now = Date.now();
    void market;
    return { source: 'KIS', mode: 'poll', asOf: now, receivedAt: now, intervalMs: ms };
  }

  private idOf(code: string): string | undefined {
    const m = this.instruments();
    return (m.get(`EQ:KS:${code}`) ?? m.get(`EQ:KQ:${code}`))?.id;
  }

  /** MEMB·MOV: 지수 구성(국내는 ETF 구성종목, 미국은 IMAP과 같은 ETF 보유 종목)과 기여도. 1분 캐시 */
  memb(index: MembIndex): Promise<MembResponse> {
    return this.cached(`memb|${index}`, 60_000, async () => {
      if (index === 'SPX' || index === 'NDX') {
        const r = await this.usMap(index);
        const rows: MembRow[] = r.sectors
          .flatMap((s) => s.members)
          .map((m) => ({ code: m.code, id: m.id, name: m.name, weight: m.weight, last: m.last, changePct: m.changePct }))
          .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
        const w = withContribution(rows);
        const src = US_MAP_ETF[index];
        return { index, source: { etf: src.etf, issuer: src.issuer, asOf: r.holdings?.asOf }, rows: w.rows, totalContribution: w.total, fresh: r.fresh ?? this.fresh(60_000, 'US'), note: r.liveError ?? r.holdings?.error };
      }
      const etf = MEMB_KR_ETF[index];
      const { rows } = await this.needKis().etfComponents(etf.code);
      const parsed = parseComponents(rows).map((r) => ({ ...r, id: this.idOf(r.code) }));
      const w = withContribution(parsed);
      return { index, source: { etf: `${etf.name}(${etf.code})`, issuer: '한국투자증권 ETF 구성종목시세' }, rows: w.rows, totalContribution: w.total, fresh: this.fresh(60_000) };
    });
  }

  /** ETF 분석: 현재가·NAV·괴리율, NAV 비교추이(일), 구성종목, 상장 주수 기록(FFLO) */
  etf(id: string): Promise<EtfResponse> {
    return this.cached(`etf|${id}`, 60_000, async () => {
      const inst = this.instruments().get(id);
      if (!inst || (inst.market !== 'KS' && inst.market !== 'KQ')) throw new Error('국내 ETF만 볼 수 있어요');
      const kis = this.needKis();
      const [p, nav, comp] = await Promise.allSettled([kis.etfPrice(inst.code), kis.etfNavDaily(inst.code), kis.etfComponents(inst.code)]);
      const o: Row = p.status === 'fulfilled' ? p.value : {};
      if (p.status === 'rejected' && nav.status === 'rejected') throw new Error((p.reason as Error).message);
      const listedShares = num(o.lstn_stcn);
      const navNow = num(o.nav);
      if (listedShares) await this.recordShares(inst.code, { date: kstIso(Date.now()), shares: listedShares, nav: navNow });
      const navDaily = nav.status === 'fulfilled' ? parseNavDaily(nav.value).slice(0, 30) : [];
      // 지난 NAV 비교추이로 기록에 NAV를 채워요(그날 상장 주수는 앱이 본 날만 있어요)
      const navByDate = new Map(navDaily.map((r) => [r.date, r.nav]));
      // KRX 인증키가 있으면 KRX 일별 자료, 없거나 실패하면 앱이 모은 기록
      let krxNote: string | undefined;
      const krx = await this.krxRecords(inst.code).catch((e: Error) => {
        krxNote = `KRX 조회 실패(앱 기록으로 보여 줘요): ${e.message}`;
        return undefined;
      });
      const own = (await this.shareRecords(inst.code)).map((r) => ({ ...r, nav: r.nav ?? navByDate.get(r.date) }));
      const recs = krx && krx.length ? [...krx, ...own.filter((r) => !krx.some((k) => k.date === r.date))] : own;
      return {
        id,
        name: inst.nameKo,
        price: num(o.stck_prpr),
        changePct: signed(o.prdy_ctrt, o.prdy_vrss_sign),
        nav: navNow,
        gap: num(o.dprt),
        trackingError: num(o.trc_errt),
        netAssets: num(o.etf_ntas_ttam) !== undefined ? num(o.etf_ntas_ttam)! * 1e8 : undefined,
        listedShares,
        componentCount: num(o.etf_cnfg_issu_cnt),
        category: String(o.etf_div_name ?? '').trim() || undefined,
        dividendCycle: String(o.etf_dvdn_cycl ?? '').trim() || undefined,
        navDaily,
        components: comp.status === 'fulfilled' ? parseComponents(comp.value.rows).map((r) => ({ ...r, id: this.idOf(r.code) })) : [],
        flows: etfFlows(recs),
        flowSource: krx && krx.length ? 'krx' : 'app',
        fresh: this.fresh(60_000),
        note: [comp.status === 'rejected' ? `구성종목 조회 실패: ${(comp.reason as Error).message}` : '', krxNote ?? ''].filter(Boolean).join(' · ') || undefined,
      };
    });
  }

  /** BQ 10호가: 2초 동안 같은 값 */
  orderbook(id: string, market: BookMarket): Promise<OrderbookResponse> {
    return this.cached(`book|${id}|${market}`, 2_000, async () => {
      const inst = this.instruments().get(id);
      if (!inst || (inst.market !== 'KS' && inst.market !== 'KQ')) throw new Error('10호가는 국내 종목만 볼 수 있어요');
      const r = await this.needKis().orderbook(inst.code, market);
      const now = Date.now();
      return { id, market, ...parseBook(r.book, r.expected), fresh: { source: 'KIS', mode: 'poll', asOf: now, receivedAt: now, intervalMs: 2_000 } };
    });
  }

  // ── KRX Open API(FFLO 일별 상장 좌수) ──

  setKrxKey(key: string | undefined) {
    this.krxKey = key;
    this.cache.clear();
  }

  private async krxDay(key: string, ymd: string): Promise<Map<string, KrxEtfDay>> {
    const res = await fetchJson<{ OutBlock_1?: Array<Record<string, string>>; respMsg?: string; respCode?: string }>(`${KRX_ETF_URL}?basDd=${ymd}`, { headers: { AUTH_KEY: key }, timeoutMs: 20_000 });
    if (res.respCode && res.respCode !== '200' && !res.OutBlock_1) throw new Error(`KRX ${res.respCode} ${res.respMsg ?? ''}`.trim());
    return parseKrxEtf(res);
  }

  /** 인증키 확인: 최근 거래일(오늘부터 거꾸로 7일 안) ETF 자료를 받아 봐요 */
  async testKrx(key: string): Promise<{ ok: boolean; message: string }> {
    try {
      for (let i = 1; i <= 7; i++) {
        const d = kstIso(Date.now() - i * 86400_000).replace(/-/g, '');
        const m = await this.krxDay(key, d);
        if (m.size) return { ok: true, message: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)} ETF ${m.size}개 자료를 받았어요` };
      }
      return { ok: false, message: '최근 7일 ETF 자료가 비어 있어요(ETF 일별매매정보 서비스를 신청했는지 확인해 주세요)' };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return { ok: false, message: 'KRX가 인증키를 받지 않았어요(키와 ETF 일별매매정보 서비스 신청을 확인해 주세요)' };
      return { ok: false, message: `KRX에 연결하지 못했어요: ${(e as Error).message}` };
    }
  }

  private async loadKrxDays(): Promise<Record<string, Record<string, KrxEtfDay>>> {
    if (this.krxDays) return this.krxDays;
    try {
      this.krxDays = this.dataDir ? (JSON.parse(await readFile(join(this.dataDir, 'krx-etf.json'), 'utf8')) as Record<string, Record<string, KrxEtfDay>>) : {};
    } catch {
      this.krxDays = {};
    }
    return this.krxDays;
  }

  /** FFLO: KRX로 최근 거래일(달력 45일)의 상장 좌수·NAV. 지난 날은 한 번 받으면 다시 받지 않아요 */
  private async krxRecords(code: string): Promise<ShareRecord[] | undefined> {
    const key = this.krxKey;
    if (!key) return undefined;
    const days = await this.loadKrxDays();
    const today = kstIso(Date.now());
    let changed = false;
    const out: ShareRecord[] = [];
    for (let i = 1; i <= 45; i++) {
      const iso = kstIso(Date.now() - i * 86400_000);
      const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const ymd = iso.replace(/-/g, '');
      let day = days[ymd];
      if (!day) {
        const m = await this.krxDay(key, ymd);
        day = Object.fromEntries(m);
        // 휴장일은 빈 자료라 그대로 둬요(다시 묻지 않게). 오늘 자료는 장이 끝나야 나와서 어제까지만 물어요
        if (iso < today) {
          days[ymd] = day;
          changed = true;
        }
      }
      const r = day[code];
      if (r) out.push({ date: iso, shares: r.shares, nav: r.nav });
    }
    if (changed && this.dataDir) {
      // 오래된 날은 지워요(90일)
      const cutoff = kstIso(Date.now() - 90 * 86400_000).replace(/-/g, '');
      for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
      void writeFile(join(this.dataDir, 'krx-etf.json'), JSON.stringify(days)).catch(() => undefined);
    }
    return out;
  }

  // ── FFLO 상장 주수 기록(데이터 폴더의 etf-shares.json, ETF마다 최근 400일) ──

  private async loadShares(): Promise<Record<string, ShareRecord[]>> {
    if (this.shares) return this.shares;
    try {
      this.shares = this.dataDir ? (JSON.parse(await readFile(join(this.dataDir, 'etf-shares.json'), 'utf8')) as Record<string, ShareRecord[]>) : {};
    } catch {
      this.shares = {};
    }
    return this.shares;
  }

  private async shareRecords(code: string): Promise<ShareRecord[]> {
    return (await this.loadShares())[code] ?? [];
  }

  private async recordShares(code: string, rec: ShareRecord): Promise<void> {
    const all = await this.loadShares();
    const list = (all[code] ?? []).filter((r) => r.date !== rec.date);
    list.push(rec);
    list.sort((a, b) => a.date.localeCompare(b.date));
    all[code] = list.slice(-400);
    if (this.dataDir) void writeFile(join(this.dataDir, 'etf-shares.json'), JSON.stringify(all)).catch(() => undefined);
  }
}
