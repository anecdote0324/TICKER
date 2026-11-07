// v0.5 시세 표·체결: HP 과거 시세 표(CSV 내보내기), QR 체결 테이프, AQR 체결 요약(분봉 근사), VAP 가격대별 거래량(봉 근사).

import { useEffect, useMemo, useState } from 'react';
import { BOOK_MARKETS, formatHm, formatYmd, intradaySummary, volumeAtPrice, type Bar, type BarInterval, type BookMarket, type Freshness, type Instrument, type TapeResponse } from '@bt/shared';
import { dirClass, fmtPrice } from '../format';
import { getBars, getOlderBars } from '../stores/bars';
import { useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';
import { hpCsv, hpFileName, lastSession, withChange } from './tradeCalc';

const nf = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const label = (inst: Instrument) => `${inst.nameKo || inst.nameEn || inst.code} ${inst.code}`;

function NeedSecurity({ fn, name, example }: { fn: string; name: string; example: string }) {
  return (
    <>
      <TitleBar fn={fn} name={name} />
      <div className="empty-body">
        <div>종목이 필요해요</div>
        <div className="label">{`예: ${example}`}</div>
      </div>
    </>
  );
}

/** 봉을 받아 두고 ms마다 다시 받아요(빈 id면 받지 않아요) */
function useBars(id: string | undefined, interval: BarInterval, ms: number) {
  const [state, setState] = useState<{ key: string; bars?: Bar[]; fresh?: Freshness; error?: string } | null>(null);
  const key = id ? `${id}|${interval}` : '';
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      getBars(id, interval, Math.min(ms, 60_000))
        .then((s) => alive && setState({ key, bars: s.bars, fresh: s.fresh }))
        .catch((e: Error) => alive && setState((p) => (p?.key === key && p.bars ? p : { key, error: e.message })));
    void load();
    const t = window.setInterval(load, ms);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [id, interval, ms, key]);
  return state?.key === key ? state : undefined;
}

// ── HP 과거 시세 표 ──

const HP_INTERVALS: Array<{ code: '1d' | '1w' | '1M'; label: string }> = [
  { code: '1d', label: '일' },
  { code: '1w', label: '주' },
  { code: '1M', label: '월' },
];

