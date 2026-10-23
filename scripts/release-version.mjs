// 릴리스 버전 번호를 정해요. package.json의 version은 손으로 올리지 않아요.
// - 태그를 올렸거나(v0.1.0) 태그를 직접 넣었으면 그 태그를 써요.
// - Actions에서 Release를 직접 실행하면서 종류만 고르면, 지난 태그를 보고 다음 번호를 자동으로 정해요(BUMP).
//   미리 보기: 0.1.0-beta.2 → 0.1.0-beta.3, 0.1.0 → 0.1.1-beta.1
//   정식: 0.1.0-beta.3 → 0.1.0, 0.1.0 → 0.1.1
//   다음 단계: 0.1.x → 0.2.0-beta.1
// - 아무것도 없으면(로컬 빌드) apps/desktop/package.json의 값을 쓰고 릴리스는 올리지 않아요.
// GitHub Actions에서는 결과를 GITHUB_OUTPUT의 version·prerelease·tag·publish로 넘겨요.
//
// 사용법: node scripts/release-version.mjs [태그]   (BUMP=미리 보기|정식|다음 단계)

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;

/** 'v0.1.0' → { version: '0.1.0', prerelease: false }, 'v0.2.0-beta.1' → 미리 보기 */
export function versionFromTag(tag) {
  const m = TAG_RE.exec(tag);
  if (!m) throw new Error(`태그 '${tag}'는 v0.1.0 또는 v0.2.0-beta.1 같은 형식이어야 해요`);
  return { version: tag.slice(1), prerelease: m[4] !== undefined };
}

/** 'v0.1.0-beta.2' → 비교할 수 있는 숫자들. beta가 아닌 미리 보기 이름은 0번으로 봐요 */
function parse(tag) {
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  const pre = m[4] === undefined ? null : Number(/^beta\.(\d+)$/.exec(m[4])?.[1] ?? 0);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre };
}

function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // 같은 번호면 미리 보기가 정식보다 앞이에요(0.1.0-beta.3 < 0.1.0)
  if (a.pre === null || b.pre === null) return (a.pre === null ? 1 : 0) - (b.pre === null ? 1 : 0);
  return a.pre - b.pre;
}

/** 종류 이름(Actions 화면의 선택지)을 안쪽 이름으로 */
export function bumpKind(label) {
  const s = (label ?? '').trim();
  if (s.startsWith('미리 보기') || s === 'beta') return 'beta';
  if (s.startsWith('정식') || s === 'release') return 'release';
  if (s.startsWith('다음 단계') || s === 'stage') return 'stage';
  return null;
}

/** 지난 태그들을 보고 다음 버전 번호를 정해요 */
export function nextVersion(tags, kind) {
  const all = tags.map(parse).filter(Boolean).sort(compare);
  const last = all[all.length - 1] ?? { major: 0, minor: 1, patch: 0, pre: 0 };
  const { major, minor, patch, pre } = last;
  let version;
  if (kind === 'beta') version = pre !== null ? `${major}.${minor}.${patch}-beta.${pre + 1}` : `${major}.${minor}.${patch + 1}-beta.1`;
  else if (kind === 'release') version = pre !== null ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
  else if (kind === 'stage') version = `${major}.${minor + 1}.0-beta.1`;
  else throw new Error(`알 수 없는 종류: ${kind}`);
  return versionFromTag(`v${version}`);
}

function defaultVersion() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version;
}

function gitTags() {
  return execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
}

// 직접 실행했을 때만(테스트에서 불러올 때는 실행하지 않아요). Windows 경로 대소문자 차이를 피하려고 파일 이름으로 봐요
if (/release-version\.mjs$/.test(process.argv[1] ?? '')) {
  const tag = process.argv[2] || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  const kind = bumpKind(process.env.BUMP);
  let result;
  let publish = true;
  try {
    if (tag) result = versionFromTag(tag);
    else if (kind) result = nextVersion(gitTags(), kind);
    else {
      result = { version: defaultVersion(), prerelease: false };
      publish = false;
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`버전 ${result.version}${result.prerelease ? ' (미리 보기)' : ''}${publish ? '' : ' · 릴리스는 올리지 않아요'}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\ntag=v${result.version}\npublish=${publish}\n`);
  }
}
