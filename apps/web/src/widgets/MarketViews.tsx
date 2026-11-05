// v0.4 지수·ETF·관심종목·호가: MEMB 지수 구성종목(ETF 구성 근사), MOV 등락·기여도, ETF 분석과 FFLO 자금 흐름, WATC 관심종목 분석, BQ 쿼트 대시보드(10호가).

import { useEffect, useState } from 'react';
import {
  BOOK_MARKETS,
  MEMB_INDEXES,
  type BookMarket,
  type EtfResponse,
  type MembIndex,
  type MembResponse,
  type MembRow,
  type NewsResponse,
  type OrderbookResponse,
} from '@bt/shared';
import { dirClass, fmtBig, fmtPct, fmtPrice } from '../format';
import { getBars } from '../stores/bars';
import { useQuotes } from '../stores/feed';
import { getInstrument, useInstrument } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { appState } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar, usePoll } from './common';

const nf = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | undefined, d = 2) => (v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);

function membIndexOf(panel: PanelState): MembIndex {
  const a = panel.args?.[0];
  return MEMB_INDEXES.find((x) => x.code === a)?.code ?? 'KOSPI200';
}

function IndexButtons({ panel, index }: { panel: PanelState; index: MembIndex }) {
  return (
    <>
      {MEMB_INDEXES.map((x) => (
        <button key={x.code} className={x.code === index ? 'on' : ''} onClick={() => patchPanel(panel.id, { args: [x.code] })}>
          {x.label}
        </button>
      ))}
    </>
  );
}

