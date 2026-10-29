// 개발용 실행: 브라우저와 실행 스크립트로 작업할 때 써요(01 실행 방식).
// 화면은 Vite 개발 서버(http://localhost:5173)에서 열고, 이 서버로 /api·/ws를 넘겨요.

import { join, resolve } from 'node:path';
import { startServer } from './index';

const root = resolve(import.meta.dirname, '../../..');
const dataDir = process.env.BT_DATA_DIR ?? join(root, 'data');
const port = Number(process.env.BT_PORT ?? 8787);
const token = process.env.BT_TOKEN; // 없으면 실행할 때마다 새로 만들어요
const webDir = process.env.BT_WEB_DIR;
// pnpm snapshot으로 만든 종목 목록 사본이 있으면 써요
const snapshotFile = process.env.BT_SNAPSHOT ?? join(root, 'apps/desktop/snapshot/instruments.json.gz');

const server = await startServer({
  dataDir,
  port,
  token,
  webDir,
  snapshotFile,
  devOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  // 가짜 한국투자증권 서버로 시험할 때만(두 값을 모두 줘야 해요)
  kisEndpoints: process.env.BT_KIS_REST && process.env.BT_KIS_WS ? { rest: process.env.BT_KIS_REST, ws: process.env.BT_KIS_WS } : undefined,
});

console.info(`데이터 폴더: ${dataDir}`);
console.info(`화면 주소(개발): http://127.0.0.1:5173/#token=${server.token}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
