// Electron 메인 프로세스(01 앱 형태, 실행과 종료, 멀티 모니터, 보안).
// - 내장 서버를 앱 안에서 실행하고, 화면은 그 서버(127.0.0.1)에서 불러와요.
// - 메인 창을 닫으면 떼어낸 창까지 포함해 앱 전체가 종료돼요. 트레이 상주는 없어요.
// - 앱 아이콘을 또 누르면 두 번째 실행 대신 이미 켜진 창을 앞으로 가져와요.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, safeStorage, screen, shell, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import { startServer, type RunningServer, type SecretBox } from '@bt/server';

// 데이터 폴더 이름을 개발판과 배포판에서 같게(Windows %APPDATA%\Terminal, Mac ~/Library/Application Support/Terminal)
app.setName('Terminal');
const isDev = !app.isPackaged;
let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/** OS 보안 저장소(Windows DPAPI, macOS 키체인)로 앱키를 암호화해요. 쓸 수 없으면 데이터 폴더의 키 파일로 대신해요 */
async function osSecretBox(): Promise<SecretBox | undefined> {
  if (!(await safeStorage.isAsyncEncryptionAvailable().catch(() => false))) return undefined;
  return {
    kind: 'os',
    async encrypt(plain) {
      return (await safeStorage.encryptStringAsync(plain)).toString('base64');
    },
    async decrypt(cipher) {
      return (await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'))).result;
    },
  };
}

// ── 창 위치 기억 ──

const statePath = () => join(app.getPath('userData'), 'window-state.json');

function loadBounds(): (Rectangle & { maximized?: boolean }) | undefined {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return undefined;
  }
}

function saveBounds(win: BrowserWindow) {
  try {
    writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    // 무시
  }
}

/** 모니터가 빠졌으면 사라진 모니터에 있던 창을 메인 모니터로 모아요(01 멀티 모니터) */
function visibleBounds(b: Rectangle): Rectangle {
  const displays = screen.getAllDisplays();
  const onScreen = displays.some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y < a.y + a.height - 50 && b.y + b.height > a.y + 30;
  });
  if (onScreen) return b;
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + 40, y: a.y + 40, width: Math.min(b.width, a.width - 80), height: Math.min(b.height, a.height - 80) };
}

// ── 메뉴와 단축키(05 §10.3) ──

function buildMenu() {
  if (process.platform === 'darwin') {
    // Mac은 복사·붙여넣기·되돌리기가 되도록 App·Edit·Window 역할을 남겨요. 새로고침·개발자 도구는 빼요
    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows는 메뉴 막대를 두지 않아요. Ctrl+R(새로고침)·Ctrl+W(창 닫기)·Ctrl+Shift+I(개발자 도구)도 함께 빠져요
    Menu.setApplicationMenu(null);
  }
}

function attachDevKeys(win: BrowserWindow) {
  // 개발 빌드: 새로고침과 개발자 도구를 다른 키로(F5, F12)
  win.webContents.on('before-input-event', (event, input) => {
    if (!isDev || input.type !== 'keyDown') return;
    if (input.key === 'F5') {
      win.webContents.reload();
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function hardenNavigation(win: BrowserWindow, origin: string) {
  // 앱 화면 밖으로 이동하지 않아요. 외부 링크는 브라우저로 열어요
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(`${origin}/popout.html`) || url.startsWith(`${origin}/`)) {
      // 떼어낸 창(dockview 팝아웃): 같은 출처라 부모 창의 화면 코드가 그대로 그려요
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          title: 'Terminal',
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
        },
      };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.setMenu(null);
    child.setBounds(visibleBounds(child.getBounds()));
    attachDevKeys(child);
  });
}

async function createMainWindow() {
  const saved = loadBounds();
  const bounds = visibleBounds(saved ?? { x: 80, y: 60, width: 1600, height: 960 });
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Terminal',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  attachDevKeys(win);
  hardenNavigation(win, server!.url);
  win.on('close', () => saveBounds(win));
  // 메인 창을 닫으면 떼어낸 창까지 포함해 앱 전체 종료(01)
  win.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  await win.loadURL(`${server!.url}/`);
  // 빌드 검사용: 화면을 찍어 저장하고 끝내요(BT_SMOKE_SHOT=파일 경로)
  const shot = process.env.BT_SMOKE_SHOT;
  if (shot) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      writeFileSync(shot, img.toPNG());
      app.quit();
    }, Number(process.env.BT_SMOKE_WAIT ?? 10_000));
  }
}

ipcMain.on('bt:init', (event) => {
  // 우리 서버에서 불러온 화면에만 토큰을 줘요
  const url = event.senderFrame?.url ?? '';
  const ok = !!server && url.startsWith(server.url);
  event.returnValue = { token: ok ? server!.token : '', version: app.getVersion(), platform: process.platform };
});

ipcMain.on('bt:open-external', (_e, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url);
});

app.whenReady().then(async () => {
  buildMenu();
  const dataDir = join(app.getPath('userData'), 'data');
  const webDir = isDev ? join(__dirname, '../../web/dist') : join(process.resourcesPath, 'web');
  const snapshotFile = isDev ? join(__dirname, '../snapshot/instruments.json.gz') : join(process.resourcesPath, 'snapshot', 'instruments.json.gz');
  server = await startServer({ dataDir, port: 0, webDir, snapshotFile, secretBox: await osSecretBox(), version: app.getVersion() });
  await createMainWindow();
});

app.on('window-all-closed', () => app.quit());

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !server) return;
  // 종료할 때: 실시간 구독 해제, 저장할 것 저장
  e.preventDefault();
  quitting = true;
  void server.close().finally(() => app.quit());
});
