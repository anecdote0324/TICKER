// 앱 전체 단축키(05 §10). Windows는 메뉴 막대가 없어서 화면 쪽에서 처리해요.
// 떼어낸 창에도 같은 처리기를 붙여요. 키는 설정에서 바꿀 수 있어요(06 단축키).

import { bindingsFor, formatBinding, matchesShortcut, type KeyLike, type ShortcutId } from '@bt/shared';
import { isMac } from './api';
import { focusRegistry } from './components/focus';
import { activePanelId, navigate, panels } from './stores/panels';
import { settings } from './stores/settings';
import { openSettings, showToast, togglePalette } from './stores/ui';

/** 설정에서 바꾼 키를 반영한 단축키 판정 */
export function isShortcut(e: KeyLike, id: ShortcutId): boolean {
  return matchesShortcut(e, id, settings.get().keys, isMac);
}

/** 안내 문구에 쓰는 단축키 이름(바꾼 키 반영). 없으면 빈 문자열 */
export function shortcutLabel(id: ShortcutId): string {
  const b = bindingsFor(id, settings.get().keys, isMac)[0];
  return b ? formatBinding(b, isMac) : '';
}

/** 단축키를 받는 중(설정 창)에는 앱 단축키를 멈춰요 */
export const keyCapture = { active: false };

/**
 * 전체 화면(Windows F11, Mac ⌃⌘F): 단축키를 누른 그 창만 바꿔요(메인 창 또는 떼어낸 창).
 * 데스크톱 앱은 메인 프로세스가 창 이름으로 찾아 바꾸고, 브라우저(개발용)에서는 화면 전체 API를 써요.
 */
async function toggleFullScreen(view: Window) {
  const isMain = view === window;
  let on = false;
  try {
    if (window.btBridge?.toggleFullScreen) on = await window.btBridge.toggleFullScreen(isMain ? '' : view.name);
    else {
      const doc = view.document;
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await doc.documentElement.requestFullscreen();
      on = !!doc.fullscreenElement;
    }
  } catch {
    return;
  }
  // 알림은 메인 창에 떠요. 떼어낸 창이면 그 창에서는 보이지 않아서 띄우지 않아요
  if (on && isMain) showToast(`전체 화면이에요 · ${shortcutLabel('fullscreen')}로 나가요`, undefined, 3000);
}

function focusPanel(id: string) {
  activePanelId.set(id);
  focusRegistry.command.get(id)?.('');
}

export function onGlobalKey(e: KeyboardEvent) {
  if (keyCapture.active) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const active = activePanelId.get();
  if (isShortcut(e, 'palette')) {
    e.preventDefault();
    togglePalette();
    return;
  }
  if (isShortcut(e, 'settings')) {
    e.preventDefault();
    openSettings();
    return;
  }
  if (isShortcut(e, 'fullscreen')) {
    e.preventDefault();
    void toggleFullScreen((e.view as Window | null) ?? window);
    return;
  }
  if (isShortcut(e, 'focusCommand')) {
    e.preventDefault();
    if (active) focusPanel(active);
    return;
  }
  if (isShortcut(e, 'toggleFocus')) {
    e.preventDefault();
    if (!active) return;
    const inCmd = (e.target as HTMLElement | null)?.closest?.('.cmd');
    if (inCmd) focusRegistry.body.get(active)?.();
    else focusPanel(active);
    return;
  }
  const back = isShortcut(e, 'back');
  const fwd = !back && isShortcut(e, 'forward');
  if ((back || fwd) && active) {
    e.preventDefault();
    navigate(active, back ? 'back' : 'fwd');
    return;
  }
  const list = Object.values(panels.get()).sort((a, b) => a.num - b.num);
  const nextPanel = isShortcut(e, 'nextPanel');
  const prevPanel = !nextPanel && isShortcut(e, 'prevPanel');
  if ((nextPanel || prevPanel) && list.length) {
    e.preventDefault();
    const i = list.findIndex((p) => p.id === active);
    const next = list[(i + (prevPanel ? -1 : 1) + list.length) % list.length];
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
