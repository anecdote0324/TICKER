// v0.4 DART 종목 정보 화면: MGMT 경영진, RELS 관계사, HDS 보유자, OWN 내부자 매매(주가 위 표시), ERN 실적 이력, EM 실적 추세, CF 공시 검색.
// 국내 주식만(OpenDART). 줄을 누르면 DART 원문을 브라우저로 열어요.

import {
  DISCLOSURE_TYPES,
  FIN_LINES,
  type BarSeries,
  type DisclosureResponse,
  type EarningsResponse,
  type FinancialsResponse,
  type HoldersResponse,
  type Instrument,
  type MgmtResponse,
  type RelsResponse,
} from '@bt/shared';
import type { ReactNode } from 'react';
import { dirClass } from '../format';
import { getInstrument, useInstrument } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';
import { openLink } from './News';

const H = 3600_000;
const isKr = (i: Instrument | undefined) => !!i && i.assetClass === 'EQUITY' && (i.market === 'KS' || i.market === 'KQ');
const nf = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eok = (v: number | null | undefined) => (v == null ? '—' : (v / 1e8).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const label = (i: Instrument) => `${i.nameKo || i.code} ${i.code}`;

function Need({ fn, name, inst }: { fn: string; name: string; inst?: Instrument }) {
  return (
    <>
      <TitleBar fn={fn} name={name} />
      <div className="empty-body">
        <div>{inst ? '국내 주식만 볼 수 있어요(DART)' : '종목이 필요해요'}</div>
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

function useStock<T>(panel: PanelState, path: string, ms = 12 * H) {
  const inst = useInstrument(panel.securityId);
  const res = usePoll<T>(isKr(inst) ? `${path}?id=${encodeURIComponent(inst!.id)}` : '', ms);
  return { inst, res };
}

export function Mgmt({ panel }: { panel: PanelState }) {
  const { inst, res } = useStock<MgmtResponse>(panel, '/api/mgmt');
  if (!isKr(inst)) return <Need fn="MGMT" name="경영진" inst={inst} />;
  return (
    <>
      <TitleBar fn="MGMT" name="경영진" sub={label(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              <div className="label fa-note">{d.period ? `DART ${d.period.label} 기준` : '정기보고서에 임원 현황이 없어요'}</div>
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th style={{ textAlign: 'left' }}>직위</th>
                    <th style={{ textAlign: 'left' }}>등기</th>
                    <th style={{ textAlign: 'left' }}>상근</th>
                    <th style={{ textAlign: 'left' }}>담당</th>
                    <th style={{ textAlign: 'left' }}>재직</th>
                    <th style={{ textAlign: 'left' }}>최대주주 관계</th>
                  </tr>
                </thead>
                <tbody>
                  {d.executives.map((e, i) => (
                    <tr key={`${e.name}-${i}`} title={e.career ?? ''}>
                      <td>{e.name}</td>
                      <td style={{ textAlign: 'left', color: 'var(--value)' }}>{e.position}</td>
                      <td style={{ textAlign: 'left' }}>{e.registered ?? ''}</td>
                      <td style={{ textAlign: 'left' }}>{e.fullTime ?? ''}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{e.duty ?? ''}</td>
                      <td style={{ textAlign: 'left' }}>{e.tenure ?? ''}</td>
                      <td style={{ textAlign: 'left' }}>{e.relation ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(d.pay.length > 0 || d.topPay.length > 0) && (
                <table className="flow-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>보수</th>
                      <th>인원</th>
                      <th>총액(백만 원)</th>
                      <th>1인 평균(백만 원)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pay.map((p, i) => (
                      <tr key={`p${i}`}>
                        <td>{p.group}</td>
                        <td className="num">{nf(p.count)}</td>
                        <td className="num">{nf(p.total !== undefined ? p.total / 1e6 : undefined)}</td>
                        <td className="num">{nf(p.avg !== undefined ? p.avg / 1e6 : undefined)}</td>
                      </tr>
                    ))}
                    {d.topPay.map((p, i) => (
                      <tr key={`t${i}`}>
                        <td>{`${p.name} ${p.position ?? ''}`}</td>
                        <td className="num">1</td>
                        <td className="num">{nf(p.total !== undefined ? p.total / 1e6 : undefined)}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="attr">DART 정기보고서 임원 현황·임원 보수(5억 원 이상 개인별) · 줄에 마우스를 올리면 주요 경력</div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

export function Rels({ panel }: { panel: PanelState }) {
  const { inst, res } = useStock<RelsResponse>(panel, '/api/rels');
  if (!isKr(inst)) return <Need fn="RELS" name="관계사·출자" inst={inst} />;
  return (
    <>
      <TitleBar fn="RELS" name="관계사·출자" sub={label(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              <div className="label fa-note">{d.period ? `DART ${d.period.label} 타법인 출자 현황 · 장부가 큰 순` : '정기보고서에 타법인 출자 현황이 없어요'}</div>
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>법인</th>
                    <th>지분율</th>
                    <th>장부가(억 원)</th>
                    <th>보유 주식</th>
                    <th style={{ textAlign: 'left' }}>목적</th>
                    <th>최초 취득</th>
                    <th>총자산(억 원)</th>
                    <th>순이익(억 원)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={`${r.name}-${i}`}>
                      <td style={{ whiteSpace: 'normal' }}>{r.name}</td>
                      <td className="num">{r.pct === undefined ? '—' : `${r.pct}%`}</td>
                      <td className="num">{eok(r.book)}</td>
                      <td className="num">{nf(r.shares)}</td>
                      <td style={{ textAlign: 'left' }}>{r.purpose ?? ''}</td>
                      <td>{r.firstAcq ?? ''}</td>
                      <td className="num">{eok(r.assets)}</td>
                      <td className={`num ${dirClass(r.netIncome)}`}>{eok(r.netIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="attr">DART 정기보고서 타법인 출자 현황(장부가·피출자회사 재무는 원 단위를 억 원으로)</div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

export function Hds({ panel }: { panel: PanelState }) {
  const { inst, res } = useStock<HoldersResponse>(panel, '/api/holders');
  const tab = panel.hdsTab ?? 'largest';
  if (!isKr(inst)) return <Need fn="HDS" name="보유자" inst={inst} />;
  const tools = (
    <>
      {(
        [
          ['largest', '최대주주'],
          ['major', '5% 보유'],
          ['insiders', '임원·주요주주'],
        ] as const
      ).map(([k, l]) => (
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => patchPanel(panel.id, { hdsTab: k })}>
          {l}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="HDS" name="보유자" sub={label(inst!)} fresh={res?.data?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => (
            <>
              {tab === 'largest' && (
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th style={{ textAlign: 'left' }}>관계</th>
                      <th style={{ textAlign: 'left' }}>주식</th>
                      <th>기말 주식</th>
                      <th>기말 지분</th>
                      <th>기초 지분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.largest.map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td>
                        <td style={{ textAlign: 'left' }}>{r.relation ?? ''}</td>
                        <td style={{ textAlign: 'left' }}>{r.kind ?? ''}</td>
                        <td className="num">{nf(r.shares)}</td>
                        <td className="num">{r.pct === undefined ? '—' : `${r.pct}%`}</td>
                        <td className="num label">{r.pctStart === undefined ? '—' : `${r.pctStart}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'major' && (
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>보고일</th>
                      <th style={{ textAlign: 'left' }}>보고자</th>
                      <th>주식</th>
                      <th>지분</th>
                      <th>증감</th>
                      <th style={{ textAlign: 'left' }}>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.major.map((r, i) => (
                      <tr key={i} className="click" onClick={() => openLink(r.url)}>
                        <td>{r.date}</td>
                        <td style={{ textAlign: 'left', color: 'var(--value)' }}>{r.reporter}</td>
                        <td className="num">{nf(r.shares)}</td>
                        <td className="num">{r.pct === undefined ? '—' : `${r.pct}%`}</td>
                        <td className={`num ${dirClass(r.chgPct)}`}>{r.chgPct === undefined ? '—' : `${r.chgPct > 0 ? '+' : ''}${r.chgPct}%p`}</td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{r.reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'insiders' && <InsiderTable rows={d.insiders} />}
              <div className="attr">{`DART ${tab === 'largest' ? `정기보고서 최대주주 현황${d.period ? `(${d.period.label})` : ''}` : tab === 'major' ? '주식등의 대량보유상황보고(5%)' : '임원·주요주주 특정증권등 소유상황보고'} · 보고 줄을 누르면 원문`}</div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

function InsiderTable({ rows }: { rows: HoldersResponse['insiders'] }) {
  return (
    <table className="flow-table">
      <thead>
        <tr>
          <th>보고일</th>
          <th style={{ textAlign: 'left' }}>보고자</th>
          <th style={{ textAlign: 'left' }}>직위</th>
          <th>증감</th>
          <th>보유 주식</th>
          <th>지분</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="click" onClick={() => openLink(r.url)}>
            <td>{r.date}</td>
            <td style={{ textAlign: 'left', color: 'var(--value)' }}>{r.reporter}</td>
            <td style={{ textAlign: 'left' }}>{[r.registered, r.position, r.mainHolder].filter(Boolean).join(' · ')}</td>
            <td className={`num ${dirClass(r.change)}`}>{r.change === undefined ? '—' : `${r.change > 0 ? '+' : ''}${nf(r.change)}`}</td>
            <td className="num">{nf(r.shares)}</td>
            <td className="num">{r.pct === undefined ? '—' : `${r.pct}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** OWN: 1년 종가 선 위에 임원·주요주주 매수(▲)·매도(▼) 보고를 표시하고, 아래에 보고 목록 */
export function Own({ panel }: { panel: PanelState }) {
  const { inst, res } = useStock<HoldersResponse>(panel, '/api/holders');
  const bars = usePoll<BarSeries>(isKr(inst) ? `/api/bars?id=${encodeURIComponent(inst!.id)}&interval=1d` : '', 6 * H);
  if (!isKr(inst)) return <Need fn="OWN" name="내부자 매매" inst={inst} />;
  const W = 600;
  const HT = 150;
  const cutoff = Date.now() / 1000 - 365 * 86400;
  const pts = (bars?.data?.bars ?? []).filter((b) => b.t >= cutoff);
  const lo = Math.min(...pts.map((b) => b.l));
  const hi = Math.max(...pts.map((b) => b.h));
  const x = (t: number) => ((t - (pts[0]?.t ?? 0)) / Math.max(1, (pts.at(-1)?.t ?? 1) - (pts[0]?.t ?? 0))) * (W - 10) + 5;
  const y = (v: number) => HT - 8 - ((v - lo) / (hi - lo || 1)) * (HT - 16);
  const marks = (res?.data?.insiders ?? [])
    .filter((r) => r.change && Date.parse(`${r.date}T00:00:00Z`) / 1000 >= (pts[0]?.t ?? Infinity))
    .map((r) => {
      const t = Date.parse(`${r.date}T00:00:00Z`) / 1000;
      const b = pts.find((p) => p.t >= t) ?? pts.at(-1)!;
      return { r, x: x(b.t), y: y(b.c) };
    });
  return (
    <>
      <TitleBar fn="OWN" name="내부자 매매" sub={label(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        {pts.length > 1 && (
          <div className="flow-chart">
            <svg viewBox={`0 0 ${W} ${HT}`} preserveAspectRatio="none" style={{ height: HT }}>
              <polyline fill="none" stroke="var(--amber)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" points={pts.map((b) => `${x(b.t)},${y(b.c)}`).join(' ')} />
              {marks.map((m, i) => (
                <text key={i} x={m.x} y={m.r.change! > 0 ? m.y + 12 : m.y - 4} fontSize={11} textAnchor="middle" fill={m.r.change! > 0 ? 'var(--up)' : 'var(--down)'}>
                  <title>{`${m.r.date} ${m.r.reporter} ${m.r.change! > 0 ? '+' : ''}${nf(m.r.change)}주`}</title>
                  {m.r.change! > 0 ? '▲' : '▼'}
                </text>
              ))}
            </svg>
            <div className="flow-legend label">
              <span style={{ color: 'var(--amber)' }}>— 종가(1년)</span>
              <span style={{ color: 'var(--up)' }}>▲ 늘림</span>
              <span style={{ color: 'var(--down)' }}>▼ 줄임</span>
              <span>{`보고 ${marks.length}건`}</span>
            </div>
          </div>
        )}
        <Body res={res}>{(d) => <InsiderTable rows={d.insiders} />}</Body>
        <div className="attr">DART 임원·주요주주 특정증권등 소유상황보고 · 보고일 기준(매매일과 다를 수 있어요) · 줄을 누르면 원문</div>
      </div>
    </>
  );
}

export function Ern({ panel }: { panel: PanelState }) {
  const { inst, res } = useStock<EarningsResponse>(panel, '/api/earnings');
  if (!isKr(inst)) return <Need fn="ERN" name="실적 이력" inst={inst} />;
  return (
    <>
      <TitleBar fn="ERN" name="실적 이력" sub={label(inst!)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) =>
            d.rows.length === 0 ? (
              <div className="empty-body label">{d.note ?? '실적 발표가 없어요'}</div>
            ) : (
              <>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>발표일</th>
                      <th>분기</th>
                      <th>매출(억)</th>
                      <th>전년 대비</th>
                      <th>영업이익(억)</th>
                      <th>전년 대비</th>
                      <th>순이익(억)</th>
                      <th>당일 반응</th>
                      <th>이틀</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r, i) => (
                      <tr key={i} className="click" title={r.title} onClick={() => openLink(r.url)}>
                        <td>{r.date}</td>
                        <td>{r.quarter ?? <span className="label">정정</span>}</td>
                        <td className="num">{eok(r.revenue)}</td>
                        <td className={`num ${dirClass(r.revenueYoY)}`}>{r.revenueYoY === undefined ? '—' : `${r.revenueYoY.toFixed(1)}%`}</td>
                        <td className={`num ${dirClass(r.operatingIncome)}`}>{eok(r.operatingIncome)}</td>
                        <td className={`num ${dirClass(r.operatingYoY)}`}>{r.operatingYoY === undefined ? '—' : `${r.operatingYoY.toFixed(1)}%`}</td>
                        <td className={`num ${dirClass(r.netIncome)}`}>{eok(r.netIncome)}</td>
                        <td className={`num ${dirClass(r.reaction1d)}`}>{r.reaction1d === undefined ? '—' : `${r.reaction1d > 0 ? '+' : ''}${r.reaction1d.toFixed(2)}%`}</td>
                        <td className={`num ${dirClass(r.reaction2d)}`}>{r.reaction2d === undefined ? '—' : `${r.reaction2d > 0 ? '+' : ''}${r.reaction2d.toFixed(2)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="attr">DART 잠정실적 공시(최근 3년) · 분기 값은 FA와 같은 DART 재무제표(정기보고서가 나온 분기만) · 반응은 발표일 종가의 전일 대비 · 줄을 누르면 원문</div>
              </>
            )
          }
        </Body>
      </div>
    </>
  );
}

/** EM: FA 분기 값으로 매출·영업이익·순이익 막대와 영업이익률 */
export function Em({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const ok = inst?.assetClass === 'EQUITY';
  const res = usePoll<FinancialsResponse>(ok ? `/api/financials?id=${encodeURIComponent(inst!.id)}&period=quarter` : '', 6 * H);
  if (!inst || !ok) return <Need fn="EM" name="실적 추세" inst={inst} />;
  const lines = (['revenue', 'operatingIncome', 'netIncome'] as const).map((id) => ({ id, label: FIN_LINES.find((l) => l.id === id)!.label }));
  const COLORS = ['#5a6b7d', 'var(--amber)', '#4fc3f7'];
  return (
    <>
      <TitleBar fn="EM" name="실적 추세" sub={label(inst)} fresh={res?.data?.fresh} inst={inst} />
      <div className="pbody flow">
        <Body res={res}>
          {(d) => {
            const unit = d.currency === 'USD' ? 1e6 : 1e8;
            const n = d.periods.length;
            const W = 600;
            const HT = 160;
            const all = lines.flatMap((l) => (d.values[l.id] ?? []).map((v) => v ?? 0)).concat(0);
            const lo = Math.min(...all);
            const hi = Math.max(...all);
            const y = (v: number) => HT - 16 - ((v - lo) / (hi - lo || 1)) * (HT - 24);
            const gw = (W - 10) / Math.max(1, n);
            const bw = gw / 4;
            return (
              <>
                <div className="flow-chart">
                  <svg viewBox={`0 0 ${W} ${HT}`} preserveAspectRatio="none" style={{ height: HT }}>
                    <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
                    {d.periods.map((p, i) =>
                      lines.map((l, k) => {
                        const v = d.values[l.id]?.[i];
                        if (v == null) return null;
                        const top = Math.min(y(v), y(0));
                        return <rect key={`${p.key}-${l.id}`} x={5 + i * gw + bw * (k + 0.5)} y={top} width={bw * 0.9} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={COLORS[k]} />;
                      }),
                    )}
                    {d.periods.map((p, i) => (
                      <text key={p.key} x={5 + i * gw + gw / 2} y={HT - 3} fontSize={10} textAnchor="middle" fill="var(--label)">
                        {p.label}
                      </text>
                    ))}
                  </svg>
                  <div className="flow-legend label">
                    {lines.map((l, k) => (
                      <span key={l.id} style={{ color: COLORS[k] }}>{`■ ${l.label}`}</span>
                    ))}
                  </div>
                </div>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>{d.currency === 'USD' ? '백만 달러' : '억 원'}</th>
                      {d.periods.map((p) => (
                        <th key={p.key}>{p.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.label}</td>
                        {(d.values[l.id] ?? []).map((v, i) => (
                          <td key={i} className={`num ${v != null && v < 0 ? 'down' : ''}`}>
                            {v == null ? '—' : Math.round(v / unit).toLocaleString('en-US')}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td>영업이익률</td>
                      {d.periods.map((p, i) => {
                        const r = d.values.revenue?.[i];
                        const o = d.values.operatingIncome?.[i];
                        const m = r && o != null ? (o / r) * 100 : undefined;
                        return (
                          <td key={p.key} className={`num ${dirClass(m)}`}>
                            {m === undefined ? '—' : `${m.toFixed(1)}%`}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
                <div className="attr">{`${d.source === 'DART' ? 'DART' : 'SEC EDGAR'} 분기 재무제표(FA와 같은 값) · 최근 8분기`}</div>
              </>
            );
          }}
        </Body>
      </div>
    </>
  );
}

/** CF: 공시 검색. 종목이 있으면 그 회사 최근 1년, 없으면 전체 최근 7일. 위 버튼으로 종류, 검색칸으로 제목 거르기 */
export function Cf({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const kr = isKr(inst) ? inst : undefined;
  const type = panel.cfType ?? '';
  const res = usePoll<DisclosureResponse>(`/api/disclosures?type=${type}${kr ? `&id=${encodeURIComponent(kr.id)}` : ''}`, 5 * 60_000);
  const q = (panel.cfQuery ?? '').trim();
  const tools = (
    <>
      {DISCLOSURE_TYPES.map((t) => (
        <button key={t.code} className={type === t.code ? 'on' : ''} onClick={() => patchPanel(panel.id, { cfType: t.code })}>
          {t.label}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="CF" name="공시 검색" sub={kr ? `${label(kr)} · 최근 1년` : '전체 · 최근 7일'} fresh={res?.data?.fresh} inst={kr} tools={tools} />
      <div className="pbody flow">
        <input className="cf-search" placeholder="제목·회사로 거르기 (예: 유상증자, 자기주식)" value={panel.cfQuery ?? ''} onChange={(e) => patchPanel(panel.id, { cfQuery: e.target.value })} />
        <Body res={res}>
          {(d) => {
            const rows = q ? d.rows.filter((r) => r.title.includes(q) || r.corp.includes(q)) : d.rows;
            return (
              <>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      {!kr && <th style={{ textAlign: 'left' }}>회사</th>}
                      <th style={{ textAlign: 'left' }}>제목</th>
                      <th style={{ textAlign: 'left' }}>제출인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const id = r.code ? (getInstrument(`EQ:KS:${r.code}`)?.id ?? getInstrument(`EQ:KQ:${r.code}`)?.id) : undefined;
                      return (
                        <tr key={i} className="click" onClick={() => openLink(r.url)}>
                          <td>{r.date.slice(5)}</td>
                          {!kr && (
                            <td
                              style={{ textAlign: 'left', color: 'var(--value)' }}
                              onClick={(e) => {
                                if (!id) return;
                                e.stopPropagation();
                                setPanelSecurity(panel.id, id);
                              }}
                              title={id ? '누르면 연동 그룹이 이 회사로 바뀌어요' : ''}
                            >
                              {r.corp}
                            </td>
                          )}
                          <td style={{ textAlign: 'left', color: 'var(--value)', whiteSpace: 'normal' }}>{r.title}</td>
                          <td style={{ textAlign: 'left' }} className="label">
                            {r.filer ?? ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="attr">{`DART 공시검색 · ${rows.length}건${q ? `(거른 결과, 전체 ${d.rows.length}건)` : ''} · 5분마다 · 제목을 누르면 원문${kr ? '' : ', 회사를 누르면 연동'} · 미국 공시(SEC)는 후순위`}</div>
              </>
            );
          }}
        </Body>
      </div>
    </>
  );
}
