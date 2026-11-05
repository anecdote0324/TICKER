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
      const recs = (await this.shareRecords(inst.code)).map((r) => ({ ...r, nav: r.nav ?? navByDate.get(r.date) }));
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
        fresh: this.fresh(60_000),
        note: comp.status === 'rejected' ? `구성종목 조회 실패: ${(comp.reason as Error).message}` : undefined,
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
