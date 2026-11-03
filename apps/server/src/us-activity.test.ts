import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Instrument } from '@bt/shared';
import { applyUsBoost, UsActivity } from './us-activity';

describe('미국 종목 인기도 보강', () => {
  it('가장 큰 하루 거래대금을 두고, 100만~100억 달러를 0~1 점수로', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bt-us-'));
    const a = new UsActivity(dir);
    a.record('PLTR', 5e9);
    a.record('PLTR', 1e9); // 더 작으면 그대로
    a.record('TINY', 5e5);
    a.record('X', undefined);
    const s = a.scores();
    expect(s.get('PLTR')).toBeCloseTo((Math.log10(5e9) - 6) / 4, 6);
    expect(s.get('TINY')).toBe(0);
    expect(s.has('X')).toBe(false);
    await a.flush();
    const b = new UsActivity(dir);
    await b.load();
    expect(b.scores().get('PLTR')).toBeCloseTo(s.get('PLTR')!, 6);
  });
  it('인기 목록 밖 종목은 점수만큼 올리고, 이미 높은 종목은 그대로', () => {
    const list: Instrument[] = [
      { id: 'EQ:US:PLTR', assetClass: 'EQUITY', market: 'US', code: 'PLTR', popularity: 0.2 },
      { id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', code: 'AAPL', popularity: 1 },
      { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930', popularity: 0.5 },
    ];
    applyUsBoost(list, new Map([['PLTR', 1], ['AAPL', 0.5], ['005930', 1]]));
    expect(list[0].popularity).toBeCloseTo(0.85, 9);
    expect(list.slice(1).map((i) => i.popularity)).toEqual([1, 0.5]);
  });
});
