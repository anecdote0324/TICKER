// 앱 업데이트(데스크톱): 공개 GitHub 저장소(UPDATE_REPO)의 릴리스에서 이 컴퓨터에 맞는 새 버전을 찾아 받고 설치를 시작해요.
// - Windows 설치형: 설치 프로그램을 받아 실행하고 앱을 닫아요(설치 프로그램이 끝나면 다시 켤 수 있어요).
// - Windows 휴대용: 새 휴대용 파일을 지금 파일 옆에 받아 실행하고 앱을 닫아요.
// - Mac: dmg를 다운로드 폴더에 받아 열어요. 앱을 끄고 응용 프로그램 폴더로 끌어 덮어써요(서명이 없어서 자동 교체는 못 해요).
// 받은 파일은 GitHub가 준 SHA-256 지문과 크기로 확인하고, 그 저장소의 릴리스 파일 주소만 받아요.

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
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
      this.state = { ...this.state, phase: info ? 'available' : 'none', info, checkedAt: Date.now() };
      this.log(`업데이트 확인: 지금 ${this.state.current}, ${info ? `새 버전 ${info.version}` : '최신'}(미리 보기 ${prerelease ? '포함' : '제외'})`);
    } catch (e) {
      this.state = { ...this.state, phase: 'error', message: `업데이트를 확인하지 못했어요: ${(e as Error).message}`, checkedAt: Date.now() };
      this.log(this.state.message!);
    }
    return this.get();
  }

  private saveDir(target: UpdateTarget): string {
    if (target === 'mac-arm64') return app.getPath('downloads');
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
      const err = await shell.openPath(file);
      if (err) return { ok: false, quit: false, message: `dmg를 열지 못했어요: ${err}` };
      return { ok: true, quit: false, message: 'dmg를 열었어요. TICKER를 끈 뒤 새 TICKER를 응용 프로그램 폴더로 끌어 덮어써요' };
    }
    try {
      // 설치 프로그램(또는 새 휴대용 파일)을 앱과 따로 실행하고 앱은 닫아요
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
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
