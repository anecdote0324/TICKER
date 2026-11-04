// FA 재무제표(03 v0.3).
// - 국내: DART 단일회사 전체 재무제표(fnlttSinglAcntAll). 연결(CFS)이 없으면 별도(OFS). 연간은 사업보고서 2번(6년),
//   분기는 1분기·반기·3분기·사업보고서의 누적 값을 빼서 분기 값으로(손익·현금흐름), 재무상태는 그 시점 값.
// - 미국: SEC companyfacts(US GAAP). 연간은 1년 기간 값, 분기는 3개월 기간 값(4분기는 연간 − 앞 세 분기).
//   SEC는 요청마다 연락처(User-Agent)를 달라고 해서 설정의 연락처가 있어야 받아요. 초당 10건 이하.
// 받은 값은 12시간 동안 다시 써요(원천은 분기마다 바뀌어요).

import { FIN_LINES, quartersFromCumulative, type FinancialsResponse, type FinLineId, type FinPeriod, type FinPeriodKind, type Instrument } from '@bt/shared';
import type { NewsService } from './news';
import { fetchJson, HttpError, type Logger } from './util';

const TTL_MS = 12 * 3600_000;
const DART_BASE = 'https://opendart.fss.or.kr/api';

// ── DART ──

/** DART 계정: account_id(IFRS 표준) 먼저, 없으면 계정 이름 */
const DART_ACCOUNTS: Record<FinLineId, { sj: Array<'IS' | 'CIS' | 'BS' | 'CF'>; ids: string[]; names: string[] }> = {
  revenue: { sj: ['IS', 'CIS'], ids: ['ifrs-full_Revenue', 'ifrs_Revenue'], names: ['매출액', '수익(매출액)', '영업수익', '매출'] },
  cogs: { sj: ['IS', 'CIS'], ids: ['ifrs-full_CostOfSales', 'ifrs_CostOfSales'], names: ['매출원가', '영업비용'] },
  grossProfit: { sj: ['IS', 'CIS'], ids: ['ifrs-full_GrossProfit', 'ifrs_GrossProfit'], names: ['매출총이익'] },
  operatingIncome: { sj: ['IS', 'CIS'], ids: ['dart_OperatingIncomeLoss'], names: ['영업이익', '영업이익(손실)'] },
  pretaxIncome: { sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLossBeforeTax', 'ifrs_ProfitLossBeforeTax'], names: ['법인세비용차감전순이익', '법인세비용차감전순이익(손실)'] },
  netIncome: { sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLoss', 'ifrs_ProfitLoss'], names: ['당기순이익', '당기순이익(손실)'] },
  netIncomeOwners: { sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLossAttributableToOwnersOfParent', 'ifrs_ProfitLossAttributableToOwnersOfParent'], names: ['지배기업의 소유주에게 귀속되는 당기순이익', '지배기업 소유주지분'] },
  assets: { sj: ['BS'], ids: ['ifrs-full_Assets', 'ifrs_Assets'], names: ['자산총계'] },
  currentAssets: { sj: ['BS'], ids: ['ifrs-full_CurrentAssets', 'ifrs_CurrentAssets'], names: ['유동자산'] },
  cash: { sj: ['BS'], ids: ['ifrs-full_CashAndCashEquivalents', 'ifrs_CashAndCashEquivalents'], names: ['현금및현금성자산'] },
  liabilities: { sj: ['BS'], ids: ['ifrs-full_Liabilities', 'ifrs_Liabilities'], names: ['부채총계'] },
  currentLiabilities: { sj: ['BS'], ids: ['ifrs-full_CurrentLiabilities', 'ifrs_CurrentLiabilities'], names: ['유동부채'] },
  equity: { sj: ['BS'], ids: ['ifrs-full_Equity', 'ifrs_Equity'], names: ['자본총계'] },
  equityOwners: { sj: ['BS'], ids: ['ifrs-full_EquityAttributableToOwnersOfParent', 'ifrs_EquityAttributableToOwnersOfParent'], names: ['지배기업의 소유주에게 귀속되는 자본', '지배기업 소유주지분'] },
  cfo: { sj: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInOperatingActivities', 'ifrs_CashFlowsFromUsedInOperatingActivities'], names: ['영업활동현금흐름', '영업활동으로 인한 현금흐름'] },
  cfi: { sj: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInInvestingActivities', 'ifrs_CashFlowsFromUsedInInvestingActivities'], names: ['투자활동현금흐름', '투자활동으로 인한 현금흐름'] },
  cff: { sj: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInFinancingActivities', 'ifrs_CashFlowsFromUsedInFinancingActivities'], names: ['재무활동현금흐름', '재무활동으로 인한 현금흐름'] },
  capex: { sj: ['CF'], ids: ['ifrs-full_PurchaseOfPropertyPlantAndEquipment', 'ifrs_PurchaseOfPropertyPlantAndEquipment'], names: ['유형자산의 취득'] },
};

export interface DartRow {
  sj_div: string;
  account_id?: string;
  account_nm: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
}

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/,/g, '').trim();
  if (!t || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** 보고서 한 개에서 계정 줄 찾기(같은 계정이 여러 번이면 첫 줄) */
export function dartFind(rows: DartRow[], id: FinLineId): DartRow | undefined {
  const a = DART_ACCOUNTS[id];
  const inSj = rows.filter((r) => (a.sj as string[]).includes(r.sj_div));
  return inSj.find((r) => r.account_id && a.ids.includes(r.account_id)) ?? inSj.find((r) => a.names.includes(r.account_nm.replace(/\s+/g, ' ').trim()));
}

/** 사업보고서 한 개 → 그해·전년·전전년 값 */
export function dartAnnual(rows: DartRow[]): Partial<Record<FinLineId, [number | null, number | null, number | null]>> {
  const out: Partial<Record<FinLineId, [number | null, number | null, number | null]>> = {};
  for (const { id } of FIN_LINES) {
    const r = dartFind(rows, id);
    if (r) out[id] = [num(r.bfefrmtrm_amount), num(r.frmtrm_amount), num(r.thstrm_amount)];
  }
  return out;
}

/**
 * 분기 보고서의 누적 값. 손익: 1분기는 당기, 반기·3분기는 누적(thstrm_add_amount, 없으면 당기),
 * 현금흐름: 당기 칸이 누적이에요. 재무상태는 그 시점 값
 */
export function dartCumulative(rows: DartRow[], id: FinLineId, reprt: '11013' | '11012' | '11014' | '11011'): number | null {
  const r = dartFind(rows, id);
  if (!r) return null;
  const sj = DART_ACCOUNTS[id].sj[0];
  if (sj === 'IS' && reprt !== '11013' && reprt !== '11011') return num(r.thstrm_add_amount) ?? num(r.thstrm_amount);
  return num(r.thstrm_amount);
}

interface DartFinResponse {
  status: string;
  message: string;
  list?: DartRow[];
}

// ── SEC ──

/** SEC us-gaap 개념: 앞의 것부터 써요(회사마다 쓰는 이름이 달라요) */
const SEC_CONCEPTS: Record<FinLineId, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  cogs: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  netIncome: ['ProfitLoss', 'NetIncomeLoss'],
  netIncomeOwners: ['NetIncomeLoss'],
  assets: ['Assets'],
  currentAssets: ['AssetsCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  liabilities: ['Liabilities'],
  currentLiabilities: ['LiabilitiesCurrent'],
  equity: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'],
  equityOwners: ['StockholdersEquity'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities'],
  cfi: ['NetCashProvidedByUsedInInvestingActivities'],
  cff: ['NetCashProvidedByUsedInFinancingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
};

export interface SecFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400_000;

/** 기간 길이로 나눠요: 연간(약 1년), 분기(약 3개월), 시점(재무상태) */
function bucket(f: SecFact): 'year' | 'quarter' | 'instant' | 'other' {
  if (!f.start) return 'instant';
  const d = days(f.start, f.end);
  if (d >= 350 && d <= 380) return 'year';
  if (d >= 80 && d <= 100) return 'quarter';
  return 'other';
}

/** 같은 기말일의 값이 여러 번이면 가장 늦게 제출한 것 */
function latestByEnd(facts: SecFact[]): Map<string, number> {
  const best = new Map<string, SecFact>();
  for (const f of facts) {
    const cur = best.get(f.end);
    if (!cur || (f.filed ?? '') > (cur.filed ?? '')) best.set(f.end, f);
  }
  return new Map([...best].map(([k, v]) => [k, v.val]));
}

type UsGaap = Record<string, { units?: Record<string, SecFact[]> }>;

/** 한 계정의 기간별 값(연간: 1년 기간, 분기: 3개월 기간 + 4분기 = 연간 − 앞 세 분기, 시점: 기말일) */
export function secSeries(gaap: UsGaap, id: FinLineId, kind: FinPeriodKind): Map<string, number> {
  const instant = FIN_LINES.find((l) => l.id === id)!.section === 'bs';
  for (const concept of SEC_CONCEPTS[id]) {
    const facts = gaap[concept]?.units?.USD;
    if (!facts?.length) continue;
    if (instant) {
      const m = latestByEnd(facts.filter((f) => bucket(f) === 'instant'));
      if (m.size) return m;
      continue;
    }
    const years = latestByEnd(facts.filter((f) => bucket(f) === 'year'));
    if (kind === 'annual') {
      if (years.size) return years;
      continue;
    }
    const q = latestByEnd(facts.filter((f) => bucket(f) === 'quarter'));
    // 현금흐름처럼 10-Q가 회계연도 시작부터의 누적(3·6·9개월)만 주는 계정: 같은 시작일의 누적끼리 빼서 분기 값으로
    const byStart = new Map<string, SecFact[]>();
    for (const f of facts) {
      if (!f.start) continue;
      const d = days(f.start, f.end);
      if (d < 80 || d > 290) continue;
      byStart.set(f.start, [...(byStart.get(f.start) ?? []), f]);
    }
    for (const list of byStart.values()) {
      const cum = latestByEnd(list);
      const ends = [...cum.keys()].sort();
      ends.forEach((e, i) => {
        if (q.has(e)) return;
        const v = i === 0 ? cum.get(e)! : cum.get(e)! - cum.get(ends[i - 1])!;
        if (i === 0 && days(list.find((f) => f.end === e)!.start!, e) > 100) return;
        q.set(e, v);
      });
    }
    // 4분기: 연간 값에서 그 회계연도(기말 1년 안)의 세 분기를 빼요
    for (const [end, fy] of years) {
      if (q.has(end)) continue;
      const inYear = [...q].filter(([e]) => e < end && days(e, end) < 340).map(([, v]) => v);
      if (inYear.length === 3) q.set(end, fy - inYear.reduce((a, b) => a + b, 0));
    }
    if (q.size) return q;
  }
  return new Map();
}

/** SEC 요청 머리글. 요청 머리글에는 영문(ASCII)만 넣을 수 있어요 */
export function secHeaders(contact: string): Record<string, string> {
  return { 'user-agent': `TICKER ${contact}`, accept: 'application/json', 'accept-encoding': 'gzip, deflate' };
}

/** SEC 연락처 모양: 영문(ASCII)·이메일 포함·120자 이하. 틀리면 이유 */
export function secContactError(k: string): string | undefined {
  if (!/^[\x20-\x7E]+$/.test(k)) return '연락처는 영문·숫자로 적어 주세요(예: Hong Gildong me@example.com). 요청 머리글에는 한글을 넣을 수 없어요';
  if (!/\S+@\S+\.\S+/.test(k)) return '이름과 이메일을 함께 적어 주세요(예: Hong Gildong me@example.com)';
  if (k.length > 120) return '연락처는 120자까지예요';
  return undefined;
}

/** SEC가 막았을 때: 응답의 제목(예: Request Rate Threshold Exceeded, Undeclared Automated Tool)을 함께 보여 줘요 */
export function secBlockMessage(status: number, body: string | undefined): string {
  const title = body?.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/^SEC\.gov\s*\|\s*/, '').trim();
  const why = title || body?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `SEC가 요청을 막았어요(HTTP ${status}${why ? `: ${why}` : ''}). SEC는 한도를 넘거나 연락처가 없다고 보면 약 10분 동안 막아요. 10분쯤 뒤에 다시 확인해 보세요`;
}

// ── 서비스 ──

export class FinancialsService {
  private secContact?: string;
  private cache = new Map<string, { at: number; res: Promise<FinancialsResponse> }>();
  private secCiks?: { at: number; map: Promise<Map<string, string>> };
  private secFacts = new Map<string, { at: number; gaap: Promise<UsGaap> }>();
  private lastSec = 0;

  constructor(
    private news: NewsService | undefined,
    private log: Logger,
  ) {}

  setSecContact(contact: string | undefined) {
    this.secContact = contact;
    this.secCiks = undefined;
    this.cache.clear();
  }

  get(inst: Instrument, kind: FinPeriodKind): Promise<FinancialsResponse> {
    const key = `${inst.id}|${kind}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.res;
    const res = inst.market === 'US' ? this.sec(inst, kind) : this.dart(inst, kind);
    this.cache.set(key, { at: Date.now(), res });
    res.catch(() => this.cache.delete(key));
    return res;
  }

  // ── DART ──

  private async dartReport(corp: string, year: number, reprt: string): Promise<{ rows: DartRow[]; basis: string } | null> {
    const key = this.news?.dartKeyValue;
    if (!key) throw new Error('DART 인증키를 넣으면 국내 재무제표가 보여요(설정 → 데이터 연결)');
    for (const fs of ['CFS', 'OFS'] as const) {
      const q = new URLSearchParams({ crtfc_key: key, corp_code: corp, bsns_year: String(year), reprt_code: reprt, fs_div: fs });
      const r = await fetchJson<DartFinResponse>(`${DART_BASE}/fnlttSinglAcntAll.json?${q}`, { timeoutMs: 20_000 });
      if (r.status === '000' && r.list?.length) return { rows: r.list, basis: fs === 'CFS' ? '연결' : '별도' };
      if (r.status !== '013') throw new Error(`DART 재무제표 오류 ${r.status}: ${r.message}`);
    }
    return null;
  }

  private async dart(inst: Instrument, kind: FinPeriodKind): Promise<FinancialsResponse> {
    const corp = await this.news?.corpCodeOf(inst.code);
    if (!this.news?.dartKeyValue) throw new Error('DART 인증키를 넣으면 국내 재무제표가 보여요(설정 → 데이터 연결)');
    if (!corp) throw new Error(`${inst.nameKo ?? inst.code}의 DART 고유번호가 없어요(ETF·리츠 등은 재무제표가 없어요)`);
    const thisYear = new Date().getFullYear();
    const values: FinancialsResponse['values'] = {};
    const periods: FinPeriod[] = [];
    let basis = '연결';
    if (kind === 'annual') {
      // 가장 최근 사업보고서(작년, 아직 없으면 재작년)와 그 3년 앞 보고서 → 6년
      let latest = thisYear - 1;
      let a = await this.dartReport(corp, latest, '11011');
      if (!a) {
        latest--;
        a = await this.dartReport(corp, latest, '11011');
      }
      if (!a) throw new Error('DART에 사업보고서 재무제표가 없어요');
      basis = a.basis;
      const b = await this.dartReport(corp, latest - 3, '11011').catch(() => null);
      const recent = dartAnnual(a.rows);
      const older = b ? dartAnnual(b.rows) : {};
      for (let y = latest - 5; y <= latest; y++) periods.push({ key: String(y), label: String(y) });
      for (const { id } of FIN_LINES) {
        const r = recent[id];
        const o = older[id];
        if (!r && !o) continue;
        values[id] = [...(o ?? [null, null, null]), ...(r ?? [null, null, null])];
      }
      return this.dartResult(inst, kind, periods, values, basis, `사업보고서 ${latest}년${b ? `·${latest - 3}년` : ''}`);
    }
    // 분기: 최근 2개 회계연도의 1분기·반기·3분기·사업보고서(8번)
    const REPORTS = ['11013', '11012', '11014', '11011'] as const;
    const years = [thisYear - 1, thisYear];
    const got: Array<{ year: number; q: number; rows: DartRow[] | null }> = [];
    for (const y of years)
      for (let i = 0; i < 4; i++) {
        const r = await this.dartReport(corp, y, REPORTS[i]).catch(() => null);
        if (r) basis = r.basis;
        got.push({ year: y, q: i + 1, rows: r?.rows ?? null });
      }
    // 아직 나오지 않은 뒤쪽 분기는 빼요
    while (got.length && !got[got.length - 1].rows) got.pop();
    if (!got.length) throw new Error('DART에 분기 재무제표가 없어요');
    for (const g of got) periods.push({ key: `${g.year}Q${g.q}`, label: `${g.year} ${g.q}Q` });
    for (const { id, section } of FIN_LINES) {
      const series: Array<number | null> = [];
      for (const y of years) {
        const inYear = got.filter((g) => g.year === y);
        if (!inYear.length) continue;
        const raw = inYear.map((g) => (g.rows ? dartCumulative(g.rows, id, REPORTS[g.q - 1]) : null));
        series.push(...(section === 'bs' ? raw : quartersFromCumulative(raw)));
      }
      if (series.some((v) => v != null)) values[id] = series;
    }
    return this.dartResult(inst, kind, periods, values, basis, '1분기·반기·3분기·사업보고서(손익·현금흐름은 누적에서 빼서 분기 값)');
  }

  private dartResult(inst: Instrument, kind: FinPeriodKind, periods: FinPeriod[], values: FinancialsResponse['values'], basis: string, note: string): FinancialsResponse {
    const now = Date.now();
    return { id: inst.id, currency: 'KRW', source: 'DART', basis, period: kind, periods, values, note, fresh: { source: 'DART', mode: 'release', asOf: now, receivedAt: now, asOfFromReceipt: true } };
  }

  // ── SEC ──

  private async secFetch<T>(url: string): Promise<T> {
    const contact = this.secContact;
    if (!contact) throw new Error('SEC EDGAR 연락처를 넣으면 미국 재무제표가 보여요(설정 → 데이터 연결). SEC가 요청마다 연락처를 달라고 해요');
    // 초당 10건 이하(여유 있게 0.2초 간격)
    const wait = this.lastSec + 200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastSec = Date.now();
    try {
      // SEC 공개 규칙(Accessing EDGAR Data)의 모양: User-Agent에 이름과 이메일, Accept-Encoding gzip·deflate
      return await fetchJson<T>(url, { timeoutMs: 30_000, headers: secHeaders(contact) });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 429)) throw new Error(secBlockMessage(e.status, e.body));
      throw e;
    }
  }

  private async cikOf(ticker: string): Promise<string | undefined> {
    if (!this.secCiks || Date.now() - this.secCiks.at > 24 * 3600_000) {
      const map = this.secFetch<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json').then(
        (r) => new Map(Object.values(r).map((x) => [x.ticker.toUpperCase(), String(x.cik_str).padStart(10, '0')])),
      );
      this.secCiks = { at: Date.now(), map };
      map.catch(() => (this.secCiks = undefined));
    }
    // BRK.B 같은 클래스 표기는 SEC에서 BRK-B예요
    return (await this.secCiks.map).get(ticker.toUpperCase().replace('.', '-'));
  }

  async testSec(contact: string): Promise<{ ok: boolean; message: string }> {
    const prev = this.secContact;
    this.secContact = contact;
    try {
      const r = await this.secFetch<{ entityName?: string }>('https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Assets.json');
      return { ok: true, message: `SEC EDGAR에서 ${r.entityName ?? 'Apple'} 자료를 받았어요` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    } finally {
      this.secContact = prev;
    }
  }

  private async sec(inst: Instrument, kind: FinPeriodKind): Promise<FinancialsResponse> {
    const cik = await this.cikOf(inst.code);
    if (!cik) throw new Error(`${inst.code}는 SEC에 재무제표가 없어요(ETF·외국 회사 등)`);
    let hit = this.secFacts.get(cik);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const gaap = this.secFetch<{ facts?: { 'us-gaap'?: UsGaap } }>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`).then((r) => r.facts?.['us-gaap'] ?? {});
      hit = { at: Date.now(), gaap };
      this.secFacts.set(cik, hit);
      gaap.catch(() => this.secFacts.delete(cik));
    }
    const gaap = await hit.gaap;
    const series = new Map(FIN_LINES.map(({ id }) => [id, secSeries(gaap, id, kind)] as const));
    // 기간: 매출(없으면 순이익)이 있는 기말일 중 최근 6개(연간)·8개(분기)
    const anchor = series.get('revenue')?.size ? series.get('revenue')! : series.get('netIncome')!;
    const ends = [...anchor.keys()].sort().slice(kind === 'annual' ? -6 : -8);
    if (!ends.length) throw new Error(`${inst.code}의 SEC 재무제표에서 매출·순이익을 찾지 못했어요`);
    const values: FinancialsResponse['values'] = {};
    for (const { id } of FIN_LINES) {
      const m = series.get(id)!;
      const row = ends.map((e) => m.get(e) ?? null);
      if (row.some((v) => v != null)) values[id] = row;
    }
    const now = Date.now();
    return {
      id: inst.id,
      currency: 'USD',
      source: 'SEC',
      basis: 'US GAAP',
      period: kind,
      periods: ends.map((e) => ({ key: e, label: `${e.slice(0, 4)}.${e.slice(5, 7)}`, end: e })),
      values,
      note: kind === 'annual' ? '10-K의 1년 기간 값' : '10-Q의 3개월 값(4분기는 연간 − 앞 세 분기)',
      fresh: { source: 'SEC', mode: 'release', asOf: now, receivedAt: now, asOfFromReceipt: true },
    };
  }
}
