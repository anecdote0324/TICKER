// 앱 업데이트(데스크톱): 켤 때(20초 뒤)와 6시간마다 새 버전을 확인하고, 있으면 알림으로 알려요.
// 확인·받기·설치는 데스크톱 앱(메인 프로세스)이 하고, 화면은 상태를 보여 주고 단추를 줘요(설정 → 정보).

import { useEffect } from 'react';
import { isPrerelease, type UpdateState } from '@bt/shared';
import { settings } from './settings';
import { createStore } from './store';
import { openSettings, showToast } from './ui';

export const updateState = createStore<UpdateState | null>(null);

const AUTO_FIRST_MS = 20_000;
const AUTO_EVERY_MS = 6 * 3600_000;

/** 미리 보기 버전도 받을지: 설정에서 정하지 않았으면 지금 버전이 미리 보기일 때만 */
export function wantPrerelease(current: string | undefined): boolean {
  const p = settings.get().updates?.prerelease;
  return p ?? (current ? isPrerelease(current) : false);
}

export async function refreshUpdateState(): Promise<UpdateState | null> {
  const s = (await window.btBridge?.update?.state()) ?? null;
  updateState.set(s);
  return s;
}

export async function checkUpdate(manual: boolean): Promise<UpdateState | null> {
  const u = window.btBridge?.update;
  if (!u) return null;
  const cur = updateState.get()?.current ?? window.btBridge?.version;
  const s = (await u.check(wantPrerelease(cur))) ?? null;
  updateState.set(s);
  if (!manual && s?.phase === 'available' && s.info && s.info.version !== settings.get().updates?.skipped) {
    if (s.autoInstall && !s.devBuild) {
      // 보통 프로그램처럼 뒤에서 받아 두고, 다 받으면 다시 시작해서 업데이트할지 물어요
      void downloadInBackground();
    } else {
      showToast(`새 버전 v${s.info.version}이 있어요(지금 v${s.current})`, { label: '업데이트', run: () => openSettings('about') }, 15_000);
    }
  }
  return s;
}

/** 받기가 끝날 때까지 0.5초마다 상태를 물어요 */
async function waitDownloaded(): Promise<UpdateState | null> {
  for (;;) {
    const s = await refreshUpdateState();
    if (!s || s.phase !== 'downloading') return s;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function downloadInBackground() {
  const u = window.btBridge?.update;
  if (!u) return;
  updateState.set((await u.download()) ?? null);
  const s = await waitDownloaded();
  if (s?.phase === 'ready' && s.info) {
    showToast(`v${s.info.version} 업데이트를 받았어요. 다시 시작하면 설치돼요`, { label: '다시 시작해서 업데이트', run: () => void installUpdate() }, 60_000);
  }
}

/** 설치 시작(받은 뒤). 앱이 알아서 설치하고 다시 켜면 곧 닫혀요 */
export async function installUpdate(): Promise<{ ok: boolean; message?: string }> {
  const u = window.btBridge?.update;
  if (!u) return { ok: false, message: '데스크톱 앱에서만 돼요' };
  const r = await u.install();
  if (r.ok && r.quit) showToast('업데이트를 설치하고 다시 켜요…', undefined, 30_000);
  else if (r.message) showToast(r.message, undefined, 15_000);
  return r;
}

/** 단추 한 번: 받기 → (다 받으면) 설치하고 다시 시작 */
export async function updateNow(): Promise<{ ok: boolean; message?: string }> {
  const u = window.btBridge?.update;
  if (!u) return { ok: false, message: '데스크톱 앱에서만 돼요' };
  let s = updateState.get();
  if (s?.phase === 'available') {
    updateState.set((await u.download()) ?? null);
    s = await waitDownloaded();
  } else if (s?.phase === 'downloading') s = await waitDownloaded();
  if (s?.phase !== 'ready') return { ok: false, message: s?.message ?? '업데이트를 받지 못했어요' };
  return installUpdate();
}

/** 앱 전체에서 한 번: 자동 확인 */
export function useUpdateWatcher() {
  useEffect(() => {
    if (!window.btBridge?.update) return;
    void refreshUpdateState();
    const run = () => {
      if (settings.get().updates?.autoCheck !== false) void checkUpdate(false);
    };
    const first = window.setTimeout(run, AUTO_FIRST_MS);
    const every = window.setInterval(run, AUTO_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);
}
