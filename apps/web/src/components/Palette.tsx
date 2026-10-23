// 명령 팔레트(Ctrl+K): 같은 엔진이에요. 대상은 팔레트를 연 그 창의 활성 패널이에요(05 §10.4).

import { FUNCTIONS } from '@bt/shared';
import { activePanelId, panelCanonical, panels } from '../stores/panels';
import { useStore } from '../stores/store';
import { ui } from '../stores/ui';
import { CommandLine } from './CommandLine';

export function Palette() {
  const id = useStore(activePanelId);
  const p = useStore(panels, (all) => (id ? all[id] : undefined));
  const close = () => ui.set((s) => ({ ...s, palette: false }));
  if (!p) return null;
  const fn = FUNCTIONS.find((f) => f.code === p.fn);
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="palette-target">
            → 패널 {p.num} · {panelCanonical(p, fn) || '빈 패널'}
          </span>
          <CommandLine panelId={p.id} variant="palette" autoFocus onDone={close} />
        </div>
      </div>
    </div>
  );
}
