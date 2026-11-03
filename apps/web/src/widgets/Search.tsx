// 로컬 검색 페이지(05 §3.6·§4.5, v0.2): 커맨드 라인의 더 보기나 일치 없음의 Enter로 열려요.
// 앱 안의 종목 목록(색인)에서 찾은 줄을 자산군별로 묶어 최대 200줄. 위 입력칸에서 다시 찾을 수 있어요(네트워크 안 씀).

import { useMemo, useState } from 'react';
import type { EngineContext, Row } from '@bt/command';
import { engine, indexState, supports } from '../stores/instruments';
import { applyExecution, patchPanel, type PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { usageScore } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

export function Search({ panel }: { panel: PanelState }) {
  const st = useStore(settings);
  // 종목 목록을 다 받으면 다시 찾아요
  const idxCount = useStore(indexState, (s) => s.count);
  const initial = panel.args?.[0] ?? '';
  const [q, setQ] = useState(initial);
  const ctx: EngineContext = {
    panel: {},
    assist: 'beginner',
    hanEng: st.commandLine.hanEngCorrection,
    tabAutofill: false,
    supports,
    usage: usageScore,
    securityEnter: st.commandLine.securityOnlyEnter,
    defaultFn: (a) => st.commandLine.defaultFunctions?.[a],
  };
  const rows: Row[] = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    const first = t.split(/\s+/)[0];
    return engine.analyze(first, first.length, ctx, { expanded: true }).rows.filter((r) => r.kind !== 'nomatch');
    // ctx는 설정에서만 바뀌어요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, st.commandLine.hanEngCorrection, idxCount]);
  const open = (row: Row) => {
    const line = row.kind === 'function' ? row.canonical : row.instrumentId ? row.canonical : '';
    if (!line) return;
    const a = engine.analyze(line, line.length, ctx);
    if (a.plan.kind === 'execute') applyExecution(panel.id, a.plan.exec);
  };
  const count = rows.filter((r) => r.kind !== 'header').length;
  return (
    <>
      <TitleBar fn="검색" name="로컬 검색" sub={initial ? `'${initial}'` : undefined} />
      <div className="search-box">
        <input
          value={q}
          placeholder="종목코드·이름·초성·기능 (앱 안의 종목 목록에서 찾아요)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') patchPanel(panel.id, { args: [q.trim()] });
          }}
          spellCheck={false}
        />
        <span className="label">{q.trim() ? `${count}줄` : ''}</span>
      </div>
      <div className="pbody">
        {rows.map((r) =>
          r.kind === 'header' ? (
            <div key={r.id} className="grp">
              <span>{r.name}</span>
            </div>
          ) : (
            <div key={r.id} className={`row ${r.disabled ? 'nolink' : ''}`} onClick={() => !r.disabled && open(r)} title={r.disabled ? r.info : '누르면 이 패널에서 열어요'}>
              <span className={`search-badge ${r.kind === 'function' ? 'fn' : ''}`}>{r.badge}</span>
              <span className="search-code">{r.code}</span>
              <span className="nm">
                <span>{r.name}</span>
                {r.nameEn && <span className="cd">{r.nameEn}</span>}
              </span>
              <span className="label search-info">{r.info}</span>
              {r.flags.length > 0 && <span className="label search-flags">{r.flags.join(' ')}</span>}
            </div>
          ),
        )}
        {q.trim() && count === 0 && (
          <div className="des-note label">
            '{q.trim()}'와 맞는 종목·기능이 없어요. 국내 6자리 코드나 미국 티커라면 커맨드 라인에서 Enter를 누르면 한국투자증권에서 직접 조회하는 줄이 나와요(키가 있을 때).
          </div>
        )}
        <div className="des-note label">앱 안의 종목 목록(국내·미국·코인·환율·지수)과 기능에서 찾아요. 오타 한 글자, 초성, 영문 머리글자도 돼요. 줄을 누르면 이 패널에서 열어요.</div>
      </div>
    </>
  );
}
