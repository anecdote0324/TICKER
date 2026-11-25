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
import { removeTradingView, setTradingViewUrl, syncTradingView, TV_GROUP_ID } from '../stores/tradingview';

export function Mon({ panel, bodyFocus }: { panel: PanelState; bodyFocus: boolean }) {
  const groups = useStore(appState, (s) => s.watchlists);
  useStore(indexState, (s) => s.count);
  // 트레이딩뷰 묶음은 묶음을 골라 둔 패널(기본 배치의 MON 등)에도 보여요
  const shown = panel.watchGroups ? groups.filter((g) => panel.watchGroups!.includes(g.id) || g.id === TV_GROUP_ID) : groups;
  const hasTv = groups.some((g) => g.id === TV_GROUP_ID);
  const [tvEdit, setTvEdit] = useState(false);
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
            {!hasTv && (
              <button title="트레이딩뷰 관심 목록 공유 링크로 '트레이딩뷰' 묶음 만들기" onClick={() => setTvEdit(true)}>
                + 트레이딩뷰
              </button>
            )}
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
        {tvEdit && !hasTv && <TvLinkRow onClose={() => setTvEdit(false)} />}
        {visible.map((g) => (
          <div key={g.id}>
            <div className="grp">
              <span style={{ flex: 1 }}>{g.name}</span>
              {g.id === TV_GROUP_ID ? (
                <>
                  <TvStatus g={g} />
                  <button className="icon-btn" title="지금 트레이딩뷰 목록과 맞추기" aria-label="트레이딩뷰 목록 다시 받기" onClick={() => void syncTradingView()}>
                    ↻
                  </button>
                  <button className="icon-btn" title="링크 바꾸기·연결 끊기" aria-label="트레이딩뷰 링크 설정" onClick={() => setTvEdit((o) => !o)}>
                    🔗
                  </button>
                </>
              ) : (
                <button className="icon-btn" title="종목 추가" aria-label={`${g.name}에 종목 추가`} onClick={() => setAdding(adding === g.id ? null : g.id)}>
                  +
                </button>
              )}
            </div>
            {g.id === TV_GROUP_ID && tvEdit && <TvLinkRow current={g.tvUrl} onClose={() => setTvEdit(false)} />}
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
                    g.id === TV_GROUP_ID ? undefined : (
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
                    )
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

/** 트레이딩뷰 묶음 상태: 목록 이름·종목 수·맞춘 시각, 찾지 못한 기호, 오류 */
function TvStatus({ g }: { g: { tvName?: string; ids: string[]; syncedAt?: number; unmatched?: string[]; syncError?: string } }) {
  const at = g.syncedAt ? new Date(g.syncedAt) : undefined;
  const hm = at ? `${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '확인 전';
  const miss = g.unmatched?.length ?? 0;
  return (
    <span className={`label tv-status ${g.syncError ? 'err' : ''}`} title={[g.syncError, miss ? `앱에서 찾지 못한 종목: ${g.unmatched!.join(', ')}` : ''].filter(Boolean).join('\n') || undefined}>
      {g.syncError ? '받지 못함' : `${g.tvName ? `${g.tvName} · ` : ''}${g.ids.length}개${miss ? ` · 못 찾음 ${miss}` : ''} · ${hm}`}
    </span>
  );
}

/** 트레이딩뷰 링크 넣기·바꾸기·끊기 */
function TvLinkRow({ current, onClose }: { current?: string; onClose: () => void }) {
  const [v, setV] = useState(current ?? '');
  const [err, setErr] = useState<string | undefined>();
  const save = () => {
    const e = setTradingViewUrl(v);
    if (e) setErr(e);
    else onClose();
  };
  return (
    <div className="tv-link">
      <input
        autoFocus
        value={v}
        placeholder="트레이딩뷰 관심 목록 공유 링크 (https://kr.tradingview.com/watchlists/번호/)"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onClose();
        }}
      />
      <button className="btn" onClick={save}>
        저장
      </button>
      {current && (
        <button
          className="btn"
          onClick={() => {
            removeTradingView();
            onClose();
          }}
        >
          연결 끊기
        </button>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
