// 설정: 바꾸면 바로 적용되고, 모든 패널과 떼어낸 창에 함께 적용돼요(06).

import { DEFAULT_SETTINGS, type Settings } from '@bt/shared';
import { api } from '../api';
import { createStore } from './store';

export const settings = createStore<Settings>(DEFAULT_SETTINGS);

/** 등락 색(02 색): 글로벌식 기본 */
export function applyTheme(s: Settings, doc: Document = document) {
  const root = doc.documentElement;
  const korean = s.display.upDown === 'korean';
  root.style.setProperty('--up', korean ? '#FF5F57' : '#3FD08A');
  root.style.setProperty('--down', korean ? '#4C9AFF' : '#FF5F57');
  root.style.setProperty('--up-bg', korean ? 'rgba(255,95,87,0.28)' : 'rgba(63,208,138,0.24)');
  root.style.setProperty('--down-bg', korean ? 'rgba(76,154,255,0.28)' : 'rgba(255,95,87,0.26)');
  root.style.setProperty('--accent', s.display.accent);
  root.style.setProperty('--scale', String(s.display.fontScale));
}

export async function loadSettings() {
  try {
    const s = await api.get<Settings>('/api/settings');
    settings.set(s);
  } catch {
    // 기본값
  }
  applyTheme(settings.get());
}

type Patch = { [K in keyof Settings]?: Partial<Settings[K]> };

export async function updateSettings(patch: Patch) {
  const cur = settings.get();
  const next: Settings = {
    general: { ...cur.general, ...patch.general },
    display: { ...cur.display, ...patch.display },
    commandLine: { ...cur.commandLine, ...patch.commandLine },
    data: { ...cur.data, ...patch.data },
  };
  settings.set(next);
  applyTheme(next);
  for (const d of popoutDocuments) applyTheme(next, d);
  await api.put('/api/settings', next).catch(() => undefined);
}

/** 떼어낸 창의 문서에도 색을 적용해요 */
export const popoutDocuments = new Set<Document>();
