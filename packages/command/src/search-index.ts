// 종목 색인과 찾기(05 §6.1~6.4). 목록은 네트워크를 기다리지 않고 메모리의 색인에서 바로 찾아요.

import type { AssetClass, Instrument, Market } from '@bt/shared';
import {
  hangulToKeys,
  hangulToQwerty,
  hasHangul,
  isChosungQuery,
  isConsonantJamo,
  isSyllable,
  splitDoubleConsonants,
  toChosung,
  toKeystrokeJamo,
  decompose,
} from './hangul';
import { codeKey } from './lexicon';

export interface Range {
  start: number;
  end: number;
}

export interface IndexRecord {
  inst: Instrument;
  /** 코드와 심볼 별칭(대문자, 구분자 제거) */
  codeKeys: string[];
  /** 한국어 별칭 키워드(원달러, 나스닥 등, 공백 제거) */
  aliasKeys: string[];
  nameKoKey: string;
  nameEnKey: string;
  /** 영문 이름의 단어 시작마다 그 뒤를 이은 문자열 */
  enStarts: Array<{ key: string; word: number }>;
  jamo: string;
  cho: string;
  /** 한글 이름을 영문 자판으로 친 키 */
  keys: string;
  /** 영문 이름의 머리글자(bank of america → boa, ba). 두 단어 이상인 이름만(v0.2) */
  acr: string[];
}

export type MatchVia =
  | 'code'
  | 'alias'
  | 'nameKo'
  | 'nameEn'
  | 'jamo'
  | 'cho'
  | 'substr'
  | 'zero'
  | 'hanToEng'
  | 'engToHan'
  /** 영문 머리글자(v0.2) */
  | 'acronym'
  /** 한 글자 틀린 영문 이름(T9, v0.2) */
  | 'typo'
  /** 사용자가 만든 별칭(ALIAS, v0.2) */
  | 'user';

export interface SecurityMatch {
  rec: IndexRecord;
  /** T0~T8 */
  tier: number;
  /** 같은 등급 안의 세부 순서(작을수록 위) */
  sub: number;
  via: MatchVia;
  /** 짧은 입력 규칙 때문에 정확으로 치지 않은 정확 일치 */
  shortExact?: boolean;
  codeRanges?: Range[];
  /** 이름 강조 범위를 만들 재료. 범위는 nameRangesOf로 보이는 줄에서만 계산해요 */
  hl?: { kind: 'ko' | 'ko-full' | 'en'; start?: number; len?: number };
  /** 한/영 변환으로 찾았을 때 변환한 글자 */
  converted?: string;
}

export interface SearchOptions {
  /** 줄 첫머리인지(짧은 입력 규칙) */
  first: boolean;
  composing?: boolean;
  asset?: AssetClass;
  market?: Market;
  hanEng?: boolean;
}

