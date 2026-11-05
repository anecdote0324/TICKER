// v0.4 실적·기업행위 화면: EE 실적 추정치, ANR 투자의견·목표가, DVD 배당, CACS 기업행위, EVTS 이벤트 캘린더, IPO 공모.
// 모두 한국투자증권(종목추정실적·종목투자의견·예탁원 정보)이고, 표는 수급 화면과 같은 모양이에요.

import {
  CORP_EVENT_LABEL,
  opinionClass,
  type CorpEventsResponse,
  type DividendResponse,
  type EstimateResponse,
  type Instrument,
  type IpoResponse,
  type OpinionResponse,
} from '@bt/shared';
import type { ReactNode } from 'react';
import { dirClass } from '../format';
import { getInstrument, useInstrument } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';
import { openLink } from './News';

const HOURS = 3600_000;

const isKr = (i: Instrument | undefined) => !!i && i.assetClass === 'EQUITY' && (i.market === 'KS' || i.market === 'KQ');
const nf = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** 종목이 필요한 화면의 빈 모양 */
function NeedStock({ fn, name, inst }: { fn: string; name: string; inst?: Instrument }) {
  return (
    <>
      <TitleBar fn={fn} name={name} />
      <div className="empty-body">
        <div>{inst ? '국내 주식만 볼 수 있어요' : '종목이 필요해요'}</div>
        <div className="label">{`예: 005930 ${fn} ⏎`}</div>
      </div>
    </>
  );
}

function Body<T>({ res, children }: { res: { data?: T; error?: string } | undefined; children: (d: T) => ReactNode }) {
  if (!res) return <div className="empty-body label">불러오는 중…</div>;
  if (res.error && !res.data) return <div className="empty-body err">{res.error}</div>;
  return res.data ? <>{children(res.data)}</> : null;
}

const stockLabel = (i: Instrument) => `${i.nameKo || i.code} ${i.code}`;

