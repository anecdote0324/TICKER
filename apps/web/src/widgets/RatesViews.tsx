// v0.6 금리: BTMM 금리 종합(USSW 별칭은 미국 탭), OIS 무위험지표금리, FICM 크레딧 스프레드, WB 세계 국채(WBX 스프레드 탭),
// CMX 커브 매트릭스, FWCM 선도금리 매트릭스, HSA 커브 전략 모니터, SOVM 국채·국가부채.
// 커브는 /api/curves(국고·미국채·일본·유로 AAA), 단기·크레딧 시계열은 /api/money, 국가부채는 /api/sovereign.

import { useMemo, useState } from 'react';
import {
  compoundedRate,
  CURVE_INFO,
  daysBefore,
  forwardFromSpot,
  lastAndAgo,
  MONEY_SERIES,
  rowOnOrBefore,
  yieldAt,
  type CurveId,
  type CurvesResponse,
  type MoneySeriesId,
  type MoneySeriesResponse,
  type SovereignResponse,
  type YieldCurve,
} from '@bt/shared';
import { dirClass } from '../format';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const POLL = 30 * 60_000;
const ORDER: CurveId[] = ['KTB', 'UST', 'JGB', 'EUR'];
const f2 = (v: number | undefined, d = 3) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const fbp = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
const bpOf = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : (a - b) * 100);

/** 1년치 작은 선 그래프 */
function Spark({ values, w = 110, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <span className="label">—</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.2" />
    </svg>
  );
}

function useCurves() {
  const res = usePoll<CurvesResponse>('/api/curves', POLL);
  const curves = useMemo(() => {
    const m = new Map<CurveId, YieldCurve>();
    for (const c of res?.data?.curves ?? []) m.set(c.id, c);
    return m;
  }, [res?.data]);
  return { res, curves };
}

function useMoney() {
  const res = usePoll<MoneySeriesResponse>('/api/money', POLL);
  const series = useMemo(() => new Map((res?.data?.series ?? []).map((s) => [s.id, s.obs])), [res?.data]);
  return { res, series };
}

/** 커브의 마지막 행과 n일 전 행에서 만기 years 금리 */
function curvePoint(c: YieldCurve | undefined, years: number, daysAgo = 0): number | undefined {
  if (!c?.rows.length) return undefined;
  const last = c.rows[c.rows.length - 1];
  const row = daysAgo ? rowOnOrBefore(c.rows, daysBefore(last.date, daysAgo)) : last;
  return row ? yieldAt(c, row.values, years) : undefined;
}

/** 커브 이력에서 만기 years 금리의 1년 시계열 */
function curveSeries(c: YieldCurve | undefined, years: number): Array<{ date: string; value: number }> {
  if (!c) return [];
  const out: Array<{ date: string; value: number }> = [];
  for (const r of c.rows) {
    const v = yieldAt(c, r.values, years);
    if (v !== undefined) out.push({ date: r.date, value: v });
  }
  return out.slice(-260);
}

function MissingNote({ res, keys }: { res?: { data?: { missing: Array<{ id: string; reason: string }> } }; keys?: string[] }) {
  const miss = (res?.data?.missing ?? []).filter((m) => !keys || keys.includes(m.id));
  if (!miss.length) return null;
  const reasons = [...new Set(miss.map((m) => m.reason))];
  return <div className="label fx-warn">{`일부 없음: ${reasons.join(' / ')}`}</div>;
}

function CurveButtons({ panel, value }: { panel: PanelState; value: CurveId }) {
  return (
    <>
      {ORDER.map((c) => (
        <button key={c} className={c === value ? 'on' : ''} onClick={() => patchPanel(panel.id, { ratesCurve: c })}>
          {CURVE_INFO[c].short}
        </button>
      ))}
    </>
  );
}

// ── BTMM 금리 종합 ──

