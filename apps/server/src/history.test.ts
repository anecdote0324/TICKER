import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bar, Freshness, Instrument, Quote } from '@bt/shared';
import type { Adapter } from './adapters/types';
import { History, mergeBars } from './history';
import { Hub } from './hub';
import { consoleLogger } from './util';

async function tmpHistory() {
  const dir = await mkdtemp(join(tmpdir(), 'bt-history-'));
  return { file: join(dir, 'history.db'), history: new History(join(dir, 'history.db')) };
}

const MIN = 60_000;
/** 가장 최근 평일 오전 10시(한국 시간). 분봉은 장중 봉만 보여 줘서 시험 시각을 국내 장중으로 잡아요 */
function lastKrMorning(now = Date.now()): number {
  const KST = 9 * 3600_000;
  for (let back = 0; ; back++) {
    const d = new Date(now + KST - back * 86400_000);
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10) - KST;
    const wd = new Date(at + KST).getUTCDay();
    if (at <= now - 10 * MIN && wd !== 0 && wd !== 6) return at;
  }
}
const base = lastKrMorning();

function quote(id: string, last: number, at: number, volume?: number, fresh: Partial<Freshness> = {}): Quote {
  return { id, last, volume, fresh: { source: 'KIS', mode: 'realtime', asOf: at, receivedAt: at, ...fresh } };
}

const bar = (t: number, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 1 });

describe('분봉·이력 저장', () => {
  it('받은 봉을 저장하고 다시 열어도 남아 있어요', async () => {
    const { file, history } = await tmpHistory();
    history.save('EQ:KS:005930', '1d', [bar(1000, 1), bar(2000, 2)]);
    history.close();
    const again = new History(file);
    expect(again.load('EQ:KS:005930', '1d').bars.map((b) => b.c)).toEqual([1, 2]);
    again.close();
  });

  it('시세로 1분봉을 만들고, 끝낼 때 만들고 있던 분봉까지 저장해요', async () => {
    const { file, history } = await tmpHistory();
    const id = 'EQ:KS:005930';
    history.onQuote(quote(id, 100, base + 1000, 10));
    history.onQuote(quote(id, 105, base + 20_000, 15));
    history.onQuote(quote(id, 98, base + 40_000, 18));
    history.onQuote(quote(id, 101, base + MIN + 1000, 20)); // 다음 분
    history.close();
    const bars = new History(file).load(id, '1m').bars;
    expect(bars).toEqual([
      { t: base / 1000, o: 100, h: 105, l: 98, c: 98, v: 8 },
      { t: base / 1000 + 60, o: 101, h: 101, l: 101, c: 101, v: 0 },
    ]);
  });

  it('데모 값과 하루 한 번 값은 분봉으로 저장하지 않아요', async () => {
    const { file, history } = await tmpHistory();
    history.onQuote(quote('EQ:KS:005930', 100, base, 1, { source: 'DEMO', mode: 'demo' }));
    history.onQuote(quote('FX:USDKRW', 1400, base, undefined, { source: 'ECB', mode: 'daily' }));
    history.close();
    const again = new History(file);
    expect(again.load('EQ:KS:005930', '1m').bars).toEqual([]);
    expect(again.load('FX:USDKRW', '1m').bars).toEqual([]);
  });

  it('같은 시각은 새 봉이 이겨요', () => {
    expect(mergeBars([bar(1, 1), bar(2, 2)], [bar(2, 9), bar(3, 3)]).map((b) => b.c)).toEqual([1, 9, 3]);
  });
});

describe('시세 중계와 저장', () => {
  const sam: Instrument = { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930' };

  async function setup(bars: () => Promise<Bar[]>) {
    const hub = new Hub(consoleLogger('test', true));
    const { history } = await tmpHistory();
    hub.history = history;
    const adapter = {
      source: 'KIS',
      bars: async (_i: Instrument, interval: string) => ({ id: sam.id, interval, bars: await bars(), fresh: { source: 'KIS', mode: 'poll', asOf: Date.now(), receivedAt: Date.now() } }),
    } as unknown as Adapter;
    hub.kis = adapter as never;
    hub.setInstruments([sam]);
    return hub;
  }

  it('소스가 막히면 저장해 둔 봉을 멈춤 배지(오래된 받은 시각)로 보여 줘요', async () => {
    let fail = false;
    const hub = await setup(async () => {
      if (fail) throw new Error('접속 실패');
      return [bar(86400, 1), bar(2 * 86400, 2)];
    });
    await hub.bars(sam.id, '1d');
    fail = true;
    (hub as unknown as { barCache: Map<string, unknown> }).barCache.clear();
    const s = await hub.bars(sam.id, '1d');
    expect(s.bars.map((b) => b.c)).toEqual([1, 2]);
    expect(s.fresh.source).toBe('KIS');
  });

  it('분봉은 소스가 주는 범위 앞의 저장분까지 이어 붙여요', async () => {
    const t0 = base / 1000;
    let first = true;
    const hub = await setup(async () => {
      const r = first ? [bar(t0, 1), bar(t0 + 60, 2)] : [bar(t0 + 60, 3), bar(t0 + 120, 4)];
      first = false;
      return r;
    });
    await hub.bars(sam.id, '1m');
    (hub as unknown as { barCache: Map<string, unknown> }).barCache.clear();
    const s = await hub.bars(sam.id, '1m');
    expect(s.bars.map((b) => b.c)).toEqual([1, 3, 4]);
  });
});
