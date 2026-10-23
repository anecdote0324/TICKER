// preload: 화면에는 토큰과 몇 가지 정보만 넘겨요. Node 기능은 화면에 열지 않아요(contextIsolation, sandbox).

import { contextBridge, ipcRenderer } from 'electron';

const init = ipcRenderer.sendSync('bt:init') as { token: string; version: string; platform: string };

contextBridge.exposeInMainWorld('btBridge', {
  token: init.token,
  platform: init.platform,
  version: init.version,
  openExternal: (url: string) => ipcRenderer.send('bt:open-external', url),
});
