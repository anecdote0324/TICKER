// 분봉·이력 저장(01). 데이터 폴더의 history.db(SQLite 파일 하나)에 소스에서 받은 봉과 실시간 시세로 만든 분봉을 모아요.
// - 다시 켜거나 소스가 막혔을 때도 저장해 둔 봉으로 차트를 그려요(배지는 멈춤으로).
// - 데모 값은 실제 시세가 아니어서 저장하지 않아요.
// - 분봉은 30일까지만 두고, 일·주·월봉은 계속 둬요.
// SQLite는 Node·Electron에 들어 있는 node:sqlite를 써서 따로 설치할 모듈이 없어요.

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Bar, BarInterval, Quote } from '@bt/shared';

const MINUTE_KEEP_DAYS = 30;
/** 한 번에 돌려주는 분봉 수(오늘 분봉에 충분해요) */
const INTRADAY_LIMIT = 2000;

interface LiveBar extends Bar {
  /** 누적 거래량(직전 시세). 시세의 거래량은 하루 누적이라 차이로 봉 거래량을 만들어요 */
  cum?: number;
}

/** 같은 시각이면 b가 이겨요. 시각 순으로 돌려줘요 */
export function mergeBars(a: Bar[], b: Bar[]): Bar[] {
  const m = new Map<number, Bar>();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

export class History {
  private db: DatabaseSync;
  private upsert: StatementSync;
  private select: StatementSync;
  private live = new Map<string, LiveBar>();
  private done: Array<{ id: string; bar: Bar }> = [];
  private timer: NodeJS.Timeout;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS bars (
        id TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
        o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
        PRIMARY KEY (id, interval, t)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS series (
        id TEXT NOT NULL, interval TEXT NOT NULL, saved_at INTEGER NOT NULL,
        PRIMARY KEY (id, interval)
      ) WITHOUT ROWID;
    `);
    this.upsert = this.db.prepare('INSERT OR REPLACE INTO bars (id, interval, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.select = this.db.prepare('SELECT t, o, h, l, c, v FROM bars WHERE id = ? AND interval = ? AND t >= ? ORDER BY t');
    this.prune();
    // 다 만든 분봉은 30초마다 모아서 써요
    this.timer = setInterval(() => this.flush(false), 30_000);
    this.timer.unref?.();
  }

  private prune() {
    const cutoff = Math.floor(Date.now() / 1000) - MINUTE_KEEP_DAYS * 86400;
    this.db.prepare("DELETE FROM bars WHERE interval IN ('1m', '5m') AND t < ?").run(cutoff);
  }

  /** 소스에서 받은 봉을 저장해요 */
  save(id: string, interval: BarInterval, bars: Bar[], savedAt = Date.now()) {
    if (bars.length === 0) return;
    this.tx(() => {
      for (const b of bars) this.upsert.run(id, interval, b.t, b.o, b.h, b.l, b.c, b.v);
      this.db.prepare('INSERT OR REPLACE INTO series (id, interval, saved_at) VALUES (?, ?, ?)').run(id, interval, savedAt);
    });
  }

  /** 저장해 둔 봉. 분봉은 최근 것만 */
  load(id: string, interval: BarInterval): { bars: Bar[]; savedAt?: number } {
    const intraday = interval === '1m' || interval === '5m';
    const since = intraday ? Math.floor(Date.now() / 1000) - MINUTE_KEEP_DAYS * 86400 : 0;
    let bars = this.select.all(id, interval, since) as unknown as Bar[];
    if (intraday && bars.length > INTRADAY_LIMIT) bars = bars.slice(-INTRADAY_LIMIT);
    const row = this.db.prepare('SELECT saved_at FROM series WHERE id = ? AND interval = ?').get(id, interval) as { saved_at: number } | undefined;
    return { bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })), savedAt: row?.saved_at };
  }

  /** 실시간·주기 조회 시세로 1분봉을 만들어요. 데모와 하루 한 번 값(ECB)은 빼요 */
  onQuote(q: Quote) {
    if (q.fresh.source === 'DEMO' || (q.fresh.mode !== 'realtime' && q.fresh.mode !== 'poll')) return;
    if (!Number.isFinite(q.last) || q.last <= 0) return;
    const t = Math.floor(q.fresh.asOf / 60_000) * 60;
    const cur = this.live.get(q.id);
    if (cur && cur.t === t) {
      cur.h = Math.max(cur.h, q.last);
      cur.l = Math.min(cur.l, q.last);
      cur.c = q.last;
      if (q.volume !== undefined && cur.cum !== undefined && q.volume >= cur.cum) cur.v += q.volume - cur.cum;
      cur.cum = q.volume ?? cur.cum;
      return;
    }
    if (cur && t < cur.t) return; // 늦게 온 값
    if (cur) this.done.push({ id: q.id, bar: strip(cur) });
    this.live.set(q.id, { t, o: q.last, h: q.last, l: q.last, c: q.last, v: 0, cum: q.volume });
  }

  /** 만들고 있는 1분봉(차트의 마지막 봉을 이어 그릴 때) */
  liveBar(id: string): Bar | undefined {
    const b = this.live.get(id);
    return b ? strip(b) : undefined;
  }

  /** 다 만든 분봉을 써요. 끝낼 때는 만들고 있던 분봉까지 써요 */
  flush(all: boolean) {
    const rows = this.done;
    this.done = [];
    if (all) for (const [id, b] of this.live) rows.push({ id, bar: strip(b) });
    if (rows.length === 0) return;
    this.tx(() => {
      for (const { id, bar } of rows) this.upsert.run(id, '1m', bar.t, bar.o, bar.h, bar.l, bar.c, bar.v);
    });
  }

  close() {
    clearInterval(this.timer);
    this.flush(true);
    this.live.clear();
    this.db.close();
  }

  private tx(fn: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

function strip(b: LiveBar): Bar {
  return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
}
