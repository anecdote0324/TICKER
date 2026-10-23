// 설치 파일에 넣을 종목 목록 사본을 만들어요(05 §6.1). 첫 실행 때 인터넷이 없어도 종목 검색이 되게 해요.
// 사본은 내려받은 데이터라 저장소에 올리지 않아요. 설치 파일을 만들 때(pnpm snapshot) 새로 만들어요.
//
// 사용법: tsx src/snapshot.ts <출력 파일(.json.gz)>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BinanceAdapter } from './adapters/binance';
import { encodeSnapshot, buildInstruments } from './instruments';
import { consoleLogger } from './util';

const out = process.argv[2];
if (!out) {
  console.error('출력 파일을 넣어 주세요. 예: tsx src/snapshot.ts ../desktop/snapshot/instruments.json.gz');
  process.exit(1);
}

const log = consoleLogger('snapshot');
const dir = await mkdtemp(join(tmpdir(), 'bt-snapshot-'));
const binance = new BinanceAdapter({ emitQuote: () => undefined, emitStatus: () => undefined, log });
try {
  const r = await buildInstruments(dir, binance, log);
  const failed = r.sources.filter((s) => s.error);
  for (const s of failed) log.warn(`${s.name}: ${s.error}`);
  const fetched = r.sources.filter((s) => !s.error && s.name !== '지수·환율 목록').length;
  if (fetched === 0) {
    log.error('받은 종목 목록이 없어서 사본을 만들지 않았어요');
    process.exit(1);
  }
  const path = resolve(out);
  await mkdir(dirname(path), { recursive: true });
  const buf = encodeSnapshot(r);
  await writeFile(path, buf);
  log.info(`종목 목록 사본: ${path} (${r.instruments.length}개, ${(buf.length / 1024).toFixed(0)}KB${failed.length ? `, 받지 못한 소스 ${failed.length}개` : ''})`);
} finally {
  binance.stop();
  await rm(dir, { recursive: true, force: true });
}
