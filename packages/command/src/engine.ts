// 커맨드 라인 해석기·완성기(05). 커맨드 라인과 명령 팔레트가 같은 엔진을 써요.
// 흐린 글씨, ⏎ 라벨, 실제 실행은 모두 같은 해석 결과(Analysis)를 읽어요. 그래서 미리 보기와 결과가 다를 수 없어요.

import {
  ASSET_HOME_FUNCTION,
  ASSET_LABEL,
  DEFAULT_FUNCTION,
  FUNCTIONS,
  FUNCTION_ORDER,
  FX_CURRENCIES,
  MARKET_LABEL,
  OVERRIDE_TABLE,
  assetBadge,
  canonicalSecurity,
  displayName,
  isSecurityFunction,
  resolveFunctionAlias,
  versionLabel,
  type AssetClass,
  type FunctionArgs,
  type FunctionDef,
  type Instrument,
  type Market,
} from '@bt/shared';
import { hangulToQwerty, hasHangul, isChosungQuery, isSyllable, toChosung, toKeystrokeJamo } from './hangul';
import {
  ASSET_WORDS,
  COMMAND_WORDS,
  FOREIGN_MARKETS,
  MARKET_WORDS,
  RESERVED_ASSET_WORDS,
  aliasKey,
  codeKey,
  normalizeText,
  type CommandWord,
} from './lexicon';
import { sortMatches } from './rank';
import { nameRangesOf, withinOneEdit, type SearchIndex, type SecurityMatch } from './search-index';
import type {
  Analysis,
  ChosenToken,
  EngineContext,
  EnterPlan,
  Execution,
  Ghost,
  ProgressItem,
  Row,
  Segment,
} from './types';

export const MAX_ROWS = 8;
const MAX_MORE = 200;
/** 종목 줄을 만드는 최대 수(더 보기 + 끼워 넣을 기능 줄 여유) */
const ROW_CAP = MAX_MORE + 20;

interface RawToken {
  text: string;
  norm: string;
  start: number;
  end: number;
}

