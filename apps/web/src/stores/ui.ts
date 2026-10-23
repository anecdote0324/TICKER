// 겹침 화면(설정·도움말·팔레트)과 알림

import { createStore } from './store';

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
  toast: Toast | null;
}>({ settings: false, help: null, palette: false, toast: null });

let toastTimer = 0;
let seq = 0;

export function showToast(text: string, action?: Toast['action'], ms = 6000) {
  window.clearTimeout(toastTimer);
  const id = ++seq;
  ui.set((s) => ({ ...s, toast: { id, text, action } }));
  toastTimer = window.setTimeout(() => ui.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), ms);
}

export function openSettings(section?: string) {
  ui.set((s) => ({ ...s, settings: true, settingsSection: section, palette: false }));
}