const BTMM_ROWS: Record<'KR' | 'US' | 'EU', Array<{ series?: MoneySeriesId; curve?: [CurveId, number]; label?: string }>> = {
  KR: [{ series: 'KR_BASE' }, { series: 'KR_CALL' }, { series: 'KR_CD91' }, { series: 'KR_CP91' }, { curve: ['KTB', 1], label: '국고채 1년' }, { series: 'KR_KTB3' }, { curve: ['KTB', 5], label: '국고채 5년' }, { series: 'KR_KTB10' }, { curve: ['KTB', 30], label: '국고채 30년' }, { series: 'KR_AA3' }, { series: 'KR_BBB3' }],
  US: [{ series: 'US_FFU' }, { series: 'US_FFL' }, { series: 'US_EFFR' }, { series: 'US_SOFR' }, { series: 'US_TB3M' }, { curve: ['UST', 2], label: '미국채 2년' }, { curve: ['UST', 5], label: '미국채 5년' }, { curve: ['UST', 10], label: '미국채 10년' }, { curve: ['UST', 30], label: '미국채 30년' }],
  EU: [{ series: 'EU_ESTR' }, { curve: ['EUR', 2], label: '유로 AAA 2년' }, { curve: ['EUR', 10], label: '유로 AAA 10년' }, { curve: ['JGB', 2], label: '일본 국채 2년' }, { curve: ['JGB', 10], label: '일본 국채 10년' }, { curve: ['JGB', 30], label: '일본 국채 30년' }],
};

