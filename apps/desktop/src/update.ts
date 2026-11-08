// 앱 업데이트(데스크톱): 공개 GitHub 저장소(UPDATE_REPO)의 릴리스에서 이 컴퓨터에 맞는 새 버전을 찾아 받고 설치를 시작해요.
// - Windows 설치형: 설치 프로그램을 창 없이(/S) 실행하고 앱을 닫아요. 설치가 끝나면 앱이 다시 켜져요(--force-run).
// - Windows 휴대용: 새 휴대용 파일을 지금 파일 옆에 받아 실행하고 앱을 닫아요.
// - Mac: zip을 받아 풀고, 앱이 닫히면 작은 셸 스크립트가 응용 프로그램 폴더의 TICKER.app을 새것으로 바꿔 끼우고 다시 켜요.
//   서명하지 않은 앱이라 Squirrel(electron-updater)은 쓸 수 없어서 직접 바꿔요. 앱이 받은 파일이라 격리 표시가 붙지 않아요.
//   zip이 없는 예전 릴리스이거나 앱을 바꿀 수 없는 곳(dmg 안, 쓰기 막힌 폴더)에서 켰으면 dmg를 열어 주는 예전 방식으로 해요.
// 받은 파일은 GitHub가 준 SHA-256 지문과 크기로 확인하고, 그 저장소의 릴리스 파일 주소만 받아요.

import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { app, net, shell } from 'electron';
import { isReleaseAssetUrl, pickUpdate, UPDATE_REPO, type GithubRelease, type UpdateState, type UpdateTarget } from '@bt/shared';

function detectTarget(): UpdateTarget | undefined {
  // 개발판 시험용: BT_UPDATE_TARGET으로 다른 운영체제의 확인 흐름을 볼 수 있어요(받기는 개발판이라 막혀요)
  const forced = process.env.BT_UPDATE_TARGET;
  if (!app.isPackaged && (forced === 'win-setup' || forced === 'win-portable' || forced === 'mac-arm64')) return forced;
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'win-portable' : 'win-setup';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  return undefined;
}

/** Mac: 지금 켜진 TICKER.app 경로. 바꿔 끼울 수 없는 곳(dmg 안, 앱 격리 경로, 쓰기 막힌 폴더)이면 undefined */
function macBundle(): string | undefined {
  if (process.platform !== 'darwin' || !app.isPackaged) return undefined;
  const bundle = resolve(app.getPath('exe'), '../../..');
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return undefined;
  try {
    accessSync(dirname(bundle), constants.W_OK);
    accessSync(bundle, constants.W_OK);
    return bundle;
  } catch {
    return undefined;
  }
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((ok, fail) => execFile(cmd, args, { timeout: 120_000 }, (e, _out, err) => (e ? fail(new Error(String(err || e.message).trim())) : ok())));

/** 앱이 닫히길 기다렸다가 TICKER.app을 새것으로 바꾸고 다시 켜는 스크립트. 실패하면 예전 앱을 되돌려 놓고 켜요 */
const MAC_SWAP_SCRIPT = `#!/bin/bash
PID="$1"; NEW="$2"; DEST="$3"; LOG="$4"
exec >>"$LOG" 2>&1
echo "[$(date)] 업데이트 시작: $NEW -> $DEST"
for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
rm -rf "$DEST.old"
if mv "$DEST" "$DEST.old" && mv "$NEW" "$DEST"; then
  xattr -cr "$DEST" 2>/dev/null
  rm -rf "$DEST.old"
  echo "[$(date)] 바꿔 끼움"
else
  echo "[$(date)] 실패, 되돌림"
  [ -d "$DEST" ] || mv "$DEST.old" "$DEST"
fi
open "$DEST"
`;

const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'TICKER-app', 'X-GitHub-Api-Version': '2022-11-28' };

export class Updater {
  private state: UpdateState;
  private downloading?: Promise<void>;

  constructor(private log: (msg: string) => void) {
    const target = detectTarget();
    this.state = { phase: target ? 'idle' : 'unsupported', current: app.getVersion(), target, devBuild: !app.isPackaged && !process.env.BT_UPDATE_DEV_DOWNLOAD };
    if (!target) this.state.message = '이 컴퓨터(운영체제·칩)에는 업데이트 파일이 없어요';
  }

