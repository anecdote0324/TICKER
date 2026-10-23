// WEI 세계 지수: 지역별 그룹, 현재·변동·변동률·시간(장 상태와 신선도 배지)·스파크라인(02).

import { INDICES, SESSION_LABEL, slowestFreshness } from '@bt/shared';
import { FreshBadge } from '../components/FreshBadge';
import { Sparkline } from '../components/Sparkline';
import { arrow, dirClass, fmtNum, fmtPct, fmtPrice } from '../format';
import { useNow } from '../hooks/useNow';
import { useQuotes } from '../stores/feed';
import { indexState } from '../stores/instruments';
import { getInstrument } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { useStore } from '../stores/store';
import { instSession } from '../session';
import { TitleBar, useFlash } from './common';

const REGIONS = ['한국', '미주', '유럽', '아시아'] as const;

export function Wei({ panel }: { panel: PanelState }) {
  useStore(indexState, (s) => s.count);
  const ids = INDICES.map((d) => `IDX:${d.code}`);
  const quotes = useQuotes(ids);
  const now = useNow(5000);
  const fresh = slowestFreshness([...quotes.values()].map((q) => q.fresh));
  return (
    <>
      <TitleBar fn="WEI" name="세계 지수" fresh={fresh} />
      <div className="pbody">
        <div className="thead">
          <span style={{ flex: 1 }}>지수</span>
          <span style={{ width: 84, textAlign: 'right' }}>현재</span>
          <span style={{ width: 70, textAlign: 'right' }}>변동</span>
          <span style={{ width: 64, textAlign: 'right' }}>변동률</span>
          <span style={{ width: 72, textAlign: 'right' }}>시간</span>
          <span style={{ width: 52, textAlign: 'right' }}>추세</span>
        </div>
        {REGIONS.map((region) => (
          <div key={region}>
            <div className="grp">{region}</div>
            {INDICES.filter((d) => d.region === region).map((d) => {
              const inst = getInstrument(`IDX:${d.code}`);
              if (!inst) return null;
              const q = quotes.get(inst.id);
              const ses = instSession(inst, now);
              return <WeiRow key={d.code} inst={inst} q={q} session={ses ? SESSION_LABEL[ses] : ''} onPick={() => setPanelSecurity(panel.id, inst.id)} />;
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function WeiRow({ inst, q, session, onPick }: { inst: NonNullable<ReturnType<typeof getInstrument>>; q: ReturnType<typeof useQuotes> extends Map<string, infer Q> ? Q | undefined : never; session: string; onPick: () => void }) {
  const flash = useFlash(q?.last, q?.fresh.mode);
  return (
    <div className="row wei-row" onClick={onPick}>
      <span className="nm">
        <span>{inst.nameKo}</span>
        <span className="cd">{inst.code}</span>
      </span>
      <span className={`num ${flash}`} style={{ width: 84, color: 'var(--value-hi)' }}>
        {fmtPrice(inst, q?.last)}
      </span>
      <span className={`num ${dirClass(q?.change)}`} style={{ width: 70 }}>
        {q?.change !== undefined ? `${arrow(q.change)}${fmtNum(Math.abs(q.change), 2)}` : '—'}
      </span>
      <span className={`num ${dirClass(q?.changePct)}`} style={{ width: 64 }}>
        {fmtPct(q?.changePct)}
      </span>
      <span style={{ width: 72, textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span className="label">{session}</span>
        <FreshBadge fresh={q?.fresh} inst={inst} variant="short" />
      </span>
      <Sparkline id={inst.id} />
    </div>
  );
}