function MembTable({ rows, panel, contribution }: { rows: MembRow[]; panel: PanelState; contribution?: boolean }) {
  return (
    <table className="flow-table">
      <thead>
        <tr>
          <th>#</th>
          <th style={{ textAlign: 'left' }}>종목</th>
          <th>비중</th>
          <th>현재가</th>
          <th>등락률</th>
          {contribution && <th>기여도</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.code} className={r.id ? 'click' : ''} onClick={() => r.id && setPanelSecurity(panel.id, r.id)}>
            <td className="label">{i + 1}</td>
            <td style={{ textAlign: 'left', color: 'var(--value)' }}>{`${r.name} `}<span className="label">{r.code}</span></td>
            <td className="num">{r.weight === undefined ? '—' : `${r.weight.toFixed(2)}%`}</td>
            <td className="num">{nf(r.last, r.last !== undefined && r.last < 1000 && !Number.isInteger(r.last) ? 2 : 0)}</td>
            <td className={`num ${dirClass(r.changePct)}`}>{pct(r.changePct)}</td>
            {contribution && <td className={`num ${dirClass(r.contribution)}`}>{r.contribution === undefined ? '—' : `${r.contribution > 0 ? '+' : ''}${r.contribution.toFixed(3)}%p`}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Memb({ panel }: { panel: PanelState }) {
  const index = membIndexOf(panel);
  const res = usePoll<MembResponse>(`/api/memb?index=${index}`, 60_000);
  const d = res?.data;
  return (
    <>
      <TitleBar fn="MEMB" name="지수 구성종목" sub={MEMB_INDEXES.find((x) => x.code === index)?.label} fresh={d?.fresh} tools={<IndexButtons panel={panel} index={index} />} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !d && <div className="empty-body err">{res.error}</div>}
        {d && (
          <>
            <div className="anr-sum">
              <span>{`${d.rows.length}종목`}</span>
              <span className="label">{`근사: ${d.source.etf} 구성${d.source.asOf ? ` (${d.source.asOf})` : ''}`}</span>
            </div>
            {d.note && <div className="kwrn-err label">{d.note}</div>}
            <MembTable rows={d.rows} panel={panel} />
            <div className="attr">{`지수 회사의 구성종목 목록은 유료라 그 지수를 따르는 ETF(${d.source.etf}, ${d.source.issuer})의 구성으로 대신해요(ETF 구성 근사) · 줄을 누르면 연동`}</div>
          </>
        )}
      </div>
    </>
  );
}

export function Mov({ panel }: { panel: PanelState }) {
  const index = membIndexOf(panel);
  const res = usePoll<MembResponse>(`/api/memb?index=${index}`, 60_000);
  const d = res?.data;
  const view = panel.movView ?? 'contrib';
  const rows = d?.rows ?? [];
  const sorted =
    view === 'up'
      ? [...rows].filter((r) => r.changePct !== undefined).sort((a, b) => b.changePct! - a.changePct!)
      : view === 'down'
        ? [...rows].filter((r) => r.changePct !== undefined).sort((a, b) => a.changePct! - b.changePct!)
        : [...rows].filter((r) => r.contribution !== undefined).sort((a, b) => Math.abs(b.contribution!) - Math.abs(a.contribution!));
  const up = rows.filter((r) => (r.changePct ?? 0) > 0).length;
  const down = rows.filter((r) => (r.changePct ?? 0) < 0).length;
  return (
    <>
      <TitleBar fn="MOV" name="등락·지수 기여도" sub={MEMB_INDEXES.find((x) => x.code === index)?.label} fresh={d?.fresh} tools={<IndexButtons panel={panel} index={index} />} />
      <div className="most-tabs">
        {(
          [
            ['contrib', '기여도'],
            ['up', '상승 상위'],
            ['down', '하락 상위'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => patchPanel(panel.id, { movView: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="pbody flow">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !d && <div className="empty-body err">{res.error}</div>}
        {d && (
          <>
            <div className="anr-sum">
              <span className="up">{`상승 ${up}`}</span>
              <span className="down">{`하락 ${down}`}</span>
              <span className={dirClass(d.totalContribution)}>{`기여도 합 ${d.totalContribution === undefined ? '—' : `${d.totalContribution > 0 ? '+' : ''}${d.totalContribution.toFixed(2)}%p`}`}</span>
              <span className="label">{`근사: ${d.source.etf} 구성 비중 × 등락률`}</span>
            </div>
            {d.note && <div className="kwrn-err label">{d.note}</div>}
            <MembTable rows={sorted.slice(0, 50)} panel={panel} contribution />
            <div className="attr">기여도는 비중 × 등락률 ÷ 100(%p)이에요. 지수 산식(유동 비율·상한)과 달라서 합이 지수 등락과 조금 달라요 · 줄을 누르면 연동</div>
          </>
        )}
      </div>
    </>
  );
}

/** ETF 분석(ETF)·자금 흐름(FFLO): 국내 ETF */
export function Etf({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const ok = !!inst && (inst.market === 'KS' || inst.market === 'KQ');
  const tab = panel.fn === 'FFLO' ? 'flows' : (panel.etfTab ?? 'nav');
  const res = usePoll<EtfResponse>(ok ? `/api/etf?id=${encodeURIComponent(inst!.id)}` : '', 60_000);
  const d = res?.data;
  const fn = panel.fn === 'FFLO' ? 'FFLO' : 'ETF';
  if (!ok) {
    return (
      <>
        <TitleBar fn={fn} name={fn === 'FFLO' ? 'ETF 자금 흐름' : 'ETF 분석'} />
        <div className="empty-body">
          <div>{inst ? '국내 ETF만 볼 수 있어요' : 'ETF 종목이 필요해요'}</div>
          <div className="label">{`예: 069500 ${fn} ⏎`}</div>
        </div>
      </>
    );
  }
  const tools = (
    <>
      {(
        [
          ['nav', 'NAV'],
          ['components', '구성종목'],
          ['flows', '자금 흐름'],
        ] as const
      ).map(([k, l]) => (
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => patchPanel(panel.id, { etfTab: k, ...(panel.fn === 'FFLO' && k !== 'flows' ? { fn: 'ETF' } : {}) })}>
          {l}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn={fn} name={fn === 'FFLO' ? 'ETF 자금 흐름' : 'ETF 분석'} sub={`${inst!.nameKo || inst!.code} ${inst!.code}`} fresh={d?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !d && <div className="empty-body err">{res.error}</div>}
        {d && (
          <>
            <div className="etf-head">
              <span>{`현재가 ${nf(d.price)}`}</span>
              <span className={dirClass(d.changePct)}>{pct(d.changePct)}</span>
              <span>{`NAV ${nf(d.nav, 2)}`}</span>
              <span className={dirClass(d.gap)}>{`괴리율 ${d.gap === undefined ? '—' : `${d.gap.toFixed(2)}%`}`}</span>
              <span>{`추적오차 ${d.trackingError === undefined ? '—' : `${d.trackingError.toFixed(2)}%`}`}</span>
              <span>{`순자산 ${fmtBig(d.netAssets, 'KRW')}`}</span>
              <span>{`상장 ${nf(d.listedShares)}주`}</span>
              <span className="label">{[d.category, d.componentCount ? `구성 ${d.componentCount}종목` : '', d.dividendCycle ? `분배 ${d.dividendCycle}` : ''].filter(Boolean).join(' · ')}</span>
            </div>
            {d.note && <div className="kwrn-err label">{d.note}</div>}
            {tab === 'nav' && (
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>종가</th>
                    <th>NAV</th>
                    <th>괴리율</th>
                  </tr>
                </thead>
                <tbody>
                  {d.navDaily.map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td className="num">{nf(r.close)}</td>
                      <td className="num">{nf(r.nav, 2)}</td>
                      <td className={`num ${dirClass(r.gap)}`}>{r.gap === undefined ? '—' : `${r.gap.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'components' && <MembTable rows={d.components} panel={panel} />}
            {tab === 'flows' &&
              (d.flows.length < 2 ? (
                <div className="empty-body label">상장 주수를 모으는 중이에요. 이 화면을 연 날마다 상장 주수를 기록해서, 이틀째부터 자금 흐름(주수 변화 × NAV)이 보여요. 설정 → 데이터 연결에 KRX Open API 인증키를 넣으면 지난 거래일 자료를 바로 받아요.</div>
              ) : (
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>상장 주수</th>
                      <th>NAV</th>
                      <th>자금 흐름(억 원)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.flows.map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td className="num">{nf(r.shares)}</td>
                        <td className="num">{nf(r.nav, 2)}</td>
                        <td className={`num ${dirClass(r.flow)}`}>{r.flow === undefined ? '—' : `${r.flow > 0 ? '+' : ''}${nf(r.flow / 1e8, 1)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            <div className="attr">{`한국투자증권 ETF/ETN 현재가·NAV 비교추이(일)·ETF 구성종목시세 · 자금 흐름은 ${d.flowSource === 'krx' ? 'KRX Open API ETF 일별매매정보(상장 좌수 × NAV)' : '앱이 이 화면을 연 날의 상장 주수로 계산해요(KRX 인증키를 넣으면 KRX 일별 자료)'}`}</div>
          </>
        )}
      </div>
    </>
  );
}

/** WATC: MON 관심종목 전체의 성과(오늘·1주·1개월·3개월), 오늘 관련 뉴스 수 */
export function Watc({ panel }: { panel: PanelState }) {
  const groups = useStore(appState, (s) => s.watchlists);
  const ids = [...new Set(groups.flatMap((g) => g.ids))];
  const quotes = useQuotes(ids);
  const [perf, setPerf] = useState<Record<string, { w1?: number; m1?: number; m3?: number }>>({});
  const news = usePoll<NewsResponse>('/api/news?kind=all&limit=500', 5 * 60_000);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, { w1?: number; m1?: number; m3?: number }> = {};
      for (const id of ids) {
        try {
          const s = await getBars(id, '1d', 30 * 60_000);
          const bars = s.bars;
          const last = bars.at(-1)?.c;
          const back = (days: number) => {
            const t = (bars.at(-1)?.t ?? 0) - days * 86400;
            const b = [...bars].reverse().find((x) => x.t <= t);
            return b && last ? (last / b.c - 1) * 100 : undefined;
          };
          out[id] = { w1: back(7), m1: back(30), m3: back(91) };
        } catch {
          // 봉이 없는 종목
        }
        if (!alive) return;
      }
      if (alive) setPerf(out);
    })();
    return () => {
      alive = false;
    };
    // ids가 바뀌면(관심종목 편집) 다시 받아요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const dayAgo = Date.now() - 86400_000;
  const newsCount = (name: string, code: string) => (news?.data?.items ?? []).filter((x) => x.published >= dayAgo && (x.title.includes(name) || x.stockCode === code || x.corpName === name)).length;
  return (
    <>
      <TitleBar fn="WATC" name="관심종목 분석" sub={`MON ${groups.length}묶음 · ${ids.length}종목`} />
      <div className="pbody flow">
        <table className="flow-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>종목</th>
              <th style={{ textAlign: 'left' }}>묶음</th>
              <th>현재가</th>
              <th>오늘</th>
              <th>1주</th>
              <th>1개월</th>
              <th>3개월</th>
              <th>뉴스·공시(24시간)</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const inst = getInstrument(id);
              const q = quotes.get(id);
              const p = perf[id] ?? {};
              const name = inst ? inst.nameKo || inst.nameEn || inst.code : id;
              const cnt = inst ? newsCount(inst.nameKo ?? inst.code, inst.code) : 0;
              return (
                <tr key={id} className="click" onClick={() => setPanelSecurity(panel.id, id)}>
                  <td style={{ textAlign: 'left', color: 'var(--value)' }}>{`${name} `}<span className="label">{inst?.code}</span></td>
                  <td style={{ textAlign: 'left' }} className="label">
                    {groups.filter((g) => g.ids.includes(id)).map((g) => g.name).join(', ')}
                  </td>
                  <td className="num">{inst ? fmtPrice(inst, q?.last) : '—'}</td>
                  <td className={`num ${dirClass(q?.changePct)}`}>{fmtPct(q?.changePct)}</td>
                  <td className={`num ${dirClass(p.w1)}`}>{pct(p.w1, 1)}</td>
                  <td className={`num ${dirClass(p.m1)}`}>{pct(p.m1, 1)}</td>
                  <td className={`num ${dirClass(p.m3)}`}>{pct(p.m3, 1)}</td>
                  <td className="num">{cnt || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="attr">MON의 모든 묶음 종목이에요 · 기간 등락은 일봉 종가 기준 · 뉴스·공시 수는 제목에 종목 이름이 든 헤드라인과 그 회사 공시 · 줄을 누르면 연동(CN·EVTS로 더 자세히)</div>
      </div>
    </>
  );
}

/** BQ 쿼트 대시보드: 10호가만(KRX·NXT·통합). 호가는 조회로 2초마다(실시간 등록 칸을 쓰지 않아요) */
export function Bq({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const kr = !!inst && inst.assetClass === 'EQUITY' && (inst.market === 'KS' || inst.market === 'KQ');
  const market = (panel.bookMarket ?? 'J') as BookMarket;
  const book = usePoll<OrderbookResponse>(kr ? `/api/orderbook?id=${encodeURIComponent(inst!.id)}&market=${market}` : '', 2_000);
  if (!inst) {
    return (
      <>
        <TitleBar fn="BQ" name="10호가" />
        <div className="empty-body">
          <div>종목이 필요해요</div>
          <div className="label">예: 005930 BQ ⏎</div>
        </div>
      </>
    );
  }
  const b = book?.data;
  const maxQty = Math.max(1, ...(b?.asks ?? []).map((x) => x.qty), ...(b?.bids ?? []).map((x) => x.qty));
  const tools = kr ? (
    <>
      {BOOK_MARKETS.map((m) => (
        <button key={m.code} className={m.code === market ? 'on' : ''} onClick={() => patchPanel(panel.id, { bookMarket: m.code })}>
          {m.label}
        </button>
      ))}
    </>
  ) : undefined;
  return (
    <>
      <TitleBar fn="BQ" name="10호가" sub={`${inst.nameKo || inst.nameEn || inst.code} ${inst.code}`} fresh={b?.fresh} inst={inst} tools={tools} />
      <div className="pbody bq">
        {!kr && <div className="empty-body label">10호가는 국내 종목만 볼 수 있어요(미국은 무료로 1호가만)</div>}
        {kr && !book && <div className="empty-body label">호가 불러오는 중…</div>}
        {kr && book?.error && !b && <div className="empty-body err">{book.error}</div>}
        {b && (
          <table className="bq-book">
            <tbody>
              {[...b.asks].reverse().map((a, i) => (
                <tr key={`a${i}`}>
                  <td className="bq-qty ask">
                    <span className="bq-bar ask" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
                    <span className="num">{nf(a.qty)}</span>
                  </td>
                  <td className="num bq-px down">{nf(a.price)}</td>
                  <td />
                </tr>
              ))}
              {b.bids.map((x, i) => (
                <tr key={`b${i}`}>
                  <td />
                  <td className="num bq-px up">{nf(x.price)}</td>
                  <td className="bq-qty bid">
                    <span className="bq-bar bid" style={{ width: `${(x.qty / maxQty) * 100}%` }} />
                    <span className="num">{nf(x.qty)}</span>
                  </td>
                </tr>
              ))}
              <tr className="bq-total">
                <td className="num">{nf(b.totalAsk)}</td>
                <td className="label">{b.time ?? '총 잔량'}</td>
                <td className="num">{nf(b.totalBid)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {b?.expected && <div className="label bq-exp">{`예상 체결 ${nf(b.expected.price)}${b.expected.qty ? ` · ${nf(b.expected.qty)}주` : ''}`}</div>}
        {kr && <div className="attr">{`${BOOK_MARKETS.find((m) => m.code === market)?.label} 10호가 · 한국투자증권 호가 조회로 2초마다(실시간 등록 칸 0개 사용)`}</div>}
      </div>
    </>
  );
}
