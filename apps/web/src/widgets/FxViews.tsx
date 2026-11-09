// v0.6 외환: FXIP FX 홈, FXCA 환산 계산기, FRD 선물환 계산기, FIXI 공식 고시환율, WCRS 통화 순위.
// 환율은 모두 원화 환율(CUR:XXXKRW)을 바탕으로 교차 계산해요(FXC와 같아요).

import { useEffect, useMemo, useState } from 'react';
import {
  closeOn,
  CURRENCY_NAME,
  DEFAULT_RATE_FOR,
  forwardRate,
  formatYmd,
  FX_CURRENCIES,
  FX_TENORS,
  periodReturn,
  realizedVol,
  slowestFreshness,
  spotDate,
  tenorDate,
  daysBetween,
  type Bar,
  type FixingsResponse,
  type MoneyRatesResponse,
  type NewsViewResponse,
  type Quote,
} from '@bt/shared';
import { dirClass } from '../format';
import { getBars } from '../stores/bars';
import { useQuotes } from '../stores/feed';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { openLink, when } from './News';
import { TitleBar, usePoll } from './common';

const KRW_ID = (c: string) => `CUR:${c}KRW`;
const ALL_IDS = FX_CURRENCIES.filter((c) => c !== 'KRW').map(KRW_ID);
const nf = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
/** 소수 자리: 값이 크면 적게 */
const digits = (v: number) => (v >= 100 ? 2 : v >= 1 ? 4 : 6);
const todayKst = () => formatYmd(Date.now());

/** 원화 환율(통화 1단위의 원) */
function krwOf(quotes: Map<string, Quote>, c: string): { v?: number; pct?: number } {
  if (c === 'KRW') return { v: 1, pct: 0 };
  const q = quotes.get(KRW_ID(c));
  return { v: q?.last, pct: q?.changePct };
}

/** a 1단위 = b 얼마 */
function cross(quotes: Map<string, Quote>, a: string, b: string): { v?: number; pct?: number } {
  const x = krwOf(quotes, a);
  const y = krwOf(quotes, b);
  if (x.v === undefined || y.v === undefined) return {};
  return { v: x.v / y.v, pct: ((1 + (x.pct ?? 0) / 100) / (1 + (y.pct ?? 0) / 100)) * 100 - 100 };
}

function CcySelect({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <select className="fx-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {FX_CURRENCIES.map((c) => (
        <option key={c} value={c}>{`${c} ${CURRENCY_NAME[c] ?? ''}`}</option>
      ))}
    </select>
  );
}

