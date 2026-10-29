// Electron 메인 프로세스(01 앱 형태, 실행과 종료, 멀티 모니터, 보안).
// - 내장 서버를 앱 안에서 실행하고, 화면은 그 서버(127.0.0.1)에서 불러와요.
// - 메인 창을 닫으면 떼어낸 창까지 포함해 앱 전체가 종료돼요. 트레이 상주는 없어요.
// - 앱 아이콘을 또 누르면 두 번째 실행 대신 이미 켜진 창을 앞으로 가져와요.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, safeStorage, screen, shell, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import { startServer, type RunningServer, type SecretBox } from '@bt/server';

// 데이터 폴더 이름을 개발판과 배포판에서 같게(Windows %APPDATA%\TICKER, Mac ~/Library/Application Support/TICKER)
app.setName('TICKER');
migrateOldUserData();
const isDev = !app.isPackaged;
let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;
/** 떼어낸 창(패널 묶음 창·화면 창). window.open의 이름 → 창 */
const childWindows = new Map<string, BrowserWindow>();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/** 보안 저장소가 이 시간 안에 답하지 않으면 예전 방식(바로 끝나는 API)으로 다시 해요 */
const SECRET_ASYNC_MS = 5000;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`보안 저장소가 ${ms / 1000}초 동안 응답하지 않았어요`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * OS 보안 저장소(Windows DPAPI, macOS 키체인)로 앱키를 암호화해요. 쓸 수 없으면 데이터 폴더의 키 파일로 대신해요.
 * 비동기 API가 답하지 않으면(첫 호출 때 초기화가 끝나지 않는 경우) 같은 저장소의 예전 동기 API로 다시 해요.
 * 동기 API로 암호화한 값은 비동기 API로도 풀 수 있어요(Electron 문서).
 */
async function osSecretBox(): Promise<SecretBox | undefined> {
  // 없다고 답하면 예전처럼 키 파일을 써요. 답이 없을 때만 동기 API로 대신해요(저장 방식이 바뀌면 저장된 키를 못 읽어서)
  const available = await within(safeStorage.isAsyncEncryptionAvailable(), SECRET_ASYNC_MS).catch(() => 'no-answer' as const);
  if (available === false) return undefined;
  const asyncOk = available === true;
  const syncOk = safeStorage.isEncryptionAvailable();
  if (!asyncOk && !syncOk) return undefined;
  const note = (msg: string) => server?.log.warn(msg) ?? console.warn(msg);
  return {
    kind: 'os',
    async encrypt(plain) {
      if (asyncOk) {
        try {
          return (await within(safeStorage.encryptStringAsync(plain), SECRET_ASYNC_MS)).toString('base64');
        } catch (e) {
          if (!syncOk) throw e;
          note(`보안 저장소(비동기) 암호화 실패, 동기 API로 다시 해요: ${(e as Error).message}`);
        }
      }
      return safeStorage.encryptString(plain).toString('base64');
    },
    async decrypt(cipher) {
      const buf = Buffer.from(cipher, 'base64');
      if (asyncOk) {
        try {
          return (await within(safeStorage.decryptStringAsync(buf), SECRET_ASYNC_MS)).result;
        } catch (e) {
          if (!syncOk) throw e;
          note(`보안 저장소(비동기) 복호화 실패, 동기 API로 다시 해요: ${(e as Error).message}`);
        }
      }
      return safeStorage.decryptString(buf);
    },
  };
}

/**
 * 앱 이름을 Terminal에서 TICKER로 바꾸면서(사용자 결정) 예전 데이터 폴더의 설정·키·화면 배치·분봉 이력을 한 번만 옮겨요.
 * Chromium이 새 폴더를 쓰기 전(ready 전)에 해야 해서 맨 처음에 불러요. 'Local State'에는 앱키 암호화 키가 들어 있어요(Windows).
 * Mac은 키체인 항목 이름이 앱 이름을 따라가서 한국투자증권 키를 다시 넣어야 해요. 예전 폴더는 지우지 않아요.
 */