function noSpace(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 머리글자에서 빼는 단어(bank of america corp → ba도 함께) */
const ACR_STOP = new Set(['of', 'the', 'and', '&', 'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'holdings', 'holding', 'group', 'class', 'sa', 'nv', 'ag', 'adr', 'etf', 'trust', 'fund']);

/** 영문 이름의 머리글자: 모든 단어, 접미사·관사를 뺀 단어. 두 글자 이상만 */
export function acronymsOf(nameEn: string | undefined): string[] {
  const words = (nameEn ?? '').toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  if (words.length < 2) return [];
  const all = words.map((w) => w[0]).join('');
  const core = words
    .filter((w) => !ACR_STOP.has(w))
    .map((w) => w[0])
    .join('');
  return [...new Set([all, core])].filter((a) => a.length >= 2);
}

/**
 * 오타 한 글자(T9): 바꾸기·넣기·빼기·이웃 글자 맞바꾸기 중 하나로 같아지는지(Damerau 거리 1 이하)
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    // 바꾸기 한 번 또는 이웃 두 글자 맞바꾸기
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

export function buildRecord(inst: Instrument): IndexRecord {
  const codeKeys = new Set<string>([codeKey(inst.code)]);
  const aliasKeys: string[] = [];
  for (const a of inst.aliases ?? []) {
    if (hasHangul(a)) aliasKeys.push(noSpace(a).toLowerCase());
    else codeKeys.add(codeKey(a));
  }
  const nameKoKey = noSpace(inst.nameKo ?? '').toLowerCase();
  const nameEn = (inst.nameEn ?? '').toLowerCase();
  const words = nameEn.split(/[^a-z0-9&]+/).filter(Boolean);
  const enStarts = words.map((_, i) => ({ key: words.slice(i).join(''), word: i }));
  return {
    inst,
    codeKeys: [...codeKeys],
    aliasKeys,
    nameKoKey,
    nameEnKey: words.join(''),
    enStarts,
    jamo: hasHangul(nameKoKey) ? toKeystrokeJamo(nameKoKey) : '',
    cho: hasHangul(nameKoKey) ? toChosung(nameKoKey) : '',
    keys: hasHangul(nameKoKey) ? hangulToKeys(nameKoKey) : '',
    acr: acronymsOf(inst.nameEn),
  };
}

/**
 * 색인을 화면과 다른 스레드(웹 워커)에서 만들 때 넘기는 압축 형태(05 §6.1, §14.2).
 * 레코드 객체 수만 개를 넘기면 복사가 느려서, 칸마다 문자열 하나로 이어 붙여 넘겨요.
 */
export interface PackedRecords {
  count: number;
  codeKeys: string;
  aliasKeys: string;
  nameKoKey: string;
  nameEnKey: string;
  enStarts: string;
  jamo: string;
  cho: string;
  keys: string;
  acr: string;
}

const REC = '\u0001';
const ITEM = '\u0002';

export function packRecords(insts: Instrument[]): PackedRecords {
  const cols = { codeKeys: [] as string[], aliasKeys: [] as string[], nameKoKey: [] as string[], nameEnKey: [] as string[], enStarts: [] as string[], jamo: [] as string[], cho: [] as string[], keys: [] as string[], acr: [] as string[] };
  for (const inst of insts) {
    const r = buildRecord(inst);
    cols.codeKeys.push(r.codeKeys.join(ITEM));
    cols.aliasKeys.push(r.aliasKeys.join(ITEM));
    cols.nameKoKey.push(r.nameKoKey);
    cols.nameEnKey.push(r.nameEnKey);
    cols.enStarts.push(r.enStarts.map((x) => x.key).join(ITEM));
    cols.jamo.push(r.jamo);
    cols.cho.push(r.cho);
    cols.keys.push(r.keys);
    cols.acr.push(r.acr.join(ITEM));
  }
  return {
    count: insts.length,
    codeKeys: cols.codeKeys.join(REC),
    aliasKeys: cols.aliasKeys.join(REC),
    nameKoKey: cols.nameKoKey.join(REC),
    nameEnKey: cols.nameEnKey.join(REC),
    enStarts: cols.enStarts.join(REC),
    jamo: cols.jamo.join(REC),
    cho: cols.cho.join(REC),
    keys: cols.keys.join(REC),
    acr: cols.acr.join(REC),
  };
}

/** 압축 형태를 레코드로 되돌려요. 종목 순서는 packRecords에 넣은 순서와 같아야 해요 */
export function unpackRecords(insts: Instrument[], p: PackedRecords): IndexRecord[] {
  if (p.count !== insts.length) throw new Error('색인과 종목 수가 달라요');
  const col = (s: string) => (p.count === 0 ? [] : s.split(REC));
  const items = (s: string) => (s ? s.split(ITEM) : []);
  const codeKeys = col(p.codeKeys);
  const aliasKeys = col(p.aliasKeys);
  const nameKoKey = col(p.nameKoKey);
  const nameEnKey = col(p.nameEnKey);
  const enStarts = col(p.enStarts);
  const jamo = col(p.jamo);
  const cho = col(p.cho);
  const keys = col(p.keys);
  const acr = col(p.acr ?? '');
  const out: IndexRecord[] = new Array(insts.length);
  for (let i = 0; i < insts.length; i++) {
    out[i] = {
      inst: insts[i],
      codeKeys: items(codeKeys[i]),
      aliasKeys: items(aliasKeys[i]),
      nameKoKey: nameKoKey[i],
      nameEnKey: nameEnKey[i],
      enStarts: items(enStarts[i]).map((key, word) => ({ key, word })),
      jamo: jamo[i],
      cho: cho[i],
      keys: keys[i],
      acr: items(acr[i] ?? ''),
    };
  }
  return out;
}

/** 공백을 뺀 위치를 원래 문자열 위치로 바꿔요 */
export function mapNoSpaceRange(display: string, start: number, len: number): Range {
  let ns = 0;
  let s = -1;
  let e = display.length;
  for (let i = 0; i < display.length; i++) {
    if (/\s/.test(display[i])) continue;
    if (ns === start && s < 0) s = i;
    ns++;
    if (ns === start + len) {
      e = i + 1;
      break;
    }
  }
  return { start: Math.max(0, s), end: e };
}

/** 영문 이름에서 word번째 단어 시작부터 len글자(공백·기호 제외)의 위치 */
function mapEnRange(display: string, word: number, len: number): Range {
  const re = /[A-Za-z0-9&]+/g;
  let m: RegExpExecArray | null;
  let w = 0;
  let start = 0;
  while ((m = re.exec(display))) {
    if (w === word) {
      start = m.index;
      break;
    }
    w++;
  }
  let count = 0;
  let end = start;
  for (let i = start; i < display.length && count < len; i++) {
    if (/[A-Za-z0-9&]/.test(display[i])) count++;
    end = i + 1;
  }
  return { start, end };
}

export interface QueryInfo {
  raw: string;
  key: string;
  lower: string;
  codeLike: boolean;
  hangul: boolean;
  chosung: boolean;
  jamo: string;
  /** 영문·숫자 2글자 이하 또는 한 글자: 정확으로 치지 않음 */
  short: boolean;
}

export function queryInfo(raw: string, first: boolean): QueryInfo {
  const q = raw.trim();
  const codeLike = /^[A-Za-z0-9./\-&]+$/.test(q);
  const hangul = hasHangul(q);
  const chosungQ = isChosungQuery(q);
  const len = [...q].length;
  return {
    raw: q,
    key: codeKey(q),
    lower: noSpace(q).toLowerCase(),
    codeLike,
    hangul,
    chosung: chosungQ,
    jamo: hangul ? toKeystrokeJamo(noSpace(q)) : '',
    short: first && (len <= 1 || (codeLike && len <= 2)),
  };
}

export class SearchIndex {
  records: IndexRecord[] = [];
  private byId = new Map<string, IndexRecord>();
  private byCode = new Map<string, IndexRecord[]>();
  /**
   * 영문·숫자 검색어용 앞글자 목록: 코드·이름·영문 단어·자판 키의 첫 1글자, 첫 2글자 → 레코드.
   * 영문·숫자로 찾는 모든 등급은 어떤 키가 검색어로 시작해야 해서, 이 목록 밖은 볼 필요가 없어요
   */
  private byFirst1 = new Map<string, IndexRecord[]>();
  private byFirst2 = new Map<string, IndexRecord[]>();

  constructor(instruments: Instrument[] = []) {
    this.setInstruments(instruments);
  }

  setInstruments(instruments: Instrument[]) {
    this.setRecords(instruments.map(buildRecord));
  }

  /** 다른 스레드에서 만든 레코드로 바꿔요(packRecords → unpackRecords) */
  setRecords(records: IndexRecord[]) {
    this.records = records;
    this.byId.clear();
    this.byCode.clear();
    this.byFirst1.clear();
    this.byFirst2.clear();
    for (const r of this.records) this.link(r);
  }

  /** 직접 조회로 찾은 종목을 더해요(05 §4.5). 이미 있으면 바꾸지 않아요 */
  addInstrument(inst: Instrument): IndexRecord {
    const had = this.byId.get(inst.id);
    if (had) return had;
    const r = buildRecord(inst);
    this.records.push(r);
    this.link(r);
    return r;
  }

  /** 레코드를 찾기 표(id, 코드, 앞글자 목록)에 넣어요 */
  private link(r: IndexRecord) {
    this.byId.set(r.inst.id, r);
    for (const k of r.codeKeys) push(this.byCode, k, r);
    const s1 = new Set<string>();
    const s2 = new Set<string>();
    const addKey = (k: string) => {
      if (!k) return;
      const low = k.toLowerCase();
      s1.add(low[0]);
      if (low.length >= 2) s2.add(low.slice(0, 2));
    };
    for (const k of r.codeKeys) addKey(k);
    addKey(r.nameKoKey);
    addKey(r.nameEnKey);
    for (const e of r.enStarts) addKey(e.key);
    addKey(r.keys);
    for (const a of r.acr) addKey(a);
    // 앞자리 0이 빠진 국내 코드(5930 → 005930)
    const inst = r.inst;
    if ((inst.market === 'KS' || inst.market === 'KQ') && inst.code.length === 6) addKey(inst.code.replace(/^0+/, ''));
    for (const k of s1) push(this.byFirst1, k, r);
    for (const k of s2) push(this.byFirst2, k, r);
  }

  /** 영문·숫자 검색어가 볼 레코드. 한글 검색어는 부분 일치(T7) 때문에 모두 봐요 */
  private candidates(q: QueryInfo): IndexRecord[] {
    if (q.hangul || !q.codeLike) return this.records;
    const heads = new Set([q.lower, q.key.toLowerCase()].filter(Boolean));
    const lists: IndexRecord[][] = [];
    for (const h of heads) {
      const list = h.length >= 2 ? this.byFirst2.get(h.slice(0, 2)) : this.byFirst1.get(h[0]);
      if (list) lists.push(list);
    }
    if (lists.length <= 1) return lists[0] ?? [];
    return [...new Set(lists.flat())];
  }

  get(id: string): IndexRecord | undefined {
    return this.byId.get(id);
  }

  /** 정확한 코드·심볼 별칭으로 찾기 */
  exactCode(key: string): IndexRecord[] {
    return this.byCode.get(codeKey(key)) ?? [];
  }

  /** 여러 단어 이름의 정확 일치(05 §7.6): 공백을 뺀 이름이 같은 종목 */
  exactName(text: string): IndexRecord[] {
    const k = noSpace(text).toLowerCase();
    if (!k) return [];
    return this.records.filter((r) => r.nameKoKey === k || r.nameEnKey === k);
  }

  /**
   * 종목 찾기. 키를 누를 때마다 전체 레코드를 한 번 훑어요(05 §14.1 p95 ≤ 2ms).
   * 레코드마다 객체·함수를 만들지 않고, 강조 범위는 보이는 줄에서만 계산해요(nameRangesOf).
   */
  search(raw: string, opts: SearchOptions): SecurityMatch[] {
    const q = queryInfo(raw, opts.first);
    if (!q.raw) return [];
    const out: SecurityMatch[] = [];
    const chosungQuery = q.chosung ? splitDoubleConsonants(q.raw) : '';
    const mixedCho = !q.chosung && q.hangul && [...q.raw].some(isConsonantJamo) && [...q.raw].some(isSyllable);
    const hanToEng = opts.hanEng !== false && q.hangul ? hangulToQwerty(noSpace(q.raw)) : '';
    const engLower = opts.hanEng !== false && q.codeLike && /^[a-zA-Z]{3,}$/.test(q.raw) ? q.raw.toLowerCase() : '';
    const digits = /^\d{1,5}$/.test(q.raw) ? q.raw : '';
    const sylLen = [...q.lower].length;
    const latin = !q.hangul && !!q.lower;
    const jamoQuery = q.hangul && !q.chosung ? q.jamo : '';
    const substr = q.hangul && !q.chosung;
    const asset = opts.asset;
    const market = opts.market;

    const records = this.candidates(q);
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const inst = r.inst;
      if (asset && inst.assetClass !== asset) continue;
      if (market && inst.market !== market) continue;

      let best: SecurityMatch | null = null;

      // T0: 정확한 코드·심볼 별칭·한국어 키워드
      if (q.codeLike && r.codeKeys.includes(q.key)) {
        best = q.short
          ? { rec: r, tier: 3, sub: -1, via: 'code', shortExact: true, codeRanges: [{ start: 0, end: inst.code.length }] }
          : { rec: r, tier: 0, sub: 0, via: 'code', codeRanges: [{ start: 0, end: inst.code.length }] };
      }
      if (q.hangul && !q.short && r.aliasKeys.length && r.aliasKeys.includes(q.lower)) {
        best = pick(best, { rec: r, tier: 0, sub: 1, via: 'alias' });
      }
      // T1: 정확한 전체 이름
      if (!best || best.tier > 1) {
        if (r.nameKoKey && r.nameKoKey === q.lower) {
          best = pick(best, q.short ? { rec: r, tier: 3, sub: -1, via: 'nameKo', shortExact: true } : { rec: r, tier: 1, sub: 0, via: 'nameKo', hl: { kind: 'ko-full' } });
        } else if (r.nameEnKey && r.nameEnKey === q.lower) {
          best = pick(best, q.short ? { rec: r, tier: 3, sub: -1, via: 'nameEn', shortExact: true } : { rec: r, tier: 1, sub: 1, via: 'nameEn' });
        }
      }
      if (best && best.tier <= 1) {
        out.push(best);
        continue;
      }
      // T3: 코드 앞부분
      if (q.codeLike && q.key) {
        const keys = r.codeKeys;
        for (let j = 0; j < keys.length; j++) {
          const k = keys[j];
          if (k.length > q.key.length && k.startsWith(q.key)) {
            best = pick(best, { rec: r, tier: 3, sub: k.length - q.key.length, via: 'code', codeRanges: j === 0 ? [{ start: 0, end: q.raw.length }] : undefined });
            break;
          }
        }
      }
      // T4: 이름 앞부분(한글은 음절, 영문은 단어 시작)
      const ko = r.nameKoKey;
      const koPrefix = !!ko && ko !== q.lower && ko.startsWith(q.lower);
      if (koPrefix) best = pick(best, { rec: r, tier: 4, sub: 0, via: 'nameKo', hl: { kind: 'ko', start: 0, len: sylLen } });
      if (q.hangul && r.aliasKeys.length && r.aliasKeys.some((a) => a !== q.lower && a.startsWith(q.lower))) {
        best = pick(best, { rec: r, tier: 4, sub: 1, via: 'alias' });
      }
      if (latin && (!best || best.tier > 4)) {
        const starts = r.enStarts;
        for (let j = 0; j < starts.length; j++) {
          if (starts[j].key.startsWith(q.lower)) {
            best = pick(best, { rec: r, tier: 4, sub: starts[j].word === 0 ? 2 : 3, via: 'nameEn', hl: { kind: 'en', start: starts[j].word, len: q.lower.length } });
            break;
          }
        }
      }
      if (best && best.tier <= 4 && !jamoQuery) {
        out.push(best);
        continue;
      }
      // T5: 자모 앞부분(마지막 음절 미완성). 조합 중에는 T4와 같은 순위(K7)
      if (jamoQuery && r.jamo && !koPrefix && r.jamo.startsWith(jamoQuery)) {
        best = pick(best, { rec: r, tier: opts.composing ? 4 : 5, sub: opts.composing ? 1 : 0, via: 'jamo', hl: { kind: 'ko', start: 0, len: sylLen } });
      }
      // T6: 초성
      if (chosungQuery) {
        if (r.cho && r.cho.startsWith(chosungQuery)) {
          best = pick(best, { rec: r, tier: 6, sub: r.cho === chosungQuery ? 0 : 1, via: 'cho', hl: { kind: 'ko', start: 0, len: chosungQuery.length } });
        }
      } else if (mixedCho && ko && matchMixedChosung(q.lower, ko)) {
        best = pick(best, { rec: r, tier: 6, sub: 2, via: 'cho', hl: { kind: 'ko', start: 0, len: sylLen } });
      }
      // T7: 음절·단어 경계의 부분 일치, 앞자리 0이 빠진 코드
      if (substr && ko && (!best || best.tier > 7)) {
        const idx = ko.indexOf(q.lower);
        if (idx > 0) best = pick(best, { rec: r, tier: 7, sub: idx, via: 'substr', hl: { kind: 'ko', start: [...ko.slice(0, idx)].length, len: sylLen } });
      }
      if (digits && (inst.market === 'KS' || inst.market === 'KQ') && inst.code.length === 6 && digits.length < 6) {
        if (inst.code.replace(/^0+/, '') === digits) {
          best = pick(best, { rec: r, tier: 7, sub: 0, via: 'zero', codeRanges: [{ start: 6 - digits.length, end: 6 }] });
        }
      }
      // T8: 한/영 변환
      if (hanToEng.length >= 2) {
        if (r.codeKeys.includes(hanToEng)) best = pick(best, { rec: r, tier: 8, sub: 0, via: 'hanToEng', converted: hanToEng });
        else if (r.codeKeys.some((k) => k.length >= 3 && k.startsWith(hanToEng))) {
          best = pick(best, { rec: r, tier: 8, sub: 1, via: 'hanToEng', converted: hanToEng });
        }
      }
      if (engLower && r.keys && r.keys.startsWith(engLower)) {
        best = pick(best, { rec: r, tier: 8, sub: 2, via: 'engToHan' });
      }
      // 영문 머리글자(v0.2): 정확하면 2글자부터, 앞부분은 3글자부터. 초성(T6)처럼 이름의 첫 글자들이라 같은 등급
      if (latin && r.acr.length && (!best || best.tier > 6)) {
        for (const a of r.acr) {
          if (a === q.lower) best = pick(best, { rec: r, tier: 6, sub: 3, via: 'acronym' });
          else if (q.lower.length >= 3 && a.startsWith(q.lower)) best = pick(best, { rec: r, tier: 6, sub: 4, via: 'acronym' });
        }
      }
      if (best) out.push(best);
    }

    // T9 오타 허용(v0.2): 4글자 이상 영문, 위 결과가 3개 미만일 때만. 영문 이름의 단어 시작과 한 글자 차이. 코드·티커에는 안 써요
    if (latin && q.lower.length >= 4 && /^[a-z]+$/.test(q.lower) && out.length < 3) {
      const have = new Set(out.map((m) => m.rec));
      const pool = this.byFirst1.get(q.lower[0]) ?? [];
      const n = q.lower.length;
      for (const r of pool) {
        if (have.has(r)) continue;
        if (asset && r.inst.assetClass !== asset) continue;
        if (market && r.inst.market !== market) continue;
        for (const s of r.enStarts) {
          if (s.key.length < n - 1) continue;
          if (withinOneEdit(q.lower, s.key.slice(0, n)) || withinOneEdit(q.lower, s.key.slice(0, n + 1)) || withinOneEdit(q.lower, s.key.slice(0, n - 1))) {
            out.push({ rec: r, tier: 9, sub: s.word, via: 'typo', hl: { kind: 'en', start: s.word, len: n } });
            have.add(r);
            break;
          }
        }
      }
    }

    // 영→한 줄은 다른 결과가 3개 미만일 때만(05 §8.2)
    let nonConv = 0;
    for (const m of out) if (m.via !== 'engToHan') nonConv++;
    return nonConv >= 3 ? out.filter((m) => m.via !== 'engToHan') : out;
  }
}

function push(m: Map<string, IndexRecord[]>, k: string, r: IndexRecord) {
  const arr = m.get(k);
  if (arr) arr.push(r);
  else m.set(k, [r]);
}

/** 더 좋은 등급(작은 tier, 같으면 작은 sub)을 골라요 */
function pick(best: SecurityMatch | null, m: SecurityMatch): SecurityMatch {
  return !best || m.tier < best.tier || (m.tier === best.tier && m.sub < best.sub) ? m : best;
}

/** 이름 강조 범위(보이는 줄에서만 계산해요) */
export function nameRangesOf(m: SecurityMatch): Range[] | undefined {
  const hl = m.hl;
  if (!hl) return undefined;
  const inst = m.rec.inst;
  if (hl.kind === 'ko-full') return [{ start: 0, end: (inst.nameKo ?? '').length }];
  if (hl.kind === 'ko') return [mapNoSpaceRange(inst.nameKo ?? '', hl.start ?? 0, hl.len ?? 0)];
  return [mapEnRange(inst.nameEn ?? '', hl.start ?? 0, hl.len ?? 0)];
}

/** 음절 + 초성 섞인 검색어: 음절은 같고, 자음은 그 음절의 초성과 같아야 해요(삼ㅅㅈㅈ) */
function matchMixedChosung(q: string, name: string): boolean {
  const qs = [...q];
  const ns = [...name];
  if (qs.length > ns.length) return false;
  for (let i = 0; i < qs.length; i++) {
    const a = qs[i];
    const b = ns[i];
    if (isSyllable(a)) {
      if (a !== b) return false;
    } else if (isConsonantJamo(a)) {
      const d = decompose(b);
      if (!d || d[0] !== a) return false;
    } else if (a !== b) return false;
  }
  return true;
}
