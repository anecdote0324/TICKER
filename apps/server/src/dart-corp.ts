// v0.4 DART 종목 정보: MGMT(임원·보수), RELS(타법인 출자), HDS(최대주주·5% 대량보유·임원 소유), ERN(잠정실적 공시와 주가 반응), CF(공시 검색).
// OpenDART 정기보고서 주요정보는 가장 최근 보고서를 3분기 → 반기 → 1분기 → 지난해 사업보고서 순서로 찾아요. 종목별 12시간 캐시.

import {
  DART_REPORTS,
  dartNum,
  quarterBefore,
  type Bar,
  type DartPeriod,
  type DisclosureResponse,
  type DisclosureRow,
  type EarningsResponse,
  type EarningsRow,
  type FinancialsResponse,
  type Freshness,
  type HoldersResponse,
  type InsiderRow,
  type Instrument,
  type MgmtResponse,
  type RelsResponse,
} from '@bt/shared';
import { dartList, type NewsService } from './news';
import { fetchJson } from './util';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const TTL = 12 * 3600_000;
const LIST_TTL = 5 * 60_000;

type Row = Record<string, string>;
interface DartRes {
  status: string;
  message: string;
  list?: Row[];
}

const s = (v: unknown) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t && t !== '-' ? t : undefined;
};
const day = (v: unknown) => {
  const t = String(v ?? '').replace(/[^0-9]/g, '');
  return t.length >= 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '';
};
const kstIso = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const ymd = (ms: number) => kstIso(ms).replace(/-/g, '');
const viewer = (rcept: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}`;

/** 가장 최근 정기보고서 후보(최근 먼저): 올해 3분기·반기·1분기, 지난해 사업보고서, 지난해 3분기, 재작년 사업보고서 */
export function reportCandidates(nowMs: number): DartPeriod[] {
  const y = new Date(nowMs + 9 * 3600_000).getUTCFullYear();
  const list: Array<[number, string]> = [
    [y, '11014'],
    [y, '11012'],
    [y, '11013'],
    [y - 1, '11011'],
    [y - 1, '11014'],
    [y - 2, '11011'],
  ];
  return list.map(([year, reprt]) => ({ year, reprt, label: `${year} ${DART_REPORTS[reprt]}` }));
}

export function parseExecutives(list: Row[]): MgmtResponse['executives'] {
  return list
    .map((o) => ({
      name: s(o.nm) ?? '',
      position: s(o.ofcps) ?? '',
      registered: s(o.rgist_exctv_at),
      fullTime: s(o.fte_at),
      duty: s(o.chrg_job),
      career: s(o.main_career),
      tenure: s(o.hffc_pd),
      gender: s(o.sexdstn),
      birth: s(o.birth_ym),
      relation: s(o.mxmm_shrholdr_relate),
    }))
    .filter((e) => e.name);
}

export function parseInsiders(list: Row[]): InsiderRow[] {
  return list
    .map((o) => ({
      date: day(o.rcept_dt),
      reporter: s(o.repror) ?? '',
      registered: s(o.isu_exctv_rgist_at),
      position: s(o.isu_exctv_ofcps),
      mainHolder: s(o.isu_main_shrholdr),
      shares: dartNum(o.sp_stock_lmp_cnt),
      change: dartNum(o.sp_stock_lmp_irds_cnt),
      pct: dartNum(o.sp_stock_lmp_rate),
      url: viewer(String(o.rcept_no ?? '')),
    }))
    .filter((r) => r.date && r.reporter)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** ERN: 잠정실적 공시만 골라요(정정 공시도 포함) */
export function isEarningsTitle(title: string): boolean {
  return /잠정\)?실적|영업\(잠정\)|실적\(잠정\)/.test(title.replace(/\s/g, ''));
}

/** 발표일 종가 반응: 발표일(장 마감 뒤 공시면 다음 거래일) 종가의 전일 대비, 다음 날까지 */
export function reaction(bars: Bar[], dateIso: string): { r1?: number; r2?: number } {
  const t = Date.parse(`${dateIso}T00:00:00Z`) / 1000;
  const i = bars.findIndex((b) => b.t >= t);
  if (i <= 0) return {};
  const prev = bars[i - 1].c;
  const r1 = (bars[i].c / prev - 1) * 100;
  const r2 = bars[i + 1] ? (bars[i + 1].c / prev - 1) * 100 : undefined;
  return { r1, r2 };
}

export class DartCorpService {
  private cache = new Map<string, { at: number; p: Promise<unknown> }>();

  constructor(
    private news: NewsService | undefined,
    private instruments: () => Map<string, Instrument>,
    private bars: (id: string) => Promise<Bar[]>,
    private quarterly: (inst: Instrument) => Promise<FinancialsResponse>,
  ) {}

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
    const p = load();
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  private key(): string {
    const k = this.news?.dartKeyValue;
    if (!k) throw new Error('DART 인증키를 넣으면 보여요(설정 → 데이터 연결)');
    return k;
  }

  private async corp(id: string): Promise<{ inst: Instrument; corp: string }> {
    const inst = this.instruments().get(id);
    if (!inst) throw new Error(`종목 ${id}을(를) 찾지 못했어요`);
    if (inst.assetClass !== 'EQUITY' || (inst.market !== 'KS' && inst.market !== 'KQ')) throw new Error('국내 주식만 볼 수 있어요(DART)');
    this.key();
    const corp = await this.news!.corpCodeOf(inst.code);
    if (!corp) throw new Error(`${inst.code}의 DART 고유번호를 찾지 못했어요`);
    return { inst, corp };
  }

  private async get(path: string, params: Record<string, string>): Promise<Row[]> {
    const q = new URLSearchParams({ crtfc_key: this.key(), ...params });
    const r = await fetchJson<DartRes>(`${DART_BASE}/${path}?${q}`, { timeoutMs: 20_000 });
    if (r.status === '013') return [];
    if (r.status !== '000') throw new Error(`DART ${r.status}: ${r.message}`);
    return r.list ?? [];
  }

  /** 정기보고서 주요정보: 가장 최근 보고서에서 찾아요 */
  private async latest(path: string, corp: string): Promise<{ period?: DartPeriod; list: Row[] }> {
    for (const p of reportCandidates(Date.now())) {
      const list = await this.get(path, { corp_code: corp, bsns_year: String(p.year), reprt_code: p.reprt });
      if (list.length) return { period: p, list };
    }
    return { list: [] };
  }

  private fresh(ttl: number): Freshness {
    const now = Date.now();
    return { source: 'DART', mode: 'release', asOf: now, receivedAt: now, asOfFromReceipt: true, intervalMs: ttl };
  }

  mgmt(id: string): Promise<MgmtResponse> {
    return this.cached(`mgmt|${id}`, TTL, async () => {
      const { corp } = await this.corp(id);
      const ex = await this.latest('exctvSttus.json', corp);
      // 보수는 반기·사업보고서에만 있어서 따로 찾아요
      const payAll = await this.latest('hmvAuditAllSttus.json', corp).catch(() => ({ list: [] as Row[] }));
      const payTop = await this.latest('hmvAuditIndvdlBySttus.json', corp).catch(() => ({ list: [] as Row[] }));
      return {
        id,
        period: ex.period,
        executives: parseExecutives(ex.list),
        pay: payAll.list.map((o) => ({ group: s(o.se) ?? '임원 전체', count: dartNum(o.nmpr), total: dartNum(o.mendng_totamt), avg: dartNum(o.jan_avrg_mendng_am) })),
        topPay: payTop.list.map((o) => ({ name: s(o.nm) ?? '', position: s(o.ofcps), total: dartNum(o.mendng_totamt) })).filter((x) => x.name),
        fresh: this.fresh(TTL),
      };
    });
  }

  rels(id: string): Promise<RelsResponse> {
    return this.cached(`rels|${id}`, TTL, async () => {
      const { corp } = await this.corp(id);
      const r = await this.latest('otrCprInvstmntSttus.json', corp);
      const rows = r.list
        .map((o) => ({
          name: s(o.inv_prm) ?? '',
          purpose: s(o.invstmnt_purps),
          firstAcq: day(o.frst_acqs_de) || undefined,
          shares: dartNum(o.trmend_blce_qy),
          pct: dartNum(o.trmend_blce_qota_rt),
          book: dartNum(o.trmend_blce_acntbk_amount),
          assets: dartNum(o.recent_bsns_year_fnnr_sttus_tot_assets),
          netIncome: dartNum(o.recent_bsns_year_fnnr_sttus_thstrm_ntpf),
        }))
        .filter((x) => x.name && x.name !== '합계' && x.name !== '계')
        .sort((a, b) => (b.book ?? 0) - (a.book ?? 0));
      return { id, period: r.period, rows, fresh: this.fresh(TTL) };
    });
  }

  holders(id: string): Promise<HoldersResponse> {
    return this.cached(`hds|${id}`, TTL, async () => {
      const { corp } = await this.corp(id);
      const [lg, major, ele] = await Promise.all([this.latest('hyslrSttus.json', corp), this.get('majorstock.json', { corp_code: corp }), this.get('elestock.json', { corp_code: corp })]);
      return {
        id,
        period: lg.period,
        largest: lg.list
          .map((o) => ({ name: s(o.nm) ?? '', relation: s(o.relate), kind: s(o.stock_knd), shares: dartNum(o.trmend_posesn_stock_co), pct: dartNum(o.trmend_posesn_stock_qota_rt), sharesStart: dartNum(o.bsis_posesn_stock_co), pctStart: dartNum(o.bsis_posesn_stock_qota_rt) }))
          .filter((x) => x.name),
        major: major
          .map((o) => ({ date: day(o.rcept_dt), reporter: s(o.repror) ?? '', shares: dartNum(o.stkqy), pct: dartNum(o.stkrt), chgShares: dartNum(o.stkqy_irds), chgPct: dartNum(o.stkrt_irds), reason: s(o.report_resn), url: viewer(String(o.rcept_no ?? '')) }))
          .filter((x) => x.date)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 100),
        insiders: parseInsiders(ele).slice(0, 300),
        fresh: this.fresh(TTL),
      };
    });
  }

  /** CF: 공시 검색. 종목이 있으면 그 회사 최근 1년, 없으면 전체 최근 7일. type은 OpenDART pblntf_ty */
  disclosures(id: string | undefined, type: string): Promise<DisclosureResponse> {
    return this.cached(`cf|${id ?? 'all'}|${type}`, LIST_TTL, async () => {
      const key = this.key();
      const now = Date.now();
      const params: Record<string, string> = { bgn_de: ymd(now - (id ? 365 : 7) * 86400_000), end_de: ymd(now) };
      if (id) params.corp_code = (await this.corp(id)).corp;
      if (type) params.pblntf_ty = type;
      const rows: DisclosureRow[] = [];
      for (let page = 1; page <= (id ? 3 : 2); page++) {
        const r = await dartList(key, { ...params, page_no: String(page) });
        for (const x of r.list ?? []) rows.push({ date: day(x.rcept_dt), corp: x.corp_name, code: x.stock_code?.trim() || undefined, title: x.report_nm.replace(/\s+/g, ' ').trim(), filer: x.flr_nm, url: viewer(x.rcept_no), rm: x.rm?.trim() || undefined });
        if ((r.list?.length ?? 0) < 100) break;
      }
      return { id, type, rows, fresh: { source: 'DART', mode: 'poll', asOf: now, receivedAt: now, intervalMs: LIST_TTL } };
    });
  }

  /** ERN: 최근 3년 잠정실적 공시, 그 분기 실적(FA 분기 값)과 발표일 주가 반응 */
  earnings(id: string): Promise<EarningsResponse> {
    return this.cached(`ern|${id}`, TTL, async () => {
      const { inst, corp } = await this.corp(id);
      const key = this.key();
      const now = Date.now();
      const found: Array<{ date: string; title: string; url: string }> = [];
      for (let page = 1; page <= 3; page++) {
        const r = await dartList(key, { corp_code: corp, bgn_de: ymd(now - 3 * 365 * 86400_000), end_de: ymd(now), pblntf_ty: 'I', page_no: String(page) });
        for (const x of r.list ?? []) if (isEarningsTitle(x.report_nm)) found.push({ date: day(x.rcept_dt), title: x.report_nm.replace(/\s+/g, ' ').trim(), url: viewer(x.rcept_no) });
        if ((r.list?.length ?? 0) < 100) break;
      }
      const [bars, fin] = await Promise.all([this.bars(id).catch(() => [] as Bar[]), this.quarterly(inst).catch(() => undefined)]);
      const val = (line: 'revenue' | 'operatingIncome' | 'netIncome', q: string) => {
        if (!fin) return undefined;
        const i = fin.periods.findIndex((p) => p.key === q);
        return i >= 0 ? (fin.values[line]?.[i] ?? undefined) : undefined;
      };
      const yoy = (line: 'revenue' | 'operatingIncome', q: string) => {
        const [y, n] = q.split('Q');
        const now1 = val(line, q);
        const then = val(line, `${Number(y) - 1}Q${n}`);
        return now1 != null && then != null && then !== 0 ? (now1 / Math.abs(then) - 1) * 100 * Math.sign(then) : undefined;
      };
      // 같은 분기의 정정 공시는 처음 것만
      const seen = new Set<string>();
      const rows: EarningsRow[] = [];
      for (const f of found.sort((a, b) => a.date.localeCompare(b.date))) {
        const quarter = quarterBefore(f.date);
        const re = reaction(bars, f.date);
        rows.push({
          ...f,
          quarter: seen.has(quarter) ? undefined : quarter,
          revenue: seen.has(quarter) ? undefined : val('revenue', quarter),
          operatingIncome: seen.has(quarter) ? undefined : val('operatingIncome', quarter),
          netIncome: seen.has(quarter) ? undefined : val('netIncome', quarter),
          revenueYoY: seen.has(quarter) ? undefined : yoy('revenue', quarter),
          operatingYoY: seen.has(quarter) ? undefined : yoy('operatingIncome', quarter),
          reaction1d: re.r1,
          reaction2d: re.r2,
        });
        seen.add(quarter);
      }
      rows.reverse();
      return { id, rows, fresh: this.fresh(TTL), note: rows.length ? undefined : '최근 3년 잠정실적 공시가 없어요(공정공시를 하지 않는 회사는 정기보고서로만 나와요)' };
    });
  }
}

