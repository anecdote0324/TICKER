// 성능 회귀 시험(05 §14.1): 실제 마스터와 비슷한 규모(약 1만 7천 종목)의 가짜 색인에서
// 실제로 치는 순서대로 한 글자씩 해석해 보고, 키 하나당 해석 시간이 기준을 넘으면 실패로 봐요.
// 실제 마스터(개발 PC)에서 잰 값: p50 약 0.9ms, p95 약 4ms(한 글자 입력이 결과 수천 개라 가장 느려요).
// CI 기계는 느리고 들쭉날쭉해서 기준을 넉넉히 잡았어요. 예전 구현(p95 약 24ms)은 여기서 걸러져요.

import { describe, expect, it } from 'vitest';
import { staticInstruments, type Instrument } from '@bt/shared';
import { CommandEngine } from './engine';
import { fixtureInstruments } from './fixtures';
import { SearchIndex } from './search-index';
import type { EngineContext } from './types';

/** 같은 씨앗이면 같은 수열(시험마다 같은 색인) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SYL = '가나다라마바사아자차카타파하삼성전기현대에스케이엘지화학바이오로직셀트리온한솔루션신금융우리은행제약포코네버카오트닉스엔씨소프중공업건설증권보험해운항공전력가스철강반도체배터리'.split('');
const WORDS = ['Apple', 'Micro', 'Global', 'Capital', 'Energy', 'Health', 'Systems', 'Group', 'Holdings', 'Trust', 'Fund', 'Bio', 'Tech', 'Pharma', 'Financial', 'Software', 'Semiconductor', 'Industries', 'Resources', 'Partners', 'Income', 'Growth', 'Value', 'Dividend', 'Bond', 'Treasury', 'Small', 'Cap', 'Index', 'Shares', 'Ultra', 'Short', 'Long', 'Daily', 'Bull', 'Bear'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function syntheticInstruments(): Instrument[] {
  const r = rng(20261023);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const out: Instrument[] = [...fixtureInstruments()];
  const seen = new Set(out.map((i) => i.id));
  const add = (i: Instrument) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    out.push(i);
  };
  for (let i = 0; i < 4000; i++) {
    const code = String(100000 + i * 7).padStart(6, '0');
    const n = 2 + Math.floor(r() * 5);
    const name = Array.from({ length: n }, () => pick(SYL)).join('');
    const market = i % 2 ? 'KQ' : 'KS';
    add({ id: `EQ:${market}:${code}`, assetClass: 'EQUITY', market, code, nameKo: name, popularity: r() });
  }
  for (let made = 0; made < 12900; ) {
    const len = 2 + Math.floor(r() * 4);
    const code = Array.from({ length: len }, () => pick(LETTERS.split(''))).join('');
    if (seen.has(`EQ:US:${code}`)) continue;
    made++;
    const etf = r() < 0.4;
    const words = Array.from({ length: 2 + Math.floor(r() * 3) }, () => pick(WORDS));
    if (etf) words.push('ETF');
    const nameKo = r() < 0.7 ? Array.from({ length: 2 + Math.floor(r() * 5) }, () => pick(SYL)).join('') : undefined;
    add({ id: `EQ:US:${code}`, assetClass: 'EQUITY', market: 'US', exchange: 'NAS', code, nameEn: words.join(' '), nameKo, flags: etf ? ['ETF'] : undefined, popularity: r() * 0.5 });
  }
  for (let made = 0; made < 700; ) {
    const code = Array.from({ length: 2 + Math.floor(r() * 4) }, () => pick(LETTERS.split(''))).join('');
    if (seen.has(`CRY:${code}`)) continue;
    made++;
    add({ id: `CRY:${code}`, assetClass: 'CRYPTO', code, nameEn: code, aliases: [`${code}USDT`], popularity: r() });
  }
  for (const s of staticInstruments()) add(s);
  return out;
}

const TYPED = ['005930 GP', 'AAPL US GIP', '삼성전자', 'ㅅㅅㅈㅈ', 'BTC', 'tkatjdwjswk', 'NVDA', '하이닉스', 'KODEX 200', 'SPY', 'USDKRW', 'WEI', '테슬라', 'ETH GP', '에코프로', 'apple', 'GS', 'KOSPI', 'S', 'ETF', 'Global'];

describe('키 하나당 해석 시간(05 §14.1)', () => {
  it('가짜 1만 7천 종목에서 p95가 기준 안이에요', () => {
    const index = new SearchIndex(syntheticInstruments());
    const engine = new CommandEngine(index);
    const ctx: EngineContext = { panel: {}, assist: 'beginner', hanEng: true, tabAutofill: true };
    const inputs: string[] = [];
    for (const t of TYPED) {
      const cs = [...t];
      for (let i = 1; i <= cs.length; i++) inputs.push(cs.slice(0, i).join(''));
    }
    for (const s of inputs) engine.analyze(s, s.length, ctx); // 데우기
    const times: number[] = [];
    for (let k = 0; k < 3; k++) {
      for (const s of inputs) {
        const t0 = performance.now();
        engine.analyze(s, s.length, ctx);
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const at = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
    console.info(`[성능] 종목 ${index.records.length}개, 키 ${times.length}번: p50 ${at(0.5).toFixed(2)}ms · p95 ${at(0.95).toFixed(2)}ms · p99 ${at(0.99).toFixed(2)}ms`);
    expect(at(0.5)).toBeLessThan(4);
    expect(at(0.95)).toBeLessThan(12);
    expect(at(0.99)).toBeLessThan(24);
  });
});
