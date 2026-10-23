// 도움말, 알림

import { useMemo, useState } from 'react';
import { buildCollisionTable } from '@bt/command';
import { shortcutLabel } from '../keys';
import { engine, index, indexState } from '../stores/instruments';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { ui } from '../stores/ui';
import { SyntaxCard } from './CandidateList';

export function HelpOverlay() {
  const help = useStore(ui, (s) => s.help);
  if (!help) return null;
  const close = () => ui.set((s) => ({ ...s, help: null }));
  return (
    <div className="overlay" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1}>
      <div className={`help ${help === 'collisions' ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px' }}>{help === 'syntax' ? '명령 문법' : help === 'collisions' ? '겹치는 이름' : '도움말'}</h3>
        {help === 'collisions' ? <Collisions /> : <SyntaxCard />}
        {help === 'help' && (
          <>
            <p>
              <b>Tab은 채우고, Enter는 실행해요.</b> 입력이 여러 뜻일 수 있으면 첫 Enter는 1번 줄을 <b>선택</b>만 하고, 두 번째 Enter가 실행해요. 커맨드 라인 오른쪽의 ⏎ 라벨이 Enter가 할 일을 늘 알려 줘요.
            </p>
            <p>
              예: <code>005930⏎</code> 삼성전자 · <code>삼성⏎⏎</code> 이름으로 찾기 · <code>ㅅㅅㅈㅈ</code> 초성 · <code>AAPL US GIP⏎</code> · <code>BTC⏎</code> · <code>WEI⏎</code> · <code>USDKRW⏎</code>
            </p>
            <p>
              <b>데이터 신선도</b>: 배지가 없으면 실시간이에요. 실시간이 아닌 값에는 `5초 주기`, `15분 지연`, `일별 10/21`, `마감`, `⚠ 멈춤`, `데모` 같은 회색 배지가 붙어요. 배지에 마우스를 올리면 출처와 기준 시각을 보여 줘요.
            </p>
            <p>
              <b>겹치는 이름</b>: <code>GP</code>처럼 기능 코드이면서 미국 티커이기도 한 단어, <code>CVX</code>처럼 코인과 주식에 모두 있는 코드는{' '}
              <button className="btn" style={{ height: 20, fontSize: 11 }} onClick={() => ui.set((s) => ({ ...s, help: 'collisions' }))}>
                겹치는 이름 표
              </button>
              에서 Enter가 무엇을 하는지 볼 수 있어요.
            </p>
            <p className="label">
              {[
                [shortcutLabel('palette'), '명령 팔레트'],
                [shortcutLabel('focusCommand'), '커맨드 라인'],
                [shortcutLabel('toggleFocus'), '본문 ↔ 커맨드 라인'],
                [shortcutLabel('settings'), '설정'],
                ['Esc', '닫기'],
              ]
                .filter(([k]) => k)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** 겹침 표(05 §7.7): 지금 색인으로 만들어요. 줄마다 그 단어만 치고 Enter를 누르면 무엇을 하는지 */
function Collisions() {
  const count = useStore(indexState, (s) => s.count);
  const st = useStore(settings, (s) => s.commandLine);
  const [filter, setFilter] = useState('');
  const rows = useMemo(
    () => buildCollisionTable(engine, index, { panel: {}, assist: st.assist, hanEng: st.hanEngCorrection, tabAutofill: st.tabAutofill }),
    // count: 색인이 바뀌면 다시 만들어요
    [count, st.assist, st.hanEngCorrection, st.tabAutofill], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const f = filter.trim().toUpperCase();
  const shown = f ? rows.filter((r) => r.word.includes(f) || r.meanings.some((m) => m.toUpperCase().includes(f))) : rows;
  return (
    <>
      <p className="note" style={{ margin: '0 0 8px' }}>
        기능·명령·시장·자산군 단어와 종목 코드, 코인과 주식, 한국 회사 이름과 미국 티커가 겹치는 경우예요. 빈 패널에서 그 단어 하나만 치고 Enter를 눌렀을 때 하는 일을 보여 줘요. 다른 뜻은 목록의 바로 아래 줄에 있고, 시장·자산군을 붙이면(<code>CVX US</code>, <code>CVX CRY</code>) 바로 정해져요.
      </p>
      <input className="collision-filter" placeholder="단어·이름으로 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="겹침 표 거르기" />
      <span className="label" style={{ marginLeft: 8 }}>
        {shown.length}개 / 전체 {rows.length}개
      </span>
      <div className="collision-wrap">
        <table className="cmp collision-table">
          <thead>
            <tr>
              <th>단어</th>
              <th>종류</th>
              <th>뜻</th>
              <th>⏎ 하는 일</th>
              <th>이유</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.kind}|${r.word}`}>
                <td className="mono">{r.word}</td>
                <td className="label">{r.kind}</td>
                <td>
                  {r.meanings.map((m) => (
                    <div key={m}>{m}</div>
                  ))}
                </td>
                <td className={r.outcome === 'execute' ? '' : 'label'}>{r.label}</td>
                <td className="label">{r.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ToastView() {
  const t = useStore(ui, (s) => s.toast);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span>{t.text}</span>
      {t.action && (
        <button
          className="btn"
          onClick={() => {
            t.action!.run();
            ui.set((s) => ({ ...s, toast: null }));
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="icon-btn" aria-label="닫기" onClick={() => ui.set((s) => ({ ...s, toast: null }))}>
        ✕
      </button>
    </div>
  );
}
