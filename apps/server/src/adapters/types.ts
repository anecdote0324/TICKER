// 데이터 소스 어댑터. 한 소스가 막히거나 바뀌어도 그 부분만 갈아 끼울 수 있게 해요(04).

import type { BarInterval, BarSeries, Instrument, Quote, SourceId, SourceStatus } from '@bt/shared';
import type { Logger } from '../util';

export interface AdapterHost {
  emitQuote(q: Quote): void;
  emitStatus(): void;
  log: Logger;
}

export interface Adapter {
  readonly source: SourceId;
  /** 이 종목의 시세를 줄 수 있는지 */
  canServe(inst: Instrument): boolean;
  /** 분봉을 줄 수 있는지(GIP를 쓸 수 있는지, 05 §3.4) */
  supportsIntraday(inst: Instrument): boolean;
  start(): Promise<void>;
  stop(): void;
  subscribe(insts: Instrument[]): void;
  unsubscribe(insts: Instrument[]): void;
  bars(inst: Instrument, interval: BarInterval): Promise<BarSeries>;
  status(): SourceStatus;
}
