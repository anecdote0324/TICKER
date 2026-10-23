// CRYP 코인 시세판: Binance USDT 주요 코인. 심볼 + 한글명, 현재가(USDT), 24시간 등락, 거래대금, 24시간 범위 막대(02).

import { useMemo } from 'react';
import { slowestFreshness } from '@bt/shared';
import { arrow, dirClass, fmtBig, fmtPct, fmtPrice } from '../format';
import { useQuotes } from '../stores/feed';
import { index, indexState } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { useStore } from '../stores/store';
import { FreshBadge } from '../components/FreshBadge';
import { TitleBar, useFlash } from './common';

export function Cryp({ panel }: { panel: PanelState }) {
  const count = useStore(indexState, (s) => s.count);
  const coins = useMemo(
    () =>
      index.records
        .filter((r) => r.inst.assetClass === 'CRYPTO')
        .sort((a, b) => (b.inst.popularity ?? 0) - (a.inst.popularity ?? 0))
        .slice(0, 40)
        .map((r) => r.inst),
    [count], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const quotes = useQuotes(coins.map((c) => c.id));
  const sorted = [...coins].sort((a, b) => (quotes.get(b.id)?.turnover ?? 0) - (quotes.get(a.id)?.turnover ?? 0));
  const fresh = slowestFreshness([...quotes.values()].map((q) => q.fresh));
  return (
    <>
      <TitleBar fn="CRYP" name="코인 시세판" sub="Binance USDT 현물" fresh={fresh} />
      <div className="pbody">
        <div className="thead">
          <span style={{ flex: 1 }}>코인</span>
          <span style={{ width: 96, textAlign: 'right' }}>현재가(USDT)</span>
          <span style={{ width: 70, textAlign: 'right' }}>24시간</span>
          <span style={{ width: 70, textAlign: 'right' }}>거래대금</span>
          <span style={{ width: 80, textAlign: 'center' }}>24시간 범위</span>
        </div>
        {sorted.map((inst) => {
          const q = quotes.get(inst.id);
          return <CrypRow key={inst.id} inst={inst} q={q} onPick={() => setPanelSecurity(panel.id, inst.id)} />;
        })}
      </div>
    </>
  );
}

function CrypRow({ inst, q, onPick }: { inst: Parameters<typeof fmtPrice>[0] & object; q: ReturnType<typeof useQuotes> extends Map<string, infer Q> ? Q | undefined : never; onPick: () => void }) {
  const flash = useFlash(q?.last, q?.fresh.mode);
  const pos = q && q.high !== undefined && q.low !== undefined && q.high > q.low ? ((q.last - q.low) / (q.high - q.low)) * 100 : 50;
  return (
    <div className="row" onClick={onPick}>
      <span className="nm">
        <span className="mono" style={{ color: 'var(--value-hi)' }}>
          {inst.code}
        </span>
        <span className="cd">{inst.nameKo ?? ''}</span>
      </span>
      <span className={`num ${flash}`} style={{ width: 96, color: 'var(--value-hi)' }}>
        {fmtPrice(inst, q?.last)}
      </span>
      <span className={`num ${dirClass(q?.changePct)}`} style={{ width: 70 }}>
        {arrow(q?.changePct)}
        {q?.changePct !== undefined ? fmtPct(Math.abs(q.changePct)).replace('+', '') : '—'}
      </span>
      <span className="num label" style={{ width: 70 }}>
        {fmtBig(q?.turnover)}
      </span>
      <span style={{ width: 80, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
        <span className="range">
          <i style={{ left: `calc(${pos}% - 1px)` }} />
        </span>
        <FreshBadge fresh={q?.fresh} inst={inst} variant="short" />
      </span>
    </div>
  );
}
