import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instrument } from '@bt/shared';
import type { BinanceAdapter } from './adapters/binance';
import { buildInstruments, encodeSnapshot } from './instruments';
import { consoleLogger } from './util';

const offlineBinance = { tickers24h: async () => Promise.reject(new Error('offline')) } as unknown as BinanceAdapter;

const SNAP: Instrument[] = [
  { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930', nameKo: '삼성전자' },
  { id: 'EQ:KQ:247540', assetClass: 'EQUITY', market: 'KQ', code: '247540', nameKo: '에코프로비엠' },
  { id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', exchange: 'NAS', code: 'AAPL', nameEn: 'APPLE INC' },
  { id: 'CRY:BTC', assetClass: 'CRYPTO', code: 'BTC', nameKo: '비트코인' },
];

afterEach(() => vi.unstubAllGlobals());

describe('종목 목록 사본', () => {
  it('첫 실행에 인터넷이 없으면 받지 못한 소스를 사본으로 대신해요', async () => {
    vi.stubGlobal('fetch', async () => Promise.reject(new Error('offline')));
    const dir = await mkdtemp(join(tmpdir(), 'bt-inst-'));
    const snapFile = join(dir, 'instruments.json.gz');
    await writeFile(snapFile, encodeSnapshot({ instruments: SNAP, builtAt: Date.parse('2026-10-20T00:00:00Z'), sources: [] }));
    const r = await buildInstruments(join(dir, 'data'), offlineBinance, consoleLogger('test', true), snapFile);
    const ids = r.instruments.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['EQ:KS:005930', 'EQ:KQ:247540', 'EQ:US:AAPL', 'CRY:BTC', 'IDX:KOSPI']));
    const kospi = r.sources.find((s) => s.name.startsWith('kospi'))!;
    expect(kospi).toMatchObject({ count: 1, snapshot: true, asOf: '2026-10-20' });
    expect(r.sources.find((s) => s.name.startsWith('amsmst'))).toMatchObject({ count: 0 });
  });

  it('사본도 없으면 정해 둔 지수·환율과 주요 코인만', async () => {
    vi.stubGlobal('fetch', async () => Promise.reject(new Error('offline')));
    const dir = await mkdtemp(join(tmpdir(), 'bt-inst-'));
    const r = await buildInstruments(join(dir, 'data'), offlineBinance, consoleLogger('test', true), join(dir, 'none.json.gz'));
    expect(r.instruments.some((i) => i.assetClass === 'EQUITY')).toBe(false);
    expect(r.instruments.some((i) => i.id === 'CRY:BTC')).toBe(true);
  });
});
