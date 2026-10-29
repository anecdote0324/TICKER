import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordingLogger, TimeoutError, withTimeout } from './util';

describe('서버 도우미', () => {
  it('정한 시간 안에 안 끝나면 실패로 봐요', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, '늦어요')).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(1), 20, '늦어요')).resolves.toBe(1);
  });

  it('기록을 메모리와 파일에 남기고, 1MB를 넘으면 넘겨요', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bt-log-'));
    const file = join(dir, 'logs', 'server.log');
    const log = recordingLogger('t', { quiet: true, file });
    log.info('첫 줄');
    log.warn('둘째 줄');
    expect(log.recent().map((l) => l.split('] ')[1])).toEqual(['첫 줄', '둘째 줄']);
    expect(readFileSync(file, 'utf8')).toContain('WARN [t] 둘째 줄');
    // 큰 파일이 있으면 다음 기록 때 server.log.1로 넘겨요
    writeFileSync(file, 'x'.repeat(1_100_000));
    const log2 = recordingLogger('t', { quiet: true, file });
    log2.info('새 파일');
    expect(readFileSync(file, 'utf8').trim().endsWith('새 파일')).toBe(true);
    expect(readFileSync(`${file}.1`, 'utf8').length).toBeGreaterThan(1_000_000);
  });
});
