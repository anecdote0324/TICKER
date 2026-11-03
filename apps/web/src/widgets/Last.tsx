// LAST 최근 화면(05 §15, v0.2): 최근에 실행한 명령(화면) 목록. 줄을 누르면 이 패널에서 다시 열어요(블룸버그 LAST처럼).

import { labelFor, type EngineContext } from '@bt/command';
import { useNow } from '../hooks/useNow';
import { engine, index, supports } from '../stores/instruments';
import { applyExecution, type PanelState } from '../stores/panels';
import { appState, usageScore } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

const MAX = 100;
const pad2 = (n: number) => String(n).padStart(2, '0');

function when(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

const ctx = (): EngineContext => ({ panel: {}, assist: 'expert', hanEng: false, tabAutofill: false, supports, usage: usageScore });

/** 기록의 표준형을 다시 해석해서 무엇이 열리는지(⏎ 라벨) 보여 줘요 */
function describe(cmd: string): { label: string; ok: boolean } {
  const a = engine.analyze(cmd, cmd.length, ctx());
  if (a.plan.kind !== 'execute') return { label: '지금은 열 수 없어요', ok: false };
  return { label: labelFor(a.plan, index).replace(/^⏎ 실행: /, ''), ok: true };
}

export function Last({ panel }: { panel: PanelState }) {
  const history = useStore(appState, (s) => s.history);
  const now = useNow(30_000);
  const seen = new Set<string>();
  const rows = history.filter((h) => {
    if (seen.has(h.cmd) || /^LAST\b/.test(h.cmd)) return false;
    seen.add(h.cmd);
    return true;
  }).slice(0, MAX);
  const open = (cmd: string) => {
    const a = engine.analyze(cmd, cmd.length, ctx());
    if (a.plan.kind === 'execute') applyExecution(panel.id, a.plan.exec);
  };
  return (
    <>
      <TitleBar fn="LAST" name="최근 화면" sub={`${rows.length}개`} />
      <div className="pbody">
        <div className="thead">
          <span style={{ width: 22, textAlign: 'right' }}>#</span>
          <span style={{ width: 40 }}>시각</span>
          <span style={{ flex: 1 }}>명령</span>
          <span className="col-vol" style={{ flex: 1 }}>
            여는 화면
          </span>
        </div>
        {rows.map((h, i) => {
          const d = describe(h.cmd);
          return (
            <div key={h.cmd} className={`row ${d.ok ? '' : 'nolink'}`} onClick={() => d.ok && open(h.cmd)} title={d.ok ? '누르면 이 패널에서 열어요' : d.label}>
              <span className="num label" style={{ width: 22 }}>
                {i + 1}
              </span>
              <span className="num label" style={{ width: 40, textAlign: 'left' }}>
                {when(h.at, now)}
              </span>
              <span className="last-cmd" style={{ flex: 1 }}>
                {h.cmd}
              </span>
              <span className={`col-vol ${d.ok ? 'last-desc' : 'label'}`} style={{ flex: 1 }}>
                {d.label}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <div className="des-note label">아직 실행한 명령이 없어요</div>}
        <div className="des-note label">실행한 명령은 최근 500개까지 남아요. 빈 커맨드 라인에서 ↑로 꺼내 쓸 수도 있어요.</div>
      </div>
    </>
  );
}
