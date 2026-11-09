// v0.6 WEIF 지수선물: 한국투자증권 지수선물옵션 마스터(fo_idx_code_mts.mst)로 최근월물을 고르고,
// 선물옵션 시세(FHMIF10000000)를 화면이 열려 있는 동안 조회해요(같은 값을 5초 동안 써요). 호가 탭은 선물옵션 시세호가(FHMIF10010000).
// 실시간(WS) 등록 칸은 주식 시세에 쓰려고 아껴서 지수선물은 조회로 받아요.

import {
  FUTURES_KINDS,
  carryFair,
  futuresSession,
  parseFuturesMaster,
  watchedContracts,
  type FuturesBook,
  type FuturesContract,
  type FuturesResponse,
  type FuturesRow,
} from '@bt/shared';
import type { KisAdapter } from './adapters/kis';
import { loadMaster } from './instruments';
import type { Logger } from './util';

const QUOTE_TTL = 5_000;
const num = (s: string | undefined) => {
  if (s === undefined || s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};
/** KIS 부호: 1 상한·2 상승·3 보합·4 하한·5 하락. 대비 값은 절댓값으로 올 때가 있어서 부호를 붙여요 */
const signed = (v: number | undefined, sign: string | undefined) => (v === undefined ? undefined : sign === '4' || sign === '5' ? -Math.abs(v) : sign === '1' || sign === '2' ? Math.abs(v) : v);

export class FuturesService {
  private master?: { at: number; p: Promise<{ list: FuturesContract[]; asOf?: string }> };
  private cache?: { at: number; p: Promise<FuturesResponse> };

  constructor(
    private dataDir: string,
    private log: Logger,
    private kis: () => KisAdapter | undefined,
    /** 이론가에 쓰는 CD91(%) */
    private cd91: () => Promise<number | undefined>,
  ) {}

  private contracts() {
    if (this.master && Date.now() - this.master.at < 6 * 3600_000) return this.master.p;
    const p = (async () => {
      const m = await loadMaster(this.dataDir, 'fo_idx_code_mts.mst', this.log);
      if ('error' in m) throw new Error(`지수선물 마스터를 받지 못했어요: ${m.error}`);
      return { list: parseFuturesMaster(new TextDecoder('euc-kr').decode(m.bytes)), asOf: m.asOf };
    })();
    this.master = { at: Date.now(), p };
    p.catch(() => (this.master = undefined));
    return p;
  }

  get(): Promise<FuturesResponse> {
    if (this.cache && Date.now() - this.cache.at < QUOTE_TTL) return this.cache.p;
    const p = this.load();
    this.cache = { at: Date.now(), p };
    p.catch(() => (this.cache = undefined));
    return p;
  }

  private async load(): Promise<FuturesResponse> {
    const now = Date.now();
    const session = futuresSession(now);
    const fresh = { source: 'KIS' as const, mode: 'poll' as const, asOf: now, receivedAt: now, intervalMs: QUOTE_TTL, asOfFromReceipt: true };
    let master: { list: FuturesContract[]; asOf?: string };
    try {
      master = await this.contracts();
    } catch (e) {
      return { rows: [], session, error: (e as Error).message, fresh };
    }
    const watched = watchedContracts(master.list);
    const label = (c: FuturesContract) => `${FUTURES_KINDS.find((k) => k.kind === c.kind)!.label} ${c.month.slice(2, 4)}.${c.month.slice(4)}`;
    const kis = this.kis();
    if (!kis) return { rows: watched.map((c) => ({ contract: c, label: label(c) })), session, masterAsOf: master.asOf, error: '한국투자증권 키를 넣으면 지수선물 시세가 보여요(설정 → 데이터 연결)', fresh };
    const cd91 = await this.cd91().catch(() => undefined);
    const rows: FuturesRow[] = await Promise.all(
      watched.map(async (c): Promise<FuturesRow> => {
        try {
          const { quote: q, underlying: u } = await kis.futuresPrice(c.code);
          const last = num(q.futs_prpr);
          const spot = num(u.bstp_nmix_prpr);
          const daysLeft = num(q.hts_rmnn_dynu);
          return {
            contract: c,
            label: label(c),
            last,
            change: signed(num(q.futs_prdy_vrss), q.prdy_vrss_sign),
            changePct: signed(num(q.futs_prdy_ctrt), q.prdy_vrss_sign),
            volume: num(q.acml_vol),
            openInterest: num(q.hts_otst_stpl_qty),
            oiChange: num(q.otst_stpl_qty_icdc),
            basis: num(q.basis) ?? (last !== undefined && spot !== undefined ? last - spot : undefined),
            theo: num(q.hts_thpr),
            disparity: num(q.dprt),
            carry: spot !== undefined && cd91 !== undefined && daysLeft !== undefined && c.kind !== 'VKOSPI' ? carryFair(spot, cd91, daysLeft) : undefined,
            daysLeft,
            lastTradeDate: q.futs_last_tr_date,
            spot,
            spotChangePct: signed(num(u.bstp_nmix_prdy_ctrt), u.prdy_vrss_sign),
          };
        } catch (e) {
          return { contract: c, label: label(c), error: (e as Error).message };
        }
      }),
    );
    return { rows, session, cd91, masterAsOf: master.asOf, fresh };
  }

  async book(code: string): Promise<FuturesBook> {
    const kis = this.kis();
    if (!kis) return { code, asks: [], bids: [], error: '한국투자증권 키가 없어요' };
    if (!/^[0-9A-Z]{5,9}$/.test(code)) return { code, asks: [], bids: [], error: '종목코드가 맞지 않아요' };
    try {
      const b = await kis.futuresBook(code);
      const lv = [1, 2, 3, 4, 5];
      return {
        code,
        asks: lv.map((i) => ({ price: num(b[`futs_askp${i}`]) ?? 0, qty: num(b[`askp_rsqn${i}`]) ?? 0 })).filter((x) => x.price),
        bids: lv.map((i) => ({ price: num(b[`futs_bidp${i}`]) ?? 0, qty: num(b[`bidp_rsqn${i}`]) ?? 0 })).filter((x) => x.price),
        totalAsk: num(b.total_askp_rsqn),
        totalBid: num(b.total_bidp_rsqn),
        time: b.aspr_acpt_hour,
      };
    } catch (e) {
      return { code, asks: [], bids: [], error: (e as Error).message };
    }
  }
}