function migrateOldUserData() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = join(app.getPath('appData'), 'Terminal');
    if (existsSync(join(newDir, 'data')) || !existsSync(join(oldDir, 'data'))) return;
    mkdirSync(newDir, { recursive: true });
    cpSync(join(oldDir, 'data'), join(newDir, 'data'), { recursive: true });
    for (const f of ['window-state.json', 'Local State']) {
      if (existsSync(join(oldDir, f))) cpSync(join(oldDir, f), join(newDir, f));
    }
  } catch {
    // 옮기지 못하면 새로 시작해요
  }
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
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' || url.startsWith(`${origin}/popout.html`) || url.startsWith(`${origin}/`)) {
      // 떼어낸 창(dockview 팝아웃, 화면 탭을 통째로 떼어낸 창): 같은 출처라 부모 창의 화면 코드가 그대로 그려요
      const screen = frameName.startsWith('ticker-screen-');
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          title: 'TICKER',
          ...(screen ? { minWidth: 640, minHeight: 400 } : {}),
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
        },
      };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child, details) => {
    // 전체 화면 단축키가 어느 창의 것인지 창 이름(window.open의 이름)으로 찾아요
    if (details.frameName) {
      const name = details.frameName;
      childWindows.set(name, child);
      child.on('closed', () => childWindows.get(name) === child && childWindows.delete(name));
    }
    child.setMenu(null);
    child.webContents.setZoomFactor(zoomFactor);
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
    title: 'TICKER',
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

// 글자 크기 설정(06): 모든 창(떼어낸 창 포함)에 같은 확대 배율
let zoomFactor = 1;
ipcMain.on('bt:zoom', (event, factor: unknown) => {
  if (!server || !(event.senderFrame?.url ?? '').startsWith(server.url)) return;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0.5 || factor > 2) return;
  zoomFactor = factor;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(factor);
});

// 전체 화면(Windows F11, Mac ⌃⌘F, 06 단축키): 단축키를 누른 그 창만. 메인 창이 F11을 메뉴로 받지 않아서(Windows는 메뉴 막대 없음) 화면이 알려 줘요
ipcMain.handle('bt:fullscreen', (event, name: unknown) => {
  if (!server || !(event.senderFrame?.url ?? '').startsWith(server.url)) return false;
  const target = (typeof name === 'string' && name && childWindows.get(name)) || BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return false;
  target.setFullScreen(!target.isFullScreen());
  return target.isFullScreen();
});

ipcMain.on('bt:open-external', (_e, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url);
});

app.whenReady().then(async () => {
  buildMenu();
  const dataDir = join(app.getPath('userData'), 'data');
  const webDir = isDev ? join(__dirname, '../../web/dist') : join(process.resourcesPath, 'web');
  const snapshotFile = isDev ? join(__dirname, '../snapshot/instruments.json.gz') : join(process.resourcesPath, 'snapshot', 'instruments.json.gz');
  // 가짜 한국투자증권 서버로 시험할 때만(개발판에서 BT_KIS_REST·BT_KIS_WS를 둘 다 줄 때). 배포판은 늘 실제 주소예요
  const kisEndpoints = isDev && process.env.BT_KIS_REST && process.env.BT_KIS_WS ? { rest: process.env.BT_KIS_REST, ws: process.env.BT_KIS_WS } : undefined;
  // 서버 기록은 데이터 폴더의 logs/server.log에 남겨요(설정 → 정보 → 진단 정보 복사). 키·토큰은 남기지 않아요
  const logFile = join(app.getPath('userData'), 'logs', 'server.log');
  server = await startServer({ dataDir, port: 0, webDir, snapshotFile, secretBox: await osSecretBox(), version: app.getVersion(), kisEndpoints, logFile });
  // 메인 프로세스에서 놓친 오류는 오류 창을 띄우는 대신 기록하고 계속 돌아가요(오류 창이 떠 있는 동안 서버가 멈춰요)
  process.on('uncaughtException', (e) => server?.log.error(`처리하지 못한 오류: ${e.stack ?? e.message}`));
  process.on('unhandledRejection', (e) => server?.log.error(`처리하지 못한 약속 거절: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
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
