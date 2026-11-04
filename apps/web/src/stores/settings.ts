// 설정: 바꾸면 바로 적용되고, 모든 패널과 떼어낸 창에 함께 적용돼요(06).

import { DEFAULT_SETTINGS, type Settings } from '@bt/shared';
import { api } from '../api';
import { createStore } from './store';

export const settings = createStore<Settings>(DEFAULT_SETTINGS);

/** 등락 색(02 색): 글로벌식 기본 */
export function applyTheme(s: Settings, doc: Document = document) {
  const root = doc.documentElement;
  const korean = s.display.upDown === 'korean';
  // 글로벌식은 블룸버그의 초록·빨강, 한국식은 빨강 상승·파랑 하락(02 색)
  root.style.setProperty('--up', korean ? '#E8203C' : '#1FBF3F');
  root.style.setProperty('--down', korean ? '#2F7BFF' : '#E8203C');
  root.style.setProperty('--up-bg', korean ? 'rgba(232,32,60,0.32)' : 'rgba(31,191,63,0.3)');
  root.style.setProperty('--down-bg', korean ? 'rgba(47,123,255,0.32)' : 'rgba(232,32,60,0.32)');
  root.style.setProperty('--accent', s.display.accent);
  applyZoom(s.display.fontScale, doc);
}

/**
 * 글자 크기(06): 화면 전체를 같은 배율로 키워요(표·차트·커맨드 라인·떼어낸 창 모두).
 * 데스크톱 앱은 Electron 확대 배율을 모든 창에 걸고, 브라우저(개발용)에서는 CSS zoom으로 대신해요.
 */
function applyZoom(scale: number, doc: Document) {
  const f = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (window.btBridge?.setZoom) {
    window.btBridge.setZoom(f);
    doc.documentElement.style.removeProperty('zoom');
  } else {
    doc.documentElement.style.setProperty('zoom', f === 1 ? '' : String(f));
  }
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
    // 단축키는 통째로 바꿔요(기본값으로 되돌린 키는 빠져야 해서)
    keys: (patch.keys as Settings['keys'] | undefined) ?? cur.keys,
    alerts: { ...DEFAULT_SETTINGS.alerts!, ...cur.alerts, ...patch.alerts },
  };
  settings.set(next);
  applyTheme(next);
  for (const d of popoutDocuments) applyTheme(next, d);
  await api.put('/api/settings', next).catch(() => undefined);
}

/** 떼어낸 창의 문서에도 색을 적용해요 */
export const popoutDocuments = new Set<Document>();