  get(): UpdateState {
    return { ...this.state };
  }

  async check(prerelease: boolean): Promise<UpdateState> {
    const target = this.state.target;
    if (!target) return this.get();
    // 받는 중이거나 다 받은 뒤에는 다시 확인하지 않아요
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') return this.get();
    this.state = { ...this.state, phase: 'checking', message: undefined };
    try {
      const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`, { headers: HEADERS });
      if (res.status === 404) throw new Error('업데이트 저장소를 찾을 수 없어요(저장소가 비공개이거나 이름이 바뀌었어요)');
      if (res.status === 403 || res.status === 429) throw new Error('GitHub 확인 한도에 걸렸어요. 한 시간쯤 뒤에 다시 확인해 주세요');
      if (!res.ok) throw new Error(`GitHub가 HTTP ${res.status}로 답했어요`);
      const releases = (await res.json()) as GithubRelease[];
      const info = pickUpdate(releases, this.state.current, target, prerelease);
      const autoInstall = !!info && (target === 'win-setup' || target === 'win-portable' || (/\.zip$/i.test(info.asset.name) && !!macBundle()));
      this.state = { ...this.state, phase: info ? 'available' : 'none', info, autoInstall, checkedAt: Date.now() };
      this.log(`업데이트 확인: 지금 ${this.state.current}, ${info ? `새 버전 ${info.version}` : '최신'}(미리 보기 ${prerelease ? '포함' : '제외'})`);
    } catch (e) {
      this.state = { ...this.state, phase: 'error', message: `업데이트를 확인하지 못했어요: ${(e as Error).message}`, checkedAt: Date.now() };
      this.log(this.state.message!);
    }
    return this.get();
  }

  private saveDir(target: UpdateTarget): string {
    // Mac zip은 임시 폴더에서 풀어 바꿔 끼우고, dmg(예전 방식)는 사용자가 열 수 있게 다운로드 폴더에
    if (target === 'mac-arm64') return /\.zip$/i.test(this.state.info?.asset.name ?? '') ? join(app.getPath('temp'), 'TICKER-update') : app.getPath('downloads');
    if (target === 'win-portable') return process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.env.PORTABLE_EXECUTABLE_FILE ?? app.getPath('downloads'));
    return join(app.getPath('temp'), 'TICKER-update');
  }

  /** 받기 시작(이미 받는 중이면 그대로). 끝나면 phase가 ready예요 */
  download(): UpdateState {
    const info = this.state.info;
    const target = this.state.target;
    if (!info || !target || this.state.phase !== 'available') return this.get();
    if (this.state.devBuild) {
      this.state = { ...this.state, message: '개발판이라 받지 않아요(설치 파일로 깐 앱에서 돼요)' };
      return this.get();
    }
    if (!isReleaseAssetUrl(info.asset.url)) {
      this.state = { ...this.state, phase: 'error', message: '업데이트 파일 주소가 이 앱의 저장소가 아니라서 받지 않았어요' };
      return this.get();
    }
    this.state = { ...this.state, phase: 'downloading', received: 0, message: undefined };
    this.downloading = this.fetchFile(target).finally(() => (this.downloading = undefined));
    return this.get();
  }

  private async fetchFile(target: UpdateTarget) {
    const info = this.state.info!;
    let file = join(this.saveDir(target), info.asset.name);
    try {
      try {
        mkdirSync(dirname(file), { recursive: true });
      } catch {
        // 휴대용 파일 옆에 쓸 수 없으면 다운로드 폴더에
        file = join(app.getPath('downloads'), info.asset.name);
      }
      const res = await net.fetch(info.asset.url, { headers: { 'User-Agent': 'TICKER-app' } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = createHash('sha256');
      let received = 0;
      const out = createWriteStream(file);
      await new Promise<void>((resolve, reject) => {
        const src = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
        src.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          received += chunk.length;
          this.state.received = received;
        });
        src.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        src.pipe(out);
      });
      if (info.asset.size && received !== info.asset.size) throw new Error(`받은 크기가 달라요(${received} / ${info.asset.size}바이트)`);
      const sha = hash.digest('hex');
      if (info.asset.sha256 && sha !== info.asset.sha256) throw new Error('받은 파일의 지문(SHA-256)이 GitHub가 알려 준 것과 달라요');
      this.state = { ...this.state, phase: 'ready', file, received };
      this.log(`업데이트 받음: ${info.asset.name}(${received}바이트, 지문 ${info.asset.sha256 ? '확인' : '없음'})`);
    } catch (e) {
      try {
        rmSync(file, { force: true });
      } catch {
        // 지우지 못해도 다음에 덮어써요
      }
      this.state = { ...this.state, phase: 'available', message: `받지 못했어요: ${(e as Error).message}` };
      this.log(this.state.message!);
    }
  }

  /** 설치 시작. 앱을 닫아야 하면 true(부른 쪽이 닫아요) */
  async install(): Promise<{ ok: boolean; quit: boolean; message?: string }> {
    const { file, target } = this.state;
    if (this.state.phase !== 'ready' || !file || !target) return { ok: false, quit: false, message: '받은 업데이트가 없어요' };
    if (target === 'mac-arm64') {
      const bundle = macBundle();
      if (/\.zip$/i.test(file) && bundle) {
        try {
          // zip을 풀고(ditto는 Mac 앱의 링크·권한을 그대로 풀어요) 앱이 닫히면 스크립트가 바꿔 끼워요
          const dir = join(dirname(file), 'unpacked');
          rmSync(dir, { recursive: true, force: true });
          mkdirSync(dir, { recursive: true });
          await run('/usr/bin/ditto', ['-x', '-k', file, dir]);
          const fresh = join(dir, 'TICKER.app');
          if (!existsSync(join(fresh, 'Contents', 'MacOS'))) throw new Error('zip 안에 TICKER.app이 없어요');
          await run('/usr/bin/xattr', ['-cr', fresh]).catch(() => undefined);
          const script = join(dirname(file), 'swap.sh');
          writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
          const log = join(app.getPath('userData'), 'logs', 'update.log');
          mkdirSync(dirname(log), { recursive: true });
          const child = spawn('/bin/bash', [script, String(process.pid), fresh, bundle, log], { detached: true, stdio: 'ignore' });
          child.on('error', (e) => this.log(`업데이트 스크립트를 실행하지 못했어요: ${e.message}`));
          child.unref();
          this.log(`업데이트: ${bundle}를 새 버전으로 바꿔 끼우고 다시 켜요`);
          return { ok: true, quit: true };
        } catch (e) {
          this.log(`업데이트를 바꿔 끼우지 못했어요: ${(e as Error).message}`);
          return { ok: false, quit: false, message: `자동 설치를 준비하지 못했어요: ${(e as Error).message}` };
        }
      }
      const err = await shell.openPath(file);
      if (err) return { ok: false, quit: false, message: `설치 파일을 열지 못했어요: ${err}` };
      return { ok: true, quit: false, message: '설치 파일을 열었어요. TICKER를 끈 뒤 새 TICKER를 응용 프로그램 폴더로 끌어 덮어써요(응용 프로그램 폴더에서 켠 앱이면 다음부터는 자동으로 돼요)' };
    }
    try {
      // Windows 설치형은 창 없이 설치하고(/S) 끝나면 다시 켜요(--force-run, electron-builder NSIS). 휴대용은 새 파일을 그냥 실행해요
      const args = target === 'win-setup' ? ['/S', '--updated', '--force-run'] : [];
      const child = spawn(file, args, { detached: true, stdio: 'ignore' });
      child.on('error', (e) => this.log(`설치 파일을 실행하지 못했어요: ${e.message}`));
      child.unref();
      this.log(`업데이트 실행: ${file}`);
      return { ok: true, quit: true };
    } catch (e) {
      return { ok: false, quit: false, message: `실행하지 못했어요: ${(e as Error).message}` };
    }
  }

  /** 받은 파일을 폴더에서 보여 줘요(직접 실행하고 싶을 때) */
  reveal() {
    if (this.state.file) shell.showItemInFolder(this.state.file);
  }
}
