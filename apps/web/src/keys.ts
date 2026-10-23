// 앱 전체 단축키(05 §10). Windows는 메뉴 막대가 없어서 화면 쪽에서 처리해요.
// 떼어낸 창에도 같은 처리기를 붙여요.

import { isMac } from './api';
import { focusRegistry } from './components/focus';
import { activePanelId, navigate, panels } from './stores/panels';
import { openSettings, ui } from './stores/ui';

function focusPanel(id: string) {
  activePanelId.set(id);
  focusRegistry.command.get(id)?.('');
}

export function onGlobalKey(e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const active = activePanelId.get();
  if (mod && !e.shiftKey && (e.key === 'k' || e.code === 'KeyK')) {
    e.preventDefault();
    ui.set((s) => ({ ...s, palette: !s.palette }));
    return;
  }
  if (mod && (e.key === ',' || e.code === 'Comma')) {
    e.preventDefault();
    openSettings();
    return;
  }
  if (mod && !e.shiftKey && (e.key === 'l' || e.code === 'KeyL')) {
    e.preventDefault();
    if (active) focusPanel(active);
    return;
  }
  if (e.key === 'F6') {
    e.preventDefault();
    if (!active) return;
    const inCmd = (e.target as HTMLElement | null)?.closest?.('.cmd');
    if (inCmd) focusRegistry.body.get(active)?.();
    else focusPanel(active);
    return;
  }
  const back = isMac ? e.metaKey && e.key === '[' : e.altKey && e.key === 'ArrowLeft';
  const fwd = isMac ? e.metaKey && e.key === ']' : e.altKey && e.key === 'ArrowRight';
  if ((back || fwd) && active) {
    e.preventDefault();
    navigate(active, back ? 'back' : 'fwd');
    return;
  }
  const list = Object.values(panels.get()).sort((a, b) => a.num - b.num);
  if (e.ctrlKey && e.key === 'Tab' && list.length) {
    e.preventDefault();
    const i = list.findIndex((p) => p.id === active);
    const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
    focusPanel(next.id);
    return;
  }
  if (mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    const n = Number(e.code.slice(5));
    const p = list.find((x) => x.num === n);
    if (p) {
      e.preventDefault();
      focusPanel(p.id);
    }
  }
}

export function attachGlobalKeys(win: Window) {
  win.addEventListener('keydown', onGlobalKey, true);
}
