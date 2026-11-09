// v0.6 CIX 수식 티커: 이미 받는 시세를 조합한 사용자 지수(스프레드·비율 등). 지금 값과 전일 종가로 계산한 값, 등락.
// 식은 대괄호 안에 종목([005930], [AAPL US], [SPX], [BTC], [USDKRW])과 숫자, + - * / 괄호.

import { useMemo, useState } from 'react';
import { evalCix, parseCix, splitCixRef, type CixFormula, type Instrument } from '@bt/shared';
import { dirClass } from '../format';
import { useQuotes } from '../stores/feed';
import { engine, getInstrument, index, indexState, supports } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { appState, updateState, usageScore } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

/** 대괄호 안 글자 → 종목. 커맨드 라인과 같은 순위로 골라요(BTC는 코인, 겹치면 시장을 붙여요) */
export function resolveCixRef(ref: string): Instrument | undefined {
  if (ref.includes(':')) return index.get(ref)?.inst;
  const a = engine.analyze(ref, ref.length, { panel: {}, assist: 'expert', hanEng: false, tabAutofill: false, supports, usage: usageScore });
  const id = a.plan.kind === 'execute' ? a.plan.exec.instrumentId : undefined;
  if (id) return getInstrument(id);
  const row = a.rows.find((r) => r.instrumentId && !r.disabled);
  if (row?.instrumentId) return getInstrument(row.instrumentId);
  const { code } = splitCixRef(ref);
  return index.exactCode(code)[0]?.inst;
}

interface Parsed {
  id: string;
  name: string;
  formula: string;
  f?: CixFormula;
  error?: string;
  insts: Map<string, Instrument | undefined>;
}

function parseAll(list: Array<{ id: string; name: string; formula: string }>): Parsed[] {
  return list.map((x) => {
    try {
      const f = parseCix(x.formula);
      const insts = new Map(f.refs.map((r) => [r, resolveCixRef(r)]));
      const missing = f.refs.filter((r) => !insts.get(r));
      return { ...x, f, insts, error: missing.length ? `찾지 못한 종목: ${missing.join(', ')}` : undefined };
    } catch (e) {
      return { ...x, insts: new Map(), error: (e as Error).message };
    }
  });
}

const fmt = (v: number | undefined) => (v === undefined ? '—' : Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toPrecision(6).replace(/\.?0+$/, ''));

export function Cix({ panel }: { panel: PanelState }) {
  const list = useStore(appState).cix ?? [];
  // 종목 목록을 다 받은 뒤 다시 찾아요(켜자마자는 목록이 비어 있어요)
  const indexCount = useStore(indexState).count;
  const parsed = useMemo(() => parseAll(list), [list, indexCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => [...new Set(parsed.flatMap((p) => [...p.insts.values()].filter((i): i is Instrument => !!i).map((i) => i.id)))], [parsed]);
  const quotes = useQuotes(ids);
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  let draftError: string | undefined;
  if (formula.trim()) {
    try {
      const f = parseCix(formula);
      const miss = f.refs.filter((r) => !resolveCixRef(r));
      if (miss.length) draftError = `찾지 못한 종목: ${miss.join(', ')}`;
    } catch (e) {
      draftError = (e as Error).message;
    }
  }
  const add = () => {
    if (!formula.trim() || draftError) return;
    updateState('cix', (l) => [...(l ?? []), { id: Date.now().toString(36), name: name.trim() || formula.trim(), formula: formula.trim() }].slice(-40));
    setName('');
    setFormula('');
  };
  return (
    <>
      <TitleBar fn="CIX" name="수식 티커" sub={list.length ? `${list.length}개` : undefined} />
      <div className="pbody flow">
        <table className="flow-table cix">
          <thead>
            <tr>
              <th>이름</th>
              <th>식</th>
              <th>값</th>
              <th>전일</th>
              <th>대비</th>
              <th>%</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parsed.map((p) => {
              const last = p.f && !p.error ? evalCix(p.f, (r) => quotes.get(p.insts.get(r)!.id)?.last) : undefined;
              const prev =
                p.f && !p.error
                  ? evalCix(p.f, (r) => {
                      const q = quotes.get(p.insts.get(r)!.id);
                      return q?.prevClose ?? (q && q.change !== undefined ? q.last - q.change : undefined);
                    })
                  : undefined;
              const chg = last !== undefined && prev !== undefined ? last - prev : undefined;
              const pct = chg !== undefined && prev ? (chg / Math.abs(prev)) * 100 : undefined;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="cix-f">
                    {p.f
                      ? p.formula.split(/(\[[^\]]+\])/).map((part, i) => {
                          const m = part.match(/^\[([^\]]+)\]$/);
                          const inst = m ? p.insts.get(m[1].trim().replace(/\s+/g, ' ')) : undefined;
                          return m && inst ? (
                            <button key={i} className="linkish" title={`${inst.nameKo || inst.nameEn} · 눌러서 연동 그룹으로`} onClick={() => setPanelSecurity(panel.id, inst.id)}>
                              {part}
                            </button>
                          ) : (
                            <span key={i}>{part}</span>
                          );
                        })
                      : p.formula}
                    {p.error && <div className="err">{p.error}</div>}
                  </td>
                  <td>{fmt(last)}</td>
                  <td className="label">{fmt(prev)}</td>
                  <td className={dirClass(chg)}>{chg === undefined ? '—' : `${chg > 0 ? '+' : ''}${fmt(chg)}`}</td>
                  <td className={dirClass(pct)}>{pct === undefined ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}</td>
                  <td>
                    <button className="linkish" onClick={() => updateState('cix', (l) => (l ?? []).filter((x) => x.id !== p.id))}>
                      빼기
                    </button>
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={7} className="label">
                  아직 없어요. 아래에 이름과 식을 넣어요. 예: 삼성/하이닉스 = [005930] / [000660]
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="ecst-add">
          <input placeholder="이름 (예: 삼성/하이닉스)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="식 (예: [005930] / [000660], [SPX] - [NDX] * 0.25)" value={formula} onChange={(e) => setFormula(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add} disabled={!formula.trim() || !!draftError}>
            더하기
          </button>
        </div>
        {draftError && <div className="err cix-draft">{draftError}</div>}
      </div>
      <div className="attr">종목은 대괄호 안에 코드로 적어요(겹치면 시장을 붙여요: [AAPL US]). 시세는 그 종목의 지금 시세와 같은 속도로 바뀌고, 전일은 각 종목의 전일 종가로 계산해요. 종목 코드를 누르면 연동 그룹의 패널이 그 종목으로 바뀌어요</div>
    </>
  );
}
