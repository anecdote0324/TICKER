// 겹침 화면(설정·도움말·팔레트)과 알림

import { createStore } from './store';
import { focusedScreenWindow, screenWindows } from './windows';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const ui = createStore<{
  settings: boolean;
  settingsSection?: string;
  help: 'help' | 'syntax' | 'collisions' | null;
  palette: boolean;
  /** 팔레트·도움말을 그릴 떼어낸 화면 창의 화면 id. 없으면 메인 창 */
  host?: string;
  toast: Toast | null;
}>({ settings: false, help: null, palette: false, toast: null });

/** 팔레트를 열거나 닫아요. 연 창(포커스가 있는 창) 안에 그려요(05 §10.4) */
export function togglePalette() {
  ui.set((s) => (s.palette ? { ...s, palette: false } : { ...s, palette: true, host: focusedScreenWindow() }));
}

/** 도움말을 지금 포커스가 있는 창 안에 열어요 */
export function openHelp(kind: 'help' | 'syntax' | 'collisions') {
  ui.set((s) => ({ ...s, help: kind, host: focusedScreenWindow() }));
}

let toastTimer = 0;
let seq = 0;

export function showToast(text: string, action?: Toast['action'], ms = 6000) {
  window.clearTimeout(toastTimer);
  const id = ++seq;
  ui.set((s) => ({ ...s, toast: { id, text, action } }));
  toastTimer = window.setTimeout(() => ui.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), ms);
}

export function openSettings(section?: string) {
  // 커맨드 라인에서 열었으면 후보 목록이 설정 창 위에 남지 않게 포커스를 빼요
  const from = focusedScreenWindow();
  const doc = from ? screenWindows.get(from)?.document : document;
  (doc?.activeElement as HTMLElement | null)?.blur?.();
  // 설정 창은 메인 창에 떠요. 떼어낸 화면 창에서 열었으면 메인 창을 앞으로 가져와요
  if (from) window.focus();
  ui.set((s) => ({ ...s, settings: true, settingsSection: section, palette: false }));
}
