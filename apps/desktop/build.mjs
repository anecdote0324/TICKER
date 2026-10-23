// 메인 프로세스와 preload를 하나씩 묶어요. 내장 서버와 의존성까지 함께 묶어서 배포판에 node_modules가 필요 없어요.

import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, external: ['electron'], logLevel: 'warning' };

await build({ ...common, entryPoints: [join(here, 'src/main.ts')], outfile: join(here, 'dist/main.cjs') });
await build({ ...common, entryPoints: [join(here, 'src/preload.ts')], outfile: join(here, 'dist/preload.cjs') });

// 화면 파일을 배포판 자원으로 복사해요
const webDist = join(here, '../web/dist');
const webOut = join(here, 'web');
if (existsSync(webDist)) {
  rmSync(webOut, { recursive: true, force: true });
  cpSync(webDist, webOut, { recursive: true });
}
console.log('desktop build done');
