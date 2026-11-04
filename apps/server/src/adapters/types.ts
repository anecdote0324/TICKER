// 데이터 소스 어댑터. 한 소스가 막히거나 바뀌어도 그 부분만 갈아 끼울 수 있게 해요(04).

import type { Bar, BarInterval, BarSeries, Instrument, Quote, SourceId, SourceStatus } from '@bt/shared';
import type { Logger } from '../util';

export interface AdapterHost {
  emitQuote(q: Quote): void;
  emitStatus(): void;
  log: Logger;
}

export interface BarsOptions {
  after?: number;
  /** 이 시각(초)보다 오래된 봉 한 묶음(차트를 왼쪽 끝으로 끌 때, 일·주·월봉만). 더 없으면 빈 배열 */
  before?: number;
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
  /**
   * 봉. 시간봉은 허브가 '1h'만 달라고 하고 2·4시간봉은 묶어서 만들어요.
   * after(초)를 주면 그 뒤의 봉만 있으면 돼요(그 앞은 저장해 둔 봉이 있어요)
   */
  bars(inst: Instrument, interval: BarInterval, opts?: BarsOptions): Promise<BarSeries>;
  /** before(초)보다 오래된 1시간봉 한 묶음(뒤에서 조금씩 채워요). 더 없으면 빈 배열 */
  olderHourBars?(inst: Instrument, before: number): Promise<Bar[]>;
  status(): SourceStatus;
}
