// PORT 포트폴리오(03 v0.3): 보유 종목을 직접 입력하거나 잔고 CSV로 가져와 원화로 평가·손익을 봐요.
// 미국 종목·코인은 지금 원/달러로 평가하고, 매입금액은 매입 환율(넣었으면)로 환산해요. 줄을 누르면 연동 그룹이 그 종목으로.
// 보유 목록은 데이터 폴더(state-portfolio.json)에 저장돼요. 매매·잔고 자동 연동은 없어요(사용자 결정).

import { useMemo, useRef, useState } from 'react';
import { computePortfolio, parseHoldingsCsv, type Holding, type Instrument } from '@bt/shared';
import { dirClass, fmtPct, fmtPrice } from '../format';
import { useQuotes } from '../stores/feed';
import { getInstrument, index } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { showToast } from '../stores/ui';
import { TitleBar } from './common';

const won = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v).toLocaleString('en-US')}`);
const currencyOf = (inst: Instrument | undefined) => (!inst ? 'KRW' : inst.assetClass === 'CRYPTO' ? 'USDT' : inst.market === 'US' ? 'USD' : 'KRW');

/** 코드·이름으로 종목 찾기(CSV 가져오기): 정확한 코드 먼저 */
function resolve(code: string, name?: string): Instrument | undefined {
  for (const q of [code, name].filter(Boolean) as string[]) {
    const hits = index.search(q, { first: false }).filter((m) => m.tier <= 1 && (m.rec.inst.assetClass === 'EQUITY' || m.rec.inst.assetClass === 'CRYPTO'));
    if (hits.length) return hits.sort((a, b) => a.tier - b.tier || (b.rec.inst.popularity ?? 0) - (a.rec.inst.popularity ?? 0))[0].rec.inst;
  }
  return undefined;
}

export function Port({ panel }: { panel: PanelState }) {
  const holdings = useStore(appState, (s) => s.portfolio ?? []);
  const ids = useMemo(() => [...new Set([...holdings.map((h) => h.id), 'CUR:USDKRW'])], [holdings]);
  const quotes = useQuotes(ids);
  const usdkrw = quotes.get('CUR:USDKRW')?.last;
  const { rows, totals } = computePortfolio(
    holdings,
    (id) => {
      const q = quotes.get(id);
      const inst = getInstrument(id);
      if (!q) return inst ? { currency: currencyOf(inst) } : undefined;
      return { last: q.last, prevClose: q.prevClose ?? (q.change !== undefined ? q.last - q.change : undefined), currency: currencyOf(inst) };
    },
    usdkrw,
  );
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setAll = (next: Holding[]) => updateState('portfolio', () => next);
  const before = () => appState.get().portfolio ?? [];
  const undo = (prev: Holding[]) => ({ label: '되돌리기', run: () => setAll(prev) });

  const importCsv = async (f: File) => {
    const buf = new Uint8Array(await f.arrayBuffer());
    // 증권사 CSV는 EUC-KR(CP949)인 경우가 많아요. UTF-8로 읽어 깨지면 EUC-KR로
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
    const r = parseHoldingsCsv(text);
    if (r.error) {
      showToast(`가져오지 못했어요: ${r.error}`);
      return;
    }
    const prev = before();
    const next = [...prev];
    const unknown: string[] = [];
    for (const row of r.rows) {
      const inst = resolve(row.code, row.name);
      if (!inst) {
        unknown.push(row.code || row.name || '?');
        continue;
      }
      const h: Holding = { id: inst.id, qty: row.qty, avgCost: row.avgCost, fxAtCost: row.fxAtCost, account: row.account };
      const i = next.findIndex((x) => x.id === inst.id && (x.account ?? '') === (h.account ?? ''));
      if (i >= 0) next[i] = h;
      else next.push(h);
    }
    setAll(next);
    showToast(`${r.rows.length - unknown.length}개 종목을 가져왔어요${unknown.length ? ` · 못 찾은 코드 ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ' …' : ''}` : ''}${r.skipped ? ` · ${r.skipped}줄 건너뜀` : ''}`, undo(prev), 10_000);
  };

  const tools = (
    <>
      <button className={adding ? 'on' : ''} onClick={() => setAdding((a) => !a)}>
        종목 추가
      </button>
      <button title="잔고 CSV(신한 등): 종목코드·수량·평균단가 열을 읽어요" onClick={() => fileRef.current?.click()}>
        CSV 가져오기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importCsv(f);
        }}
      />
    </>
  );

  return (
    <>
      <TitleBar fn="PORT" name="포트폴리오" sub={`${holdings.length}종목 · 원화 환산`} fresh={quotes.get('CUR:USDKRW')?.fresh} tools={tools} />
      <div className="pbody port">
        {adding && <PortAdd onAdd={(h) => setAll([...before(), h])} usdkrw={usdkrw} />}
        <div className="port-sum">
          <span>
            평가금액 <b className="num">{won(totals.value)}</b>원
          </span>
          <span>
            매입금액 <b className="num">{won(totals.cost)}</b>원
          </span>
          <span className={dirClass(totals.pnl)}>
            손익 <b className="num">{won(totals.pnl)}</b>원 {totals.pnlPct !== undefined ? fmtPct(totals.pnlPct) : ''}
          </span>
          <span className={dirClass(totals.dayPnl)}>
            오늘 <b className="num">{won(totals.dayPnl)}</b>원
          </span>
          {usdkrw && <span className="label">원/달러 {usdkrw.toFixed(2)}</span>}
          {totals.missing > 0 && <span className="label">시세 없는 {totals.missing}종목은 합계에서 빠져요</span>}
        </div>
        {holdings.length === 0 && !adding && (
          <div className="empty-body">
            <div>보유 종목이 없어요</div>
            <div className="label">제목 줄의 종목 추가 또는 CSV 가져오기(신한 등 잔고 파일)</div>
          </div>
        )}
        {holdings.length > 0 && (
          <table className="port-table">
            <thead>
              <tr>
                <th>종목</th>
                <th>수량</th>
                <th>평균단가</th>
                <th>현재가</th>
                <th>평가금액(원)</th>
                <th>손익(원)</th>
                <th>수익률</th>
                <th>오늘(원)</th>
                <th>비중</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const inst = getInstrument(r.id);
                const h = holdings[i];
                return (
                  <tr key={`${r.id}|${h.account ?? ''}|${i}`} onClick={() => setPanelSecurity(panel.id, r.id)}>
                    <td>
                      <span className="port-name">{inst?.nameKo || inst?.nameEn || r.id}</span> <span className="cd">{inst?.code}</span>
                      {h.account && <span className="label"> · {h.account}</span>}
                    </td>
                    <td className="num">
                      <EditNum value={h.qty} onSave={(v) => setAll(before().map((x, k) => (k === i ? { ...x, qty: v } : x)))} />
                    </td>
                    <td className="num">
                      <EditNum value={h.avgCost} onSave={(v) => setAll(before().map((x, k) => (k === i ? { ...x, avgCost: v } : x)))} />
                      {h.fxAtCost ? <span className="label"> @{h.fxAtCost}</span> : null}
                    </td>
                    <td className="num">{inst ? fmtPrice(inst, r.last) : '—'}</td>
                    <td className="num">{won(r.value)}</td>
                    <td className={`num ${dirClass(r.pnl)}`}>{won(r.pnl)}</td>
                    <td className={`num ${dirClass(r.pnlPct)}`}>{r.pnlPct !== undefined ? fmtPct(r.pnlPct) : '—'}</td>
                    <td className={`num ${dirClass(r.dayPnl)}`}>{won(r.dayPnl)}</td>
                    <td className="num">{r.weight !== undefined ? `${r.weight.toFixed(1)}%` : '—'}</td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label="빼기"
                        onClick={(e) => {
                          e.stopPropagation();
                          const prev = before();
                          setAll(prev.filter((_, k) => k !== i));
                          showToast(`${inst?.nameKo ?? r.id}을(를) 포트폴리오에서 뺐어요`, undo(prev));
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="attr">미국 종목·코인은 지금 원/달러로 평가해요. 매입 환율(@)을 넣으면 매입금액을 그 환율로 환산하고, 없으면 지금 환율이라 환율 손익이 0이에요. 수량·평균단가는 숫자를 눌러 고쳐요. 매매·잔고 자동 연동은 하지 않아요.</div>
      </div>
    </>
  );
}

function EditNum({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit === null)
    return (
      <span
        className="port-edit"
        title="눌러서 고치기"
        onClick={(e) => {
          e.stopPropagation();
          setEdit(String(value));
        }}
      >
        {value.toLocaleString('en-US', { maximumFractionDigits: 6 })}
      </span>
    );
  const save = () => {
    const v = Number(edit.replace(/,/g, ''));
    if (Number.isFinite(v) && v >= 0) onSave(v);
    setEdit(null);
  };
  return (
    <input
      className="port-input"
      autoFocus
      value={edit}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setEdit(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') setEdit(null);
      }}
    />
  );
}

function PortAdd({ onAdd, usdkrw }: { onAdd: (h: Holding) => void; usdkrw?: number }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Instrument | null>(null);
  const [qty, setQty] = useState('');
  const [avg, setAvg] = useState('');
  const [fx, setFx] = useState('');
  const [account, setAccount] = useState('');
  const results = useMemo(() => {
    if (!q.trim() || pick) return [];
    return index
      .search(q, { first: false })
      .filter((m) => m.rec.inst.assetClass === 'EQUITY' || m.rec.inst.assetClass === 'CRYPTO')
      .sort((a, b) => a.tier - b.tier || a.sub - b.sub || (b.rec.inst.popularity ?? 0) - (a.rec.inst.popularity ?? 0))
      .slice(0, 6)
      .map((m) => m.rec.inst);
  }, [q, pick]);
  const foreign = pick && currencyOf(pick) !== 'KRW';
  const ok = pick && Number(qty.replace(/,/g, '')) > 0 && Number(avg.replace(/,/g, '')) >= 0 && avg !== '';
  const add = () => {
    if (!ok || !pick) return;
    onAdd({ id: pick.id, qty: Number(qty.replace(/,/g, '')), avgCost: Number(avg.replace(/,/g, '')), fxAtCost: foreign && Number(fx) > 0 ? Number(fx) : undefined, account: account.trim() || undefined });
    setQ('');
    setPick(null);
    setQty('');
    setAvg('');
    setFx('');
  };
  return (
    <div className="port-add">
      {pick ? (
        <button className="btn" onClick={() => setPick(null)} title="다른 종목 고르기">
          {pick.nameKo || pick.nameEn} {pick.code} ✕
        </button>
      ) : (
        <input autoFocus placeholder="종목코드·이름" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && results[0] && setPick(results[0])} />
      )}
      <input placeholder="수량" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 80 }} />
      <input placeholder={foreign ? '평균단가(달러)' : '평균단가(원)'} value={avg} onChange={(e) => setAvg(e.target.value)} style={{ width: 110 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
      {foreign && <input placeholder={`매입 환율(지금 ${usdkrw?.toFixed(0) ?? '—'})`} value={fx} onChange={(e) => setFx(e.target.value)} style={{ width: 140 }} />}
      <input placeholder="계좌(선택)" value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 90 }} />
      <button className="btn primary" disabled={!ok} onClick={add}>
        추가
      </button>
      {results.map((r) => (
        <div key={r.id} className="row" onClick={() => setPick(r)}>
          <span className="nm">
            <span>{r.nameKo ?? r.nameEn}</span>
            <span className="cd">{r.code}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
