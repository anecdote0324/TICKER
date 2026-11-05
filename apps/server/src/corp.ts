// v0.4 실적·기업행위(EE·ANR·DVD·CACS·IPO·EVTS): 한국투자증권 종목추정실적·종목투자의견·예탁원 정보를 화면 모양으로 바꿔요.
// 종목별 값은 6시간, 시장 전체 일정은 1시간 동안 같은 값을 써요.

import {
  CORP_EVENT_LABEL,
  ESTIMATE_INCOME_LABELS,
  ESTIMATE_INDICATOR_LABELS,
  ESTIMATE_PCT_LABELS,
  ksdDate,
  ksdRange,
  opinionSummary,
  type CorpEvent,
  type CorpEventsResponse,
  type DividendResponse,
  type DividendRow,
  type EstimateResponse,
  type Freshness,
  type Instrument,
  type IpoResponse,
  type IpoRow,
  type OpinionResponse,
  type OpinionRow,
} from '@bt/shared';
import type { KisAdapter, KsdKind } from './adapters/kis';
import type { Logger } from './util';

type Row = Record<string, string>;

const STOCK_TTL = 6 * 3600_000;
const MARKET_TTL = 3600_000;

const num = (v: unknown): number | undefined => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  const n = Number(t);
  return t === '' || !Number.isFinite(n) ? undefined : n;
};
const fmt = (v: number | undefined) => (v === undefined ? '' : v.toLocaleString('en-US'));
const iso = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const ymd = (ms: number) => iso(ms).replace(/-/g, '');

/** EE: 종목추정실적 → 줄 이름을 붙인 표. 열 머리 결산년월 '202512' → '2025.12' */
export function parseEstimate(raw: { periods: string[]; income: Array<Array<number | null>>; indicators: Array<Array<number | null>> }): Pick<EstimateResponse, 'periods' | 'income' | 'indicators'> {
  const periods = raw.periods.map((p) => {
    const m = /^(\d{4})(\d{2})(.*)$/.exec(p.trim());
    return m ? `${m[1]}.${m[2]}${m[3] ? ` ${m[3].trim()}` : ''}` : p;
  });
  const lines = (labels: string[], rows: Array<Array<number | null>>) =>
    rows.slice(0, labels.length).map((values, i) => ({ label: labels[i], values: values.slice(0, Math.max(periods.length, 1)), pct: ESTIMATE_PCT_LABELS.has(labels[i]) || undefined }));
  return { periods, income: lines(ESTIMATE_INCOME_LABELS, raw.income), indicators: lines(ESTIMATE_INDICATOR_LABELS, raw.indicators) };
}

