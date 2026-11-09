// v0.6 중앙은행: CENB 중앙은행(FED 별칭), FOMC FOMC 결과(FOMS 별칭, 금통위 탭), DOTS 점도표, WIRP 정책금리 경로(근사, FFIP 별칭),
// CSDR 국가 신용등급(근사: 수동 관리 표와 등급 뉴스).
// 정책금리·일정·성명·점도표는 /api/centralbank, 시장 금리는 /api/money, 등급 뉴스는 /api/news/topic?topic=ratings.

import { useMemo, useState } from 'react';
import {
  DEFAULT_RATINGS,
  MEETING_BANK_NAMES,
  POLICY_BANKS,
  RATINGS_AS_OF,
  dotMedian,
  isInvestmentGrade,
  lastAndAgo,
  ratingNotch,
  type CbDocument,
  type CentralBankResponse,
  type DotPlot,
  type Meeting,
  type MoneySeriesId,
  type NewsViewResponse,
  type SovereignRating,
} from '@bt/shared';
import { dirClass } from '../format';
import { useNow } from '../hooks/useNow';
import { patchPanel, type PanelState } from '../stores/panels';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar, usePoll } from './common';
import { openLink } from './News';
import { Rows } from './NewsViews';
import { Spark, useMoney } from './RatesViews';

