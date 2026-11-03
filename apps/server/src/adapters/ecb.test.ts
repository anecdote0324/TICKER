import { describe, expect, it, vi } from 'vitest';
import type { Instrument, Quote } from '@bt/shared';
import { EcbAdapter, pairBars, type LiveFxSource } from './ecb';
import type { AdapterHost } from './types';

const usdkrw: Instrument = { id: 'CUR:USDKRW', assetClass: 'CURNCY', code: 'USDKRW' };
const eurkrw: Instrument = { id: 'CUR:EURKRW', assetClass: 'CURNCY', code: 'EURKRW' };

function setup() {
  const quotes: Quote[] = [];
  const host = { emitQuote: (q: Quote) => quotes.push(q), emitStatus: () => undefined, log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } } as unknown as AdapterHost;
  const fx = new EcbAdapter(host);
  // ECB 기준환율 두 영업일(1달러당)
  (fx as unknown as { days: unknown }).days = [
    { date: '2026-10-29', usd: { USD: 1, KRW: 1390, EUR: 0.93 } },
    { date: '2026-10-30', usd: { USD: 1, KRW: 1400, EUR: 0.92 } },
  ];
  return { fx, quotes, refresh: () => (fx as unknown as { refreshLive: () => Promise<void> }).refreshLive() };
}

describe('환율', () => {
  it('한국투자증권 키가 없으면 ECB 기준환율(일별)', () => {
    const { fx, quotes } = setup();
    fx.subscribe([usdkrw]);
    expect(quotes[0]).toMatchObject({ last: 1400, prevClose: 1390, fresh: { source: 'ECB', mode: 'daily', asOfDate: '2026-10-30' } });
    fx.stop();
  });

  it('키가 있으면 한국투자증권 환율을 10초 주기로, 교차 환율은 1달러당 값으로 계산해요', async () => {
    const { fx, quotes, refresh } = setup();
    const asked: string[][] = [];
    const live: LiveFxSource = {
      fxPerUsd: async (c) => {
        asked.push(c);
        return { cur: { KRW: 1410, EUR: 1 / 1.1 }, prev: { KRW: 1400, EUR: 1 / 1.09 } };
      },
    };
    fx.subscribe([usdkrw, eurkrw]);
    fx.setLive(live);
    await refresh();
    const last = (id: string) => [...quotes].reverse().find((q) => q.id === id)!;
    expect(last('CUR:USDKRW')).toMatchObject({ last: 1410, prevClose: 1400, fresh: { source: 'KIS', mode: 'poll', intervalMs: 10_000 } });
    expect(last('CUR:EURKRW').last).toBeCloseTo(1551, 6);
    expect(asked[asked.length - 1].sort()).toEqual(['EUR', 'KRW']);
    expect(fx.status().intervalMs).toBe(10_000);
    fx.stop();
  });

  it('한국투자증권 환율을 받지 못하면 ECB 기준환율로 돌아가고, 키를 지워도 돌아가요', async () => {
    const { fx, quotes, refresh } = setup();
    fx.subscribe([usdkrw]);
    fx.setLive({ fxPerUsd: async () => ({ cur: {}, prev: {} }) });
    await refresh();
    expect(quotes[quotes.length - 1].fresh.source).toBe('ECB');
    fx.setLive({ fxPerUsd: async () => ({ cur: { KRW: 1410 }, prev: {} }) });
    await refresh();
    expect(quotes[quotes.length - 1].fresh.source).toBe('KIS');
    fx.setLive(undefined);
    expect(quotes[quotes.length - 1].fresh.source).toBe('ECB');
    fx.stop();
  });

  it('한 통화를 한 번 못 받아도 그 통화의 앞 값을 1분까지 써서, ECB 값과 번갈아 바뀌지 않아요', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      const { fx, quotes, refresh } = setup();
      let eur = true;
      fx.subscribe([eurkrw]);
      fx.setLive({ fxPerUsd: async () => ({ cur: (eur ? { KRW: 1410, EUR: 1 / 1.1 } : { KRW: 1411 }) as Record<string, number>, prev: {} }) });
      await refresh();
      expect(quotes[quotes.length - 1].fresh.source).toBe('KIS');
      // 유로를 이번에 못 받았어요(초당 한도 초과 등): 앞 유로 값과 새 원화 값으로 계산해요
      eur = false;
      vi.setSystemTime(1_010_000);
      await refresh();
      const q = quotes[quotes.length - 1];
      expect(q.fresh.source).toBe('KIS');
      expect(q.last).toBeCloseTo(1411 * 1.1, 6);
      // 기준 시각은 오래된 쪽(유로를 받은 때)
      expect(q.fresh.asOf).toBe(1_000_000);
      // 1분 넘게 유로를 못 받으면 ECB로 돌아가요
      vi.setSystemTime(1_070_001);
      await refresh();
      expect(quotes[quotes.length - 1].fresh.source).toBe('ECB');
      fx.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('환율 차트: 키가 있으면 한국투자증권 봉으로, 달러가 한쪽이면 그대로·뒤집어서, 교차 환율은 같은 날짜 종가로', async () => {
    const krw = [{ t: 1, o: 1400, h: 1410, l: 1390, c: 1405, v: 0 }, { t: 2, o: 1405, h: 1420, l: 1400, c: 1410, v: 0 }];
    const eur = [{ t: 2, o: 0.9, h: 0.92, l: 0.88, c: 0.9, v: 0 }];
    expect(pairBars(null, krw)).toBe(krw);
    const eurusd = pairBars(eur, null)[0];
    expect([eurusd.c, eurusd.h, eurusd.l].map((v) => +v.toFixed(4))).toEqual([1.1111, 1.1364, 1.087]);
    expect(pairBars(eur, krw)).toEqual([{ t: 2, o: 1410 / 0.9, h: 1410 / 0.9, l: 1410 / 0.9, c: 1410 / 0.9, v: 0 }]);
    const { fx } = setup();
    fx.setLive({ fxPerUsd: async () => ({ cur: {}, prev: {} }), fxBarsPerUsd: async (c) => (c === 'KRW' ? krw : eur) });
    const s = await fx.bars(eurkrw, '1d');
    expect(s.fresh.source).toBe('KIS');
    expect(s.bars.map((b) => b.c)).toEqual([1410 / 0.9]);
    fx.stop();
  });

  it('키를 넣은 뒤 첫 환율을 받는 동안에도 상태 표시줄은 10초마다예요', () => {
    const { fx } = setup();
    expect(fx.status().intervalMs).toBe(30 * 60_000);
    fx.setLive({ fxPerUsd: () => new Promise(() => undefined) });
    expect(fx.status().intervalMs).toBe(10_000);
    fx.stop();
  });
});