function tokenize(input: string): RawToken[] {
  const out: RawToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const norm = normalizeText(m[0]);
    if (!norm) continue;
    out.push({ text: m[0], norm, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ── 기능 찾기 ──

const KEYWORDS = new Map<string, FunctionDef>();
for (const f of FUNCTIONS) for (const k of f.keywords) if (!KEYWORDS.has(k)) KEYWORDS.set(k, f);

interface FnHit {
  fn: FunctionDef;
  tier: number;
  via: 'code' | 'alias' | 'keyword' | 'convert' | 'typo';
  /** 별칭·키워드·변환으로 들어온 글자 */
  from?: string;
  exact: boolean;
}

/** 정확한 기능: 코드, 별칭, 한국어 키워드 */
function exactFunction(word: string): FnHit | undefined {
  if (/^[A-Za-z0-9]+$/.test(word)) {
    const r = resolveFunctionAlias(word);
    if (r) return { fn: r.fn, tier: 0, via: r.via ? 'alias' : 'code', from: r.via, exact: true };
    return undefined;
  }
  const k = KEYWORDS.get(word);
  if (k) return { fn: k, tier: 0, via: 'keyword', from: word, exact: true };
  return undefined;
}

/** 한글 모드로 친 코드: 헤 → GP */
function convertedFunction(word: string): FnHit | undefined {
  if (!hasHangul(word)) return undefined;
  const conv = hangulToQwerty(word);
  const r = resolveFunctionAlias(conv);
  if (r) return { fn: r.fn, tier: 0, via: 'convert', from: word, exact: true };
  return undefined;
}

/** 기능 앞부분 후보(T2) */
function functionPrefixHits(word: string, opts: { closedSlot: boolean; hanEng: boolean }): FnHit[] {
  const hits: FnHit[] = [];
  const seen = new Set<string>();
  const push = (h: FnHit) => {
    if (seen.has(h.fn.code)) return;
    seen.add(h.fn.code);
    hits.push(h);
  };
  if (/^[A-Za-z0-9]+$/.test(word)) {
    const up = word.toUpperCase();
    for (const f of FUNCTIONS) if (f.code !== up && f.code.startsWith(up)) push({ fn: f, tier: 2, via: 'code', exact: false });
    // T9 오타 허용(v0.2): 4글자 이상, 앞부분이 맞는 기능이 없을 때만, 만든 기능 코드와 한 글자 차이(CRPY → CRYP)
    if (hits.length === 0 && up.length >= 4 && /^[A-Z]+$/.test(up)) {
      for (const f of FUNCTIONS) if (f.implemented && f.code !== up && f.code.length >= 4 && withinOneEdit(up, f.code)) push({ fn: f, tier: 9, via: 'typo', exact: false });
    }
  } else if (hasHangul(word)) {
    const syllable = [...word].some(isSyllable);
    const cho = isChosungQuery(word);
    // 첫 칸에서는 완성된 음절이 있거나 초성이 2글자 이상일 때만(05 §6.4)
    const allowed = opts.closedSlot || syllable || (cho && [...word].length >= 2);
    if (allowed) {
      const jamo = toKeystrokeJamo(word);
      for (const [k, f] of KEYWORDS) {
        if (k === word) continue;
        const kj = toKeystrokeJamo(k);
        if (k.startsWith(word) || kj.startsWith(jamo) || (cho && toChosung(k).startsWith(word))) {
          push({ fn: f, tier: 2, via: 'keyword', from: k, exact: false });
        }
      }
    }
    if (opts.hanEng) {
      const conv = hangulToQwerty(word);
      for (const f of FUNCTIONS) if (f.code !== conv && f.code.startsWith(conv)) push({ fn: f, tier: 2, via: 'convert', from: word, exact: false });
    }
  }
  return hits;
}

function isMarketWord(w: string) {
  return MARKET_WORDS[w.toUpperCase()] !== undefined;
}
function isAssetWord(w: string) {
  return ASSET_WORDS[w] !== undefined || ASSET_WORDS[w.toUpperCase()] !== undefined;
}
function assetOf(w: string): AssetClass | undefined {
  return ASSET_WORDS[w] ?? ASSET_WORDS[w.toUpperCase()];
}
function commandOf(w: string) {
  return COMMAND_WORDS[w] ?? COMMAND_WORDS[w.toUpperCase()];
}

/** 기능 인자의 정확한 값: MOST 뒤의 KQ·코스닥·UW·CRYPTO(05 §3.1, v0.2) */
export function argValue(fn: FunctionDef, w: string): string | undefined {
  const a = fn.args;
  if (!a) return undefined;
  const up = w.toUpperCase();
  const byLabel = a.choices.find((c) => c.label === w || c.code === up || c.aliases?.includes(up));
  if (byLabel) return byLabel.code;
  if (a.kind === 'market') {
    const m = MARKET_WORDS[up];
    if (m && m !== 'IGNORE' && a.choices.some((c) => c.code === m)) return m;
    if (assetOf(w) === 'CRYPTO' && a.choices.some((c) => c.code === 'CRYPTO')) return 'CRYPTO';
  }
  return undefined;
}

/** 앞부분이 맞는 인자 값(고르기 줄) */
function argChoices(fn: FunctionDef, w: string): FunctionArgs['choices'] {
  const a = fn.args;
  if (!a) return [];
  const up = w.toUpperCase();
  return a.choices.filter((c) => !w || c.code.startsWith(up) || c.label.startsWith(w));
}

const CRYPTO_QUOTES = ['USDT', 'BTC', 'ETH', 'BNB', 'KRW', 'EUR', 'TRY', 'FDUSD', 'USDC', 'BUSD', 'JPY', 'BRL'];

export interface ApplyResult {
  input: string;
  cursor: number;
  chosen?: ChosenToken;
  /** 줄이 이미 완성돼서 할 일이 없음 */
  noop?: boolean;
  /** 다음 칸이 없어서 목록을 닫음 */
  closeList?: boolean;
}

export type EnterOutcome =
  | { kind: 'execute'; exec: Execution; chosen?: ChosenToken }
  | { kind: 'select'; segment: number; rowId: string }
  | { kind: 'accepted'; input: string; cursor: number; chosen?: ChosenToken }
  | { kind: 'need-security'; fn: FunctionDef }
  | { kind: 'error'; message: string }
  | { kind: 'nomatch' }
  | { kind: 'empty' };

export interface AnalyzeOptions {
  composing?: boolean;
  /** 목록을 보여 줄 칸(Enter가 앞쪽 토큰을 고를 때) */
  listSegment?: number;
  /** 더 보기: 최대 200줄 */
  expanded?: boolean;
}

export class CommandEngine {
  /** 이번 해석에서 만들지 않은 종목 줄 수(더 보기 수에 더해요) */
  private hiddenRows = 0;
  /** 이번 해석에서 만들 종목 줄 수(목록을 펼치지 않았으면 보이는 8줄과 여유만) */
  private rowCap = ROW_CAP;

  constructor(public index: SearchIndex) {}

  // ── 해석 ──

  private parse(input: string, ctx: EngineContext, composing: boolean): { segs: Segment[]; matches: Map<number, SecurityMatch[]> } {
    const toks = tokenize(input);
    const segs: Segment[] = [];
    const matches = new Map<number, SecurityMatch[]>();
    if (toks.length === 0) return { segs, matches };

    const mk = (from: number, to: number, extra: Partial<Segment>): Segment => ({
      index: segs.length,
      start: toks[from].start,
      end: toks[to].end,
      text: input.slice(toks[from].start, toks[to].end),
      slot: 'unknown',
      status: 'exact',
      ...extra,
    });

    let i = 0;
    const first = toks[0];
    // 여러 단어 이름은 가장 긴 일치를 먼저(05 §7.6): Equity Residential, bank of america
    let multiSpan = 0;
    for (let k = Math.min(5, toks.length); k >= 2; k--) {
      const joined = toks
        .slice(0, k)
        .map((t) => t.norm)
        .join('');
      if (joined.length >= 3 && this.index.exactName(joined).length > 0) {
        multiSpan = k;
        break;
      }
    }
    const nextIsQualifier = toks.length > 1 && (isMarketWord(toks[1].norm) || isAssetWord(toks[1].norm));
    let state: 'start' | 'sec' | 'mkt' | 'asset' | 'fn' = 'start';
    let assetFilter: AssetClass | undefined;

    // ── 첫 토큰(05 §3.3): ① 기능 코드 ② 키워드·별칭 ③ 종목 ④ 자산군 단어 하나만 ──
    const cmd = commandOf(first.norm);
    if (multiSpan > 0) {
      segs.push(mk(0, multiSpan - 1, { slot: 'security' }));
      i = multiSpan;
      state = 'sec';
    } else if (first.norm.startsWith('?')) {
      segs.push(mk(0, 0, { slot: 'command', cmd: 'syntax' }));
      i = 1;
      state = 'fn';
    } else if (cmd && !nextIsQualifier) {
      segs.push(mk(0, 0, { slot: 'command', cmd: cmd.cmd }));
      i = 1;
      state = 'fn';
    } else {
      const fnHit = exactFunction(first.norm);
      const latinLen = /^[A-Za-z0-9]+$/.test(first.norm) ? first.norm.length : 99;
      // 인자를 받는 기능(MOST)은 뒤의 시장 단어가 인자예요: MOST KQ = 코스닥 상위 종목. 종목 MOST는 'MOST US EQUITY'
      const qualifierIsArg = nextIsQualifier && !!fnHit?.fn.args && !!argValue(fnHit.fn, toks[1].norm);
      if (fnHit && latinLen >= 2 && (!nextIsQualifier || qualifierIsArg)) {
        const seg = this.functionSegment(mk(0, 0, {}), fnHit, ctx, true);
        segs.push(seg);
        i = 1;
        state = 'fn';
      } else if (isAssetWord(first.norm) && toks.length === 1 && !this.hasExactSecurity(first.norm)) {
        segs.push(mk(0, 0, { slot: 'asset', asset: assetOf(first.norm) }));
        i = 1;
        state = 'asset';
      } else if (isAssetWord(first.norm) && toks.length > 1 && !this.hasExactSecurity(first.norm)) {
        // 자산군 단어로 거르기: CRYPTO 비트
        assetFilter = assetOf(first.norm);
        segs.push(mk(0, 0, { slot: 'asset', asset: assetFilter }));
        i = 1;
        state = 'start';
      }
    }

    // ── 종목 칸(줄 첫머리 또는 자산군 거르기 뒤) ──
    if (state === 'start' && i < toks.length) {
      let span = 1;
      // 여러 단어 이름은 가장 긴 일치를 먼저(05 §7.6)
      for (let k = Math.min(5, toks.length - i); k >= 2; k--) {
        const joined = toks
          .slice(i, i + k)
          .map((t) => t.norm)
          .join('');
        if (joined.length >= 3 && this.index.exactName(joined).length > 0) {
          span = k;
          break;
        }
      }
      segs.push(mk(i, i + span - 1, { slot: 'security' }));
      i += span;
      state = 'sec';
    }

    // ── 나머지 토큰 ──
    for (; i < toks.length; i++) {
      const t = toks[i];
      const w = t.norm;
      const up = w.toUpperCase();
      const isLast = i === toks.length - 1;
      const fnSeg = segs.find((s) => s.slot === 'function');
      const secSeg = segs.find((s) => s.slot === 'security');

      if (state === 'fn') {
        if (up === 'GO' && isLast && fnSeg) {
          segs.push(mk(i, i, { slot: 'go', status: 'ignored' }));
          continue;
        }
        if (segs[0]?.slot === 'command' && segs[0].cmd === 'alias') {
          // ALIAS 별칭 종목: 두 번째 단어가 별칭, 그 뒤가 종목(시장·자산군도 붙일 수 있어요)
          if (!segs.some((s) => s.slot === 'arg')) {
            const err = aliasNameError(w);
            segs.push(mk(i, i, err ? { slot: 'arg', status: 'invalid', error: err } : { slot: 'arg', arg: w.toUpperCase() }));
          } else {
            segs.push(mk(i, i, { slot: 'security' }));
            state = 'sec';
          }
          continue;
        }
        if (segs[0]?.slot === 'command') {
          segs.push(mk(i, i, { slot: 'arg', status: 'invalid', error: '이 명령은 뒤에 아무것도 받지 않아요' }));
          continue;
        }
        if (fnSeg?.fn && isSecurityFunction(fnSeg.fn) && !secSeg) {
          segs.push(mk(i, i, { slot: 'security' }));
          state = 'sec';
          continue;
        }
        if (fnSeg?.fn?.args?.kind === 'securities') {
          // 앞 비교 종목의 시장(AAPL US): 그 인자 칸에 붙여요. 기준 종목의 시장으로 읽지 않게 따로 칸을 만들지 않아요
          const prev = segs[segs.length - 1];
          const pm = MARKET_WORDS[up];
          if (pm && pm !== 'IGNORE' && prev?.slot === 'arg' && prev.argSecurity && !prev.market) {
            segs[segs.length - 1] = { ...prev, end: t.end, text: input.slice(prev.start, t.end), market: pm };
            continue;
          }
          segs.push(this.argSecuritySegment(mk(i, i, {}), fnSeg.fn, segs));
          continue;
        }
        const again = exactFunction(w) ?? (ctx.hanEng ? convertedFunction(w) : undefined);
        if (again && fnSeg) {
          segs.push(
            mk(i, i, {
              slot: 'function',
              status: 'invalid',
              fn: again.fn,
              error: '기능은 하나만 쓸 수 있어요',
              fixLine: this.lineWithout(input, fnSeg),
            }),
          );
          continue;
        }
        const fa = fnSeg?.fn?.args;
        if (fnSeg?.fn && fa) {
          const used = segs.some((s) => s.slot === 'arg');
          const v = argValue(fnSeg.fn, w);
          if (used) segs.push(mk(i, i, { slot: 'arg', status: 'invalid', error: `${fnSeg.fn.code} 뒤에는 ${fa.label}을(를) 하나만 써요` }));
          else if (v) segs.push(mk(i, i, { slot: 'arg', arg: v }));
          else if (argChoices(fnSeg.fn, w).length > 0) segs.push(mk(i, i, { slot: 'arg', status: 'choose', chooseReason: 'prefix' }));
          else segs.push(mk(i, i, { slot: 'arg', status: 'invalid', error: `${fnSeg.fn.code} 뒤에는 ${fa.label}(${fa.choices.map((c) => c.code).join('·')})을(를) 써요` }));
          continue;
        }
        segs.push(mk(i, i, { slot: 'arg', status: 'invalid', error: fnSeg?.fn ? `${fnSeg.fn.code}는 뒤에 인자를 받지 않아요` : '기능 뒤에는 인자를 받지 않아요' }));
        continue;
      }

      // 종목·시장·자산군 뒤
      const mw = MARKET_WORDS[up];
      if (mw && state === 'sec') {
        segs.push(mk(i, i, mw === 'IGNORE' ? { slot: 'market', status: 'ignored' } : { slot: 'market', market: mw }));
        state = 'mkt';
        continue;
      }
      if (FOREIGN_MARKETS.has(up) && state === 'sec') {
        segs.push(mk(i, i, { slot: 'market', status: 'invalid', error: '지원하지 않는 시장이에요 (KS·KQ·US만)' }));
        state = 'mkt';
        continue;
      }
      const aw = assetOf(w);
      if (aw && (state === 'sec' || state === 'mkt')) {
        segs.push(mk(i, i, { slot: 'asset', asset: aw }));
        state = 'asset';
        continue;
      }
      if (RESERVED_ASSET_WORDS[up] && (state === 'sec' || state === 'mkt')) {
        segs.push(
          mk(i, i, {
            slot: 'asset',
            status: 'unavailable',
            error: `${up} 자산군은 ${RESERVED_ASSET_WORDS[up]}${RESERVED_ASSET_WORDS[up].startsWith('v') ? '에서 열려요' : '이에요'}`,
          }),
        );
        state = 'asset';
        continue;
      }
      // COMP 005930 000660: 기준 종목 뒤의 토큰은 비교 종목이에요
      if (fnSeg?.fn?.args?.kind === 'securities' && secSeg) {
        segs.push(this.argSecuritySegment(mk(i, i, {}), fnSeg.fn, segs));
        state = 'fn';
        continue;
      }
      // 기능(종목 뒤에서는 길이와 상관없이 정확한 기능 코드, 05 §6.3)
      const fx = exactFunction(w);
      if (fx) {
        segs.push(this.functionSegment(mk(i, i, {}), fx, ctx, false));
        state = 'fn';
        continue;
      }
      if (ctx.hanEng) {
        // 닫힌 칸의 한/영 변환: 헤 → GP, ㅏㄴ → KS, ㄷ벼ㅑ쇼 → EQUITY
        const conv = hasHangul(w) ? hangulToQwerty(w) : '';
        if (conv) {
          const cm = MARKET_WORDS[conv];
          if (cm && cm !== 'IGNORE' && state === 'sec') {
            segs.push(mk(i, i, { slot: 'market', market: cm, status: 'corrected', note: `${w} → ${conv}` }));
            state = 'mkt';
            continue;
          }
          const ca = ASSET_WORDS[conv];
          if (ca && (state === 'sec' || state === 'mkt')) {
            segs.push(mk(i, i, { slot: 'asset', asset: ca, status: 'corrected', note: `${w} → ${conv}` }));
            state = 'asset';
            continue;
          }
          const cf = convertedFunction(w);
          if (cf) {
            const seg = this.functionSegment(mk(i, i, {}), cf, ctx, false);
            seg.note = `${w} → ${cf.fn.code}`;
            if (seg.status === 'exact') seg.status = 'corrected';
            segs.push(seg);
            state = 'fn';
            continue;
          }
        }
      }
      // 고르기가 필요한 닫힌 칸(앞부분) 또는 모르는 단어
      const hasPrefix =
        this.closedRows({ text: w } as Segment, ctx, state === 'sec' ? 'sec' : state === 'mkt' ? 'mkt' : 'asset', undefined).length > 0;
      segs.push(
        mk(i, i, hasPrefix ? { slot: 'closed', status: 'choose', chooseReason: 'prefix' } : { slot: 'closed', status: 'nomatch', error: `'${w}'는 알 수 없는 기능이에요` }),
      );
      // 앞부분 칸 뒤에는 기능이 올 수 있어요
      state = 'fn';
    }

    // ── 종목 칸 해석(뒤의 시장·자산군으로 먼저 걸러요, 05 §7.3) ──
    for (const seg of segs) {
      if (seg.slot !== 'security') continue;
      const after = segs.filter((s) => s.index > seg.index);
      const mSeg = after.find((s) => s.slot === 'market' && s.market && s.status !== 'invalid');
      const aSeg = after.find((s) => s.slot === 'asset' && s.asset && s.status !== 'unavailable') ?? (assetFilter ? segs[0] : undefined);
      const firstSlot = seg.index === 0 || (seg.index === 1 && segs[0].slot === 'asset');
      const m = this.resolveSecurity(seg, ctx, composing, firstSlot, mSeg, aSeg);
      matches.set(seg.index, m);
    }
    // ── 비교 종목(COMP) 해석: 붙인 시장으로 걸러요 ──
    for (const seg of segs) {
      if (seg.slot !== 'arg' || !seg.argSecurity || seg.status === 'invalid') continue;
      const code = seg.market ? seg.text.split(/\s+/)[0] : seg.text;
      const tmp: Segment = { ...seg, text: code, status: 'exact' };
      const m = this.resolveSecurity(tmp, ctx, composing, false, seg.market ? ({ market: seg.market } as Segment) : undefined, undefined);
      seg.inst = tmp.inst;
      seg.status = tmp.status;
      seg.chooseReason = tmp.chooseReason;
      seg.error = tmp.status === 'nomatch' ? `'${code}'와 맞는 비교 종목이 없어요` : tmp.error;
      matches.set(seg.index, m);
    }

    return { segs, matches };
  }

  /** 종목 인자 칸(COMP의 비교 종목). 해석은 parse 끝에서 해요 */
  private argSecuritySegment(seg: Segment, fn: FunctionDef, segs: Segment[]): Segment {
    const max = fn.args?.max ?? 1;
    const used = segs.filter((s) => s.slot === 'arg' && s.argSecurity).length;
    if (used >= max) return { ...seg, slot: 'arg', status: 'invalid', error: `${fn.args?.label ?? '인자'}은(는) ${max}개까지예요` };
    return { ...seg, slot: 'arg', argSecurity: true };
  }

  private hasExactSecurity(word: string): boolean {
    return this.index.exactCode(word).length > 0;
  }

  private lineWithout(input: string, seg: Segment): string {
    return (input.slice(0, seg.start) + input.slice(seg.end)).replace(/\s+/g, ' ').trim();
  }

  private functionSegment(seg: Segment, hit: FnHit, ctx: EngineContext, first: boolean): Segment {
    seg.slot = 'function';
    seg.fn = hit.fn;
    if (hit.via === 'alias') seg.fnVia = hit.from;
    if (!hit.fn.implemented) {
      // 아직 만들지 않은 기능: 같은 앞부분의 만든 기능이 있으면 앞부분으로 봐요(05 §5 a)
      const built = functionPrefixHits(seg.text, { closedSlot: !first, hanEng: ctx.hanEng }).filter((h) => h.fn.implemented);
      if (built.length > 0) {
        seg.status = 'choose';
        seg.chooseReason = 'prefix';
        seg.fn = undefined;
        return seg;
      }
      seg.status = 'unavailable';
      seg.error = `${hit.fn.code} ${hit.fn.nameKo} — ${versionLabel(hit.fn.version)}에서 제공 예정`;
    }
    return seg;
  }

  private resolveSecurity(
    seg: Segment,
    ctx: EngineContext,
    composing: boolean,
    firstSlot: boolean,
    mSeg?: Segment,
    aSeg?: Segment,
  ): SecurityMatch[] {
    const text = seg.text;
    const key = codeKey(text);
    // 시장·자산군을 직접 붙였으면(GP US, GS KS) 짧은 입력 규칙을 쓰지 않아요
    const opts = { first: firstSlot && !mSeg && !aSeg, composing, hanEng: ctx.hanEng };
    // 사용자 별칭(v0.2, 05 §13): 첫 칸에서는 별칭이 티커를 이겨요. SS US처럼 시장을 붙이면 진짜 티커
    if (firstSlot && !mSeg && !aSeg && ctx.aliases && !composing) {
      const target = ctx.aliases(aliasKey(text));
      const rec = target ? this.index.get(target) : undefined;
      if (rec) {
        seg.inst = rec.inst;
        seg.status = 'exact';
        seg.byAlias = text;
        const others = sortMatches(this.index.search(text, { ...opts }), ctx).filter((m) => m.rec !== rec);
        return [{ rec, tier: 0, sub: -2, via: 'user' }, ...others];
      }
    }
    let list = this.index.search(text, { ...opts, market: mSeg?.market, asset: aSeg?.asset });

    // 시장 교정: 입력한 시장에서 아무것도 못 찾을 때만(05 §7.3)
    if (mSeg?.market && !list.some((m) => m.tier <= 1)) {
      const wide = this.index.search(text, { ...opts, asset: aSeg?.asset });
      const exact = wide.filter((m) => m.tier <= 1 && m.rec.inst.market);
      if (exact.length > 0 && list.length === 0) {
        const target = exact[0].rec.inst.market!;
        mSeg.status = 'corrected';
        mSeg.note = `${mSeg.text.toUpperCase()} → ${target}`;
        mSeg.market = target;
        list = wide.filter((m) => m.rec.inst.market === target);
      }
    }
    // 틀린 자산군: 고침을 1번 줄에(05 §13)
    if (aSeg?.asset && list.length === 0) {
      const wide = this.index.search(text, { ...opts, market: mSeg?.market });
      const exact = sortMatches(
        wide.filter((m) => m.tier <= 1),
        ctx,
      );
      if (exact.length > 0) {
        const inst = exact[0].rec.inst;
        aSeg.status = 'invalid';
        aSeg.error = `${inst.code}은(는) ${ASSET_LABEL[aSeg.asset]}이 아니에요 → ${canonicalSecurity(inst)}`;
        aSeg.fixLine = canonicalSecurity(inst);
        list = exact;
      }
    }

    const sorted = sortMatches(list, ctx);

    // 사용자가 고른 토큰
    const chosen = ctx.chosen?.find((c) => c.start === seg.start && c.text === text);
    if (chosen?.rowId.startsWith('sec:')) {
      const rec = this.index.get(chosen.rowId.slice(4));
      if (rec) {
        seg.inst = rec.inst;
        seg.status = 'chosen';
        return sorted;
      }
    }

    // 코인 표기: USDT 쌍만(05 §13)
    if (sorted.length === 0 || !sorted.some((m) => m.tier <= 1)) {
      const special = this.specialNotation(key);
      if (special) {
        Object.assign(seg, special);
        return sorted;
      }
    }

    const exact = sorted.filter((m) => m.tier <= 1);
    if (exact.length === 1) {
      seg.inst = exact[0].rec.inst;
      seg.status = 'exact';
      return sorted;
    }
    if (exact.length > 1) {
      // 겹침(05 §7.1): ① 직접 쓴 시장·자산군(이미 걸렀어요) ② 덮어쓰기 표 ③ 사용자가 정한 기본값 ④ 선택만
      const ov = OVERRIDE_TABLE[key] ?? ((FX_CURRENCIES as readonly string[]).includes(key) ? 'CURNCY' : undefined);
      const byOv = ov ? exact.filter((m) => m.rec.inst.assetClass === ov) : [];
      if (byOv.length === 1) {
        seg.inst = byOv[0].rec.inst;
        seg.status = 'exact';
        seg.byOverride = true;
        return [byOv[0], ...sorted.filter((m) => m !== byOv[0])];
      }
      const def = ctx.userDefault?.(key);
      const byDef = def ? exact.find((m) => m.rec.inst.id === def) : undefined;
      if (byDef) {
        seg.inst = byDef.rec.inst;
        seg.status = 'exact';
        seg.byUserDefault = true;
        return [byDef, ...sorted.filter((m) => m !== byDef)];
      }
      seg.status = 'choose';
      seg.chooseReason = 'ambiguous';
      return sorted;
    }
    if (sorted.length > 0) {
      seg.status = 'choose';
      const top = sorted[0];
      seg.chooseReason = top.shortExact ? 'short' : top.tier === 8 ? 'convert' : top.tier >= 6 ? 'fuzzy' : 'prefix';
      return sorted;
    }
    if (firstSlot && this.hasFunctionCandidates(text, ctx)) {
      seg.status = 'choose';
      seg.chooseReason = hasHangul(text) && ctx.hanEng && convertedFunction(text) ? 'convert' : 'prefix';
      return sorted;
    }
    // 뒤 단계에서 쓸 코드 모양(05 §3.7): 지금은 안내만 하고, 해석기가 깨지지 않게 자리를 지켜요
    const reserved = reservedShape(key);
    if (reserved) {
      seg.status = 'unavailable';
      seg.error = reserved;
      return sorted;
    }
    seg.status = 'nomatch';
    // 목록에 없는 코드: 한국투자증권에서 직접 조회해 볼 수 있어요(05 §4.5, §13)
    const lk = lookupShape(key, mSeg?.market);
    if (lk) seg.lookup = lk;
    return sorted;
  }

  private hasFunctionCandidates(text: string, ctx: EngineContext): boolean {
    const w = normalizeText(text);
    if (exactFunction(w) || commandOf(w)) return true;
    if (ctx.hanEng && convertedFunction(w)) return true;
    return functionPrefixHits(w, { closedSlot: false, hanEng: false }).length > 0;
  }

  /** ETHBTC, ETH/KRW, USDT, KRWUSD 같은 표기 */
  private specialNotation(key: string): Partial<Segment> | undefined {
    if (key === 'USDT') {
      return { status: 'invalid', error: 'USDT는 기준 통화예요 — 코인 이름과 함께 입력하세요' };
    }
    for (const q of CRYPTO_QUOTES) {
      if (key.length > q.length && key.endsWith(q)) {
        const base = key.slice(0, -q.length);
        const rec = this.index.get(`CRY:${base}`);
        if (rec && q !== 'USDT') {
          return {
            status: 'invalid',
            error: `코인은 USDT 마켓만 지원해요 → ${base} CRYPTO`,
            fixLine: `${base} CRYPTO`,
          };
        }
      }
    }
    if (/^[A-Z]{6}$/.test(key)) {
      const inv = key.slice(3) + key.slice(0, 3);
      const rec = this.index.get(`CUR:${inv}`);
      if (rec) {
        return { status: 'corrected', inst: rec.inst, note: `환율은 ${inv} 방향으로 보여드려요` };
      }
    }
    return undefined;
  }

  // ── 줄 만들기 ──

  private securityRow(m: SecurityMatch, ctx: EngineContext, rememberedId?: string): Row {
    const inst = m.rec.inst;
    const flags: string[] = [...(inst.flags ?? [])];
    if (m.via === 'hanToEng') flags.push('한/영');
    if (m.via === 'engToHan') flags.push('영→한');
    if (m.via === 'typo') flags.push('오타?');
    if (m.via === 'acronym') flags.push('머리글자');
    const id = `sec:${inst.id}`;
    return {
      id,
      kind: 'security',
      badge: m.via === 'user' ? 'ALIAS' : assetBadge(inst),
      code: inst.code,
      name: inst.nameKo || inst.nameEn || inst.code,
      nameEn: inst.nameKo ? inst.nameEn : undefined,
      info: securityInfo(inst),
      flags,
      canonical: canonicalSecurity(inst),
      codeRanges: m.codeRanges,
      nameRanges: nameRangesOf(m),
      remembered: rememberedId === id,
      tier: m.tier,
      insert: inst.code,
      instrumentId: inst.id,
      child: !!inst.commonId,
    };
  }

  private functionRow(fn: FunctionDef, tier: number, ctx: EngineContext, sec: Instrument | undefined, opts: { from?: string; via?: FnHit['via']; panelChip?: boolean } = {}): Row {
    const flags: string[] = [];
    if (opts.via === 'convert') flags.push('한/영');
    if (fn.notBloomberg) flags.push('자체 코드');
    let info = fn.summary;
    if (!fn.implemented) info = `${versionLabel(fn.version)}에서 제공 예정`;
    else if (!isSecurityFunction(fn)) info += ' · 종목 불필요';
    else if (opts.panelChip && sec) info += ` → ${shortSecurity(sec)} (띄운 종목)`;
    let name = fn.nameKo;
    if (opts.via === 'keyword' && opts.from) name = `${opts.from} → ${fn.nameKo}`;
    if (opts.via === 'convert' && opts.from) name = `${opts.from} → ${fn.code} ${fn.nameKo}`;
    if (opts.via === 'typo') flags.push('오타?');
    const disabled = !fn.implemented || (sec && isSecurityFunction(fn) ? !this.fnSupports(fn, sec, ctx) : false);
    return {
      id: `fn:${fn.code}`,
      kind: fn.implemented ? 'function' : 'unavailable',
      badge: 'FN',
      code: fn.code,
      name,
      info: disabled && fn.implemented && sec ? `${shortSecurity(sec)}에는 쓸 수 없음` : info,
      flags,
      canonical: isSecurityFunction(fn) && sec ? `${shortCommandSecurity(sec)} ${fn.code}` : fn.code,
      tier,
      insert: fn.code,
      fnCode: fn.code,
      disabled,
      current: ctx.assist === 'beginner' && ctx.panel.fn === fn.code,
    };
  }

  private fnSupports(fn: FunctionDef, inst: Instrument, ctx: EngineContext): boolean {
    if (!isSecurityFunction(fn)) return true;
    if (!fn.assetClasses.includes(inst.assetClass)) return false;
    return ctx.supports ? ctx.supports(fn.code, inst) : true;
  }

  /** 닫힌 칸(시장·자산군·기능) 후보 */
  private closedRows(seg: Pick<Segment, 'text'>, ctx: EngineContext, after: 'sec' | 'mkt' | 'asset', sec: Instrument | undefined): Row[] {
    const w = normalizeText(seg.text);
    const up = w.toUpperCase();
    const rows: Row[] = [];
    const isLatin = /^[A-Za-z0-9]+$/.test(w);
    if (isLatin && after === 'sec') {
      for (const [word, mkt] of Object.entries(MARKET_WORDS)) {
        if (mkt === 'IGNORE' || word === up || !word.startsWith(up)) continue;
        if (!['KS', 'KQ', 'US'].includes(word)) continue;
        rows.push({
          id: `mkt:${word}`,
          kind: 'market',
          badge: 'MKT',
          code: word,
          name: MARKET_LABEL[mkt],
          info: '시장',
          flags: [],
          canonical: sec ? `${sec.code} ${word}` : word,
          tier: 2,
          insert: word,
        });
      }
    }
    if (isLatin && (after === 'sec' || after === 'mkt')) {
      const seen = new Set<string>();
      for (const [word, asset] of Object.entries(ASSET_WORDS)) {
        if (!/^[A-Z]+$/.test(word) || word === up || !word.startsWith(up)) continue;
        if (seen.has(asset)) continue;
        seen.add(asset);
        rows.push({
          id: `asset:${asset}`,
          kind: 'asset',
          badge: assetBadge({ assetClass: asset, market: undefined }).replace('EQ·', 'EQ'),
          code: asset,
          name: ASSET_LABEL[asset],
          info: '자산군',
          flags: [],
          canonical: asset,
          tier: 2,
          insert: asset,
        });
      }
    }
    const hits = functionPrefixHits(w, { closedSlot: true, hanEng: ctx.hanEng });
    const exactConv = ctx.hanEng ? convertedFunction(w) : undefined;
    if (exactConv) hits.unshift({ ...exactConv, tier: 0 });
    // 만든 기능 먼저, 그다음 앞으로 만들 기능
    const built = hits.filter((h) => h.fn.implemented);
    const later = hits.filter((h) => !h.fn.implemented);
    const order = this.functionOrder(sec, ctx);
    built.sort((a, b) => a.tier - b.tier || rankIn(order, a.fn.code) - rankIn(order, b.fn.code));
    for (const h of built) rows.push(this.functionRow(h.fn, h.tier, ctx, sec, { from: h.from, via: h.via }));
    // 한 글자 입력에서는 앞으로 만들 기능은 정확히 같은 코드만 보여요
    const laterShown = [...w].length >= 2 ? later : later.filter((h) => h.fn.code === up);
    for (const h of laterShown.slice(0, 6)) rows.push(this.functionRow(h.fn, h.tier + 1, ctx, sec, { from: h.from, via: h.via }));
    // 정확한 기능 코드(만들지 않은 것 포함)
    const ex = exactFunction(w);
    if (ex && !rows.some((r) => r.fnCode === ex.fn.code)) rows.unshift(this.functionRow(ex.fn, 0, ctx, sec));
    return rows;
  }

  /** 기능 칸의 순서(05 §6.7): 지금 기능 → 자주 쓴 기능 → 기본 순서 */
  private functionOrder(sec: Instrument | undefined, ctx: EngineContext): string[] {
    const asset = sec?.assetClass ?? 'EQUITY';
    const order: string[] = [];
    const cur = ctx.panel.fn ? FUNCTIONS.find((f) => f.code === ctx.panel.fn) : undefined;
    if (cur && isSecurityFunction(cur) && (!sec || this.fnSupports(cur, sec, ctx))) order.push(cur.code);
    for (const c of ctx.fnUsage?.(asset) ?? []) if (!order.includes(c)) order.push(c);
    for (const c of FUNCTION_ORDER[asset]) if (!order.includes(c)) order.push(c);
    return order;
  }

  /** 더 보기 목록: 기능·명령 줄은 위에 두고, 종목 줄은 처음 나온 자산군 순서로 묶어 머리줄을 붙여요 */
  private groupByAsset(rows: Row[]): Row[] {
    const assetOf = (r: Row) => (r.instrumentId ? this.index.get(r.instrumentId)?.inst.assetClass : undefined);
    const sec = rows.filter((r) => r.kind === 'security' && assetOf(r));
    const classes = [...new Set(sec.map((r) => assetOf(r)!))];
    if (classes.length < 2) return rows;
    const out = rows.filter((r) => !(r.kind === 'security' && assetOf(r)) && r.kind !== 'header');
    for (const c of classes) {
      const group = sec.filter((r) => assetOf(r) === c);
      out.push(headerRow(`── ${ASSET_LABEL[c]} ${group.length} ──`), ...group);
    }
    return out;
  }

  /** 종목 뒤 빈 기능 칸의 목록 */
  private functionListFor(sec: Instrument, ctx: EngineContext): Row[] {
    const rows: Row[] = [];
    const unusable: Row[] = [];
    for (const code of this.functionOrder(sec, ctx)) {
      const fn = FUNCTIONS.find((f) => f.code === code);
      if (!fn || !fn.implemented) continue;
      const row = this.functionRow(fn, 2, ctx, sec);
      if (row.disabled) unusable.push(row);
      else rows.push(row);
    }
    if (ctx.assist === 'beginner' && unusable.length > 0) {
      rows.push(headerRow('── 이 종목에는 쓸 수 없음 ──'), ...unusable);
    }
    return rows;
  }

  private securityRows(seg: Segment, list: SecurityMatch[], ctx: EngineContext, firstSlot: boolean): Row[] {
    const rows: Row[] = [];
    const remembered = ctx.remembered?.(normalizeText(seg.text).toLowerCase());
    // 줄은 더 보기에 보일 만큼만 만들어요(05 §14.1). 기억된 줄과 한/영 변환 줄은 뒤에 있어도 넣어요
    let shown = list;
    const cap = this.rowCap;
    if (list.length > cap) {
      shown = list.slice(0, cap);
      const rememberedInst = remembered?.startsWith('sec:') ? remembered.slice(4) : undefined;
      if (rememberedInst || hasHangul(seg.text)) {
        for (let i = cap; i < list.length; i++) {
          const m = list[i];
          if (m.rec.inst.id === rememberedInst || (m.via === 'hanToEng' && m.tier === 8)) shown.push(m);
        }
      }
      this.hiddenRows += list.length - shown.length;
    }
    const secRows = shown.map((m) => this.securityRow(m, ctx, remembered));

    // 첫 칸에서는 기능 줄이 같은 등급의 종목 줄보다 먼저예요(최대 3줄)
    let fnRows: Row[] = [];
    let convRows: Row[] = [];
    if (firstSlot) {
      const w = normalizeText(seg.text);
      const latinLen = /^[A-Za-z0-9]+$/.test(w) ? w.length : 99;
      const ex = exactFunction(w);
      const hits: FnHit[] = [];
      if (ex) hits.push({ ...ex, tier: latinLen >= 2 ? 0 : 2 });
      for (const h of functionPrefixHits(w, { closedSlot: false, hanEng: false })) if (!hits.some((x) => x.fn.code === h.fn.code)) hits.push(h);
      const built = hits.filter((h) => h.fn.implemented || h.tier === 0);
      fnRows = built
        .sort((a, b) => a.tier - b.tier || Number(b.fn.implemented) - Number(a.fn.implemented))
        .slice(0, 3)
        .map((h) => this.functionRow(h.fn, h.tier, ctx, ctx.panel.security, { from: h.from, via: h.via, panelChip: true }));
      const cmd = commandOf(w);
      if (cmd) {
        fnRows.unshift({
          id: `cmd:${cmd.cmd}`,
          kind: 'command',
          badge: 'CMD',
          code: w.toUpperCase() === 'HELP' || w.toUpperCase() === 'PDF' ? w.toUpperCase() : w,
          name: cmd.nameKo,
          info: cmd.summary,
          flags: [],
          canonical: w,
          tier: 0,
          insert: w,
        });
      }
      // 한글 모드로 친 기능 코드: 상위 2줄 안(이름 일치가 없으면 1번, 05 §6.5-5)
      if (ctx.hanEng && hasHangul(w)) {
        const cf = convertedFunction(w);
        if (cf && cf.fn.code.length >= 2) {
          convRows = [this.functionRow(cf.fn, 8, ctx, ctx.panel.security, { from: w, via: 'convert', panelChip: true })];
        }
      }
    }

    const all = [...secRows];
    // 등급별로 기능 줄 끼워 넣기
    for (const fr of fnRows.reverse()) {
      const pos = all.findIndex((r) => r.tier >= fr.tier);
      all.splice(pos < 0 ? all.length : pos, 0, fr);
    }
    // 변환 줄(한/영)은 상위 2줄 안
    const convSec = all.filter((r) => r.kind === 'security' && r.flags.includes('한/영') && r.tier === 8 && codeKey(r.code) === hangulToQwerty(normalizeText(seg.text)));
    const convAll = [...convRows, ...convSec];
    for (const cr of convAll) {
      const idx = all.indexOf(cr);
      if (idx >= 0) all.splice(idx, 1);
    }
    if (convAll.length > 0) {
      const hasName = all.some((r) => r.kind === 'security' && r.tier <= 7);
      all.splice(hasName ? Math.min(1, all.length) : 0, 0, ...convAll);
    }

    // 기억된 선택(↺): 애매한 목록에서만 순서를 바꿔요
    if (remembered && seg.status === 'choose' && seg.chooseReason !== 'ambiguous') {
      const idx = all.findIndex((r) => r.id === remembered);
      if (idx > 0) {
        const [r] = all.splice(idx, 1);
        all.unshift(r);
      }
    }
    rows.push(...all);
    return rows;
  }

  // ── 분석 ──

  analyze(input: string, cursor: number, ctx: EngineContext, opts: AnalyzeOptions = {}): Analysis {
    const composing = !!opts.composing;
    // 기능 메뉴 페이지의 숫자 + Enter(05 §10.2, v0.2). 후보 목록에서는 안 써요(숫자는 KRX 코드라 1~2자리만)
    const num = input.trim();
    if (ctx.menu?.length && ctx.panel.security && /^\d{1,2}$/.test(num)) return this.menuChoice(input, cursor, Number(num), ctx);
    const { segs, matches } = this.parse(input, ctx, composing);

    // 커서가 있는 칸
    let current = segs.findIndex((s) => cursor >= s.start && cursor <= s.end);
    if (current < 0) current = segs.length;
    if (current === segs.length && segs.length > 0 && !/\s$/.test(input.slice(0, cursor)) && cursor >= segs[segs.length - 1].end) current = segs.length - 1;

    const secSeg = segs.find((s) => s.slot === 'security');
    const fnSeg = segs.find((s) => s.slot === 'function' && s.fn);
    const cmdSeg = segs.find((s) => s.slot === 'command');
    const assetOnly = segs.length === 1 && segs[0].slot === 'asset' ? segs[0] : undefined;

    // 해석 결과
    let security: Instrument | undefined = secSeg?.inst;
    let fn: FunctionDef | undefined = fnSeg?.fn;
    let fnImplied = false;
    let securityFromPanel = false;
    if (!secSeg && fn && isSecurityFunction(fn) && ctx.panel.security) {
      security = ctx.panel.security;
      securityFromPanel = true;
    }
    let menuMode = false;
    if (security && !fnSeg && !segs.some((s) => s.slot === 'closed') && !cmdSeg) {
      if (ctx.securityEnter === 'menu' && !securityFromPanel) {
        // 블룸버그식(v0.2): 종목만 입력하고 Enter → 그 종목의 기능 메뉴
        menuMode = true;
        fn = undefined;
      } else {
        // 종목만 입력하고 Enter: 지금 기능 유지(05 §3.4). 지금 기능을 못 쓰면 자산군별 기본 기능(v0.2), 그것도 없으면 GP
        const cur = ctx.panel.fn ? FUNCTIONS.find((f) => f.code === ctx.panel.fn) : undefined;
        fn = cur && cur.implemented && isSecurityFunction(cur) && this.fnSupports(cur, security, ctx) ? cur : FUNCTIONS.find((f) => f.code === this.defaultFnFor(security!, ctx));
        fnImplied = true;
      }
    }

    // 기능과 자산군이 맞는지
    if (fnSeg?.fn && fnSeg.status !== 'unavailable' && security && isSecurityFunction(fnSeg.fn) && !this.fnSupports(fnSeg.fn, security, ctx)) {
      const f = fnSeg.fn;
      fnSeg.status = 'invalid';
      const usable = FUNCTION_ORDER[security.assetClass].filter((c) => FUNCTIONS.find((x) => x.code === c)?.implemented && this.fnSupports(FUNCTIONS.find((x) => x.code === c)!, security!, ctx));
      fnSeg.error = !f.assetClasses.includes(security.assetClass)
        ? `${f.code}(${f.nameKo})는 ${f.assetClasses.map((a) => ASSET_LABEL[a]).join('·')} 전용이에요. ${ASSET_LABEL[security.assetClass]}은 ${usable.join('·')}를 쓸 수 있어요`
        : `${shortSecurity(security)}에는 ${f.code}(${f.nameKo}) 데이터가 없어요`;
    }

    // Enter 계획(05 §3.6)
    const plan = menuMode && security
      ? this.firstProblem(input, segs, matches, ctx, security) ?? { kind: 'execute' as const, exec: { kind: 'function' as const, fn: 'MENU', instrumentId: security.id, canonical: canonicalSecurity(security), notes: [] } }
      : this.planEnter(input, segs, matches, ctx, { security, fn, fnImplied, securityFromPanel, secSeg, fnSeg, cmdSeg, assetOnly });

    // 목록
    const listSegment = opts.listSegment ?? (plan.kind === 'select' && current >= segs.length ? plan.segment : current);
    this.hiddenRows = 0;
    // 펼치지 않았으면 8줄 + 기능 줄을 끼워 넣을 여유만 만들어요
    this.rowCap = opts.expanded ? ROW_CAP : MAX_ROWS + 8;
    let rows = this.rowsFor(listSegment, segs, matches, ctx, input, security);
    // 더 보기: 종목 줄을 자산군별로 묶어요(05 §4.5)
    if (opts.expanded) rows = this.groupByAsset(rows);
    const limit = opts.expanded ? MAX_MORE : MAX_ROWS;
    const more = Math.max(0, rows.length - limit) + this.hiddenRows;
    rows = rows.slice(0, limit);

    const ghost = this.ghostFor(input, cursor, composing, segs, current, rows, plan, ctx, security, fn, fnImplied);
    const label = labelFor(plan, this.index);
    const { items, message } = this.progressFor(segs, plan, security, fn, fnImplied, current);

    const needsAttention =
      plan.kind === 'error' || plan.kind === 'nomatch' || segs.some((s) => s.status === 'choose' && s.chooseReason === 'ambiguous');

    return {
      input,
      cursor,
      segments: segs,
      current,
      listSegment,
      rows,
      more,
      ghost,
      plan,
      label,
      progress: items,
      message,
      contextChip: securityFromPanel && security ? `${shortSecurity(security)}` : undefined,
      security,
      fn,
      needsAttention,
    };
  }

  private planEnter(
    input: string,
    segs: Segment[],
    matches: Map<number, SecurityMatch[]>,
    ctx: EngineContext,
    r: {
      security?: Instrument;
      fn?: FunctionDef;
      fnImplied: boolean;
      securityFromPanel: boolean;
      secSeg?: Segment;
      fnSeg?: Segment;
      cmdSeg?: Segment;
      assetOnly?: Segment;
    },
  ): EnterPlan {
    if (segs.length === 0) return { kind: 'empty' };

    // 문제가 있는 토큰을 왼쪽부터
    for (const seg of segs) {
      if (seg.status === 'choose') {
        const rows = this.rowsFor(seg.index, segs, matches, ctx, input, r.security);
        const row = rows.find((x) => !x.disabled && x.kind !== 'header');
        if (row) return { kind: 'select', segment: seg.index, rowId: row.id, label: selectLabel(row) };
        return { kind: 'error', segment: seg.index, message: `'${seg.text}'와 맞는 줄을 고를 수 없어요` };
      }
      if (seg.status === 'invalid' || seg.status === 'unavailable') {
        return { kind: 'error', segment: seg.index, message: seg.error ?? '실행할 수 없어요' };
      }
      if (seg.status === 'nomatch') {
        if (seg.slot === 'security' && seg.lookup && ctx.lookup) {
          const row = lookupRow(seg.lookup, true);
          return { kind: 'select', segment: seg.index, rowId: row.id, label: `${seg.lookup.code} 직접 조회` };
        }
        if (seg.slot === 'security') return { kind: 'nomatch', text: seg.text };
        return { kind: 'error', segment: seg.index, message: seg.error ?? `'${seg.text}'를 알 수 없어요` };
      }
    }

    if (r.cmdSeg?.cmd === 'alias') {
      const name = segs.find((s) => s.slot === 'arg' && s.arg)?.arg;
      if (!name) return { kind: 'execute', exec: { kind: 'command', cmd: 'alias', canonical: 'ALIAS', notes: [] } };
      if (!r.security || !r.secSeg) return { kind: 'error', segment: segs.length - 1, message: `별칭 ${name}에 쓸 종목을 넣어 주세요 (예: ALIAS ${name} 005930)` };
      return {
        kind: 'execute',
        exec: { kind: 'command', cmd: 'alias', args: [name], instrumentId: r.security.id, canonical: `ALIAS ${name} ${canonicalSecurity(r.security)}`, notes: [] },
      };
    }
    if (r.cmdSeg?.cmd) {
      const word = r.cmdSeg.text;
      return {
        kind: 'execute',
        exec: { kind: 'command', cmd: r.cmdSeg.cmd, canonical: word, notes: [] },
      };
    }

    if (r.assetOnly?.asset) {
      const home = ASSET_HOME_FUNCTION[r.assetOnly.asset];
      if (home) return { kind: 'execute', exec: { kind: 'function', fn: home, canonical: home, notes: [`${r.assetOnly.asset} → ${home}`] } };
      return { kind: 'execute', exec: { kind: 'asset-list', asset: r.assetOnly.asset, canonical: r.assetOnly.asset, notes: [] } };
    }

    const fn = r.fn;
    if (!fn) return { kind: 'empty' };
    const notes: string[] = [];
    for (const s of segs) if (s.note && (s.status === 'corrected' || s.slot === 'security')) notes.push(s.note);
    if (r.secSeg?.byUserDefault) notes.push('내가 정한 기본값 ↺');
    if (r.fnSeg?.fnVia) notes.push(`${r.fnSeg.fnVia} → ${fn.code}`);

    if (!isSecurityFunction(fn)) {
      const args = segs.filter((s) => s.slot === 'arg' && s.arg).map((s) => s.arg!);
      const exec: Execution = { kind: 'function', fn: fn.code, canonical: [fn.code, ...args].join(' '), notes };
      if (args.length > 0) exec.args = args;
      if (r.security && !r.securityFromPanel) {
        exec.instrumentId = r.security.id;
        exec.setsSecurityOnly = true;
      }
      return { kind: 'execute', exec };
    }
    if (!r.security) return { kind: 'need-security', fn };
    const argSegs = segs.filter((s) => s.slot === 'arg' && s.argSecurity && s.inst);
    const exec: Execution = {
      kind: 'function',
      fn: fn.code,
      instrumentId: r.security.id,
      canonical: [`${canonicalSecurity(r.security)} ${fn.code}`, ...argSegs.map((s) => shortCommandSecurity(s.inst!))].join(' '),
      notes,
    };
    if (argSegs.length > 0) exec.args = argSegs.map((s) => s.inst!.id);
    else if (r.fnImplied) exec.keepArgs = true;
    return { kind: 'execute', exec };
  }

  private rowsFor(
    segIndex: number,
    segs: Segment[],
    matches: Map<number, SecurityMatch[]>,
    ctx: EngineContext,
    input: string,
    security: Instrument | undefined,
  ): Row[] {
    const seg = segs[segIndex];
    if (!seg) {
      // 새 칸(줄 끝 공백 뒤)
      if (segs.length === 0) return this.startRows(ctx);
      const last = segs[segs.length - 1];
      const sec = security ?? segs.find((s) => s.slot === 'security')?.inst;
      if (last.slot === 'function' && last.fn?.args && last.status !== 'invalid') return argRows(last.fn, '');
      if (last.slot === 'function' || last.slot === 'command' || last.slot === 'go' || last.slot === 'arg') return [];
      if (sec) return this.functionListFor(sec, ctx);
      return [];
    }
    const rows: Row[] = [];
    if (seg.fixLine) {
      rows.push({
        id: `fix:${seg.fixLine}`,
        kind: 'fix',
        badge: 'FIX',
        code: '',
        name: seg.error ?? '고침',
        info: 'Tab으로 적용',
        flags: [],
        canonical: seg.fixLine,
        tier: 0,
        insert: seg.fixLine,
        replaceLine: seg.fixLine,
      });
    }
    switch (seg.slot) {
      case 'security': {
        const firstSlot = seg.index === 0 || (seg.index === 1 && segs[0].slot === 'asset');
        rows.push(...this.securityRows(seg, matches.get(seg.index) ?? [], ctx, firstSlot));
        if (rows.length === 0) {
          // 키가 있으면 직접 조회 줄이 1번, 없으면 일치 없음 줄 아래에 안내만
          if (seg.lookup && ctx.lookup) rows.push(lookupRow(seg.lookup, true));
          else {
            rows.push(noMatchRow(seg.text));
            if (seg.lookup) rows.push(lookupRow(seg.lookup, false));
          }
        }
        break;
      }
      case 'closed':
      case 'function':
      case 'market':
      case 'asset': {
        const prev = segs[seg.index - 1];
        const after = prev?.slot === 'market' ? 'mkt' : prev?.slot === 'asset' ? 'asset' : 'sec';
        const sec = security ?? segs.find((s) => s.slot === 'security')?.inst;
        if (seg.slot === 'function' && seg.index === 0) {
          // 줄 첫머리 기능: 같은 글자의 종목은 늘 2번 줄(05 §6.3)
          const m = this.index.search(seg.text, { first: false, hanEng: false }).filter((x) => x.tier <= 1);
          rows.push(this.functionRow(seg.fn!, 0, ctx, ctx.panel.security, { panelChip: true }));
          for (const x of sortMatches(m, ctx)) {
            const row = this.securityRow(x, ctx);
            row.info += ` · 종목은 '${seg.text.toUpperCase()} ${x.rec.inst.market ?? x.rec.inst.assetClass}'`;
            rows.push(row);
          }
          const pre = functionPrefixHits(seg.text, { closedSlot: false, hanEng: false }).filter((h) => h.fn.implemented);
          for (const h of pre.slice(0, 2)) rows.push(this.functionRow(h.fn, 2, ctx, ctx.panel.security, { panelChip: true }));
        } else {
          rows.push(...this.closedRows(seg, ctx, after, sec));
        }
        // 다 친 시장·자산군(AAPL US): 알아들었다는 줄을 보여 줘요('US'와 일치하는 것이 없다고 하지 않게)
        if (rows.length === 0 && seg.slot === 'market' && seg.market) rows.push(recognizedRow('market', seg.text.toUpperCase(), MARKET_LABEL[seg.market], '시장'));
        if (rows.length === 0 && seg.slot === 'asset' && seg.asset) rows.push(recognizedRow('asset', seg.asset, ASSET_LABEL[seg.asset], '자산군'));
        if (rows.length === 0) rows.push(noMatchRow(seg.text));
        break;
      }
      case 'arg': {
        if (seg.argSecurity) {
          rows.push(...this.securityRows(seg, matches.get(seg.index) ?? [], ctx, false));
          if (rows.length === 0 && seg.status !== 'invalid') rows.push(noMatchRow(seg.text));
          break;
        }
        const f = segs.find((s) => s.slot === 'function' && s.fn)?.fn;
        if (f?.args && seg.status !== 'invalid') rows.push(...argRows(f, seg.arg ?? seg.text));
        break;
      }
      case 'command': {
        const c = seg.cmd!;
        rows.push({
          id: `cmd:${c}`,
          kind: 'command',
          badge: 'CMD',
          code: seg.text,
          name: Object.values(COMMAND_WORDS).find((x) => x.cmd === c)?.nameKo ?? seg.text,
          info: Object.values(COMMAND_WORDS).find((x) => x.cmd === c)?.summary ?? '',
          flags: [],
          canonical: seg.text,
          tier: 0,
          insert: seg.text,
        });
        break;
      }
      default:
        break;
    }
    void input;
    return rows;
  }

  /** 입문 시작 목록(05 §12.1) */
  private startRows(ctx: EngineContext): Row[] {
    if (ctx.assist !== 'beginner') return [];
    const rows: Row[] = [];
    const recent = (ctx.recent ?? []).slice(0, 3);
    if (recent.length > 0) {
      rows.push(headerRow('최근'));
      for (const c of recent) {
        rows.push({
          id: `hist:${c}`,
          kind: 'history',
          badge: 'HIST',
          code: c,
          name: '',
          info: '',
          flags: [],
          canonical: c,
          tier: 0,
          insert: c,
          replaceLine: c,
        });
      }
    }
    rows.push(headerRow('종목 없이 바로 쓰는 기능'));
    for (const code of ['MON', 'WEI', 'FXC', 'CRYP']) {
      const fn = FUNCTIONS.find((f) => f.code === code)!;
      rows.push(this.functionRow(fn, 2, ctx, undefined));
    }
    return rows;
  }

  private ghostFor(
    input: string,
    cursor: number,
    composing: boolean,
    segs: Segment[],
    current: number,
    rows: Row[],
    plan: EnterPlan,
    ctx: EngineContext,
    security: Instrument | undefined,
    fn: FunctionDef | undefined,
    fnImplied: boolean,
  ): Ghost | null {
    // 조합 중에는 숨겨요(K6). 커서가 줄 끝일 때만
    if (composing || ctx.assist === 'off' || cursor !== input.length || input.trim() === '') return null;
    const confirmed = plan.kind === 'execute';
    const top = rows.find((r) => !r.disabled && r.kind !== 'header');
    if (current >= segs.length) {
      // 새 칸: Enter가 쓸 기능
      if (top && top.kind === 'function' && security) {
        return { tab: top.insert, rest: '', confirmed: confirmed && fn?.code === top.fnCode, replace: false };
      }
      return null;
    }
    const seg = segs[current];
    if (current !== segs.length - 1) return null;
    const typed = seg.text;
    if (seg.slot === 'security') {
      const inst = seg.status === 'choose' ? (top?.instrumentId ? this.index.get(top.instrumentId)?.inst : undefined) : seg.inst;
      if (top && top.kind === 'function' && seg.status === 'choose') {
        // 첫 칸의 기능 줄이 맨 위
        return completion(typed, top.insert, '', false);
      }
      if (!inst) return null;
      let tab = inst.code;
      if (ctx.tabAutofill) tab += inst.market ? ` ${inst.market} ${inst.assetClass}` : ` ${inst.assetClass}`;
      const restFn = seg.status === 'choose' ? this.defaultFnFor(inst, ctx) : fnImplied ? fn?.code : undefined;
      return completion(typed, tab, restFn ? ` ${restFn}` : '', confirmed);
    }
    if ((seg.slot === 'closed' || (seg.slot === 'function' && seg.status !== 'exact')) && top) {
      return completion(typed, top.insert, '', confirmed && top.fnCode === fn?.code);
    }
    void security;
    return null;
  }

  /** 기능 메뉴의 번호 고르기 */
  private menuChoice(input: string, cursor: number, n: number, ctx: EngineContext): Analysis {
    const sec = ctx.panel.security!;
    const code = ctx.menu![n - 1];
    const fn = code ? FUNCTIONS.find((f) => f.code === code) : undefined;
    const plan: EnterPlan = fn
      ? { kind: 'execute', exec: { kind: 'function', fn: fn.code, instrumentId: sec.id, canonical: `${canonicalSecurity(sec)} ${fn.code}`, notes: [`메뉴 ${n}번`] } }
      : { kind: 'error', segment: 0, message: `기능 메뉴에 ${n}번이 없어요(1~${ctx.menu!.length})` };
    return {
      input,
      cursor,
      segments: [],
      current: 0,
      listSegment: 0,
      rows: [],
      more: 0,
      ghost: null,
      plan,
      label: fn ? `⏎ 실행: ${n}) ${fn.code} ${fn.nameKo}` : labelFor(plan, this.index),
      progress: [],
      message: '',
      security: sec,
      fn,
      needsAttention: !fn,
    };
  }

  /** 문제가 있는 토큰(고르기·오류)이 있으면 그 계획. 없으면 undefined */
  private firstProblem(input: string, segs: Segment[], matches: Map<number, SecurityMatch[]>, ctx: EngineContext, security: Instrument): EnterPlan | undefined {
    const p = this.planEnter(input, segs, matches, ctx, { security, fn: FUNCTIONS.find((f) => f.code === DEFAULT_FUNCTION), fnImplied: true, securityFromPanel: false });
    return p.kind === 'execute' ? undefined : p;
  }

  /** 종목만 쳤을 때 열 기능: 지금 기능(쓸 수 있으면) → 자산군별 기본 기능(설정, v0.2) → GP */
  private defaultFnFor(inst: Instrument, ctx: EngineContext): string {
    const usable = (code: string | undefined) => {
      const f = code ? FUNCTIONS.find((x) => x.code === code) : undefined;
      return f && f.implemented && isSecurityFunction(f) && this.fnSupports(f, inst, ctx) ? f.code : undefined;
    };
    return usable(ctx.panel.fn) ?? usable(ctx.defaultFn?.(inst.assetClass)) ?? DEFAULT_FUNCTION;
  }

  private progressFor(
    segs: Segment[],
    plan: EnterPlan,
    security: Instrument | undefined,
    fn: FunctionDef | undefined,
    fnImplied: boolean,
    current: number,
  ): { items: ProgressItem[]; message: string } {
    const secSeg = segs.find((s) => s.slot === 'security');
    const mSeg = segs.find((s) => s.slot === 'market');
    const aSeg = segs.find((s) => s.slot === 'asset');
    const fSeg = segs.find((s) => s.slot === 'function' || s.slot === 'closed');
    const state = (seg: Segment | undefined, done: boolean): ProgressItem['state'] => {
      if (seg && (seg.status === 'invalid' || seg.status === 'unavailable' || seg.status === 'nomatch')) return 'error';
      if (seg && seg.index === current) return 'current';
      if (done) return 'done';
      return seg ? 'current' : 'empty';
    };
    const items: ProgressItem[] = [
      {
        slot: 'security',
        label: '종목',
        state: state(secSeg, !!security),
        text: security ? `${security.code} ${displayName(security)}` : secSeg ? `${secSeg.text}…` : '',
      },
      {
        slot: 'market',
        label: '시장',
        state: security && !security.market ? 'done' : state(mSeg, !!security?.market),
        text: security?.market ? `${security.market} ${MARKET_LABEL[security.market]}` : security ? '—' : '',
      },
      {
        slot: 'asset',
        label: '자산군',
        state: state(aSeg, !!security),
        text: security ? `${security.assetClass} ${ASSET_LABEL[security.assetClass]}` : aSeg?.asset ? `${aSeg.asset} ${ASSET_LABEL[aSeg.asset]}` : '',
      },
      {
        slot: 'function',
        label: '기능',
        state: state(fSeg, !!fn && !fnImplied),
        text: fn ? (fnImplied ? `Tab = ${fn.code}` : fn.code) : fSeg ? `${fSeg.text}…` : '',
      },
    ];
    let message = '';
    const noted = segs.find((s) => s.note);
    if (plan.kind === 'error') message = `✗ ${plan.message}`;
    else if (plan.kind === 'nomatch') message = `'${plan.text}'와 일치하는 종목·기능이 없어요`;
    else if (plan.kind === 'need-security') message = `${plan.fn.code}에 쓸 종목을 입력하세요`;
    else if (secSeg?.byOverride && security) {
      const alt = security.assetClass === 'CRYPTO' ? `미국 종목은 ↓ 또는 ${secSeg.text.toUpperCase()} US` : '다른 뜻은 ↓';
      message = `${secSeg.text.toUpperCase()} → ${ASSET_LABEL[security.assetClass]}(${security.code}${security.assetClass === 'CRYPTO' ? '/USDT' : ''})으로 읽었어요 · ${alt}`;
    } else if (noted?.note) message = noted.note;
    else if (plan.kind === 'select') {
      const seg = segs[plan.segment];
      message = seg?.chooseReason === 'ambiguous' ? `'${seg.text}'는 여러 종목이에요 — ↓로 고르세요` : `${seg?.slot === 'security' ? '종목' : '기능'}을 고르세요 — Tab 또는 ↓`;
    } else if (plan.kind === 'execute' && fnImplied && fn) message = `다음: 기능을 고르세요 — Tab = ${fn.code} ${fn.nameKo}, ↓ 다른 기능`;
    else if (plan.kind === 'execute') message = '⏎ GO';
    if (secSeg && security && /[ㄱ-ㅎ가-힣]/.test(secSeg.text) && secSeg.status !== 'choose' && !message.startsWith('✗') && !noted) {
      message = `${secSeg.text} → ${security.code} ${displayName(security)}`;
    }
    return { items, message };
  }

  // ── Tab·클릭 ──

  applyRow(a: Analysis, row: Row, ctx: EngineContext): ApplyResult {
    if (row.kind === 'header' || row.disabled) return { input: a.input, cursor: a.cursor, noop: true };
    if (row.replaceLine !== undefined) {
      const line = row.replaceLine;
      return { input: line, cursor: line.length, closeList: true };
    }
    const segs = a.segments;
    const seg = segs[a.listSegment];
    const input = a.input;
    let start: number;
    let end: number;
    if (seg) {
      start = seg.start;
      end = seg.end;
    } else {
      start = end = input.length;
    }
    let insert = row.insert;
    let chosen: ChosenToken | undefined;
    const after = input.slice(end);
    const restEmpty = after.trim() === '';

    if (seg && seg.text === insert && a.plan.kind === 'execute' && restEmpty && row.kind !== 'security') {
      return { input, cursor: input.length, noop: true };
    }

    if (row.kind === 'security' && row.instrumentId && seg?.slot === 'arg') {
      // 비교 종목: 자산군까지 붙이면 다음 비교 종목으로 읽혀서 미국 종목만 시장을 붙여요(AAPL US)
      const inst = this.index.get(row.instrumentId)?.inst;
      chosen = { start, text: insert, rowId: row.id };
      if (inst?.market === 'US') insert += ' US';
    } else if (row.kind === 'security' && row.instrumentId) {
      const inst = this.index.get(row.instrumentId)?.inst;
      chosen = { start, text: insert, rowId: row.id };
      const next = segs[a.listSegment + 1];
      if (inst && ctx.tabAutofill && !(next && (next.slot === 'market' || next.slot === 'asset'))) {
        insert += inst.market ? ` ${inst.market} ${inst.assetClass}` : ` ${inst.assetClass}`;
      }
      if (seg && seg.status !== 'choose' && seg.inst?.id === row.instrumentId && restEmpty && seg.text.toUpperCase() === row.insert.toUpperCase()) {
        // 이미 정해진 종목: 시장·자산군만 채워요
      }
    }
    let out = input.slice(0, start) + insert;
    let closeList = false;
    if (restEmpty) {
      if (row.kind === 'function' || row.kind === 'command' || row.kind === 'convert' || row.kind === 'unavailable' || row.kind === 'arg') closeList = true;
      else out += ' ';
      const cursor = out.length;
      return { input: out, cursor, chosen, closeList };
    }
    const cursor = out.length;
    out += after;
    return { input: out, cursor, chosen, closeList };
  }

  /** Enter(05 §3.6). selectedRowId는 화면에서 선택(▶)한 줄이에요 */
  enter(a: Analysis, ctx: EngineContext, selectedRowId?: string): EnterOutcome {
    // 직접 조회 줄을 고른 두 번째 Enter: 조회한 뒤 이 줄의 기능으로 열어요(기능이 없으면 GP)
    if (selectedRowId?.startsWith('lookup:') && ctx.lookup) {
      const seg = a.segments.find((s) => s.lookup && `lookup:${s.lookup.market}:${s.lookup.code}` === selectedRowId);
      if (seg?.lookup) {
        const fn = a.segments.find((s) => s.slot === 'function' && s.fn)?.fn?.code ?? 'GP';
        return { kind: 'execute', exec: { kind: 'lookup', lookup: seg.lookup, fn, canonical: `${seg.lookup.code} ${fn}`, notes: ['직접 조회'] } };
      }
    }
    if (selectedRowId) {
      const row = a.rows.find((r) => r.id === selectedRowId);
      if (row && !row.disabled && row.kind !== 'header') {
        const applied = this.applyRow(a, row, ctx);
        const ctx2: EngineContext = applied.chosen ? { ...ctx, chosen: [...(ctx.chosen ?? []), applied.chosen] } : ctx;
        const a2 = this.analyze(applied.input, applied.cursor, ctx2);
        if (a2.plan.kind === 'execute') return { kind: 'execute', exec: a2.plan.exec, chosen: applied.chosen };
        return { kind: 'accepted', input: applied.input, cursor: applied.cursor, chosen: applied.chosen };
      }
    }
    const p = a.plan;
    switch (p.kind) {
      case 'execute':
        return { kind: 'execute', exec: p.exec };
      case 'select':
        return { kind: 'select', segment: p.segment, rowId: p.rowId };
      case 'need-security':
        return { kind: 'need-security', fn: p.fn };
      case 'error':
        return { kind: 'error', message: p.message };
      case 'nomatch':
        return { kind: 'nomatch' };
      case 'empty':
        return { kind: 'empty' };
    }
  }
}

// ── 도우미 ──

function rankIn(order: string[], code: string): number {
  const i = order.indexOf(code);
  return i < 0 ? 999 : i;
}

/** 별칭 이름 검사: 2~12글자 영문·숫자·한글, 기능·명령·시장·자산군 단어는 안 돼요(그 뜻이 먼저라 별칭이 쓰이지 않아요) */
export function aliasNameError(w: string): string | undefined {
  const t = normalizeText(w);
  if (!/^[A-Za-z0-9가-힣]{2,12}$/.test(t)) return '별칭은 영문·숫자·한글 2~12글자예요';
  const up = t.toUpperCase();
  if (exactFunction(t)) return `${up}는 기능이라 별칭으로 쓸 수 없어요`;
  if (commandOf(t)) return `${t}는 명령이라 별칭으로 쓸 수 없어요`;
  if (MARKET_WORDS[up] || ASSET_WORDS[up] || ASSET_WORDS[t] || RESERVED_ASSET_WORDS[up]) return `${up}는 시장·자산군 단어라 별칭으로 쓸 수 없어요`;
  if (up === 'GO') return 'GO는 별칭으로 쓸 수 없어요';
  return undefined;
}

/** 기능 인자 줄: MOST 뒤의 코스피·코스닥·미국·코인 */
function argRows(fn: FunctionDef, text: string): Row[] {
  const a = fn.args!;
  const exact = argValue(fn, text);
  const list = exact ? a.choices.filter((c) => c.code === exact) : argChoices(fn, text);
  return list.map((c, i) => ({
    id: `arg:${fn.code}:${c.code}`,
    kind: 'arg' as const,
    badge: 'ARG',
    code: c.code,
    name: c.label,
    info: `${fn.code} ${a.label}${i === 0 && c.code === a.choices[0].code ? ' · 기본값' : ''}`,
    flags: [],
    canonical: `${fn.code} ${c.code}`,
    tier: 0,
    insert: c.code,
  }));
}

function headerRow(text: string): Row {
  return {
    id: `hdr:${text}`,
    kind: 'header',
    badge: '',
    code: '',
    name: text,
    info: '',
    flags: [],
    canonical: '',
    tier: 99,
    insert: '',
    disabled: true,
  };
}

/** 마스터에 없는 코드의 직접 조회 줄. 키가 없으면 안내만(고를 수 없음) */
function lookupRow(lk: { code: string; market: 'KR' | 'US' }, enabled: boolean): Row {
  return {
    id: `lookup:${lk.market}:${lk.code}`,
    kind: 'lookup',
    badge: 'KIS',
    code: lk.code,
    name: enabled ? '목록에 없는 코드예요 — ⏎로 한국투자증권에서 직접 조회' : '목록에 없는 코드예요 — 한국투자증권 키를 넣으면 직접 조회할 수 있어요',
    info: lk.market === 'KR' ? '국내 주식 코드 모양' : '미국 티커 모양',
    flags: [],
    canonical: lk.code,
    tier: 99,
    insert: lk.code,
    disabled: !enabled,
  };
}

/** 직접 조회해 볼 만한 코드 모양: 국내 6자리(숫자로 시작, 새 코드는 영문 포함), 미국 티커(영문 1~5자, .B 같은 클래스) */
export function lookupShape(key: string, market?: Market): { code: string; market: 'KR' | 'US' } | undefined {
  if (market !== 'US' && /^[0-9][0-9A-Z]{5}$/.test(key)) return { code: key, market: 'KR' };
  if (market !== 'KS' && market !== 'KQ' && /^[A-Z]{1,5}(?:[./][A-Z])?$/.test(key)) return { code: key, market: 'US' };
  return undefined;
}

/** 뒤 단계에서 쓸 코드 모양(05 §3.7, 08 §4.5). 지금은 안내만 해요 */
export function reservedShape(key: string): string | undefined {
  // 채권 ISIN(KR로 시작하는 12자리 등)
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(key) && /[0-9]/.test(key.slice(2))) return `${key}는 채권 ISIN 모양이에요 — 채권(GOVT·CORP)은 v0.7에서 제공 예정`;
  // 국내 지수선물·옵션 단축코드(101W9000, 201W9340, 301W9340 등: 1 선물, 2 콜, 3 풋)
  if (/^[1-4]0[0-9][A-Z0-9]{2}[0-9]{3}$/.test(key)) {
    const kind = key[0] === '1' || key[0] === '4' ? '지수선물' : '지수옵션';
    return `${key}는 국내 ${kind} 코드 모양이에요 — ${kind === '지수선물' ? '지수선물은 v0.6' : '옵션은 v0.10'}에서 제공 예정`;
  }
  // 월물이 붙은 선물(KMZ5, ESZ25)과 연속 월물(CO1, KM1)
  if (/^[A-Z]{1,3}[FGHJKMNQUVXZ][0-9]{1,2}$/.test(key) || /^[A-Z]{1,3}[1-9]$/.test(key)) {
    return `${key}는 선물 월물 코드 모양이에요 — 지수선물 v0.6, 국채선물 v0.7, 원자재 v0.11에서 제공 예정`;
  }
  return undefined;
}

/** 알아들은 시장·자산군 줄(✓). 이미 다 쳤으니 고를 것은 없어요 */
function recognizedRow(kind: 'market' | 'asset', code: string, label: string, info: string): Row {
  return {
    id: `${kind === 'market' ? 'mkt' : 'asset'}:${code}`,
    kind,
    badge: kind === 'market' ? 'MKT' : code,
    code,
    name: label,
    info: `${info} ✓`,
    flags: [],
    canonical: code,
    tier: 0,
    insert: code,
    disabled: true,
  };
}

function noMatchRow(text: string): Row {
  return {
    id: `nomatch:${text}`,
    kind: 'nomatch',
    badge: '',
    code: '',
    name: `'${text}'와 일치하는 종목·기능이 없어요`,
    info: '',
    flags: [],
    canonical: '',
    tier: 99,
    insert: text,
    disabled: true,
  };
}

function completion(typed: string, target: string, rest: string, confirmed: boolean): Ghost {
  if (target.toUpperCase().startsWith(typed.toUpperCase())) {
    return { tab: target.slice(typed.length), rest, confirmed, replace: false };
  }
  return { tab: target, rest, confirmed, replace: true };
}

export function shortSecurity(inst: Instrument): string {
  return inst.market ? `${inst.code} ${inst.market}` : inst.code;
}

/** 가장 짧은 명령에 쓰는 종목 부분: 005930, AAPL US, BTC */
function shortCommandSecurity(inst: Instrument): string {
  if (inst.market === 'US') return `${inst.code} US`;
  return inst.code;
}

export function securityInfo(inst: Instrument): string {
  const f = inst.flags ?? [];
  if (inst.assetClass === 'CRYPTO') return '바이낸스 · USDT';
  if (inst.assetClass === 'CURNCY') return '환율';
  if (inst.assetClass === 'INDEX') return '지수';
  const parts: string[] = [];
  if (inst.market === 'US') parts.push(inst.exchange === 'NAS' ? '나스닥' : inst.exchange === 'NYS' ? '뉴욕' : inst.exchange === 'AMS' ? '아멕스' : '미국');
  else if (inst.market) parts.push(MARKET_LABEL[inst.market]);
  if (f.includes('ETF')) parts.push('ETF');
  else if (f.includes('ETN')) parts.push('ETN');
  else if (f.includes('PREF')) parts.push('우선주');
  else if (f.includes('REIT')) parts.push('리츠');
  else if (inst.market !== 'US') parts.push('보통주');
  return parts.join(' · ');
}

/** ⏎ 라벨의 종목 이름: 비트코인(BTC/USDT), 삼성전자, AAPL */
export function labelSecurity(inst: Instrument): string {
  if (inst.assetClass === 'CRYPTO') return `${inst.nameKo ?? inst.code}(${inst.code}/USDT)`;
  if (inst.market === 'US') return inst.code;
  return displayName(inst);
}

function selectLabel(row: Row): string {
  if (row.kind === 'security') return `${row.code} ${row.name}`;
  if (row.kind === 'function' || row.kind === 'unavailable') return `${row.code} ${row.name.replace(/^.* → /, '')}`;
  return row.name || row.code;
}

export function labelFor(plan: EnterPlan, index?: SearchIndex): string {
  switch (plan.kind) {
    case 'execute': {
      const e = plan.exec;
      if (e.kind === 'command') {
        if (e.cmd === 'alias') {
          const inst = e.instrumentId ? index?.get(e.instrumentId)?.inst : undefined;
          return e.args?.[0] && inst ? `⏎ 실행: 별칭 ${e.args[0]} → ${labelSecurity(inst)} 만들기` : '⏎ 실행: 별칭 목록(설정 → 커맨드 라인)';
        }
        return e.cmd === 'settings' ? '⏎ 실행: 설정 창 열기' : e.cmd === 'syntax' ? '⏎ 실행: 문법 요약' : '⏎ 실행: 도움말';
      }
      if (e.kind === 'asset-list') return `⏎ 목록: ${ASSET_LABEL[e.asset!]} 종목`;
      if (e.fn === 'MENU') {
        const inst = e.instrumentId ? index?.get(e.instrumentId)?.inst : undefined;
        return `⏎ 기능 메뉴: ${inst ? labelSecurity(inst) : e.canonical}`;
      }
      const fn = FUNCTIONS.find((f) => f.code === e.fn)!;
      const notes = e.notes.length > 0 ? ` (${e.notes.join(', ')})` : '';
      if (!isSecurityFunction(fn)) {
        const arg = e.args?.length && fn.args ? ` · ${e.args.map((v) => fn.args!.choices.find((c) => c.code === v)?.label ?? v).join(', ')}` : '';
        return `⏎ 실행: ${fn.nameKo}${arg} (종목 불필요)${notes}`;
      }
      const inst = e.instrumentId ? index?.get(e.instrumentId)?.inst : undefined;
      const name = inst ? labelSecurity(inst) : e.canonical.split(' ')[0];
      const vs = e.args?.length ? ` · 비교: ${e.args.map((id) => { const x = index?.get(id)?.inst; return x ? displayName(x) : id; }).join(', ')}` : '';
      return `⏎ 실행: ${name} ${fn.nameKo}${notes || ` (${fn.code})`}${vs}`;
    }
    case 'select':
      return `⏎ 선택: ${plan.label}`;
    case 'need-security':
      return `⏎ 종목 필요: ${plan.fn.code}에 쓸 종목을 입력하세요`;
    case 'error':
      return `⏎ 실행 안 됨: ${plan.message}`;
    case 'nomatch':
      // v0.2: Enter로 로컬 검색 페이지(05 §4.4)
      return '⏎ 검색';
    case 'empty':
      return '';
  }
}

export type { CommandWord, Market };
