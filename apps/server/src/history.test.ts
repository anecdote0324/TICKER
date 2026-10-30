import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bar, Freshness, Instrument, Quote } from '@bt/shared';
import type { Adapter } from './adapters/types';
import { History, mergeBars } from './history';
import { Hub, nextBackfillPoint } from './hub';
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

describe('시간봉 저장과 지난 봉 채우기', () => {
  const sam: Instrument = { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930' };
  const H = 3600;
  const D = 86400;
  // 2026-10-26(월) 09:00 한국 시간
  const mon = Date.UTC(2026, 9, 26, 0) / 1000;
  const dayBars = (day: number) => Array.from({ length: 7 }, (_, h) => bar(day + h * H, day / D + h));

  it('빈 곳(6일 넘게)이 있으면 위에서부터, 없으면 가장 오래된 봉 앞을 채워요', () => {
    const bars = [...dayBars(mon - 21 * D), ...dayBars(mon)];
    expect(nextBackfillPoint(bars, 0, () => false)).toBe(mon);
    expect(nextBackfillPoint(bars, 0, (t) => t === mon)).toBe(mon - 21 * D);
    expect(nextBackfillPoint(bars, mon, () => false)).toBe(mon);
    expect(nextBackfillPoint(dayBars(mon), mon, () => false)).toBeUndefined();
  });

  it('1시간봉을 저장하고 뒤에서 지난 봉을 채운 뒤, 2·4시간봉은 묶어서 줘요', async () => {
    const hub = new Hub(consoleLogger('test', true));
    const { history } = await tmpHistory();
    hub.history = history;
    const afters: Array<number | undefined> = [];
    const adapter = {
      source: 'KIS',
      bars: async (_i: Instrument, interval: string, opts?: { after?: number }) => {
        afters.push(opts?.after);
        return { id: sam.id, interval, bars: dayBars(mon), fresh: { source: 'KIS', mode: 'poll', asOf: Date.now(), receivedAt: Date.now() } };
      },
      // 앞의 두 주(평일 10일)까지만 있어요
      olderHourBars: async (_i: Instrument, before: number) => {
        const days = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14].map((n) => mon - n * D).filter((d) => d < before && d > before - 5 * D);
        return days.flatMap(dayBars);
      },
    } as unknown as Adapter;
    hub.kis = adapter as never;
    hub.setInstruments([sam, { id: 'FX:USDKRW', assetClass: 'CURNCY', code: 'USDKRW' }]);
    const first = await hub.bars(sam.id, '1h');
    expect(first.bars).toHaveLength(7);
    // 뒤에서 채우기가 끝날 때까지
    for (let i = 0; i < 50 && (hub as unknown as { backfilling: boolean }).backfilling; i++) await new Promise((r) => setTimeout(r, 10));
    expect(history.load(sam.id, '1h').bars).toHaveLength(77);
    (hub as unknown as { barCache: Map<string, unknown> }).barCache.clear();
    const again = await hub.bars(sam.id, '1h');
    expect(again.bars).toHaveLength(77);
    // 다시 받을 때는 저장해 둔 마지막 봉 뒤만
    expect(afters).toEqual([undefined, mon + 6 * H]);
    // 4시간봉: 하루 09·13시 두 칸
    const four = await hub.bars(sam.id, '4h');
    expect(four.bars).toHaveLength(22);
    expect(four.bars.slice(-2).map((b) => b.t)).toEqual([mon, mon + 4 * H]);
    // 지수·환율은 시간봉이 없어요
    await expect(hub.bars('FX:USDKRW', '1h')).rejects.toThrow('시간봉');
  });
});
