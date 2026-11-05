// DES 종목 개요(03 v0.2): 시세, 시가총액·PER·PBR·52주 고저, 실적(종목 마스터), 업종·상장일 같은 기본 정보.
// 값마다 출처가 달라서 묶음 제목에 출처와 기준을 적어요(02 데이터 신선도 표시).

import { useEffect, useState, type ReactNode } from 'react';
import { MARKET_LABEL, type EtfResponse, type Freshness, type Instrument, type SecurityProfile } from '@bt/shared';
import { api } from '../api';
import { FreshBadge } from '../components/FreshBadge';
import { arrow, dirClass, fmtBig, fmtNum, fmtPct, fmtPrice, fmtShares } from '../format';
import { useQuotes } from '../stores/feed';
import { useInstrument } from '../stores/instruments';
import type { PanelState } from '../stores/panels';
import { TitleBar, useFlash, usePoll } from './common';

/** 한국투자증권 현재가 조회를 다시 받는 간격(서버도 30초 동안 같은 값을 써요) */
const REFRESH_MS = 60_000;

export function Des({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const id = inst?.id;
  const equity = inst?.assetClass === 'EQUITY';
  const [state, setState] = useState<{ id: string; data?: SecurityProfile; error?: string } | null>(null);
  useEffect(() => {
    if (!id || !equity) return;
    let alive = true;
    const load = () =>
      api
        .get<SecurityProfile>(`/api/profile?id=${encodeURIComponent(id)}`)
        .then((data) => alive && setState({ id, data }))
        .catch((e: Error) => alive && setState((s) => (s?.id === id && s.data ? s : { id, error: e.message })));
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [id, equity]);
  const quotes = useQuotes(id ? [id] : []);
  const q = id ? quotes.get(id) : undefined;
  // 종목을 바꾸면 앞 종목의 값을 보여 주지 않아요
  const cur = state && state.id === id ? state : undefined;
  const data = cur?.data;
  const fresh: Freshness | undefined = data?.live?.fresh ?? (data?.master ? { source: 'KIS', mode: 'daily', asOf: Date.parse(data.master.asOf), receivedAt: Date.now(), asOfDate: data.master.asOf } : undefined);
  const name = inst ? inst.nameKo || inst.nameEn || inst.code : '';

  if (!inst || !equity) {
    return (
      <>
        <TitleBar fn="DES" name="종목 개요" />
        <div className="empty-body">
          <div>{inst ? '종목 개요는 주식만 볼 수 있어요' : '종목이 필요해요'}</div>
          <div className="label">커맨드 라인에 주식 종목을 입력하세요 · 예: 005930 DES ⏎</div>
        </div>
      </>
    );
  }
  return (
    <>
      <TitleBar fn="DES" name="종목 개요" sub={`${name} ${inst.code}`} fresh={fresh} inst={inst} />
      <div className="pbody des">
        <DesHead inst={inst} data={data} last={q?.last} change={q?.change} changePct={q?.changePct} quoteFresh={q?.fresh} />
        {!data && !cur?.error && <div className="des-note label">불러오는 중…</div>}
        {cur?.error && !data && <div className="des-note err">{cur.error}</div>}
        {isKrEtf(inst) && <DesEtf inst={inst} />}
        {data && <DesBody inst={inst} data={data} last={q?.last} volume={q?.volume} turnover={q?.turnover} />}
      </div>
    </>
  );
}

function DesHead(props: { inst: Instrument; data?: SecurityProfile; last?: number; change?: number; changePct?: number; quoteFresh?: Freshness }) {
  const { inst, data } = props;
  const last = props.last ?? data?.live?.last;
  const flash = useFlash(props.last, props.quoteFresh?.mode);
  const sector = data?.master?.sector?.join(' > ') ?? data?.live?.sector;
  const warnings = [...new Set([...(data?.live?.warnings ?? []), ...(data?.master?.warnings ?? [])])];
  return (
    <div className="des-head">
      <div className="des-title">
        <span className="des-name">{inst.nameKo || inst.nameEn || inst.code}</span>
        <span className="cd">
          {inst.code} · {inst.market ? MARKET_LABEL[inst.market] : ''}
          {inst.exchange && inst.market === 'US' ? ` ${inst.exchange}` : ''}
        </span>
        {inst.nameEn && inst.nameKo && <span className="label">{inst.nameEn}</span>}
      </div>
      <div className="des-price">
        <span className={`des-last num ${flash}`}>{fmtPrice(inst, last)}</span>
        <span className={`num ${dirClass(props.change)}`}>{props.change !== undefined ? `${arrow(props.change)}${fmtPrice(inst, Math.abs(props.change))}` : ''}</span>
        <span className={`num ${dirClass(props.changePct)}`}>{props.changePct !== undefined ? fmtPct(props.changePct) : ''}</span>
        <FreshBadge fresh={props.quoteFresh} inst={inst} variant="short" />
        {sector && <span className="des-sector">{sector}</span>}
      </div>
      {warnings.length > 0 && (
        <div className="des-warn">
          {warnings.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      )}
      <Range52 inst={inst} data={data} last={last} />
    </div>
  );
}

/** 52주 범위: 위 줄에 최저·최고(날짜), 아래 줄에 막대와 지금 자리. 좁은 패널에서도 잘리지 않게 두 줄로 */
function Range52({ inst, data, last }: { inst: Instrument; data?: SecurityProfile; last?: number }) {
  const lo = data?.live?.low52;
  const hi = data?.live?.high52;
  if (!lo || !hi || hi <= lo) return null;
  const pos = last !== undefined ? Math.min(1, Math.max(0, (last - lo) / (hi - lo))) : undefined;
  return (
    <div className="des-range">
      <div className="des-range-ends num">
        <span>
          <span className="label">52주 최저 </span>
          {fmtPrice(inst, lo)}
          <span className="label"> {shortDate(data?.live?.low52Date)}</span>
        </span>
        <span>
          <span className="label">{shortDate(data?.live?.high52Date)} </span>
          {fmtPrice(inst, hi)}
          <span className="label"> 52주 최고</span>
        </span>
      </div>
      <div className="des-bar">{pos !== undefined && <i style={{ left: `${pos * 100}%` }} />}</div>
    </div>
  );
}

function DesBody({ inst, data, last, volume, turnover }: { inst: Instrument; data: SecurityProfile; last?: number; volume?: number; turnover?: number }) {
  const cur = data.currency;
  const live = data.live;
  const m = data.master;
  const shares = live?.shares ?? m?.shares;
  // 시가총액은 실시간 현재가로 다시 계산해요(조회는 60초마다)
  const mcap = last && shares ? last * shares : (live?.marketCap ?? m?.marketCap);
  const margin = m?.sales && m.operatingProfit !== undefined ? (m.operatingProfit / m.sales) * 100 : undefined;
  const times = (v: number | undefined) => (v !== undefined ? `${fmtNum(v, 2)}배` : '—');
  return (
    <>
      <div className="des-grid">
        <Section title="가치" note={live ? '한국투자증권 · 60초마다' : undefined}>
          <Kv k="시가총액" v={fmtBig(mcap, cur)} />
          <Kv k="상장주식수" v={fmtShares(shares)} />
          <Kv k="PER" v={times(live?.per)} />
          <Kv k="PBR" v={times(live?.pbr)} />
          <Kv k="EPS" v={live?.eps !== undefined ? fmtPrice(inst, live.eps) : '—'} />
          <Kv k="BPS" v={live?.bps !== undefined ? fmtPrice(inst, live.bps) : '—'} />
        </Section>
        <Section title="거래">
          <Kv k="거래량" v={volume !== undefined ? `${Math.round(volume).toLocaleString('en-US')}주` : '—'} />
          <Kv k="거래대금" v={fmtBig(turnover, cur)} />
          {inst.market !== 'US' && <Kv k="외국인 소진율" v={live?.foreignRatio !== undefined ? `${fmtNum(live.foreignRatio, 2)}%` : '—'} />}
          {inst.market !== 'US' && <Kv k="거래량 회전율" v={live?.turnoverRate !== undefined ? `${fmtNum(live.turnoverRate, 2)}%` : '—'} />}
          {inst.market === 'US' && <Kv k="원화 환산가" v={live?.krwPrice !== undefined ? `${Math.round(live.krwPrice).toLocaleString('en-US')}원` : '—'} />}
        </Section>
        {m && (m.sales !== undefined || m.roe !== undefined) && (
          <Section title="실적" note={`종목 마스터${m.basisMonth ? ` · 기준 ${m.basisMonth}` : ''}`}>
            <Kv k="매출액" v={fmtBig(m.sales, 'KRW')} />
            <Kv k="영업이익" v={fmtBig(m.operatingProfit, 'KRW')} cls={dirClass(m.operatingProfit)} />
            <Kv k="영업이익률" v={margin !== undefined ? `${fmtNum(margin, 1)}%` : '—'} />
            <Kv k="ROE" v={m.roe !== undefined ? `${fmtNum(m.roe, 2)}%` : '—'} />
          </Section>
        )}
        {data.company && (
          <Section title="회사" note="DART 기업개황">
            <Kv k="대표이사" v={data.company.ceo ?? '—'} />
            <Kv k="설립일" v={data.company.established ?? '—'} />
            <Kv
              k="홈페이지"
              v={
                data.company.homepage ? (
                  <a
                    href={data.company.homepage}
                    onClick={(e) => {
                      e.preventDefault();
                      if (window.btBridge?.openExternal) window.btBridge.openExternal(data.company!.homepage!);
                      else window.open(data.company!.homepage!, '_blank', 'noopener');
                    }}
                    style={{ color: 'var(--value-hi)' }}
                  >
                    {data.company.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            <Kv k="주소" v={<span title={data.company.address}>{data.company.address ?? '—'}</span>} />
            <Kv k="산업분류(KSIC)" v={data.company.ksic ?? '—'} />
          </Section>
        )}
        <Section title="기본 정보" note={m ? `종목 마스터 · ${m.asOf}` : undefined}>
          <Kv k="업종" v={m?.sector?.join(' > ') ?? live?.sector ?? '—'} />
          {inst.market !== 'US' && <Kv k="상장일" v={m?.listedDate ?? '—'} />}
          <Kv k="액면가" v={live?.faceValue ?? m?.faceValue ? fmtPrice(inst, live?.faceValue ?? m?.faceValue) : '—'} />
          {inst.market !== 'US' && <Kv k="결산월" v={live?.settleMonth ?? m?.settleMonth ? `${Number(live?.settleMonth ?? m?.settleMonth)}월` : '—'} />}
          <Kv k="통화" v={cur} />
        </Section>
      </div>
      {data.liveError && <div className="des-note label">{data.liveError}</div>}
    </>
  );
}

const isKrEtf = (i: Instrument) => (i.market === 'KS' || i.market === 'KQ') && !!i.flags?.includes('ETF');

/** DES의 ETF 유형(v0.4): NAV·괴리율·추적오차·순자산·분류와 구성 상위 5종목. 자세한 것은 ETF 화면 */
function DesEtf({ inst }: { inst: Instrument }) {
  const res = usePoll<EtfResponse>(`/api/etf?id=${encodeURIComponent(inst.id)}`, REFRESH_MS);
  const d = res?.data;
  if (!res) return null;
  if (res.error && !d) return <div className="des-note label">{`ETF 정보: ${res.error}`}</div>;
  if (!d) return null;
  const pct = (v?: number) => (v === undefined ? '—' : `${v.toFixed(2)}%`);
  return (
    <Section title="ETF" note={`한국투자증권 ETF 현재가 · 자세히는 ${inst.code} ETF`}>
      <div className="des-grid">
        <Kv k="NAV" v={d.nav === undefined ? '—' : d.nav.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
        <Kv k="괴리율" v={pct(d.gap)} cls={dirClass(d.gap)} />
        <Kv k="추적 오차율" v={pct(d.trackingError)} />
        <Kv k="순자산" v={fmtBig(d.netAssets, 'KRW')} />
        <Kv k="상장 주수" v={fmtShares(d.listedShares)} />
        <Kv k="분류" v={d.category ?? '—'} />
        <Kv k="구성 종목 수" v={d.componentCount ?? '—'} />
        <Kv k="분배 주기" v={d.dividendCycle ?? '—'} />
      </div>
      {d.components.length > 0 && (
        <div className="des-etf-top label">
          {`구성 상위: ${d.components
            .slice(0, 5)
            .map((c) => `${c.name} ${c.weight === undefined ? '' : `${c.weight.toFixed(1)}%`}`)
            .join(' · ')}`}
        </div>
      )}
    </Section>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="des-sec">
      <div className="grp">
        <span>{title}</span>
        {note && <span className="des-src">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Kv({ k, v, cls }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v num ${cls ?? ''}`}>{v}</span>
    </div>
  );
}

const shortDate = (d?: string) => (d ? d.slice(2).replace(/-/g, '/') : '');
