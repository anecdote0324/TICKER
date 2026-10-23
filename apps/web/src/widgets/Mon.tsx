// MON 관심종목: 국내·미국 주식, 코인, 환율, 지수를 한 목록에 섞어서 보여 줘요.
// 행을 고르면 같은 연동 그룹의 패널이 그 종목으로 바뀌어요.

import { useMemo, useState } from 'react';
import { slowestFreshness, type Instrument } from '@bt/shared';
import { useQuotes } from '../stores/feed';
import { indexState } from '../stores/instruments';
import { getInstrument, index } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { checkSlots } from '../stores/slots';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { QuoteRow, TitleBar } from './common';

export function Mon({ panel, bodyFocus }: { panel: PanelState; bodyFocus: boolean }) {
  const groups = useStore(appState, (s) => s.watchlists);
  useStore(indexState, (s) => s.count);
  const shown = panel.watchGroups ? groups.filter((g) => panel.watchGroups!.includes(g.id)) : groups;
  const [tab, setTab] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const visible = tab === 'all' ? shown : shown.filter((g) => g.id === tab);
  const ids = visible.flatMap((g) => g.ids);
  const quotes = useQuotes(ids);
  const fresh = slowestFreshness([...quotes.values()].map((q) => q.fresh));

  const pick = (id: string) => {
    setSel(id);
    setPanelSecurity(panel.id, id);
    checkSlots();
  };

  const remove = (gid: string, id: string) => updateState('watchlists', (ws) => ws.map((g) => (g.id === gid ? { ...g, ids: g.ids.filter((x) => x !== id) } : g)));

  return (
    <>
      <TitleBar
        fn="MON"
        name="관심종목"
        fresh={fresh}
        tools={
          <>
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
              전체
            </button>
            {shown.map((g) => (
              <button key={g.id} className={tab === g.id ? 'on' : ''} onClick={() => setTab(g.id)}>
                {g.name}
              </button>
            ))}
          </>
        }
      />
      <div
        className="pbody"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!bodyFocus) return;
          const flat = ids;
          const i = sel ? flat.indexOf(sel) : -1;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            pick(flat[Math.min(flat.length - 1, i + 1)]);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            pick(flat[Math.max(0, i - 1)]);
          } else if (e.key === 'Delete' && sel) {
            const g = visible.find((x) => x.ids.includes(sel));
            if (g) remove(g.id, sel);
          }
        }}
      >
        <div className="thead">
          <span style={{ flex: 1 }}>종목</span>
          <span style={{ width: 84, textAlign: 'right' }}>현재가</span>
          <span style={{ width: 70, textAlign: 'right' }}>등락</span>
          <span style={{ width: 34 }} />
          <span className="col-spark" style={{ width: 52, textAlign: 'right' }}>추세</span>
        </div>
        {visible.map((g) => (
          <div key={g.id}>
            <div className="grp">
              <span style={{ flex: 1 }}>{g.name}</span>
              <button className="icon-btn" title="종목 추가" aria-label={`${g.name}에 종목 추가`} onClick={() => setAdding(adding === g.id ? null : g.id)}>
                +
              </button>
            </div>
            {adding === g.id && <AddRow onAdd={(id) => updateState('watchlists', (ws) => ws.map((x) => (x.id === g.id && !x.ids.includes(id) ? { ...x, ids: [...x.ids, id] } : x)))} onClose={() => setAdding(null)} />}
            {g.ids.map((id) => {
              const inst = getInstrument(id);
              if (!inst) return null;
              return (
                <QuoteRow
                  key={id}
                  inst={inst}
                  quote={quotes.get(id)}
                  selected={sel === id}
                  onClick={() => pick(id)}
                  extra={undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function AddRow({ onAdd, onClose }: { onAdd: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const results = useMemo<Instrument[]>(() => {
    if (!q.trim()) return [];
    return index
      .search(q, { first: false })
      .sort((a, b) => a.tier - b.tier || a.sub - b.sub || (b.rec.inst.popularity ?? 0) - (a.rec.inst.popularity ?? 0))
      .slice(0, 6)
      .map((m) => m.rec.inst);
  }, [q]);
  return (
    <div className="add-row" style={{ padding: '4px 8px' }}>
      <input
        autoFocus
        placeholder="종목코드·이름 (Enter로 추가, Esc 닫기)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            onAdd(results[0].id);
            setQ('');
          } else if (e.key === 'Escape') onClose();
        }}
      />
      {results.map((r) => (
        <div key={r.id} className="row" onClick={() => (onAdd(r.id), setQ(''))}>
          <span className="nm">
            <span>{r.nameKo ?? r.nameEn}</span>
            <span className="cd">
              {r.code} {r.market ?? r.assetClass}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
