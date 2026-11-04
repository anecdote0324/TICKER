// MON 관심종목: 국내·미국 주식, 코인, 환율, 지수를 한 목록에 섞어서 보여 줘요.
// 행을 고르면 같은 연동 그룹의 패널이 그 종목으로 바뀌어요.

import { useMemo, useState } from 'react';
import { slowestFreshness, type Instrument } from '@bt/shared';
import { useQuotes } from '../stores/feed';
import { indexState } from '../stores/instruments';
import { getInstrument, index } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { checkSlots } from '../stores/slots';
import { appState, updateState } from '../stores/state';
import { showToast } from '../stores/ui';
import { useStore } from '../stores/store';
import { QuoteRow, TitleBar } from './common';

export function Mon({ panel, bodyFocus }: { panel: PanelState; bodyFocus: boolean }) {
  const groups = useStore(appState, (s) => s.watchlists);
  useStore(indexState, (s) => s.count);
  const shown = panel.watchGroups ? groups.filter((g) => panel.watchGroups!.includes(g.id)) : groups;
  // 고른 탭은 패널에 기억해요(지운 묶음이면 전체로)
  const tab = panel.monTab && (panel.monTab === 'all' || shown.some((g) => g.id === panel.monTab)) ? panel.monTab : 'all';
  const setTab = (t: string) => patchPanel(panel.id, { monTab: t });
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

  // 종목 빼기: ✕ 단추 또는 본문에서 Delete·Backspace(Mac ⌫). 알림의 되돌리기로 같은 자리에 돌아와요
  const remove = (gid: string, id: string) => {
    const g = groups.find((x) => x.id === gid);
    const at = g ? g.ids.indexOf(id) : -1;
    if (!g || at < 0) return;
    updateState('watchlists', (ws) => ws.map((x) => (x.id === gid ? { ...x, ids: x.ids.filter((y) => y !== id) } : x)));
    if (sel === id) setSel(null);
    const inst = getInstrument(id);
    showToast(`${inst ? inst.nameKo ?? inst.nameEn ?? inst.code : id}을(를) ${g.name}에서 뺐어요`, {
      label: '되돌리기',
      run: () =>
        updateState('watchlists', (ws) =>
          ws.map((x) => (x.id === gid && !x.ids.includes(id) ? { ...x, ids: [...x.ids.slice(0, at), id, ...x.ids.slice(at)] } : x)),
        ),
    });
  };

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
          } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
            e.preventDefault();
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
                  actions={
                    <button
                      className="icon-btn"
                      title={`${g.name}에서 빼기 (Delete)`}
                      aria-label={`${inst.nameKo ?? inst.nameEn ?? inst.code}을(를) ${g.name}에서 빼기`}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(g.id, id);
                      }}
                    >
                      ✕
                    </button>
                  }
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
