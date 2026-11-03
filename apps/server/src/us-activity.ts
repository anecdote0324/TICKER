// 미국 종목 인기도 보강(05 §15 색인, v0.2): 앱에서 본 거래대금(시세·MOST US 순위)을 모아 두었다가
// 종목 목록을 만들 때 미국 종목의 인기도(찾기 순서)에 더해요. 정해 둔 인기 목록(US_POPULAR) 밖의 종목이 대상이에요.
// 데이터 폴더의 us-activity.json에 종목마다 최근 30일 안의 가장 큰 하루 거래대금(달러)을 둬요.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Instrument } from '@bt/shared';

const KEEP_DAYS = 30;
const SAVE_DELAY_MS = 60_000;

interface Entry {
  /** 가장 큰 하루 거래대금(달러) */
  turnover: number;
  /** 그 값을 본 날('YYYY-MM-DD') */
  day: string;
}

const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export class UsActivity {
  private map = new Map<string, Entry>();
  private timer?: NodeJS.Timeout;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'us-activity.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Entry>;
      const cutoff = today(Date.now() - KEEP_DAYS * 86400_000);
      for (const [k, v] of Object.entries(raw)) if (v && v.day >= cutoff && v.turnover > 0) this.map.set(k, v);
    } catch {
      // 아직 없음
    }
  }

  /** 거래대금(달러)을 봤어요. 더 크면 바꾸고, 30일이 지난 값은 새 값으로 */
  record(symbol: string, turnover: number | undefined, now = Date.now()) {
    if (!turnover || !(turnover > 0) || !symbol) return;
    const d = today(now);
    const cutoff = today(now - KEEP_DAYS * 86400_000);
    const cur = this.map.get(symbol);
    if (cur && cur.day >= cutoff && cur.turnover >= turnover) return;
    this.map.set(symbol, { turnover, day: d });
    this.scheduleSave();
  }

  /** 종목마다 0~1 점수: 하루 거래대금 100만 달러 = 0, 100억 달러 = 1(로그) */
  scores(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, v] of this.map) out.set(k, Math.max(0, Math.min(1, (Math.log10(v.turnover) - 6) / 4)));
    return out;
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map))).catch(() => undefined);
  }
}

/**
 * 미국 종목 인기도에 앱에서 본 거래대금을 더해요. 인기 목록 밖 종목은 0.2(ETF 0.25)에서 시작해 점수만큼 0.3~0.85까지.
 * 인기 목록 종목은 지금 값과 비교해 더 큰 값
 */
export function applyUsBoost(list: Instrument[], scores: Map<string, number>) {
  for (const i of list) {
    if (i.market !== 'US') continue;
    const s = scores.get(i.code);
    if (s === undefined) continue;
    i.popularity = Math.max(i.popularity ?? 0, 0.3 + 0.55 * s);
  }
}