export function Btmm({ panel }: { panel: PanelState }) {
  const arg = panel.args?.[0];
  const tab = (panel.ratesTab as 'KR' | 'US' | 'EU' | undefined) ?? (arg === 'US' || panel.fn === 'USSW' ? 'US' : 'KR');
  const { curves, res: cres } = useCurves();
  const { series, res } = useMoney();
  const rows = BTMM_ROWS[tab].map((r) => {
    if (r.series) {
      const def = MONEY_SERIES.find((d) => d.id === r.series)!;
      const obs = series.get(r.series) ?? [];
      const a = lastAndAgo(obs, 1);
      const w = lastAndAgo(obs, 7);
      const m = lastAndAgo(obs, 30);
      return { label: def.name, last: a.last?.value, date: a.last?.date, d1: bpOf(a.last?.value, obs.length > 1 ? obs[obs.length - 2].value : undefined), w1: bpOf(w.last?.value, w.ago), m1: bpOf(m.last?.value, m.ago), spark: obs.slice(-260).map((o) => o.value) };
    }
    const [cid, years] = r.curve!;
    const c = curves.get(cid);
    const s = curveSeries(c, years);
    const last = s[s.length - 1];
    return { label: r.label!, last: last?.value, date: last?.date, d1: bpOf(last?.value, s.length > 1 ? s[s.length - 2].value : undefined), w1: bpOf(curvePoint(c, years), curvePoint(c, years, 7)), m1: bpOf(curvePoint(c, years), curvePoint(c, years, 30)), spark: s.map((x) => x.value) };
  });
  const tools = (
    <>
      {(['KR', 'US', 'EU'] as const).map((t) => (
        <button key={t} className={t === tab ? 'on' : ''} onClick={() => patchPanel(panel.id, { ratesTab: t })}>
          {{ KR: '한국', US: '미국', EU: '유로·일본' }[t]}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn={panel.fn === 'USSW' ? 'USSW' : 'BTMM'} name="금리 종합" sub={{ KR: '한국', US: '미국', EU: '유로·일본' }[tab]} fresh={res?.data?.fresh} tools={tools} />
      <div className="pbody flow">
        <MissingNote res={res} keys={BTMM_ROWS[tab].map((r) => r.series).filter((x): x is MoneySeriesId => !!x)} />
        {cres?.data?.missing.length ? <MissingNote res={cres} keys={BTMM_ROWS[tab].map((r) => r.curve?.[0]).filter((x): x is CurveId => !!x)} /> : null}
        <table className="flow-table">
          <thead>
            <tr>
              <th>금리</th>
              <th>값(%)</th>
              <th>1일(bp)</th>
              <th>1주</th>
              <th>1달</th>
              <th>기준일</th>
              <th>1년</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{f2(r.last)}</td>
                <td className={dirClass(r.d1)}>{fbp(r.d1)}</td>
                <td className={dirClass(r.w1)}>{fbp(r.w1)}</td>
                <td className={dirClass(r.m1)}>{fbp(r.m1)}</td>
                <td>{r.date?.slice(5) ?? '—'}</td>
                <td>
                  <Spark values={r.spark} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="attr">일별 고시 금리예요(장중 금리 아님). 한국: ECOS(인증키) · 미국: FRED(키)·재무부 · 유로: FRED €STR·ECB · 일본: 재무성. 발표 일정은 ECO⏎. 스왑·한국 장중 금리는 무료 데이터가 없어요</div>
    </>
  );
}

// ── OIS 무위험지표금리 ──

const OIS_RATES: Array<{ id: MoneySeriesId; label: string; basis: 360 | 365 }> = [
  { id: 'US_SOFR', label: 'SOFR(달러)', basis: 360 },
  { id: 'US_EFFR', label: 'EFFR(달러)', basis: 360 },
  { id: 'EU_ESTR', label: '€STR(유로)', basis: 360 },
  { id: 'KR_CALL', label: '콜(원)', basis: 365 },
];

export function Ois({ panel }: { panel: PanelState }) {
  const rate = OIS_RATES.find((r) => r.id === panel.oisRate) ?? OIS_RATES[0];
  const { series, res } = useMoney();
  const obs = series.get(rate.id) ?? [];
  const lastDate = obs[obs.length - 1]?.date;
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const s = start || (lastDate ? daysBefore(lastDate, 91) : '');
  const e = end || lastDate || '';
  const comp = s && e ? compoundedRate(obs, s, e, rate.basis) : undefined;
  const avg = useMemo(() => {
    const xs = obs.filter((o) => o.date >= s && o.date < e).map((o) => o.value);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  }, [obs, s, e]);
  const tools = (
    <>
      {OIS_RATES.map((r) => (
        <button key={r.id} className={r.id === rate.id ? 'on' : ''} onClick={() => patchPanel(panel.id, { oisRate: r.id })}>
          {r.label.split('(')[0]}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="OIS" name="무위험지표금리" sub={rate.label} fresh={res?.data?.fresh} tools={tools} />
      <div className="pbody flow fx-calc" onKeyDown={(ev) => ev.stopPropagation()}>
        <MissingNote res={res} keys={[rate.id]} />
        <div className="fx-row">
          <b>복리 계산</b>
          <label className="label">
            시작 <input type="date" value={s} onChange={(ev) => setStart(ev.target.value)} />
          </label>
          <label className="label">
            끝 <input type="date" value={e} onChange={(ev) => setEnd(ev.target.value)} />
          </label>
          <span className="fx-spot">{comp ? `복리 ${comp.rate.toFixed(4)}%` : '—'}</span>
          <span className="label">{comp ? `${comp.days}일 · 단순 평균 ${f2(avg, 4)}% · 실제/${rate.basis}` : '기간 안 고시가 없어요'}</span>
        </div>
        <div className="ois-grid">
          <Spark values={obs.slice(-260).map((o) => o.value)} w={420} h={60} />
          <table className="flow-table">
            <thead>
              <tr>
                <th>고시일</th>
                <th>금리(%)</th>
                <th>전일 대비(bp)</th>
              </tr>
            </thead>
            <tbody>
              {obs
                .slice(-15)
                .reverse()
                .map((o, i, arr) => {
                  const prev = arr[i + 1]?.value;
                  const d = bpOf(o.value, prev);
                  return (
                    <tr key={o.date}>
                      <td>{o.date}</td>
                      <td>{o.value.toFixed(4)}</td>
                      <td className={dirClass(d)}>{fbp(d)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="attr">일별 고시 금리를 기간 동안 복리로 계산해요(주말·휴일은 직전 고시 금리를 그 일수만큼). 실제 OIS 스왑 호가는 무료 데이터가 없어요 · SOFR·EFFR·€STR(FRED 키), 콜(ECOS 인증키). KOFR은 원천 확인 전이라 콜금리로 대신해요</div>
    </>
  );
}

// ── FICM 크레딧 스프레드 ──

export function Ficm({ panel: _panel }: { panel: PanelState }) {
  const { series, res } = useMoney();
  const diff = (a: MoneySeriesId, b: MoneySeriesId) => {
    const x = series.get(a) ?? [];
    const y = new Map((series.get(b) ?? []).map((o) => [o.date, o.value]));
    return x.filter((o) => y.has(o.date)).map((o) => ({ date: o.date, value: o.value - y.get(o.date)! }));
  };
  const rows: Array<{ label: string; obs: Array<{ date: string; value: number }> }> = [
    { label: '한국 회사채 AA- 3년 − 국고 3년', obs: diff('KR_AA3', 'KR_KTB3') },
    { label: '한국 회사채 BBB- 3년 − 국고 3년', obs: diff('KR_BBB3', 'KR_KTB3') },
    { label: '미국 AAA 회사채 OAS', obs: series.get('US_OAS_AAA') ?? [] },
    { label: '미국 투자등급 회사채 OAS', obs: series.get('US_OAS_IG') ?? [] },
    { label: '미국 BBB 회사채 OAS', obs: series.get('US_OAS_BBB') ?? [] },
    { label: '미국 하이일드 OAS', obs: series.get('US_OAS_HY') ?? [] },
  ];
  return (
    <>
      <TitleBar fn="FICM" name="크레딧 스프레드" fresh={res?.data?.fresh} />
      <div className="pbody flow">
        <MissingNote res={res} keys={['KR_AA3', 'KR_BBB3', 'KR_KTB3', 'US_OAS_IG', 'US_OAS_HY']} />
        <table className="flow-table">
          <thead>
            <tr>
              <th>스프레드</th>
              <th>값(bp)</th>
              <th>1주</th>
              <th>1달</th>
              <th>1년 최저</th>
              <th>1년 최고</th>
              <th>기준일</th>
              <th>1년</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const y = r.obs.slice(-260);
              const w = lastAndAgo(r.obs, 7);
              const m = lastAndAgo(r.obs, 30);
              const last = w.last?.value;
              return (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{last === undefined ? '—' : (last * 100).toFixed(0)}</td>
                  <td className={dirClass(bpOf(last, w.ago))}>{fbp(bpOf(last, w.ago))}</td>
                  <td className={dirClass(bpOf(last, m.ago))}>{fbp(bpOf(last, m.ago))}</td>
                  <td>{y.length ? (Math.min(...y.map((o) => o.value)) * 100).toFixed(0) : '—'}</td>
                  <td>{y.length ? (Math.max(...y.map((o) => o.value)) * 100).toFixed(0) : '—'}</td>
                  <td>{w.last?.date.slice(5) ?? '—'}</td>
                  <td>
                    <Spark values={y.map((o) => o.value)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="attr">한국은 ECOS 회사채(장외 3년) 금리 − 국고채 3년(인증키), 미국은 ICE BofA 옵션조정 스프레드(FRED 키, 최근 3년만 줘서 v0.3부터 따로 모아 둬요). 스프레드가 넓어지면(+) 신용 위험을 더 높게 보는 거예요</div>
    </>
  );
}

// ── WB 세계 국채 / WBX 스프레드 ──

const WB_TENORS = [2, 5, 10, 30];

export function Wb({ panel }: { panel: PanelState }) {
  const tab = panel.fn === 'WBX' ? 'X' : ((panel.ratesTab as 'Y' | 'X' | undefined) ?? 'Y');
  const { curves, res } = useCurves();
  const avail = ORDER.filter((c) => curves.has(c));
  const tools = (
    <>
      <button className={tab === 'Y' ? 'on' : ''} onClick={() => patchPanel(panel.id, { ratesTab: 'Y' })}>
        국채
      </button>
      <button className={tab === 'X' ? 'on' : ''} onClick={() => patchPanel(panel.id, { ratesTab: 'X' })}>
        나라 간 스프레드
      </button>
    </>
  );
  return (
    <>
      <TitleBar fn={panel.fn === 'WBX' ? 'WBX' : 'WB'} name="세계 국채" sub={tab === 'X' ? '나라 간 스프레드' : undefined} tools={tools} />
      <div className="pbody flow">
        <MissingNote res={res} />
        {tab === 'Y' ? (
          <table className="flow-table">
            <thead>
              <tr>
                <th>나라</th>
                {WB_TENORS.map((t) => (
                  <th key={t}>{`${t}년`}</th>
                ))}
                {WB_TENORS.map((t) => (
                  <th key={`d${t}`}>{`${t}년 1일(bp)`}</th>
                ))}
                <th>기준일</th>
              </tr>
            </thead>
            <tbody>
              {avail.map((cid) => {
                const c = curves.get(cid)!;
                return (
                  <tr key={cid}>
                    <td>{`${CURVE_INFO[cid].country} ${c.name}`}</td>
                    {WB_TENORS.map((t) => (
                      <td key={t}>{f2(curvePoint(c, t))}</td>
                    ))}
                    {WB_TENORS.map((t) => {
                      const d = bpOf(curvePoint(c, t), curvePoint(c, t, 1));
                      return (
                        <td key={`d${t}`} className={dirClass(d)}>
                          {fbp(d)}
                        </td>
                      );
                    })}
                    <td>{c.rows[c.rows.length - 1]?.date.slice(5)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <>
            {[10, 2].map((t) => (
              <section key={t} className="fixi-src">
                <div className="fixi-head">
                  <b>{`${t}년 금리 차이(bp): 행 − 열`}</b>
                  <span className="label">괄호 안은 1달 변화</span>
                </div>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th />
                      {avail.map((c) => (
                        <th key={c}>{CURVE_INFO[c].short}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {avail.map((a) => (
                      <tr key={a}>
                        <td>{CURVE_INFO[a].country}</td>
                        {avail.map((b) => {
                          if (a === b) return <td key={b}>—</td>;
                          const now = bpOf(curvePoint(curves.get(a), t), curvePoint(curves.get(b), t));
                          const ago = bpOf(curvePoint(curves.get(a), t, 30), curvePoint(curves.get(b), t, 30));
                          const chg = now !== undefined && ago !== undefined ? now - ago : undefined;
                          return (
                            <td key={b}>
                              {now === undefined ? '—' : now.toFixed(0)}
                              <span className={`label ${dirClass(chg)}`}>{chg === undefined ? '' : ` (${fbp(chg)})`}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </>
        )}
      </div>
      <div className="attr">국고채(ECOS 인증키)·미국채(재무부)·일본 국채(재무성)·유로 AAA 국채(ECB, 현물 금리). 없는 만기는 앞뒤 만기로 보간해요. 영국·독일 개별 국채는 원천 확인 전이에요</div>
    </>
  );
}

// ── CMX 커브 매트릭스 ──

const CMX_CHANGES: Array<{ label: string; days: number }> = [
  { label: '1일', days: 1 },
  { label: '1주', days: 7 },
  { label: '1달', days: 30 },
  { label: '3달', days: 91 },
  { label: '1년', days: 365 },
];

export function Cmx({ panel }: { panel: PanelState }) {
  const { curves, res } = useCurves();
  const cid = ((panel.ratesCurve as CurveId | undefined) && curves.has(panel.ratesCurve as CurveId) ? panel.ratesCurve : ORDER.find((c) => curves.has(c))) as CurveId | undefined;
  const c = cid ? curves.get(cid) : undefined;
  const last = c?.rows[c.rows.length - 1];
  return (
    <>
      <TitleBar fn="CMX" name="커브 매트릭스" sub={c?.name} fresh={c?.fresh} tools={<CurveButtons panel={panel} value={cid ?? 'UST'} />} />
      <div className="pbody flow">
        <MissingNote res={res} keys={cid ? [cid] : undefined} />
        {c && last && (
          <table className="flow-table">
            <thead>
              <tr>
                <th>만기</th>
                <th>{`금리(%) ${last.date.slice(5)}`}</th>
                {CMX_CHANGES.map((x) => (
                  <th key={x.label}>{`${x.label}(bp)`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.tenors.map((t) => {
                const now = last.values[t.key];
                return (
                  <tr key={t.key}>
                    <td>{t.label}</td>
                    <td>{f2(now)}</td>
                    {CMX_CHANGES.map((x) => {
                      const row = rowOnOrBefore(c.rows, daysBefore(last.date, x.days));
                      const d = bpOf(now, row?.values[t.key]);
                      return (
                        <td key={x.label} className={dirClass(d)}>
                          {fbp(d)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="attr">만기별 금리와 기간별 변화(bp)예요. 커브 모양은 GC⏎, 선도금리는 FWCM⏎</div>
    </>
  );
}

// ── FWCM 선도금리 매트릭스 ──

const FW_STARTS = [0, 1, 2, 3, 5, 7, 10];
const FW_TENORS = [1, 2, 3, 5, 10];

export function Fwcm({ panel }: { panel: PanelState }) {
  const { curves, res } = useCurves();
  const cid = ((panel.ratesCurve as CurveId | undefined) && curves.has(panel.ratesCurve as CurveId) ? panel.ratesCurve : ORDER.find((c) => curves.has(c))) as CurveId | undefined;
  const c = cid ? curves.get(cid) : undefined;
  const last = c?.rows[c.rows.length - 1];
  return (
    <>
      <TitleBar fn="FWCM" name="선도금리 매트릭스" sub={c?.name} fresh={c?.fresh} tools={<CurveButtons panel={panel} value={cid ?? 'UST'} />} />
      <div className="pbody flow">
        <MissingNote res={res} keys={cid ? [cid] : undefined} />
        {c && last && (
          <table className="flow-table">
            <thead>
              <tr>
                <th>시작 → 기간</th>
                {FW_TENORS.map((t) => (
                  <th key={t}>{`${t}년`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FW_STARTS.map((s) => (
                <tr key={s}>
                  <td>{s === 0 ? '지금(현물)' : `${s}년 뒤`}</td>
                  {FW_TENORS.map((t) => {
                    const r2 = yieldAt(c, last.values, s + t);
                    const r1 = s === 0 ? 0 : yieldAt(c, last.values, s);
                    const fwd = r2 === undefined || r1 === undefined ? undefined : forwardFromSpot(r1, s, r2, s + t);
                    return (
                      <td key={t} title={`${s}Y${t}Y`}>
                        {f2(fwd)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="attr">
        {`${last?.date ?? ''} 커브로 계산한 선도금리(%)예요. 예: '2년 뒤 · 3년'은 2년 뒤에 시작하는 3년 금리(2Y3Y). 고시 금리를 연복리 현물 금리로 보고 계산한 근사이고, 커브 밖 만기는 비워요(유로 AAA만 현물 금리)`}
      </div>
    </>
  );
}

// ── HSA 커브 전략 모니터 ──

interface Strat {
  label: string;
  /** 날짜 → 값(%p) */
  series: Array<{ date: string; value: number }>;
}

export function Hsa({ panel: _panel }: { panel: PanelState }) {
  const { curves, res } = useCurves();
  const strats = useMemo(() => {
    const out: Strat[] = [];
    const build = (c: YieldCurve, f: (v: (y: number) => number | undefined) => number | undefined) => {
      const s: Strat['series'] = [];
      for (const r of c.rows.slice(-260)) {
        const v = f((y) => yieldAt(c, r.values, y));
        if (v !== undefined) s.push({ date: r.date, value: v });
      }
      return s;
    };
    for (const cid of ORDER) {
      const c = curves.get(cid);
      if (!c) continue;
      const n = CURVE_INFO[cid].short;
      out.push({ label: `${n} 2s10s(10년 − 2년)`, series: build(c, (v) => (v(10) !== undefined && v(2) !== undefined ? v(10)! - v(2)! : undefined)) });
      out.push({ label: `${n} 5s30s(30년 − 5년)`, series: build(c, (v) => (v(30) !== undefined && v(5) !== undefined ? v(30)! - v(5)! : undefined)) });
      out.push({ label: `${n} 2s5s10s 버터플라이(2×5년 − 2년 − 10년)`, series: build(c, (v) => (v(2) !== undefined && v(5) !== undefined && v(10) !== undefined ? 2 * v(5)! - v(2)! - v(10)! : undefined)) });
    }
    const cross = (a: CurveId, b: CurveId, y: number) => {
      const ca = curves.get(a);
      const cb = curves.get(b);
      if (!ca || !cb) return;
      const mb = new Map(cb.rows.map((r) => [r.date, yieldAt(cb, r.values, y)]));
      const s: Strat['series'] = [];
      for (const r of ca.rows.slice(-260)) {
        const x = yieldAt(ca, r.values, y);
        const z = mb.get(r.date);
        if (x !== undefined && z !== undefined) s.push({ date: r.date, value: x - z });
      }
      out.push({ label: `${CURVE_INFO[a].short} − ${CURVE_INFO[b].short} ${y}년`, series: s });
    };
    cross('KTB', 'UST', 10);
    cross('KTB', 'UST', 3);
    cross('JGB', 'UST', 10);
    cross('EUR', 'UST', 10);
    return out.filter((s) => s.series.length > 1);
  }, [curves]);
  return (
    <>
      <TitleBar fn="HSA" name="커브 전략 모니터" />
      <div className="pbody flow">
        <MissingNote res={res} />
        <table className="flow-table">
          <thead>
            <tr>
              <th>전략</th>
              <th>값(bp)</th>
              <th>1주</th>
              <th>1달</th>
              <th title="최근 1년 중 지금 값보다 낮았던 날의 비율">1년 백분위</th>
              <th title="(지금 − 1년 평균) ÷ 1년 표준편차">z점수</th>
              <th>1년</th>
            </tr>
          </thead>
          <tbody>
            {strats.map((s) => {
              const xs = s.series.map((o) => o.value);
              const last = xs[xs.length - 1];
              const w = lastAndAgo(s.series, 7);
              const m = lastAndAgo(s.series, 30);
              const pctile = (xs.filter((v) => v < last).length / xs.length) * 100;
              const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
              const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
              const z = sd ? (last - mean) / sd : undefined;
              return (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  <td>{(last * 100).toFixed(0)}</td>
                  <td className={dirClass(bpOf(last, w.ago))}>{fbp(bpOf(last, w.ago))}</td>
                  <td className={dirClass(bpOf(last, m.ago))}>{fbp(bpOf(last, m.ago))}</td>
                  <td>{`${pctile.toFixed(0)}%`}</td>
                  <td>{z === undefined ? '—' : z.toFixed(2)}</td>
                  <td>
                    <Spark values={xs} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="attr">커브 기울기(2s10s·5s30s), 굽은 정도(버터플라이), 나라 간 금리 차이를 최근 1년 안에서 어디쯤인지(백분위·z점수)와 함께 봐요. 내가 만든 조합은 CIX(v0.6 뒤쪽)에서 더해요</div>
    </>
  );
}

// ── SOVM 국채·국가부채 ──

const SOVM_CURVE: Record<string, CurveId> = { KOR: 'KTB', USA: 'UST', JPN: 'JGB' };

export function Sovm({ panel: _panel }: { panel: PanelState }) {
  const res = usePoll<SovereignResponse>('/api/sovereign', 6 * 3600_000);
  const { curves } = useCurves();
  const d = res?.data;
  const us = d?.usDebt;
  return (
    <>
      <TitleBar fn={_panel.fn === 'DEBT' ? 'DEBT' : 'SOVM'} name="국채·국가부채" fresh={d?.fresh} />
      <div className="pbody flow">
        {d?.errors.length ? <div className="label fx-warn">{d.errors.join(' / ')}</div> : null}
        {us && (
          <div className="sovm-us">
            <b>미국 연방 부채</b>
            <span className="fx-big">{`$${(us.total / 1e12).toFixed(3)}조`}</span>
            <span className="label">{`${us.date}${us.prev ? ` · 하루 ${us.total >= us.prev ? '+' : ''}${Math.round((us.total - us.prev) / 1e8).toLocaleString('en-US')}억 달러` : ''}`}</span>
          </div>
        )}
        <table className="flow-table">
          <thead>
            <tr>
              <th>나라</th>
              <th>중앙정부 부채/GDP</th>
              <th>앞 해 대비(%p)</th>
              <th>기준 해</th>
              <th>국채 10년(%)</th>
              <th>2s10s(bp)</th>
            </tr>
          </thead>
          <tbody>
            {(d?.countries ?? []).map((c) => {
              const cv = SOVM_CURVE[c.iso3] ? curves.get(SOVM_CURVE[c.iso3]) : undefined;
              const y10 = curvePoint(cv, 10);
              const y2 = curvePoint(cv, 2);
              const chg = c.debtGdp !== undefined && c.prevDebtGdp !== undefined ? c.debtGdp - c.prevDebtGdp : undefined;
              return (
                <tr key={c.iso3}>
                  <td>{c.name}</td>
                  <td>{c.debtGdp === undefined ? '—' : `${c.debtGdp.toFixed(1)}%`}</td>
                  <td className={dirClass(chg)}>{chg === undefined ? '—' : `${chg > 0 ? '+' : ''}${chg.toFixed(1)}`}</td>
                  <td>{c.year ?? '—'}</td>
                  <td>{f2(y10)}</td>
                  <td>{fbp(bpOf(y10, y2))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="attr">부채/GDP는 세계은행 WDI 중앙정부 부채(연 단위, 나라에 따라 몇 해 늦거나 없어요). 미국 연방 부채는 재무부 FiscalData(Debt to the Penny, 영업일). 국채 금리는 GC와 같은 커브(유로존 나라별 국채는 원천 확인 전)</div>
    </>
  );
}
