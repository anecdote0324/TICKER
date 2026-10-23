// 겹침 표(05 §7.7). 색인을 만들 때 기능·명령·시장·자산군 단어와 티커·코인·이름 사이의 겹침을 모두 뽑아요.
// 줄마다 그 단어 하나만 치고 Enter를 누르면 무엇을 하는지(해석기의 실제 결과)를 함께 적어요.
// 이 표로 답이 정해진 해석기 테스트를 만들고(collisions.test.ts), 도움말의 '겹치는 이름' 표에도 실어요.

import { FUNCTIONS, FX_CURRENCIES, OVERRIDE_TABLE, assetBadge, type Instrument } from '@bt/shared';
import type { CommandEngine } from './engine';
import { ASSET_WORDS, COMMAND_WORDS, MARKET_WORDS, RESERVED_ASSET_WORDS } from './lexicon';
import type { SearchIndex } from './search-index';
import type { EngineContext } from './types';

export type CollisionKind = '기능' | '명령' | '시장' | '자산군' | '통화' | '코인·주식' | '한국 이름·미국 티커';

export interface CollisionRow {
  word: string;
  kind: CollisionKind;
  /** 이 단어가 뜻할 수 있는 것들(단어의 뜻이 먼저, 그다음 종목) */
  meanings: string[];
  /** 그 단어만 치고 Enter를 눌렀을 때 */
  outcome: 'execute' | 'select' | 'other';
  /** ⏎ 라벨 그대로 */
  label: string;
  /** 정한 이유 */
  rule: string;
}

function describe(inst: Instrument): string {
  const name = inst.nameKo ?? inst.nameEn ?? '';
  return `${assetBadge(inst)} ${inst.code} ${name}`.trim();
}

/** 단어 목록: 기능 코드·별칭, 명령, 시장, 자산군(예약 포함), GO, 통화 코드 */
function reservedWords(): Array<{ word: string; kind: CollisionKind; meaning: string }> {
  const out: Array<{ word: string; kind: CollisionKind; meaning: string }> = [];
  for (const f of FUNCTIONS) {
    out.push({ word: f.code, kind: '기능', meaning: `기능 ${f.code} ${f.nameKo}` });
    for (const a of f.aliases ?? []) out.push({ word: a, kind: '기능', meaning: `기능 ${f.code}의 별칭` });
  }
  for (const [w, c] of Object.entries(COMMAND_WORDS)) if (/^[A-Z]+$/.test(w)) out.push({ word: w, kind: '명령', meaning: `명령 ${c.nameKo}` });
  out.push({ word: 'GO', kind: '명령', meaning: '명령 끝(GO는 지워요)' });
  for (const [w, m] of Object.entries(MARKET_WORDS)) out.push({ word: w, kind: '시장', meaning: m === 'IGNORE' ? `시장 ${w}(무시)` : `시장 ${m}` });
  for (const [w, a] of Object.entries(ASSET_WORDS)) if (/^[A-Z]+$/.test(w)) out.push({ word: w, kind: '자산군', meaning: `자산군 ${a}` });
  for (const [w, v] of Object.entries(RESERVED_ASSET_WORDS)) out.push({ word: w, kind: '자산군', meaning: `자산군 ${w}(${v})` });
  for (const c of FX_CURRENCIES) out.push({ word: c, kind: '통화', meaning: `통화 ${c}` });
  return out;
}