/** 통화들의 원화 일봉(오래된 것부터 종가) */
function useDailyCloses(ccys: string[]) {
  const [data, setData] = useState<Record<string, Bar[]>>({});
  const key = ccys.join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all(
      ccys
        .filter((c) => c !== 'KRW')
        .map((c) =>
          getBars(KRW_ID(c), '1d', 30 * 60_000)
            .then((s) => [c, s.bars] as const)
            .catch(() => [c, [] as Bar[]] as const),
        ),
    ).then((rows) => alive && setData(Object.fromEntries(rows)));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

// ── FXCA 환산 계산기 ──

export function Fxca({ panel }: { panel: PanelState }) {
  const from = panel.fxFrom ?? 'USD';
  const to = panel.fxTo ?? 'KRW';
  const [amount, setAmount] = useState('1000');
  const [date, setDate] = useState('');
  const quotes = useQuotes(ALL_IDS);
  const daily = useDailyCloses(date ? [from, to] : []);
  const amt = Number(amount.replace(/,/g, ''));
  let rate: number | undefined;
  let basis = '';
  if (!date) {
    rate = cross(quotes, from, to).v;
    basis = '지금 환율';
  } else {
    const k = (c: string) => (c === 'KRW' ? { t: 0, c: 1 } : closeOn((daily[c] ?? []).map((b) => ({ t: b.t, c: b.c })), date));
    const a = k(from);
    const b = k(to);
    if (a && b) {
      rate = a.c / b.c;
      const used = Math.max(a.t, b.t);
      basis = `${used ? formatYmd(used * 1000) : date} 종가 기준`;
    } else basis = '그날 환율이 없어요(받은 기간 밖)';
  }
  const fresh = slowestFreshness([quotes.get(KRW_ID(from))?.fresh, quotes.get(KRW_ID(to))?.fresh].filter((f): f is NonNullable<typeof f> => !!f));
  return (
    <>
      <TitleBar fn="FXCA" name="환산 계산기" fresh={date ? undefined : fresh} />
      <div className="pbody flow fx-calc" onKeyDown={(e) => e.stopPropagation()}>
        <div className="fx-row">
          <input className="fx-amount" value={amount} inputMode="decimal" aria-label="금액" onChange={(e) => setAmount(e.target.value)} />
          <CcySelect value={from} label="바꿀 통화" onChange={(c) => patchPanel(panel.id, { fxFrom: c })} />
          <button title="앞뒤 바꾸기" onClick={() => patchPanel(panel.id, { fxFrom: to, fxTo: from })}>
            ⇄
          </button>
          <CcySelect value={to} label="받을 통화" onChange={(c) => patchPanel(panel.id, { fxTo: c })} />
        </div>
        <div className="fx-row">
          <label className="label">
            날짜{' '}
            <input type="date" value={date} max={todayKst()} onChange={(e) => setDate(e.target.value)} aria-label="환산할 날짜" />
          </label>
          {date && <button onClick={() => setDate('')}>지금 환율로</button>}
        </div>
        <div className="fx-result">
          {rate !== undefined && Number.isFinite(amt) ? (
            <>
              <div className="fx-big">{`${nf(amt * rate, to === 'KRW' || to === 'JPY' ? 0 : 2)} ${to}`}</div>
              <div className="label">{`${nf(amt, from === 'KRW' || from === 'JPY' ? 0 : 2)} ${from} · 1 ${from} = ${nf(rate, digits(rate))} ${to} · 1 ${to} = ${nf(1 / rate, digits(1 / rate))} ${from} · ${basis}`}</div>
            </>
          ) : (
            <div className="label">{Number.isFinite(amt) ? basis || '환율을 받는 중…' : '금액을 숫자로 넣어 주세요'}</div>
          )}
        </div>
      </div>
      <div className="attr">원화 환율로 교차 계산해요(FXC와 같은 환율). 과거 날짜는 그날(없으면 그 앞 영업일) 일봉 종가예요</div>
    </>
  );
}

// ── FRD 선물환 계산기 ──

export function Frd({ panel }: { panel: PanelState }) {
  const base = panel.fxFrom ?? 'USD';
  const quote = panel.fxTo ?? 'KRW';
  const quotes = useQuotes(ALL_IDS);
  const money = usePoll<MoneyRatesResponse>('/api/fx/money-rates', 30 * 60_000);
  const autoRate = (c: string) => {
    for (const name of DEFAULT_RATE_FOR[c] ?? []) {
      const r = money?.data?.rates.find((x) => x.ccy === c && x.name === name);
      if (r) return r;
    }
    return undefined;
  };
  const [manual, setManual] = useState<Record<string, string>>({});
  const rateOf = (c: string) => {
    const m = manual[c];
    if (m !== undefined && m.trim() !== '' && Number.isFinite(Number(m))) return { value: Number(m), label: '직접 입력' };
    const a = autoRate(c);
    return a ? { value: a.value, label: `${a.name} ${a.date.slice(5)}` } : undefined;
  };
  const spotQ = cross(quotes, base, quote);
  const spot = spotQ.v;
  const trade = todayKst();
  const ccys = [base, quote];
  const sd = spotDate(ccys, trade);
  const rb = rateOf(base);
  const rq = rateOf(quote);
  const rows = FX_TENORS.map((t) => {
    const mat = tenorDate(ccys, sd, t);
    const days = daysBetween(sd, mat);
    const f = spot !== undefined && rb && rq ? forwardRate(spot, base, quote, rb.value, rq.value, days) : undefined;
    return { t, mat, days, f, points: f !== undefined && spot !== undefined ? f - spot : undefined };
  });
  const d = spot ? digits(spot) : 2;
  return (
    <>
      <TitleBar fn="FRD" name="선물환 계산기" sub={`${base}/${quote}`} fresh={quotes.get(KRW_ID(base === 'KRW' ? quote : base))?.fresh} />
      <div className="pbody flow fx-calc" onKeyDown={(e) => e.stopPropagation()}>
        <div className="fx-row">
          <CcySelect value={base} label="기준 통화" onChange={(c) => patchPanel(panel.id, { fxFrom: c })} />
          <span className="label">/</span>
          <CcySelect value={quote} label="표시 통화" onChange={(c) => patchPanel(panel.id, { fxTo: c })} />
          <span className="fx-spot">{`현물 ${nf(spot, d)}`}</span>
          <span className="label">{`거래일 ${trade} · 현물 결제일 ${sd}(T+2)`}</span>
        </div>
        <div className="fx-row">
          {ccys.map((c) => {
            const r = rateOf(c);
            return (
              <label key={c} className="fx-rate">
                <span className="label">{`${c} 금리(연 %)`}</span>
                <input value={manual[c] ?? ''} placeholder={r ? r.value.toFixed(3) : '직접 입력'} onChange={(e) => setManual((m) => ({ ...m, [c]: e.target.value }))} aria-label={`${c} 금리`} />
                <span className="label">{r ? r.label : '자동 금리 없음'}</span>
              </label>
            );
          })}
        </div>
        {money?.data?.errors.length ? <div className="label fx-warn">{`자동 금리 일부 없음: ${money.data.errors.join(' / ')}`}</div> : null}
        <table className="flow-table">
          <thead>
            <tr>
              <th>기간</th>
              <th>만기일</th>
              <th>일수</th>
              <th>선물환(이론)</th>
              <th>포인트</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t}>
                <td>{r.t}</td>
                <td>{r.mat}</td>
                <td>{r.days}</td>
                <td>{nf(r.f, d)}</td>
                <td className={dirClass(r.points)}>{r.points === undefined ? '—' : `${r.points > 0 ? '+' : ''}${nf(r.points, d)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="attr">
        금리평형 이론값: 선물환 = 현물 × (1 + 표시 통화 금리 × 일수/기준일수) ÷ (1 + 기준 통화 금리 × 일수/기준일수). 달러·유로·엔은 실제/360, 원·파운드는 실제/365.
        결제일은 두 나라가 모두 여는 영업일(공용 영업일 달력). 실제 시장 스왑포인트와 다를 수 있어요. 자동 금리: SOFR·€STR(FRED 키), CD91(ECOS 인증키), 다른 통화는 직접 입력
      </div>
    </>
  );
}

// ── FIXI 공식 고시환율 ──

export function Fixi({ panel: _panel }: { panel: PanelState }) {
  const res = usePoll<FixingsResponse>('/api/fx/fixings', 30 * 60_000);
  const d = res?.data;
  return (
    <>
      <TitleBar fn="FIXI" name="공식 고시환율" fresh={d?.fresh} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">고시환율 불러오는 중…</div>}
        {res?.error && !d && <div className="empty-body err">{res.error}</div>}
        {d?.sources.map((s) => (
          <section key={s.id} className="fixi-src">
            <div className="fixi-head">
              <b>{s.name}</b>
              <span className="label">{s.basis}</span>
            </div>
            {s.error ? (
              <div className="label fx-warn">{s.error}</div>
            ) : s.rows.length === 0 ? (
              <div className="label">값이 없어요</div>
            ) : (
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>통화쌍</th>
                    <th>고시환율</th>
                    <th>대비</th>
                    <th>기준일</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const chg = r.prev ? (r.value / r.prev - 1) * 100 : undefined;
                    return (
                      <tr key={r.pair}>
                        <td>{`${r.pair}${r.unit ? ` (${r.unit})` : ''}`}</td>
                        <td>{nf(r.value, digits(r.value))}</td>
                        <td className={dirClass(chg)}>{pct(chg)}</td>
                        <td>{r.date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
      <div className="attr">하루 한 번 정해지는 공식 환율이에요(실시간 아님). BFIX는 무료 데이터가 없어서 이것으로 대신해요 · ECB(키 없음), 매매기준율(ECOS 인증키), H.10(FRED 키)</div>
    </>
  );
}

// ── WCRS 통화 순위 ──

type WcrsKey = 'd1' | 'w1' | 'm1' | 'm3' | 'ytd' | 'y1' | 'vol' | 'rate' | 'carry';
const WCRS_COLS: Array<{ k: WcrsKey; label: string; title?: string }> = [
  { k: 'd1', label: '1일' },
  { k: 'w1', label: '1주' },
  { k: 'm1', label: '1달' },
  { k: 'm3', label: '3달' },
  { k: 'ytd', label: '올해' },
  { k: 'y1', label: '1년' },
  { k: 'vol', label: '변동성', title: '최근 한 달(21영업일) 일간 수익률의 연환산 변동성' },
  { k: 'rate', label: '단기금리', title: '그 통화의 단기 금리(SOFR·€STR·CD91, 키가 있을 때)' },
  { k: 'carry', label: '캐리', title: '단기금리 − 기준 통화 단기금리' },
];

export function Wcrs({ panel }: { panel: PanelState }) {
  const base = panel.fxBase ?? 'KRW';
  const quotes = useQuotes(ALL_IDS);
  const daily = useDailyCloses([...FX_CURRENCIES]);
  const money = usePoll<MoneyRatesResponse>('/api/fx/money-rates', 30 * 60_000);
  const [sort, setSort] = useState<{ k: WcrsKey; desc: boolean }>({ k: 'd1', desc: true });
  const rateOf = (c: string) => {
    for (const name of DEFAULT_RATE_FOR[c] ?? []) {
      const r = money?.data?.rates.find((x) => x.ccy === c && x.name === name);
      if (r) return r.value;
    }
    return undefined;
  };
  const rows = useMemo(() => {
    const now = Date.now() / 1000;
    const jan1 = Date.parse(`${todayKst().slice(0, 4)}-01-01T00:00:00Z`) / 1000;
    // 통화 c의 '기준 통화당 값'(c 1단위 = 기준 통화 얼마) 일봉: 원화 일봉끼리 나눠요
    const series = (c: string) => {
      const a = c === 'KRW' ? undefined : daily[c];
      const b = base === 'KRW' ? undefined : daily[base];
      if (c !== 'KRW' && !a?.length) return [];
      if (base !== 'KRW' && !b?.length) return [];
      const byDay = new Map<string, number>();
      for (const x of b ?? []) byDay.set(formatYmd(x.t * 1000), x.c);
      const src = a ?? b ?? [];
      return src
        .map((x) => {
          const day = formatYmd(x.t * 1000);
          const num = c === 'KRW' ? 1 : x.c;
          const den = base === 'KRW' ? 1 : byDay.get(day);
          return den ? { t: x.t, c: num / den } : undefined;
        })
        .filter((x): x is { t: number; c: number } => !!x);
    };
    const baseRate = rateOf(base);
    return FX_CURRENCIES.filter((c) => c !== base).map((c) => {
      const s = series(c);
      const live = cross(quotes, c, base);
      const r = rateOf(c);
      return {
        c,
        last: live.v,
        d1: live.pct,
        w1: periodReturn(s, now - 7 * 86400),
        m1: periodReturn(s, now - 30 * 86400),
        m3: periodReturn(s, now - 91 * 86400),
        ytd: periodReturn(s, jan1),
        y1: periodReturn(s, now - 365 * 86400),
        vol: realizedVol(s.map((x) => x.c)),
        rate: r,
        carry: r !== undefined && baseRate !== undefined ? r - baseRate : undefined,
      };
    });
  }, [daily, quotes, base, money?.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort.k];
    const y = b[sort.k];
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return sort.desc ? y - x : x - y;
  });
  const tools = (
    <>
      <span className="label">기준</span>
      {(['KRW', 'USD', 'EUR'] as const).map((c) => (
        <button key={c} className={c === base ? 'on' : ''} onClick={() => patchPanel(panel.id, { fxBase: c })}>
          {c}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="WCRS" name="통화 순위" sub={`${base} 대비`} fresh={slowestFreshness([...quotes.values()].map((q) => q.fresh))} tools={tools} />
      <div className="pbody flow">
        <table className="flow-table wcrs">
          <thead>
            <tr>
              <th>통화</th>
              <th>{`1 단위 = ${base}`}</th>
              {WCRS_COLS.map((col) => (
                <th key={col.k} title={col.title} className="click" onClick={() => setSort((s) => ({ k: col.k, desc: s.k === col.k ? !s.desc : true }))}>
                  {`${col.label}${sort.k === col.k ? (sort.desc ? ' ▼' : ' ▲') : ''}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.c} className="click" title={`${r.c}/${base} 차트로`} onClick={() => setPanelSecurity(panel.id, base === 'KRW' ? KRW_ID(r.c) : `CUR:${r.c}${base}`)}>
                <td>{`${r.c} ${CURRENCY_NAME[r.c] ?? ''}`}</td>
                <td>{r.last === undefined ? '—' : nf(r.last, digits(r.last))}</td>
                {(['d1', 'w1', 'm1', 'm3', 'ytd', 'y1'] as const).map((k) => (
                  <td key={k} className={dirClass(r[k])}>
                    {pct(r[k])}
                  </td>
                ))}
                <td>{r.vol === undefined ? '—' : `${r.vol.toFixed(1)}%`}</td>
                <td>{r.rate === undefined ? '—' : `${r.rate.toFixed(2)}%`}</td>
                <td className={dirClass(r.carry)}>{r.carry === undefined ? '—' : `${r.carry > 0 ? '+' : ''}${r.carry.toFixed(2)}%p`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="attr">
        수익률은 그 통화가 기준 통화 대비 얼마나 올랐는지(+면 강세)예요. 일봉 종가로 계산, 1일은 지금 시세. 단기금리·캐리는 SOFR·€STR(FRED 키)·CD91(ECOS 인증키)이 있는 통화만. PPP·CDS 칸은 무료 데이터가 마땅치 않아 아직 없어요. 줄을 누르면 그 환율 차트로
      </div>
    </>
  );
}

// ── FXIP FX 홈 ──

export function Fxip({ panel }: { panel: PanelState }) {
  const quotes = useQuotes(ALL_IDS);
  const news = usePoll<NewsViewResponse>('/api/news/topic?topic=fx', 5 * 60_000);
  const fix = usePoll<FixingsResponse>('/api/fx/fixings', 30 * 60_000);
  const majors: Array<[string, string]> = [
    ['USD', 'KRW'],
    ['EUR', 'KRW'],
    ['JPY', 'KRW'],
    ['CNY', 'KRW'],
    ['EUR', 'USD'],
    ['USD', 'JPY'],
    ['GBP', 'USD'],
    ['AUD', 'USD'],
    ['USD', 'CNY'],
  ];
  const ecb = fix?.data?.sources.find((s) => s.id === 'ECOS' && s.rows.length) ?? fix?.data?.sources.find((s) => s.id === 'ECB');
  return (
    <>
      <TitleBar fn="FXIP" name="FX 홈" fresh={slowestFreshness([...quotes.values()].map((q) => q.fresh))} />
      <div className="pbody flow fxip">
        <div className="fxip-grid">
          <section>
            <div className="fixi-head">
              <b>주요 환율</b>
              <span className="label">누르면 차트</span>
            </div>
            <table className="flow-table">
              <tbody>
                {majors.map(([a, b]) => {
                  const x = cross(quotes, a, b);
                  const code = `${a}${b}`;
                  return (
                    <tr key={code} className="click" onClick={() => setPanelSecurity(panel.id, `CUR:${code}`)}>
                      <td>{`${a}/${b}`}</td>
                      <td>{x.v === undefined ? '—' : nf(x.v, digits(x.v))}</td>
                      <td className={dirClass(x.pct)}>{pct(x.pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <section>
            <div className="fixi-head">
              <b>{ecb ? `고시환율 · ${ecb.name}` : '고시환율'}</b>
              <span className="label">FIXI⏎에서 전체</span>
            </div>
            {ecb ? (
              <table className="flow-table">
                <tbody>
                  {ecb.rows.slice(0, 7).map((r) => (
                    <tr key={r.pair}>
                      <td>{`${r.pair}${r.unit ? ` (${r.unit})` : ''}`}</td>
                      <td>{nf(r.value, digits(r.value))}</td>
                      <td>{r.date.slice(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="label">{fix?.error ?? '불러오는 중…'}</div>
            )}
          </section>
        </div>
        <section>
          <div className="fixi-head">
            <b>환율 뉴스</b>
            <span className="label">NI FX와 같은 뉴스</span>
          </div>
          {(news?.data?.items ?? []).slice(0, 15).map((n) => (
            <div key={n.id} className="row click fxip-news" onClick={() => openLink(n.url)} title={n.title}>
              <span className="num label" style={{ width: 44 }}>
                {when(n, Date.now())}
              </span>
              <span className="label" style={{ width: 70, overflow: 'hidden' }}>
                {n.source}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</span>
            </div>
          ))}
          {news?.data && news.data.items.length === 0 && <div className="label">최근 환율 뉴스가 없어요</div>}
        </section>
      </div>
      <div className="attr">환율 매트릭스는 FXC, 환산은 FXCA, 선물환은 FRD, 통화 순위는 WCRS. 귀금속(금·은)은 원자재 데이터를 붙이는 v0.11에서 더해요</div>
    </>
  );
}