const POLL = 60 * 60_000;
const fbp = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`);

function useCb() {
  return usePoll<CentralBankResponse>('/api/centralbank', POLL);
}

/** 오늘(한국 날짜) */
function todayKst(now: number) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

function dday(date: string, today: string) {
  const d = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
  return d === 0 ? '오늘' : d > 0 ? `D-${d}` : `${-d}일 전`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const mdw = (date: string) => `${date.slice(5).replace('-', '/')}(${WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;

function ErrNote({ res }: { res?: { data?: { errors: string[] }; error?: string } }) {
  if (res?.error && !res.data) return <div className="des-note err">{res.error}</div>;
  if (!res?.data?.errors.length) return null;
  return <div className="label fx-warn">{`일부 없음: ${res.data.errors.join(' / ')}`}</div>;
}

// ── CENB 중앙은행 ──

export function Cenb({ panel: _panel }: { panel: PanelState }) {
  const res = useCb();
  const now = useNow(60_000);
  const today = todayKst(now);
  const data = res?.data;
  const rates = new Map((data?.rates ?? []).map((r) => [r.area, r]));
  const nextOf = (bank: Meeting['bank']) => data?.meetings.find((m) => m.bank === bank && m.date >= today);
  const upcoming = (data?.meetings ?? []).filter((m) => m.date >= today).slice(0, 12);
  return (
    <>
      <TitleBar fn="CENB" name="중앙은행" sub="정책금리·회의 일정" fresh={data?.fresh} />
      <div className="pbody flow">
        <ErrNote res={res} />
        {!res && <div className="des-note label">받는 중…</div>}
        {data && (
          <>
            <table className="flow-table">
              <thead>
                <tr>
                  <th>나라</th>
                  <th>중앙은행</th>
                  <th>정책금리(%)</th>
                  <th>마지막 변경</th>
                  <th>폭(bp)</th>
                  <th>1년 전 대비</th>
                  <th>다음 회의</th>
                  <th>3년</th>
                </tr>
              </thead>
              <tbody>
                {POLICY_BANKS.map((b) => {
                  const r = rates.get(b.area);
                  const next = b.meetings ? nextOf(b.meetings) : undefined;
                  const chg = r?.changed ? (r.rate - r.changed.from) * 100 : undefined;
                  const yoy = r?.yearAgo !== undefined ? (r.rate - r.yearAgo) * 100 : undefined;
                  return (
                    <tr key={b.area}>
                      <td>{b.country}</td>
                      <td>{b.bank}</td>
                      <td>{r ? (b.area === 'US' ? `${(r.rate - 0.125).toFixed(2)}–${(r.rate + 0.125).toFixed(2)}` : r.rate.toFixed(2)) : '—'}</td>
                      <td>{r?.changed?.date ?? '—'}</td>
                      <td className={dirClass(chg)}>{fbp(chg)}</td>
                      <td className={dirClass(yoy)}>{fbp(yoy)}</td>
                      <td>{next ? `${mdw(next.date)} ${dday(next.date, today)}` : b.meetings ? '—' : ''}</td>
                      <td>
                        <Spark values={r?.spark ?? []} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="cb-sub label">다가오는 회의</div>
            <table className="flow-table cb-meet">
              <tbody>
                {upcoming.map((m) => (
                  <tr key={`${m.bank}${m.date}`}>
                    <td>{mdw(m.date)}</td>
                    <td>{dday(m.date, today)}</td>
                    <td>{MEETING_BANK_NAMES[m.bank]}</td>
                    <td className="label">{m.sep ? '경제 전망·점도표 발표' : ''}</td>
                  </tr>
                ))}
                {!upcoming.length && (
                  <tr>
                    <td className="label">일정을 받지 못했어요</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="attr">정책금리는 BIS 중앙은행 정책금리(일별, 나라마다 며칠 늦게 올라와요). 미국은 연방기금 목표 범위. 회의 날짜는 결정을 발표하는 날(그 나라 날짜)로, 연준·ECB·일본은행·한국은행 웹 페이지에서 받아요. 성명은 FOMC⏎, 시장이 보는 방향은 WIRP⏎</div>
    </>
  );
}

// ── FOMC 결과 ──

const KIND_LABEL: Record<CbDocument['kind'], string> = { statement: '성명', minutes: '의사록', projections: '경제 전망', pressconf: '기자간담회', other: '' };

export function Fomc({ panel }: { panel: PanelState }) {
  const tab = panel.cbTab ?? 'FED';
  const res = useCb();
  const now = useNow(60_000);
  const today = todayKst(now);
  const docs = (res?.data?.documents ?? []).filter((d) => d.bank === tab);
  const [sel, setSel] = useState<string | undefined>();
  const cur = docs.find((d) => d.url === sel) ?? docs.find((d) => d.text) ?? docs[0];
  const year = today.slice(0, 4);
  const meetings = (res?.data?.meetings ?? []).filter((m) => m.bank === tab && m.date.startsWith(year));
  const tools = (
    <>
      {(['FED', 'BOK'] as const).map((t) => (
        <button key={t} className={t === tab ? 'on' : ''} onClick={() => patchPanel(panel.id, { cbTab: t })}>
          {t === 'FED' ? 'FOMC' : '금통위'}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="FOMC" name={tab === 'FED' ? 'FOMC 결과' : '금통위 결과'} sub={tab === 'FED' ? '연준' : '한국은행'} fresh={res?.data?.fresh} tools={tools} />
      <div className="pbody flow cb-docs">
        <ErrNote res={res} />
        {!res && <div className="des-note label">받는 중…</div>}
        <div className="cb-meet-row">
          <span className="label">{`${year}년 회의`}</span>
          {meetings.map((m) => (
            <span key={m.date} className={`cb-chip ${m.date >= today ? 'next' : ''}`} title={m.sep ? '경제 전망·점도표 발표' : undefined}>
              {`${m.date.slice(5).replace('-', '/')}${m.sep ? '*' : ''}`}
            </span>
          ))}
        </div>
        <div className="cb-split">
          <table className="flow-table cb-list">
            <tbody>
              {docs.map((d) => (
                <tr key={d.url} className={`click ${cur?.url === d.url ? 'sel' : ''}`} onClick={() => setSel(d.url)}>
                  <td>{d.date.slice(2)}</td>
                  <td>
                    <span className="cb-kind">{KIND_LABEL[d.kind]}</span>
                  </td>
                  <td>{d.title}</td>
                </tr>
              ))}
              {res?.data && !docs.length && (
                <tr>
                  <td className="label">받은 자료가 없어요</td>
                </tr>
              )}
            </tbody>
          </table>
          {cur && (
            <div className="cb-text">
              <div className="cb-text-head">
                <b>{cur.title}</b>
                <button className="btn" onClick={() => openLink(cur.url)}>
                  원문 열기
                </button>
              </div>
              {cur.text ? cur.text.split('\n').map((l, i) => <p key={i}>{l}</p>) : <p className="label">본문은 원문에서 봐요(성명·결정문만 본문을 받아 와요).</p>}
            </div>
          )}
        </div>
      </div>
      <div className="attr">{tab === 'FED' ? '연준 통화정책 보도자료 RSS와 FOMC 일정 페이지(영문 원문, 최근 성명 3개는 본문까지). *는 경제 전망(점도표)을 내는 회의. 점도표는 DOTS⏎' : '한국은행 보도자료 RSS의 통화정책방향 결정문(본문)과 금통위 의사록, 통화정책방향 결정회의 일정'}</div>
    </>
  );
}

// ── DOTS 점도표 ──

const MEDIAN_LABEL: Record<DotPlot['medians'][number]['key'], string> = { gdp: '실질 GDP 성장률', unemp: '실업률', pce: 'PCE 물가', core: '근원 PCE 물가', ffr: '연방기금금리' };

function DotChart({ dots }: { dots: DotPlot }) {
  const rates = dots.dots.map((d) => d.rate);
  const used = dots.dots.filter((d) => d.counts.some((c) => c > 0)).map((d) => d.rate);
  const lo = Math.floor(Math.min(...(used.length ? used : rates)) * 2) / 2 - 0.25;
  const hi = Math.ceil(Math.max(...(used.length ? used : rates)) * 2) / 2 + 0.25;
  const W = 640;
  const H = 300;
  const left = 44;
  const top = 10;
  const bottom = 26;
  const colW = (W - left - 10) / dots.years.length;
  const y = (r: number) => top + ((hi - r) / (hi - lo)) * (H - top - bottom);
  const ticks: number[] = [];
  for (let r = Math.ceil(lo * 2) / 2; r <= hi + 1e-9; r += 0.5) ticks.push(r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dots-chart" role="img" aria-label="점도표">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 10} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="0.6" />
          <text x={left - 6} y={y(t) + 3} textAnchor="end" className="dots-axis">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {dots.years.map((yr, c) => {
        const cx = left + colW * (c + 0.5);
        const med = dotMedian(dots.dots, c);
        return (
          <g key={yr}>
            <text x={cx} y={H - 8} textAnchor="middle" className="dots-axis">
              {yr === 'Longer run' ? '장기' : yr}
            </text>
            {dots.dots.map((d) => {
              const n = d.counts[c] ?? 0;
              return Array.from({ length: n }, (_, k) => <circle key={`${d.rate}-${k}`} cx={cx + (k - (n - 1) / 2) * 7} cy={y(d.rate)} r="2.8" fill="var(--accent)" />);
            })}
            {med !== undefined && <line x1={cx - colW * 0.42} x2={cx + colW * 0.42} y1={y(med)} y2={y(med)} stroke="var(--value)" strokeWidth="1.4" strokeDasharray="4 3" />}
          </g>
        );
      })}
    </svg>
  );
}

export function Dots({ panel: _panel }: { panel: PanelState }) {
  const res = useCb();
  const dots = res?.data?.dots;
  const us = res?.data?.rates.find((r) => r.area === 'US');
  return (
    <>
      <TitleBar fn="DOTS" name="점도표" sub={dots ? `${dots.meeting} FOMC` : undefined} fresh={res?.data?.fresh} />
      <div className="pbody flow">
        <ErrNote res={res} />
        {!res && <div className="des-note label">받는 중…</div>}
        {res?.data && !dots && <div className="des-note label">경제 전망 자료를 받지 못했어요.</div>}
        {dots && (
          <>
            <div className="label cb-sub">{`점 하나가 위원 한 명의 연말 연방기금금리 전망(목표 범위 가운데)이에요. 흰 점선은 중간값${us ? ` · 지금 목표 범위 ${(us.rate - 0.125).toFixed(2)}–${(us.rate + 0.125).toFixed(2)}%` : ''}`}</div>
            <DotChart dots={dots} />
            <table className="flow-table">
              <thead>
                <tr>
                  <th>중간값(%)</th>
                  {dots.years.map((y) => (
                    <th key={y}>{y === 'Longer run' ? '장기' : y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dots.medians.map((m) => (
                  <tr key={m.key}>
                    <td>{MEDIAN_LABEL[m.key]}</td>
                    {dots.years.map((y, i) => {
                      const v = m.values[i];
                      const p = m.prev[i];
                      const d = v !== null && v !== undefined && p !== null && p !== undefined ? v - p : undefined;
                      return (
                        <td key={y}>
                          {v === null || v === undefined ? '—' : v.toFixed(1)}
                          {d !== undefined && Math.abs(d) > 1e-9 && <span className={`cb-prev ${dirClass(d)}`}>{` (${d > 0 ? '+' : ''}${d.toFixed(1)})`}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn cb-open" onClick={() => openLink(dots.url)}>
              원문 열기
            </button>
          </>
        )}
      </div>
      <div className="attr">연준 경제 전망 요약(SEP, 3·6·9·12월 회의). 괄호는 지난 전망 대비 변화. 성장률·물가는 4분기 전년 대비, 실업률은 4분기 평균이에요</div>
    </>
  );
}

// ── WIRP 정책금리 경로(근사) ──

const ATLANTA_MPT = 'https://www.atlantafed.org/cenfis/market-probability-tracker';

interface WirpRow {
  label: string;
  obs: Array<{ date: string; value: number }>;
}

function spreadSeries(a: Array<{ date: string; value: number }>, base: (date: string) => number | undefined): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = [];
  for (const o of a) {
    const b = base(o.date);
    if (b !== undefined) out.push({ date: o.date, value: (o.value - b) * 100 });
  }
  return out;
}

/** 날짜순 시계열에서 그날(없으면 그 앞) 값 */
function valueOn(obs: Array<{ date: string; value: number }>) {
  return (date: string) => {
    let lo = 0;
    let hi = obs.length - 1;
    let ans: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (obs[mid].date <= date) {
        ans = obs[mid].value;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
}

function WirpTable({ rows }: { rows: WirpRow[] }) {
  return (
    <table className="flow-table">
      <thead>
        <tr>
          <th>시장 금리 − 정책금리</th>
          <th>값(bp)</th>
          <th>≈ 25bp 몇 번</th>
          <th>1주</th>
          <th>1달</th>
          <th>기준일</th>
          <th>1년</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const w = lastAndAgo(r.obs, 7);
          const m = lastAndAgo(r.obs, 30);
          const last = w.last?.value;
          const moves = last === undefined ? undefined : last / 25;
          return (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className={dirClass(last)}>{fbp(last)}</td>
              <td>{moves === undefined ? '—' : Math.abs(moves) < 0.25 ? '동결 근처' : `${moves > 0 ? '인상' : '인하'} ${Math.abs(moves).toFixed(1)}번`}</td>
              <td className={dirClass(last !== undefined && w.ago !== undefined ? last - w.ago : undefined)}>{fbp(last !== undefined && w.ago !== undefined ? last - w.ago : undefined)}</td>
              <td className={dirClass(last !== undefined && m.ago !== undefined ? last - m.ago : undefined)}>{fbp(last !== undefined && m.ago !== undefined ? last - m.ago : undefined)}</td>
              <td>{w.last?.date.slice(5) ?? '—'}</td>
              <td>
                <Spark values={r.obs.slice(-260).map((o) => o.value)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Wirp({ panel: _panel }: { panel: PanelState }) {
  const { series, res } = useMoney();
  const cb = useCb();
  const now = useNow(60_000);
  const today = todayKst(now);
  const get = (id: MoneySeriesId) => series.get(id) ?? [];
  const kr = useMemo(() => {
    const base = valueOn(get('KR_BASE'));
    const rows: Array<[string, MoneySeriesId]> = [
      ['통안증권 91일', 'KR_MSB91'],
      ['CD 91일', 'KR_CD91'],
      ['통안증권 1년', 'KR_MSB1'],
      ['국고채 3년', 'KR_KTB3'],
    ];
    return rows.map(([label, id]) => ({ label: `${label} − 기준금리`, obs: spreadSeries(get(id), base) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);
  const us = useMemo(() => {
    const up = valueOn(get('US_FFU'));
    const dn = valueOn(get('US_FFL'));
    const mid = (d: string) => {
      const a = up(d);
      const b = dn(d);
      return a === undefined || b === undefined ? undefined : (a + b) / 2;
    };
    const rows: Array<[string, MoneySeriesId]> = [
      ['단기국채 3개월', 'US_TB3M'],
      ['국채 1년', 'US_UST1'],
      ['국채 2년', 'US_UST2'],
    ];
    return rows.map(([label, id]) => ({ label: `${label} − 목표 범위 가운데`, obs: spreadSeries(get(id), mid) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);
  const next = (bank: Meeting['bank']) =>
    (cb?.data?.meetings ?? [])
      .filter((m) => m.bank === bank && m.date >= today)
      .slice(0, 4)
      .map((m) => mdw(m.date))
      .join(' · ');
  const krBase = lastAndAgo(get('KR_BASE'), 0).last;
  const ffu = lastAndAgo(get('US_FFU'), 0).last;
  const ffl = lastAndAgo(get('US_FFL'), 0).last;
  const missing = (res?.data?.missing ?? []).filter((m) => ['KR_BASE', 'KR_MSB1', 'US_FFU', 'US_UST1'].includes(m.id));
  return (
    <>
      <TitleBar fn="WIRP" name="정책금리 경로" sub="근사" fresh={res?.data?.fresh} />
      <div className="pbody flow">
        {missing.length > 0 && <div className="label fx-warn">{`일부 없음: ${[...new Set(missing.map((m) => m.reason))].join(' / ')}`}</div>}
        <div className="cb-sub">
          <b>한국</b>
          <span className="label">{` 기준금리 ${krBase ? `${krBase.value.toFixed(2)}%` : '—'} · 다음 금통위 ${next('BOK') || '—'}`}</span>
        </div>
        <WirpTable rows={kr} />
        <div className="cb-sub">
          <b>미국</b>
          <span className="label">{` 목표 범위 ${ffu && ffl ? `${ffl.value.toFixed(2)}–${ffu.value.toFixed(2)}%` : '—'} · 다음 FOMC ${next('FED') || '—'}`}</span>
          <button className="btn" onClick={() => openLink(ATLANTA_MPT)}>
            회의별 확률(Atlanta Fed)
          </button>
        </div>
        <WirpTable rows={us} />
      </div>
      <div className="attr">시장 금리와 정책금리의 차이로 본 근사예요. 만기까지 시장이 반영한 금리 변화에 기간 프리미엄·신용 차이가 섞여 있어서 확률이 아니에요(25bp = 한 번). 회의별 확률은 금리선물 데이터가 있어야 해서 미국은 Atlanta Fed 도구(CME 데이터)로 열어요. 한국은 ECOS 인증키, 미국은 FRED 키</div>
    </>
  );
}

// ── CSDR 국가 신용등급(근사) ──

const AGENCIES: Array<{ key: 'sp' | 'moodys' | 'fitch'; label: string }> = [
  { key: 'sp', label: 'S&P' },
  { key: 'moodys', label: "Moody's" },
  { key: 'fitch', label: 'Fitch' },
];
const SP_NAMES = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];

export function Csdr({ panel: _panel }: { panel: PanelState }) {
  const edits = useStore(appState).ratings ?? {};
  const news = usePoll<NewsViewResponse>('/api/news/topic?topic=ratings', 5 * 60_000);
  const now = useNow(30_000);
  const [editing, setEditing] = useState<string | undefined>();
  const rows: SovereignRating[] = DEFAULT_RATINGS.map((r) => ({ ...r, ...(edits[r.iso] ?? {}) }));
  const save = (iso: string, key: 'sp' | 'moodys' | 'fitch', value: string) => {
    const base = DEFAULT_RATINGS.find((r) => r.iso === iso)!;
    updateState('ratings', (prev) => {
      const cur = { ...base, ...(prev?.[iso] ?? {}) };
      const v = value.trim();
      if ((cur[key] ?? '') === v) return prev;
      return { ...prev, [iso]: { ...cur, [key]: v || undefined, editedAt: todayKst(Date.now()) } };
    });
  };
  const reset = (iso: string) =>
    updateState('ratings', (prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
  return (
    <>
      <TitleBar fn="CSDR" name="국가 신용등급" sub="근사 · 수동 관리" />
      <div className="pbody flow">
        <table className="flow-table csdr">
          <thead>
            <tr>
              <th>나라</th>
              {AGENCIES.map((a) => (
                <th key={a.key}>{a.label}</th>
              ))}
              <th>평균</th>
              <th>등급</th>
              <th>고친 날</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const notches = AGENCIES.map((a) => ratingNotch(r[a.key])).filter((n): n is number => n !== undefined);
              const avg = notches.length ? notches.reduce((x, y) => x + y, 0) / notches.length : undefined;
              const ig = isInvestmentGrade(r.sp ?? r.fitch ?? r.moodys);
              return (
                <tr key={r.iso}>
                  <td>{r.country}</td>
                  {AGENCIES.map((a) => {
                    const id = `${r.iso}:${a.key}`;
                    return (
                      <td key={a.key} className="csdr-cell" title="눌러서 고치기" onClick={() => setEditing(id)}>
                        {editing === id ? (
                          <input
                            autoFocus
                            defaultValue={r[a.key] ?? ''}
                            onBlur={(e) => {
                              save(r.iso, a.key, e.target.value);
                              setEditing(undefined);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditing(undefined);
                            }}
                          />
                        ) : (
                          (r[a.key] ?? '—')
                        )}
                      </td>
                    );
                  })}
                  <td>{avg === undefined ? '—' : SP_NAMES[Math.round(avg)]}</td>
                  <td className="label">{ig === undefined ? '' : ig ? '투자' : '투기'}</td>
                  <td className="label">{r.editedAt ?? ''}</td>
                  <td>
                    {edits[r.iso] && (
                      <button className="linkish" onClick={() => reset(r.iso)}>
                        되돌리기
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="cb-sub label">신용등급 뉴스</div>
        {news?.data && <Rows items={news.data.items.slice(0, 30)} now={now} />}
        {news?.data && !news.data.items.length && <div className="des-note label">최근 헤드라인에 신용등급 소식이 없어요.</div>}
        {news?.error && !news.data && <div className="des-note err">{news.error}</div>}
      </div>
      <div className="attr">{`장기 외화 국가 신용등급. 무료 API가 없어 앱에 넣어 둔 값(${RATINGS_AS_OF} 기준)을 칸을 눌러 직접 고쳐요. 평균은 세 곳을 같은 자로 맞춘 단계의 평균(S&P 표기). 뉴스는 제목에 등급 낱말이 든 최근 헤드라인이고, ALRT 뉴스 탭에 '신용등급'을 걸면 알림으로도 받아요`}</div>
    </>
  );
}
