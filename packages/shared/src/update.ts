// 앱 업데이트(데스크톱): GitHub 공개 저장소의 릴리스에서 이 컴퓨터에 맞는 더 새 버전을 골라요.
// 받기와 설치는 데스크톱 앱(메인 프로세스)이 하고, 여기는 버전 비교와 고르기만 해요.

/** 업데이트를 받는 저장소(공개). 바꾸면 그 저장소의 릴리스를 봐요 */
export const UPDATE_REPO = 'anecdote0324/TICKER';

/** 이 컴퓨터에 맞는 설치 파일 종류 */
export type UpdateTarget = 'win-setup' | 'win-portable' | 'mac-arm64';

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  /** GitHub가 주는 파일 지문('sha256:…'). 예전 파일에는 없을 수 있어요 */
  digest?: string | null;
}

export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  published_at?: string | null;
  body?: string | null;
  assets: ReleaseAsset[];
}

export interface UpdateInfo {
  version: string;
  tag: string;
  prerelease: boolean;
  /** 릴리스 화면(변경 내용) */
  pageUrl: string;
  publishedAt?: string;
  notes?: string;
  asset: { name: string; url: string; size: number; sha256?: string };
}

/** 'v0.5.0-beta.2' → [0,5,0] + ['beta', 2]. 모양이 다르면 undefined */
function parse(v: string): { nums: number[]; pre: Array<string | number> } | undefined {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!m) return undefined;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [] };
}

/** 시맨틱 버전 비교: a가 새 것이면 양수. 정식(0.5.0)이 미리 보기(0.5.0-beta.3)보다 새 것이에요 */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function isPrerelease(v: string): boolean {
  return (parse(v)?.pre.length ?? 0) > 0;
}

/** 릴리스의 파일 중 이 컴퓨터에 맞는 설치 파일(이름은 electron-builder가 만든 모양) */
export function assetFor(release: GithubRelease, target: UpdateTarget): ReleaseAsset | undefined {
  // Mac은 앱이 스스로 바꿔 끼울 수 있는 zip을 먼저, 없으면(예전 릴리스) dmg
  if (target === 'mac-arm64') return release.assets.find((a) => /arm64(-mac)?\.zip$/i.test(a.name)) ?? release.assets.find((a) => /arm64\.dmg$/i.test(a.name));
  const test: Record<Exclude<UpdateTarget, 'mac-arm64'>, (n: string) => boolean> = {
    'win-setup': (n) => /setup.*\.exe$/i.test(n),
    'win-portable': (n) => /\.exe$/i.test(n) && !/setup/i.test(n) && !/uninstall/i.test(n),
  };
  return release.assets.find((a) => test[target](a.name));
}

/**
 * 지금 버전보다 새 버전 중 가장 새 것. 이 컴퓨터용 파일이 있는 릴리스만 봐요(Mac 파일이 없는 릴리스는 건너뛰어요).
 * prerelease가 false면 정식만 봐요. 초안은 보지 않아요
 */
export function pickUpdate(releases: GithubRelease[], current: string, target: UpdateTarget, prerelease: boolean): UpdateInfo | undefined {
  let best: { r: GithubRelease; a: ReleaseAsset; v: string } | undefined;
  for (const r of releases) {
    if (r.draft || (!prerelease && r.prerelease)) continue;
    const v = r.tag_name.replace(/^v/i, '');
    if (!parse(v) || compareVersions(v, current) <= 0) continue;
    // 태그는 정식 모양인데 미리 보기로 올린 경우도 미리 보기로 봐요
    if (!prerelease && isPrerelease(v)) continue;
    const a = assetFor(r, target);
    if (!a) continue;
    if (!best || compareVersions(v, best.v) > 0) best = { r, a, v };
  }
  if (!best) return undefined;
  const sha = best.a.digest?.startsWith('sha256:') ? best.a.digest.slice(7).toLowerCase() : undefined;
  return {
    version: best.v,
    tag: best.r.tag_name,
    prerelease: best.r.prerelease || isPrerelease(best.v),
    pageUrl: best.r.html_url,
    publishedAt: best.r.published_at ?? undefined,
    notes: best.r.body ?? undefined,
    asset: { name: best.a.name, url: best.a.browser_download_url, size: best.a.size, sha256: sha },
  };
}

/** 받은 파일 주소가 그 저장소의 릴리스 파일인지(다른 곳의 파일은 받지 않아요) */
export function isReleaseAssetUrl(url: string, repo = UPDATE_REPO): boolean {
  return url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/releases/download/`);
}

/** 데스크톱 앱이 화면에 알려 주는 업데이트 상태 */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported';
  current: string;
  target?: UpdateTarget;
  info?: UpdateInfo;
  /** 받은 바이트 */
  received?: number;
  /** 받은 파일 위치 */
  file?: string;
  message?: string;
  checkedAt?: number;
  /** 개발판(설치 파일로 깐 앱이 아님): 확인만 하고 받지 않아요 */
  devBuild?: boolean;
  /** 받은 뒤 앱이 알아서 설치하고 다시 켤 수 있는지(Windows 설치형, Mac zip + 응용 프로그램 폴더에 깐 앱) */
  autoInstall?: boolean;
}
