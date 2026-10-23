// 겹침 표(05 §7.7)로 만든, 답이 정해진 해석기 테스트예요. 표의 단어 하나만 치고 Enter를 누르면 무엇을 하는지 고정해요.

import { describe, expect, it } from 'vitest';
import { buildCollisionTable } from './collisions';
import { CommandEngine } from './engine';
import { fixtureInstruments } from './fixtures';
import { SearchIndex } from './search-index';
import type { EngineContext } from './types';

const index = new SearchIndex(fixtureInstruments());
const engine = new CommandEngine(index);
const ctx: EngineContext = { panel: {}, assist: 'beginner', hanEng: true, tabAutofill: true };
const table = buildCollisionTable(engine, index, ctx);
const row = (w: string) => table.find((r) => r.word === w);

describe('겹침 표', () => {
  it('05 §7.7의 처음 넣을 겹침이 모두 표에 있어요', () => {
    for (const w of ['DES', 'FXC', 'GP', 'HELP', 'USD', 'BTC', 'CVX', 'C', 'G', 'W', 'GS', 'KT', 'KB']) expect(row(w), w).toBeDefined();
  });

  it('줄마다 Enter 결과가 정해져 있어요', () => {
    const expected: Record<string, [string, RegExp]> = {
      BTC: ['execute', /비트코인/], // 덮어쓰기 표: 코인
      USD: ['execute', /원\/달러/], // 통화 코드는 CURNCY
      FXC: ['execute', /환율 매트릭스/], // 기능 코드가 먼저
      HELP: ['execute', /도움말/],
      CVX: ['select', /선택/], // 셰브론과 Convex: 선택만
      C: ['select', /선택/], // 한 글자
      W: ['select', /선택/],
      G: ['select', /선택/],
      GS: ['select', /선택/], // 한국 이름과 미국 티커
      KT: ['select', /선택/],
      KB: ['select', /선택/],
      GP: ['other', /종목 필요/], // 빈 패널: 기능이 먼저라 종목을 물어요
      DES: ['other', /v0\.2/], // 아직 없는 기능
    };
    for (const [w, [outcome, label]] of Object.entries(expected)) {
      expect(row(w)?.outcome, w).toBe(outcome);
      expect(row(w)?.label, w).toMatch(label);
    }
  });

  it('뜻 목록에 단어의 뜻과 겹치는 종목이 모두 들어가요', () => {
    expect(row('CVX')?.meanings).toEqual(['CRY CVX', 'EQ·US CVX Chevron Corp'].map((x) => expect.stringContaining(x)));
    expect(row('KB')?.meanings.join(' / ')).toMatch(/KB금융.*KB Financial/);
    expect(row('GP')?.meanings[0]).toBe('기능 GP 가격 차트');
  });

  it('패널에 종목이 있으면 기능 코드는 그 종목으로 바로 실행돼요', () => {
    const samsung = index.get('EQ:KS:005930')!.inst;
    const a = engine.analyze('GP', 2, { ...ctx, panel: { security: samsung } });
    expect(a.plan.kind).toBe('execute');
  });
});
