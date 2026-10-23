// 개발용 실행(01 실행 방식): 내장 서버와 화면 개발 서버를 함께 켜고 브라우저를 열어요.
// 실행할 때마다 새 토큰을 만들어 서버와 화면 주소에 넘겨요.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const token = randomBytes(18).toString('base64url');
const env = { ...process.env, BT_TOKEN: token };
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const opts = { env, stdio: 'inherit', shell: process.platform === 'win32' };

const children = [
  spawn(pnpm, ['--filter', '@bt/server', 'dev'], opts),
  spawn(pnpm, ['--filter', '@bt/web', 'dev'], opts),
];

const url = `http://127.0.0.1:5173/#token=${token}`;

async function waitAndOpen() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:5173/');
      if (r.ok) break;
    } catch {
      // 아직 준비 중
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\n화면 주소: ${url}\n`);
  if (process.env.BT_NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => undefined);
}
void waitAndOpen();

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop());
