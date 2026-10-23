// 명령 팔레트(Ctrl+K): 같은 엔진이에요. 대상은 팔레트를 연 그 창의 활성 패널이에요(05 §10.4).
// Alt+1…9(Mac Option+숫자)로 대상 패널을 바꿔요. 숫자 자리(e.code)로 알아봐서 Option+숫자의 특수 문자는 들어가지 않아요.

import { useState } from 'react';
import { FUNCTIONS } from '@bt/shared';
import { isMac } from '../api';
import { activePanelId, panelCanonical, panels } from '../stores/panels';
import { useStore } from '../stores/store';
import { ui } from '../stores/ui';
import { CommandLine } from './CommandLine';

export function Palette() {
  const active = useStore(activePanelId);
  const all = useStore(panels);
  const [target, setTarget] = useState(active);
  const p = target ? all[target] : undefined;
  const close = () => ui.set((s) => ({ ...s, palette: false }));
  if (!p) return null;
  const fn = FUNCTIONS.find((f) => f.code === p.fn);
  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          const m = /^Digit([1-9])$/.exec(e.code);
          if (!m || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          const next = Object.values(all).find((x) => x.num === Number(m[1]));
          if (next) setTarget(next.id);
        }}
      >
        <div className="palette-head">
          <span className="palette-target" title={`${isMac ? '⌥' : 'Alt+'}1…9로 대상 패널 바꾸기`}>
            → 패널 {p.num} · {panelCanonical(p, fn) || '빈 패널'}
          </span>
          <CommandLine key={p.id} panelId={p.id} variant="palette" autoFocus onDone={close} />
        </div>
        <div className="palette-foot label">
          {isMac ? '⌥' : 'Alt+'}1…9 대상 패널 바꾸기 · Esc 닫기
        </div>
      </div>
    </div>
  );
}