export function Hp({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const interval = panel.hpInterval ?? '1d';
  const res = useBars(inst?.id, interval, 5 * 60_000);
  const [older, setOlder] = useState<{ key: string; bars: Bar[]; done: boolean }>({ key: '', bars: [], done: false });
  const [busy, setBusy] = useState(false);
  const key = `${inst?.id}|${interval}`;
  const extra = older.key === key ? older : { key, bars: [], done: false };
  const all = useMemo(() => {
    const m = new Map<number, Bar>();
    for (const b of [...extra.bars, ...(res?.bars ?? [])]) m.set(b.t, b);
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [extra.bars, res?.bars]);
  const rows = useMemo(() => withChange(all).reverse(), [all]);
  if (!inst) return <NeedSecurity fn="HP" name="과거 시세 표" example="005930 HP ⏎" />;
  const more = async () => {
    if (!all.length || busy) return;
    setBusy(true);
    try {
      const s = await getOlderBars(inst.id, interval, all[0].t);
      setOlder({ key, bars: [...s.bars, ...extra.bars], done: s.bars.length === 0 });
    } catch {
      setOlder({ ...extra, key, done: true });
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + hpCsv(rows, inst)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = hpFileName(inst, interval, Date.now());
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10_000);
  };
  const first = all[0];
  const last = all[all.length - 1];
  const tools = (
    <>
      {HP_INTERVALS.map((x) => (
        <button key={x.code} className={x.code === interval ? 'on' : ''} onClick={() => patchPanel(panel.id, { hpInterval: x.code })}>
          {x.label}
        </button>
      ))}
      <button onClick={save} disabled={!rows.length} title="지금 표를 CSV 파일로 저장해요">
        CSV
      </button>
    </>
  );
  return (
    <>
      <TitleBar fn="HP" name="과거 시세 표" sub={label(inst)} fresh={res?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">시세 불러오는 중…</div>}
        {res?.error && !all.length && <div className="empty-body err">{res.error}</div>}
        {rows.length > 0 && first && last && (
          <>
            <div className="tv-sum">
              <span>{`${formatYmd(first.t * 1000)} ~ ${formatYmd(last.t * 1000)} · ${rows.length}개`}</span>
              <span className={dirClass(last.c - first.o)}>{`기간 ${pct((last.c / first.o - 1) * 100)}`}</span>
              <span>{`최고 ${fmtPrice(inst, Math.max(...all.map((b) => b.h)))}`}</span>
              <span>{`최저 ${fmtPrice(inst, Math.min(...all.map((b) => b.l)))}`}</span>
            </div>
            <table className="flow-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>시가</th>
                  <th>고가</th>
                  <th>저가</th>
                  <th>종가</th>
                  <th>등락률</th>
                  <th>거래량</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.t}>
                    <td>{formatYmd(r.t * 1000)}</td>
                    <td>{fmtPrice(inst, r.o)}</td>
                    <td>{fmtPrice(inst, r.h)}</td>
                    <td>{fmtPrice(inst, r.l)}</td>
                    <td className={dirClass(r.changePct)}>{fmtPrice(inst, r.c)}</td>
                    <td className={dirClass(r.changePct)}>{pct(r.changePct)}</td>
                    <td>{r.v ? nf(r.v) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tv-more">
              {extra.done ? (
                <span className="label">더 받을 과거 시세가 없어요</span>
              ) : (
                <button onClick={() => void more()} disabled={busy}>
                  {busy ? '받는 중…' : '과거 더 받기'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="attr">등락률은 앞 봉 종가와 비교해요 · CSV는 지금 표(받은 기간)를 그대로 저장해요(엑셀에서 열려요)</div>
    </>
  );
}

// ── QR 체결 테이프 ──

export function Qr({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const ok = !!inst && inst.assetClass === 'EQUITY' && (inst.market === 'KS' || inst.market === 'KQ' || inst.market === 'US');
  const kr = ok && inst!.market !== 'US';
  const market = (panel.bookMarket ?? 'J') as BookMarket;
  const res = usePoll<TapeResponse>(ok ? `/api/tape?id=${encodeURIComponent(inst!.id)}${kr ? `&market=${market}` : ''}` : '', 2_000);
  const d = res?.data;
  const stats = useMemo(() => {
    if (!d?.rows.length) return undefined;
    let buy = 0;
    let sell = 0;
    for (const r of d.rows) {
      if (r.side === 'buy') buy += r.qty;
      else if (r.side === 'sell') sell += r.qty;
    }
    // 큰 체결: 받은 체결 수량의 상위 5%
    const qs = d.rows.map((r) => r.qty).sort((a, b) => a - b);
    const big = qs[Math.floor(qs.length * 0.95)] ?? Infinity;
    return { buy, sell, big: d.rows.length >= 20 ? big : Infinity };
  }, [d]);
  if (!inst) return <NeedSecurity fn="QR" name="체결 테이프" example="005930 QR ⏎" />;
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
      <TitleBar fn="QR" name="체결 테이프" sub={label(inst)} fresh={d?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        {!ok && <div className="empty-body label">체결 테이프는 국내·미국 주식만 볼 수 있어요</div>}
        {ok && !res && <div className="empty-body label">체결 불러오는 중…</div>}
        {ok && res?.error && !d && <div className="empty-body err">{res.error}</div>}
        {d && d.rows.length === 0 && <div className="empty-body label">아직 오늘 체결이 없어요</div>}
        {d && stats && (
          <>
            <div className="tv-sum">
              <span>{`받은 체결 ${d.rows.length}건`}</span>
              <span className="up">{`매수 추정 ${nf(stats.buy)}`}</span>
              <span className="down">{`매도 추정 ${nf(stats.sell)}`}</span>
              {d.rows[0].strength !== undefined && <span>{`체결강도 ${nf(d.rows[0].strength, 2)}`}</span>}
              {d.gaps > 0 && <span className="label" title="두 번 받는 사이에 체결이 너무 많아 일부를 놓쳤을 수 있어요">{`빈 구간 ${d.gaps}`}</span>}
            </div>
            <table className="flow-table qr-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>체결가</th>
                  <th>대비</th>
                  <th>수량</th>
                  {!kr && <th>누적 거래량</th>}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => {
                  const c = r.side === 'buy' ? 'up' : r.side === 'sell' ? 'down' : '';
                  return (
                    <tr key={`${r.time}|${i}|${d.rows.length - i}`} className={r.qty >= stats.big ? 'qr-big' : ''}>
                      <td>{r.time}</td>
                      <td className={c}>{fmtPrice(inst, r.price)}</td>
                      <td className={dirClass(r.change)}>{pct(r.changePct)}</td>
                      <td className={c}>{nf(r.qty)}</td>
                      {!kr && <td>{nf(r.cumVolume)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="attr">
        {kr
          ? `${BOOK_MARKETS.find((m) => m.code === market)?.label} 체결 · 한국투자증권 체결 조회로 2초마다(실시간 등록 칸 0개). 색은 직전 체결과 비교한 매수·매도 추정이에요`
          : '미국 체결 · 한국투자증권 체결추이 조회로 2초마다(한국 시각). 색은 호가와 비교한 매수·매도 추정이에요'}
        {' · 화면을 연 뒤 받은 체결만 보여요(최근 500건)'}
      </div>
    </>
  );
}

// ── AQR 체결 요약(분봉 근사) ──

export function Aqr({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const res = useBars(inst?.id, '1m', 60_000);
  const bars = useMemo(() => lastSession(res?.bars ?? []), [res?.bars]);
  const s = useMemo(() => intradaySummary(bars), [bars]);
  if (!inst) return <NeedSecurity fn="AQR" name="체결 요약" example="005930 AQR ⏎" />;
  const max = Math.max(1, ...(s?.buckets ?? []).map((b) => b.volume));
  return (
    <>
      <TitleBar fn="AQR" name="체결 요약" sub={label(inst)} fresh={res?.fresh} inst={inst} tools={<span className="approx-tag">분봉 근사</span>} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">분봉 불러오는 중…</div>}
        {res?.error && !res.bars && <div className="empty-body err">{res.error}</div>}
        {res?.bars && !s && <div className="empty-body label">분봉이 없어요</div>}
        {s && (
          <>
            <div className="aqr-grid">
              <div>
                <span className="label">VWAP</span>
                <span>{fmtPrice(inst, s.vwap)}</span>
              </div>
              <div>
                <span className="label">현재가</span>
                <span className={dirClass(s.vsVwapPct)}>{`${fmtPrice(inst, s.last)} (VWAP ${pct(s.vsVwapPct)})`}</span>
              </div>
              <div>
                <span className="label">시가 · 고가 · 저가</span>
                <span>{`${fmtPrice(inst, s.open)} · ${fmtPrice(inst, s.high)} · ${fmtPrice(inst, s.low)}`}</span>
              </div>
              <div>
                <span className="label">거래량</span>
                <span>{nf(s.volume)}</span>
              </div>
              <div>
                <span className="label">거래대금(근사)</span>
                <span>{nf(s.turnover)}</span>
              </div>
              <div>
                <span className="label">분봉</span>
                <span>{`${s.bars}개(거래 있는 봉 ${s.activeBars})`}</span>
              </div>
            </div>
            <table className="flow-table">
              <thead>
                <tr>
                  <th>30분 구간</th>
                  <th>거래량</th>
                  <th />
                  <th>VWAP</th>
                  <th>고가</th>
                  <th>저가</th>
                  <th>종가</th>
                </tr>
              </thead>
              <tbody>
                {[...s.buckets].reverse().map((b) => (
                  <tr key={b.t}>
                    <td>{`${formatHm(b.t * 1000)}~`}</td>
                    <td>{nf(b.volume)}</td>
                    <td className="aqr-bar">
                      <span style={{ width: `${(b.volume / max) * 100}%` }} />
                    </td>
                    <td>{fmtPrice(inst, b.vwap)}</td>
                    <td>{fmtPrice(inst, b.high)}</td>
                    <td>{fmtPrice(inst, b.low)}</td>
                    <td className={dirClass(b.vwap === undefined ? undefined : b.close - b.vwap)}>{fmtPrice(inst, b.close)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="attr">마지막 거래 세션의 1분봉으로 계산한 근사예요(틱이 아니에요). VWAP 대표가 = (고가 + 저가 + 종가) ÷ 3 · 시각은 한국 시각 · 1분마다 다시 받아요</div>
    </>
  );
}

// ── VAP 가격대별 거래량 ──

const VAP_RANGES: Array<{ code: 'D' | '1M' | '3M' | '6M' | '1Y'; label: string; days?: number }> = [
  { code: 'D', label: '당일' },
  { code: '1M', label: '1M', days: 31 },
  { code: '3M', label: '3M', days: 92 },
  { code: '6M', label: '6M', days: 183 },
  { code: '1Y', label: '1Y', days: 366 },
];

export function Vap({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const range = VAP_RANGES.find((r) => r.code === panel.vapRange) ?? VAP_RANGES[0];
  const intraday = range.code === 'D';
  const res = useBars(inst?.id, intraday ? '1m' : '1d', intraday ? 60_000 : 10 * 60_000);
  const bars = useMemo(() => {
    const all = res?.bars ?? [];
    if (intraday) return lastSession(all);
    const last = all[all.length - 1];
    return last ? all.filter((b) => b.t >= last.t - range.days! * 86400) : [];
  }, [res?.bars, intraday, range.days]);
  const v = useMemo(() => volumeAtPrice(bars, 24), [bars]);
  if (!inst) return <NeedSecurity fn="VAP" name="가격대별 거래량" example="005930 VAP ⏎" />;
  const last = bars[bars.length - 1]?.c;
  const max = Math.max(1, ...(v?.levels ?? []).map((x) => x.volume));
  const tools = (
    <>
      <span className="approx-tag">{intraday ? '분봉 근사' : '일봉 근사'}</span>
      {VAP_RANGES.map((r) => (
        <button key={r.code} className={r.code === range.code ? 'on' : ''} onClick={() => patchPanel(panel.id, { vapRange: r.code })}>
          {r.label}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="VAP" name="가격대별 거래량" sub={label(inst)} fresh={res?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">봉 불러오는 중…</div>}
        {res?.error && !res.bars && <div className="empty-body err">{res.error}</div>}
        {res?.bars && !v && <div className="empty-body label">거래량이 있는 봉이 없어요</div>}
        {v && (
          <>
            <div className="tv-sum">
              <span>{`${formatYmd(bars[0].t * 1000)}${intraday ? '' : ` ~ ${formatYmd(bars[bars.length - 1].t * 1000)}`} · 봉 ${bars.length}개`}</span>
              <span className="vap-poc-label">{`최다 거래 ${fmtPrice(inst, (v.levels[v.poc].lo + v.levels[v.poc].hi) / 2)}`}</span>
              <span>{`70% 구간 ${fmtPrice(inst, v.levels[v.vaLo].lo)} ~ ${fmtPrice(inst, v.levels[v.vaHi].hi)}`}</span>
            </div>
            <table className="flow-table vap-table">
              <tbody>
                {v.levels
                  .map((x, i) => ({ ...x, i }))
                  .reverse()
                  .map((x) => {
                    const here = last !== undefined && last >= x.lo && (last < x.hi || (x.i === v.levels.length - 1 && last <= x.hi));
                    const cls = [x.i === v.poc ? 'poc' : '', x.i >= v.vaLo && x.i <= v.vaHi ? 'va' : '', here ? 'here' : ''].join(' ');
                    return (
                      <tr key={x.i} className={cls}>
                        <td>{`${fmtPrice(inst, x.lo)} ~ ${fmtPrice(inst, x.hi)}`}</td>
                        <td className="vap-bar">
                          <span style={{ width: `${(x.volume / max) * 100}%` }} />
                        </td>
                        <td>{nf(x.volume)}</td>
                        <td>{v.total ? `${((x.volume / v.total) * 100).toFixed(1)}%` : '—'}</td>
                        <td className="label">{here ? '◀ 현재가' : ''}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="attr">봉마다 거래량을 그 봉의 저가~고가에 고르게 나눈 근사예요(틱이 아니에요) · 밝은 줄은 거래량 70%가 모인 구간, 앰버 줄은 가장 많이 거래된 가격대예요</div>
    </>
  );
}
