import { describe, expect, it } from 'vitest';
import type { Instrument, Quote, ServerMessage } from '@bt/shared';
import type { Adapter } from './adapters/types';
import { Hub, type Client } from './hub';
import { consoleLogger } from './util';

function fakeAdapter(source: 'BINANCE' | 'ECB' | 'DEMO', subs: string[]): Adapter {
  return {
    source,
    canServe: () => true,
    supportsIntraday: () => true,
    start: async () => undefined,
    stop: () => undefined,
    subscribe: (insts: Instrument[]) => subs.push(...insts.map((i) => i.id)),
    unsubscribe: (insts: Instrument[]) => insts.forEach((i) => subs.splice(subs.indexOf(i.id), 1)),
    bars: async () => {
      throw new Error('unused');
    },
    status: () => ({ source, state: 'connected', updatedAt: 0 }),
  } as unknown as Adapter;
}

function setup() {
  const hub = new Hub(consoleLogger('test', true));
  const subs: string[] = [];
  hub.binance = fakeAdapter('BINANCE', subs) as never;
  hub.ecb = fakeAdapter('ECB', subs) as never;
  hub.demo = fakeAdapter('DEMO', subs) as never;
  const sent: ServerMessage[] = [];
  const client: Client = { ids: new Set(), send: (m) => sent.push(m) };
  hub.addClient(client);
  return { hub, subs, client, sent };
}

const btc: Instrument = { id: 'CRY:BTC', assetClass: 'CRYPTO', code: 'BTC' };
const sam: Instrument = { id: 'EQ:KS:005930', assetClass: 'EQUITY', market: 'KS', code: '005930' };

describe('시세 중계', () => {
  it('종목 목록이 준비되기 전에 들어온 구독도 목록이 오면 처리해요', () => {
    const { hub, subs, client } = setup();
    hub.subscribe(client, ['CRY:BTC', 'EQ:KS:005930']);
    expect(subs).toEqual([]);
    hub.setInstruments([btc, sam]);
    expect(subs.sort()).toEqual(['CRY:BTC', 'EQ:KS:005930']);
    expect([...client.ids].sort()).toEqual(['CRY:BTC', 'EQ:KS:005930']);
  });

  it('여러 창이 같은 종목을 봐도 한 번만 구독하고, 아무도 안 보면 해제해요', () => {
    const { hub, subs, client } = setup();
    hub.setInstruments([btc]);
    const other: Client = { ids: new Set(), send: () => undefined };
    hub.addClient(other);
    hub.subscribe(client, ['CRY:BTC']);
    hub.subscribe(other, ['CRY:BTC']);
    expect(subs).toEqual(['CRY:BTC']);
    hub.unsubscribe(client, ['CRY:BTC']);
    expect(subs).toEqual(['CRY:BTC']);
    hub.removeClient(other);
    expect(subs).toEqual([]);
  });

  it('구독이 끝난 종목의 늦게 온 값은 버려요', async () => {
    const { hub, client, sent } = setup();
    hub.setInstruments([btc]);
    hub.subscribe(client, ['CRY:BTC']);
    const q: Quote = { id: 'CRY:BTC', last: 1, fresh: { source: 'BINANCE', mode: 'realtime', asOf: 0, receivedAt: 0 } };
    hub.emitQuote(q);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent.some((m) => m.type === 'quotes')).toBe(true);
    hub.unsubscribe(client, ['CRY:BTC']);
    sent.length = 0;
    hub.emitQuote(q);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent.some((m) => m.type === 'quotes')).toBe(false);
  });
});