function ruleFor(kind: CollisionKind, word: string, outcome: CollisionRow['outcome'], insts: Instrument[], plan: string): string {
  if (OVERRIDE_TABLE[word]) return `덮어쓰기 표: ${OVERRIDE_TABLE[word]} 먼저(§7.1)`;
  if (kind === '기능' && plan === 'need-security') return '첫 칸의 기능 코드가 먼저(§3.3). 빈 패널이라 종목을 물어요';
  if (kind === '기능' && plan === 'error') return '첫 칸의 기능 코드가 먼저(§3.3). 아직 없는 기능이라 실행하지 않아요';
  if (kind === '통화' && outcome === 'execute') return '통화 코드는 CURNCY(§7.1)';
  if (kind === '기능' && outcome === 'execute') return '첫 칸의 기능 코드가 먼저(§3.3)';
  if (kind === '명령' && outcome === 'execute') return '명령 단어가 먼저';
  if ((kind === '시장' || kind === '자산군') && outcome === 'execute') return '줄 첫머리에서는 종목으로 읽어요(§3.3)';
  if (outcome === 'select' && word.length <= 2) return '짧은 입력이라 선택만(§6.3)';
  if (outcome === 'select' && insts.length > 1) return '여러 자산군에 있어서 선택만(§7.1)';
  if (outcome === 'select') return '겹쳐서 선택만(§7.2)';
  return '';
}

/**
 * 겹침 표를 만들어요. ctx는 빈 패널 기준으로 넣어요(패널 종목이 있으면 기능 코드의 결과가 달라져요).
 * 사용자가 정한 기본값과 기억된 선택은 빼고 만들어요(앱과 함께 배포하는 기본 동작).
 */
export function buildCollisionTable(engine: CommandEngine, index: SearchIndex, ctx: EngineContext): CollisionRow[] {
  const base: EngineContext = { ...ctx, userDefault: undefined, remembered: undefined, chosen: [], usage: undefined };
  const rows = new Map<string, CollisionRow>();
  const add = (word: string, kind: CollisionKind, meanings: string[], insts: Instrument[]) => {
    const key = `${kind}|${word}`;
    if (rows.has(key)) return;
    const a = engine.analyze(word, word.length, base);
    const outcome = a.plan.kind === 'execute' ? 'execute' : a.plan.kind === 'select' ? 'select' : 'other';
    rows.set(key, { word, kind, meanings, outcome, label: a.label, rule: ruleFor(kind, word, outcome, insts, a.plan.kind) });
  };

  // ① 단어와 종목 코드
  const byWord = new Map<string, { kind: CollisionKind; meanings: string[] }>();
  for (const w of reservedWords()) {
    const cur = byWord.get(w.word);
    if (cur) cur.meanings.push(w.meaning);
    else byWord.set(w.word, { kind: w.kind, meanings: [w.meaning] });
  }
  for (const [word, w] of byWord) {
    const recs = index.exactCode(word).filter((r) => r.inst.assetClass !== 'CURNCY' && r.inst.assetClass !== 'INDEX');
    if (recs.length === 0) continue;
    add(word, w.kind, [...w.meanings, ...recs.map((r) => describe(r.inst))], recs.map((r) => r.inst));
  }

  // ② 같은 코드가 코인과 주식에 모두 있을 때
  for (const r of index.records) {
    if (r.inst.assetClass !== 'CRYPTO') continue;
    const others = index.exactCode(r.inst.code).filter((x) => x.inst.assetClass === 'EQUITY');
    if (others.length === 0 || byWord.has(r.inst.code)) continue;
    const all = [r.inst, ...others.map((x) => x.inst)];
    add(r.inst.code, '코인·주식', all.map(describe), all);
  }

  // ③ 한국 회사 이름과 미국 티커(GS, KT, KB금융 → KB). 이름 앞의 영문(2글자 이상)이 미국 티커와 같으면 겹침이에요
  for (const r of index.records) {
    if (r.inst.market !== 'KS' && r.inst.market !== 'KQ') continue;
    const name = /^[a-z][a-z0-9]{1,5}(?![a-z0-9])/.exec(r.nameKoKey)?.[0]?.toUpperCase();
    if (!name || byWord.has(name)) continue;
    const us = index.exactCode(name).filter((x) => x.inst.market === 'US');
    if (us.length === 0) continue;
    const all = [r.inst, ...us.map((x) => x.inst)];
    add(name, '한국 이름·미국 티커', all.map(describe), all);
  }

  const order: CollisionKind[] = ['기능', '명령', '시장', '자산군', '통화', '코인·주식', '한국 이름·미국 티커'];
  return [...rows.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.word.localeCompare(b.word));
}