/** ANR: 종목투자의견 줄. 증권사 이름 칸(mbcr_name)은 오면 써요 */
export function parseOpinions(rows: Row[]): OpinionRow[] {
  return rows
    .map((o) => ({
      date: ksdDate(o.stck_bsop_date) ?? '',
      broker: (o.mbcr_name ?? o.mbcr_nm ?? '').trim() || undefined,
      opinion: String(o.invt_opnn ?? '').trim(),
      prevOpinion: String(o.rgbf_invt_opnn ?? '').trim() || undefined,
      target: num(o.hts_goal_prc) || undefined,
      prevClose: num(o.stck_prdy_clpr) || undefined,
      gap: num(o.dprt),
    }))
    .filter((r) => r.date && r.opinion)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** DVD: 예탁원 배당 */
export function parseDividends(rows: Row[]): DividendRow[] {
  return rows
    .map((o) => ({
      recordDate: ksdDate(o.record_date) ?? '',
      kind: String(o.divi_kind ?? '').trim() || '배당',
      cash: num(o.per_sto_divi_amt) || undefined,
      cashRate: num(o.divi_rate) || undefined,
      stockRate: num(o.stk_divi_rate) || undefined,
      payDate: ksdDate(o.divi_pay_dt),
      stockKind: String(o.stk_kind ?? '').trim() || undefined,
    }))
    .filter((r) => r.recordDate)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
}

/** DVD 미국: 해외 기간별권리 → 배당 줄(배당 03·특별배당 75만, 현지 기준일 최근 먼저) */
export function parseUsDividends(rows: Row[]): DividendRow[] {
  return rows
    .filter((o) => ['03', '75'].includes(String(o.rght_type_cd ?? '').trim()))
    .map((o) => {
      const cash = num(o.stkp_dvdn_frcr_amt2) || num(o.stkp_dvdn_frcr_amt3) || num(o.stkp_dvdn_frcr_amt4) || num(o.alct_frcr_unpr) || undefined;
      return {
        recordDate: ksdDate(o.acpl_bass_dt) ?? ksdDate(o.bass_dt) ?? '',
        kind: String(o.rght_type_cd).trim() === '75' ? '특별배당' : '배당',
        cash,
        stockKind: String(o.dfnt_yn ?? '').trim() === 'N' ? '미확정' : undefined,
      };
    })
    .filter((r) => r.recordDate)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
}

/** 예탁원 정보 줄 → 이벤트(공모는 청약과 상장 두 줄) */
export function ksdEvents(kind: KsdKind, rows: Row[]): CorpEvent[] {
  const out: CorpEvent[] = [];
  for (const o of rows) {
    const code = String(o.sht_cd ?? '').trim();
    if (!code) continue;
    const push = (type: CorpEvent['type'], date: string | undefined, detail: string) => date && out.push({ date, type, code, detail: detail.replace(/\s+·\s*$/, '').trim() || undefined });
    switch (kind) {
      case 'dividend':
        push('dividend', ksdDate(o.record_date), `${String(o.divi_kind ?? '').trim()} 주당 ${fmt(num(o.per_sto_divi_amt))}원${num(o.stk_divi_rate) ? ` · 주식배당 ${num(o.stk_divi_rate)}%` : ''}`);
        break;
      case 'paidin':
        push('paidin', ksdDate(o.record_date), `배정률 ${String(o.fix_rate ?? '').trim()} · 발행가 ${fmt(num(o.fix_price))}원 · 권리락 ${ksdDate(o.right_dt) ?? '—'} · 청약 ${ksdDate(o.sub_term_ft) ?? '—'}`);
        break;
      case 'bonus':
        push('bonus', ksdDate(o.record_date), `배정률 ${String(o.fix_rate ?? '').trim()} · 권리락 ${ksdDate(o.right_dt) ?? '—'} · 상장 ${ksdDate(o.list_date) ?? '—'}`);
        break;
      case 'capdcrs':
        push('capdcrs', ksdDate(o.record_date), `${String(o.reduce_cap_type ?? '').trim()} ${String(o.reduce_cap_rate ?? '').trim()} · 거래정지 ${String(o.td_stop_dt ?? '').trim() || '—'}`);
        break;
      case 'merger':
        push('merger', ksdDate(o.record_date), `${String(o.merge_type ?? '').trim()} ${String(o.opp_cust_nm ?? '').trim()} → ${String(o.cust_nm ?? '').trim()} · 비율 ${String(o.merge_rate ?? '').trim()}`);
        break;
      case 'revsplit':
        push('revsplit', ksdDate(o.record_date), `액면 ${fmt(num(o.inter_bf_face_amt))}원 → ${fmt(num(o.inter_af_face_amt))}원 · 거래정지 ${String(o.td_stop_dt ?? '').trim() || '—'}`);
        break;
      case 'deposit':
        push('deposit', ksdDate(o.depo_date), `${String(o.depo_reason ?? '').trim()} ${fmt(num(o.stk_qty))}주${num(o.tot_issue_qty_per_rate) ? ` (발행주식의 ${num(o.tot_issue_qty_per_rate)}%)` : ''}`);
        break;
      case 'meeting':
        push('meeting', ksdDate(o.gen_meet_dt), `${String(o.gen_meet_type ?? '').trim()} · ${String(o.agenda ?? '').trim()}`);
        break;
      case 'ipo': {
        const [from] = ksdRange(o.subscr_dt);
        push('ipo', from, `공모가 ${fmt(num(o.fix_subscr_pri))}원 · 주간사 ${String(o.lead_mgr ?? '').trim()}`);
        push('listing', ksdDate(o.list_dt), `공모가 ${fmt(num(o.fix_subscr_pri))}원`);
        break;
      }
    }
  }
  return out;
}

/** IPO: 공모 줄 */
export function parseIpo(rows: Row[]): IpoRow[] {
  return rows
    .map((o) => {
      const [subscrFrom, subscrTo] = ksdRange(o.subscr_dt);
      return { code: String(o.sht_cd ?? '').trim(), price: num(o.fix_subscr_pri) || undefined, subscrFrom, subscrTo, payDate: ksdDate(o.pay_dt), listDate: ksdDate(o.list_dt), leadMgr: String(o.lead_mgr ?? '').trim() || undefined };
    })
    .filter((r) => r.code)
    .sort((a, b) => (b.subscrFrom ?? '').localeCompare(a.subscrFrom ?? ''));
}

export class CorpService {
  private cache = new Map<string, { at: number; p: Promise<unknown> }>();

  constructor(
    private kis: () => KisAdapter | undefined,
    private instruments: () => Map<string, Instrument>,
    private price: (id: string) => Promise<number | undefined>,
    private log: Logger,
  ) {}

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
    const p = load();
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  private need(id: string): { inst: Instrument; kis: KisAdapter } {
    const inst = this.instruments().get(id);
    if (!inst) throw new Error(`종목 ${id}을(를) 찾지 못했어요`);
    if (inst.assetClass !== 'EQUITY' || (inst.market !== 'KS' && inst.market !== 'KQ')) throw new Error('국내 주식만 볼 수 있어요');
    const kis = this.kis();
    if (!kis) throw new Error('한국투자증권 키를 넣으면 보여요(설정 → 데이터 연결)');
    return { inst, kis };
  }

  private kisOrThrow(): KisAdapter {
    const kis = this.kis();
    if (!kis) throw new Error('한국투자증권 키를 넣으면 보여요(설정 → 데이터 연결)');
    return kis;
  }

  private fresh(ttl: number): Freshness {
    const now = Date.now();
    return { source: 'KIS', mode: 'poll', asOf: now, receivedAt: now, intervalMs: ttl };
  }

  /** 종목 코드 → 이름(국내 마스터) */
  nameOf(code: string): string | undefined {
    return (this.instruments().get(`EQ:KS:${code}`) ?? this.instruments().get(`EQ:KQ:${code}`))?.nameKo;
  }
  idOf(code: string): string | undefined {
    return (this.instruments().get(`EQ:KS:${code}`) ?? this.instruments().get(`EQ:KQ:${code}`))?.id;
  }

  estimate(id: string): Promise<EstimateResponse> {
    return this.cached(`ee|${id}`, STOCK_TTL, async () => {
      const { inst, kis } = this.need(id);
      const parsed = parseEstimate(await kis.estimate(inst.code));
      return { id, ...parsed, fresh: this.fresh(STOCK_TTL), note: parsed.periods.length ? undefined : '한국투자증권에 이 종목의 추정 실적이 없어요' };
    });
  }

  opinions(id: string): Promise<OpinionResponse> {
    return this.cached(`anr|${id}`, STOCK_TTL, async () => {
      const { inst, kis } = this.need(id);
      const rows = parseOpinions(await kis.opinions(inst.code));
      return { id, rows, summary: opinionSummary(rows, iso(Date.now())), fresh: this.fresh(STOCK_TTL) };
    });
  }

  dividends(id: string): Promise<DividendResponse> {
    return this.cached(`dvd|${id}`, STOCK_TTL, async () => {
      const inst0 = this.instruments().get(id);
      const us = inst0?.market === 'US' && inst0.assetClass === 'EQUITY';
      const { inst, kis } = us ? { inst: inst0!, kis: this.kisOrThrow() } : this.need(id);
      const now = Date.now();
      const rows = us
        ? parseUsDividends(await kis.usRights(inst.code, inst.exchange, ymd(now - 5 * 365 * 86400_000), ymd(now + 180 * 86400_000)))
        : parseDividends(await kis.ksd('dividend', { code: inst.code, from: ymd(now - 10 * 365 * 86400_000), to: ymd(now + 365 * 86400_000) }));
      const last = await this.price(id).catch(() => undefined);
      const yearAgo = iso(now - 365 * 86400_000);
      const today = iso(now);
      const recent = rows.filter((r) => r.recordDate > yearAgo && r.recordDate <= today && r.cash);
      const cash = recent.reduce((t, r) => t + (r.cash ?? 0), 0);
      return { id, currency: us ? 'USD' : 'KRW', rows, trailing: cash ? { cash, yieldPct: last ? (cash / last) * 100 : undefined } : undefined, fresh: this.fresh(STOCK_TTL) };
    });
  }

  /** CACS(기업행위)·EVTS(일정): 종목이 있으면 그 종목의 지난 2년~앞으로 1년, 없으면 시장 전체 지난 7일~앞으로 30일 */
  events(id: string | undefined, kinds: KsdKind[]): Promise<CorpEventsResponse> {
    return this.cached(`ev|${id ?? 'all'}|${kinds.join(',')}`, id ? STOCK_TTL : MARKET_TTL, async () => {
      const now = Date.now();
      let code: string | undefined;
      let kis: KisAdapter;
      if (id) ({ inst: { code }, kis } = this.need(id) as { inst: { code: string }; kis: KisAdapter });
      else {
        const k = this.kis();
        if (!k) throw new Error('한국투자증권 키를 넣으면 보여요(설정 → 데이터 연결)');
        kis = k;
      }
      const from = ymd(now - (id ? 2 * 365 : 7) * 86400_000);
      const to = ymd(now + (id ? 365 : 30) * 86400_000);
      const events: CorpEvent[] = [];
      const errors: string[] = [];
      for (const kind of kinds) {
        try {
          events.push(...ksdEvents(kind, await kis.ksd(kind, { code, from, to })));
        } catch (e) {
          errors.push(`${CORP_EVENT_LABEL[kind === 'ipo' ? 'ipo' : (kind as CorpEvent['type'])]}: ${(e as Error).message}`);
          this.log.warn(`예탁원 정보(${kind}) 실패: ${(e as Error).message}`);
        }
      }
      const lo = `${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}`;
      const hi = `${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}`;
      const list = events
        .filter((e) => e.date >= lo && e.date <= hi && (!code || e.code === code))
        .map((e) => ({ ...e, name: this.nameOf(e.code) }));
      list.sort((a, b) => (id ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
      if (events.length === 0 && errors.length === kinds.length) throw new Error(errors.join(' · '));
      return { id, events: list, fresh: this.fresh(id ? STOCK_TTL : MARKET_TTL), errors: errors.length ? errors : undefined };
    });
  }

  /** IPO: 지난 60일~앞으로 60일 공모, 상장한 종목은 공모가 대비 수익률 */
  ipo(): Promise<IpoResponse> {
    return this.cached('ipo', MARKET_TTL, async () => {
      const kis = this.kis();
      if (!kis) throw new Error('한국투자증권 키를 넣으면 공모 일정이 보여요(설정 → 데이터 연결)');
      const now = Date.now();
      const rows = parseIpo(await kis.ksd('ipo', { from: ymd(now - 60 * 86400_000), to: ymd(now + 60 * 86400_000) }));
      const today = iso(now);
      const listed = rows.filter((r) => r.listDate && r.listDate <= today);
      const quotes = listed.length ? await kis.multiQuote(listed.map((r) => r.code)).catch(() => new Map<string, { last: number }>()) : new Map<string, { last: number }>();
      for (const r of rows) {
        r.name = this.nameOf(r.code);
        const q = quotes.get(r.code);
        if (q && r.price) {
          r.last = q.last;
          r.returnPct = (q.last / r.price - 1) * 100;
        }
      }
      return { rows, fresh: this.fresh(MARKET_TTL) };
    });
  }
}
