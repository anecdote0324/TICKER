// docs/design/08-bloomberg-coverage.md §2 표에서 기능 카탈로그를 만들어요.
// 포함·근사로 판정한 코드와 별칭만 넣어요. 커맨드 라인이 아직 만들지 않은 기능도 앞부분 후보로 보여 주는 데 써요(05 §3.3).
// 사용법: node scripts/gen-function-catalog.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'docs/design/08-bloomberg-coverage.md'), 'utf8');

const start = md.indexOf('## 2. 전체 기능 표');
const end = md.indexOf('## 3. 단계별 로드맵');
const body = md.slice(start, end);

const entries = new Map();
let section = '';

for (const line of body.split('\n')) {
  const sec = line.match(/^### (2\.\d+) (.+)$/);
  if (sec) {
    section = sec[2].trim();
    continue;
  }
  if (!line.startsWith('| ') || line.startsWith('| 코드') || line.startsWith('|---')) continue;
  const cols = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cols.length < 6) continue;
  const [codeCol, name, desc, , speed, verdict] = cols;
  const m = verdict.match(/(포함|근사)\s*(v0\.\d+|후순위)/);
  if (!m) continue;
  if (codeCol.startsWith('(')) continue;

  const aliasMatch = codeCol.match(/\(([^)]*) 별칭\)/);
  const aliases = aliasMatch ? aliasMatch[1].split('·').map((s) => s.trim()) : [];
  const head = codeCol.replace(/\(.*\)/, '').trim();
  if (/\s/.test(head)) continue; // 'CRYP 선물 탭', 'PORT HP' 같은 탭은 코드가 아니에요
  const codes = head.split('·').map((s) => s.trim()).filter((s) => /^[A-Z][A-Z0-9]*$/.test(s));
  if (codes.length === 0) continue;

  const version = m[2] === '후순위' ? 'later' : m[2];
  for (const code of codes) {
    if (entries.has(code)) continue;
    entries.set(code, {
      code,
      nameKo: name.replace(/\*\*/g, ''),
      desc: desc === '—' ? '' : desc.replace(/\*\*/g, ''),
      section,
      speed,
      version,
      approx: m[1] === '근사',
      aliases: codes.length === 1 ? aliases.filter((a) => /^[A-Z][A-Z0-9]*$/.test(a)) : [],
    });
  }
}

const list = [...entries.values()];
const out = `// 이 파일은 scripts/gen-function-catalog.mjs가 만들어요. 직접 고치지 말고 08 문서를 고친 뒤 다시 만들어요.

export interface CatalogEntry {
  code: string;
  nameKo: string;
  desc: string;
  section: string;
  speed: string;
  /** 'v0.4' 같은 단계, 'later'는 후순위 */
  version: string;
  approx: boolean;
  aliases: string[];
}

export const FUNCTION_CATALOG: CatalogEntry[] = ${JSON.stringify(list, null, 2)};
`;
writeFileSync(join(root, 'packages/shared/src/function-catalog.generated.ts'), out);
console.log(`기능 ${list.length}개를 썼어요.`);