export function Ee({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const res = usePoll<EstimateResponse>(isKr(inst) ? `/api/estimate?id=${encodeURIComponent(inst!.id)}` : '', 6 * HOURS);
  if (!isKr(inst)) return <NeedStock fn="EE" name="실적 추정치" inst={inst} />;
  return (
    <>
      <TitleBar fn="EE" name="실적 추정치" sub={stockLabel(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) =>
            d.periods.length === 0 ? (
              <div className="empty-body label">{d.note ?? '추정 실적이 없어요'}</div>
            ) : (
              <>
                {[
                  { title: '추정 손익', lines: d.income },
                  { title: '투자 지표', lines: d.indicators },
                ].map((g) => (
                  <table key={g.title} className="flow-table" style={{ marginBottom: 8 }}>
                    <thead>
                      <tr>
                        <th>{g.title}</th>
                        {d.periods.map((p) => (
                          <th key={p}>{p}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((l) => (
                        <tr key={l.label}>
                          <td>{l.label}</td>
                          {l.values.map((v, i) => (
                            <td key={i} className={`num ${l.pct ? dirClass(v ?? undefined) : ''}`}>
                              {l.pct ? (v == null ? '—' : `${v.toFixed(1)}`) : nf(v, Number.isInteger(v ?? 0) ? 0 : 1)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
                <div className="attr">KIS 제공 추정(증권사 컨센서스가 아니에요) · 단위는 한국투자증권 표시 그대로(금액은 억 원, 증감률·ROE·부채비율은 %, PER·EV/EBITDA는 배)</div>
              </>
            )
          }
        </Body>
      </div>
    </>
  );
}

export function Anr({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const res = usePoll<OpinionResponse>(isKr(inst) ? `/api/opinions?id=${encodeURIComponent(inst!.id)}` : '', 6 * HOURS);
  if (!isKr(inst)) return <NeedStock fn="ANR" name="투자의견·목표가" inst={inst} />;
  return (
    <>
      <TitleBar fn="ANR" name="투자의견·목표가" sub={stockLabel(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              <div className="anr-sum">
                <span>{`최근 3개월 ${d.summary.brokers}건`}</span>
                <span className="up">{`매수 ${d.summary.buy}`}</span>
                <span>{`중립 ${d.summary.hold}`}</span>
                <span className="down">{`매도 ${d.summary.sell}`}</span>
                <span>{`평균 목표가 ${nf(d.summary.avgTarget)}`}</span>
                <span className="label">{`(최고 ${nf(d.summary.maxTarget)} · 최저 ${nf(d.summary.minTarget)})`}</span>
              </div>
              {d.rows.length === 0 ? (
                <div className="empty-body label">최근 1년 투자의견이 없어요</div>
              ) : (
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th style={{ textAlign: 'left' }}>증권사</th>
                      <th>의견</th>
                      <th>직전</th>
                      <th>목표가</th>
                      <th>전일 종가</th>
                      <th>괴리율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r, i) => {
                      const c = opinionClass(r.opinion);
                      return (
                        <tr key={`${r.date}-${i}`}>
                          <td>{r.date}</td>
                          <td style={{ textAlign: 'left', color: 'var(--value)' }}>{r.broker ?? '—'}</td>
                          <td className={c === 'buy' ? 'up' : c === 'sell' ? 'down' : ''}>{r.opinion}</td>
                          <td className="label">{r.prevOpinion ?? ''}</td>
                          <td className="num">{nf(r.target)}</td>
                          <td className="num">{nf(r.prevClose)}</td>
                          <td className={`num ${dirClass(r.gap)}`}>{r.gap === undefined ? '—' : `${r.gap.toFixed(1)}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="attr">한국투자증권 종목투자의견 · 최근 1년 · 요약은 증권사별 마지막 의견</div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

export function Dvd({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  // 미국 주식도 돼요(한국투자증권 해외 기간별권리)
  const ok = isKr(inst) || (inst?.market === 'US' && inst.assetClass === 'EQUITY');
  const res = usePoll<DividendResponse>(ok ? `/api/dividends?id=${encodeURIComponent(inst!.id)}` : '', 6 * HOURS);
  if (!ok) return <NeedStock fn="DVD" name="배당" inst={inst} />;
  const usd = res?.data?.currency === 'USD';
  return (
    <>
      <TitleBar fn="DVD" name="배당" sub={stockLabel(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              <div className="anr-sum">
                {d.trailing ? (
                  <>
                    <span>{usd ? `최근 1년 주당 $${nf(d.trailing.cash, 4)}` : `최근 1년 주당 ${nf(d.trailing.cash)}원`}</span>
                    {d.trailing.yieldPct !== undefined && <span className="up">{`배당수익률 ${d.trailing.yieldPct.toFixed(2)}%`}</span>}
                  </>
                ) : (
                  <span className="label">최근 1년 현금배당 없음</span>
                )}
              </div>
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>기준일</th>
                    <th style={{ textAlign: 'left' }}>종류</th>
                    <th>주당 현금</th>
                    <th>현금배당률</th>
                    <th>주식배당률</th>
                    <th>지급일</th>
                    <th>주식</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={`${r.recordDate}-${i}`}>
                      <td>{r.recordDate}</td>
                      <td style={{ textAlign: 'left', color: 'var(--value)' }}>{r.kind}</td>
                      <td className="num">{usd ? (r.cash === undefined ? '—' : `$${nf(r.cash, 4)}`) : nf(r.cash)}</td>
                      <td className="num">{r.cashRate === undefined ? '—' : `${r.cashRate}%`}</td>
                      <td className="num">{r.stockRate === undefined ? '—' : `${r.stockRate}%`}</td>
                      <td>{r.payDate ?? '—'}</td>
                      <td className="label">{r.stockKind ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="attr">{usd ? '한국투자증권 해외주식 기간별권리(배당·특별배당) · 지난 5년 · 기준일은 현지 기준일 · 배당수익률은 지금 가격 대비' : '한국투자증권 예탁원 정보(배당) · 지난 10년 · 현금배당률은 액면가 대비, 배당수익률은 지금 가격 대비'}</div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

/** CACS(기업행위)·EVTS(이벤트 캘린더): 종목이 있으면 그 종목, 없으면 시장 전체 다가오는 일정 */
export function CorpEvents({ panel }: { panel: PanelState }) {
  const actions = panel.fn === 'CACS';
  const inst = useInstrument(panel.securityId);
  const kr = isKr(inst) ? inst : undefined;
  const res = usePoll<CorpEventsResponse>(`/api/corp-events?view=${actions ? 'actions' : 'calendar'}${kr ? `&id=${encodeURIComponent(kr.id)}` : ''}`, HOURS);
  const today = new Date(Date.now() + 9 * HOURS).toISOString().slice(0, 10);
  const fn = actions ? 'CACS' : 'EVTS';
  const name = actions ? '기업행위' : '이벤트 캘린더';
  return (
    <>
      <TitleBar fn={fn} name={name} sub={kr ? stockLabel(kr) : '시장 전체 · 지난 7일~앞으로 30일'} fresh={res?.data?.fresh} inst={kr} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              {d.errors && <div className="kwrn-err err">{d.errors.join(' · ')}</div>}
              {d.events.length === 0 ? (
                <div className="empty-body label">해당 기간에 일정이 없어요</div>
              ) : (
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th style={{ textAlign: 'left' }}>종류</th>
                      {!kr && <th style={{ textAlign: 'left' }}>종목</th>}
                      <th style={{ textAlign: 'left' }}>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.events.map((e, i) => {
                      const id = getInstrument(`EQ:KS:${e.code}`)?.id ?? getInstrument(`EQ:KQ:${e.code}`)?.id;
                      return (
                        <tr
                          key={`${e.date}-${e.type}-${e.code}-${i}`}
                          className={`${(id && !kr) || e.url ? 'click' : ''} ${e.date < today ? 'past' : e.date === today ? 'today' : ''}`}
                          onClick={() => (e.url ? openLink(e.url) : id && !kr && setPanelSecurity(panel.id, id))}
                        >
                          <td>{e.date}</td>
                          <td style={{ textAlign: 'left' }}>{CORP_EVENT_LABEL[e.type]}</td>
                          {!kr && <td style={{ textAlign: 'left', color: 'var(--value)' }}>{`${e.name ?? ''} `}<span className="label">{e.code}</span></td>}
                          <td style={{ textAlign: 'left', color: 'var(--value)', whiteSpace: 'normal' }}>{e.detail ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="attr">
                {`${actions ? '한국투자증권 예탁원 정보 · 유상·무상증자, 감자, 합병·분할, 액면 변경, 의무보유(보호예수)' : '한국투자증권 예탁원 정보(주주총회, 공모 청약·상장, 배당 기준일, 유상·무상증자, 의무보유)와 DART(IR·잠정실적 공시, 날짜는 공시일 · 누르면 원문)'}${kr ? ' · 지난 2년~앞으로 1년' : ' · 줄을 누르면 연동'}`}
              </div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

export function Ipo({ panel }: { panel: PanelState }) {
  const res = usePoll<IpoResponse>('/api/ipo', HOURS);
  const today = new Date(Date.now() + 9 * HOURS).toISOString().slice(0, 10);
  return (
    <>
      <TitleBar fn="IPO" name="공모·상장" sub="지난 60일~앞으로 60일" fresh={res?.data?.fresh} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) =>
            d.rows.length === 0 ? (
              <div className="empty-body label">해당 기간에 공모가 없어요</div>
            ) : (
              <>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>청약</th>
                      <th style={{ textAlign: 'left' }}>종목</th>
                      <th>공모가</th>
                      <th>상장일</th>
                      <th>현재가</th>
                      <th>수익률</th>
                      <th style={{ textAlign: 'left' }}>주간사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => {
                      const id = getInstrument(`EQ:KS:${r.code}`)?.id ?? getInstrument(`EQ:KQ:${r.code}`)?.id;
                      const upcoming = (r.subscrTo ?? '') >= today;
                      return (
                        <tr key={r.code} className={id ? 'click' : ''} onClick={() => id && setPanelSecurity(panel.id, id)}>
                          <td className={upcoming ? 'today' : ''}>{r.subscrFrom ? `${r.subscrFrom.slice(5)}~${(r.subscrTo ?? '').slice(5)}` : '—'}</td>
                          <td style={{ textAlign: 'left', color: 'var(--value)' }}>{`${r.name ?? ''} `}<span className="label">{r.code}</span></td>
                          <td className="num">{nf(r.price)}</td>
                          <td>{r.listDate ?? '—'}</td>
                          <td className="num">{nf(r.last)}</td>
                          <td className={`num ${dirClass(r.returnPct)}`}>{r.returnPct === undefined ? '—' : `${r.returnPct > 0 ? '+' : ''}${r.returnPct.toFixed(1)}%`}</td>
                          <td style={{ textAlign: 'left' }} className="label">{r.leadMgr ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="attr">한국투자증권 예탁원 정보(공모주 청약일정) · 수익률은 공모가 대비 지금 가격 · 줄을 누르면 연동(상장한 종목)</div>
              </>
            )
          }
        </Body>
      </div>
    </>
  );
}
