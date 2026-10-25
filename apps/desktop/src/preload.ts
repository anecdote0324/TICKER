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
});
