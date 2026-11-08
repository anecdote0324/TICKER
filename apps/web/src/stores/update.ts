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
    showToast(`새 버전 v${s.info.version}이 있어요(지금 v${s.current})`, { label: '업데이트', run: () => openSettings('about') }, 15_000);
  }
  return s;
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
