// 릴리스 버전 번호는 태그에서 가져와요(v0.1.0 → 0.1.0). package.json의 version을 손으로 올리지 않아요.
// 태그가 아닌 실행(수동 실행, 로컬 빌드)에서는 apps/desktop/package.json의 값을 써요.
// GitHub Actions에서는 결과를 GITHUB_OUTPUT의 version·prerelease로 넘겨요.
//
// 사용법: node scripts/release-version.mjs [태그]

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

function defaultVersion() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version;
}

// 직접 실행했을 때만(테스트에서 불러올 때는 실행하지 않아요). Windows 경로 대소문자 차이를 피하려고 파일 이름으로 봐요
if (/release-version\.mjs$/.test(process.argv[1] ?? '')) {
  const tag = process.argv[2] ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  let result;
  try {
    result = tag ? versionFromTag(tag) : { version: defaultVersion(), prerelease: false };
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`버전 ${result.version}${result.prerelease ? ' (미리 보기)' : ''}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`);
  }
}
