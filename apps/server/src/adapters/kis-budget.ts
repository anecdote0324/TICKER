// 한국투자증권 요청 예산 관리자(01 전체 구조, 08 §4.1).
// REST 호출 한도(실전 초당 약 20건)와 실시간 구독 슬롯(약 40개)을 여러 기능이 나눠 써요.
// 우선순위는 화면에 보이는 종목이 먼저이고, 백그라운드 수집은 남는 예산으로 해요.

/** 0: 화면에서 지금 요청(차트 열기 등), 1: 주기 조회, 2: 백그라운드 수집 */
export type Priority = 0 | 1 | 2;

interface Job {
  pri: Priority;
  seq: number;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class RequestBudget {
  private queue: Job[] = [];
  private stamps: number[] = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  /** 이때까지는 새 호출을 내보내지 않아요(초당 거래건수 초과를 받았을 때) */
  private pausedUntil = 0;

  constructor(
    /** 초당 최대 호출 수. 한도보다 조금 낮게 잡아요 */
    public perSecond: number,
    private maxConcurrent = 8,
  ) {}

  schedule<T>(pri: Priority, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ pri, seq: this.seq++, run, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** 지난 1초 동안 쓴 호출 수, 기다리는 수, 나가 있는 수 */
  usage() {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 1000);
    return { lastSecond: this.stamps.length, queued: this.queue.length, running: this.running, perSecond: this.perSecond };
  }

  /** 한도를 넘었다는 답을 받으면 모든 호출을 잠깐 멈춰요 */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  /** 주기 조회에 쓸 수 있는 여유(초당 호출 수) */
  spare(reservedForUser = 4): number {
    return Math.max(0.5, this.perSecond - reservedForUser);
  }

  private pump() {
    if (this.timer) return;
    const now = Date.now();
    if (now < this.pausedUntil) {
      if (this.queue.length > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, this.pausedUntil - now);
      }
      return;
    }
    this.stamps = this.stamps.filter((t) => now - t < 1000);
    while (this.queue.length > 0 && this.stamps.length < this.perSecond && this.running < this.maxConcurrent) {
      this.queue.sort((a, b) => a.pri - b.pri || a.seq - b.seq);
      const job = this.queue.shift()!;
      this.stamps.push(Date.now());
      this.running++;
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
    if (this.queue.length > 0 && !this.timer) {
      const wait = this.stamps.length >= this.perSecond ? Math.max(5, 1000 - (Date.now() - this.stamps[0])) : 20;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
    }
  }
}

/**
 * 실시간 구독 슬롯 배분기. 여러 창에 같은 종목이 떠 있어도 한 번만 구독하고(키 단위),
 * 한도를 넘는 종목은 몇 초 간격 조회로 돌려요(04 KIS).
 */
export class SlotAllocator {
  private order: string[] = [];

  constructor(public limit: number) {}

  add(key: string) {
    if (!this.order.includes(key)) this.order.push(key);
  }

  remove(key: string) {
    this.order = this.order.filter((k) => k !== key);
  }

  /** 실시간으로 받을 키와 조회로 받을 키 */
  plan(): { ws: string[]; poll: string[] } {
    return { ws: this.order.slice(0, this.limit), poll: this.order.slice(this.limit) };
  }

  get used() {
    return Math.min(this.order.length, this.limit);
  }

  /** 한도를 넘어 조회로 받는 키 수 */
  get overflow() {
    return Math.max(0, this.order.length - this.limit);
  }
}
