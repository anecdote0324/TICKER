// preload: 화면에는 토큰과 몇 가지 정보만 넘겨요. Node 기능은 화면에 열지 않아요(contextIsolation, sandbox).

import { contextBridge, ipcRenderer } from 'electron';

const init = ipcRenderer.sendSync('bt:init') as { token: string; version: string; platform: string };

contextBridge.exposeInMainWorld('btBridge', {
  token: init.token,
  platform: init.platform,
  version: init.version,
  openExternal: (url: string) => ipcRenderer.send('bt:open-external', url),
  setZoom: (factor: number) => ipcRenderer.send('bt:zoom', factor),
  // 이름이 name인 떼어낸 창(빈 이름은 메인 창)을 전체 화면으로 바꾸거나 되돌려요. 바뀐 뒤 전체 화면인지 돌려줘요
  toggleFullScreen: (name: string) => ipcRenderer.invoke('bt:fullscreen', name) as Promise<boolean>,
  // GRAB(v0.5): 이름이 name인 창(빈 이름은 메인 창)의 rect(CSS 픽셀) 부분을 찍어 클립보드에 넣어요. 마지막으로 찍은 그림을 파일로 저장할 수도 있어요
  capture: (name: string, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('bt:capture', name, rect) as Promise<{ ok: boolean; message?: string }>,
  // 앱 업데이트(update.ts): 상태, 확인(미리 보기 포함 여부), 받기, 설치 시작, 받은 파일 보기
  update: {
    state: () => ipcRenderer.invoke('bt:update-state'),
    check: (prerelease: boolean) => ipcRenderer.invoke('bt:update-check', prerelease),
    download: () => ipcRenderer.invoke('bt:update-download'),
    install: () => ipcRenderer.invoke('bt:update-install'),
    reveal: () => ipcRenderer.invoke('bt:update-reveal'),
  },
  saveCapture: (fileName: string) => ipcRenderer.invoke('bt:save-capture', fileName) as Promise<{ ok: boolean; path?: string; message?: string }>,
});
