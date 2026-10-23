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
  | 'engToHan';

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
  nameRanges?: Range[];
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
  };
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

  constructor(instruments: Instrument[] = []) {
    this.setInstruments(instruments);
  }

  setInstruments(instruments: Instrument[]) {
    this.records = instruments.map(buildRecord);
    this.byId.clear();
    this.byCode.clear();
    for (const r of this.records) {
      this.byId.set(r.inst.id, r);
      for (const k of r.codeKeys) {
        const arr = this.byCode.get(k);
        if (arr) arr.push(r);
        else this.byCode.set(k, [r]);
      }
    }
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

  search(raw: string, opts: SearchOptions): SecurityMatch[] {
    const q = queryInfo(raw, opts.first);
    if (!q.raw) return [];
    const out: SecurityMatch[] = [];
    const chosungQuery = q.chosung ? splitDoubleConsonants(q.raw) : '';
    const mixedCho = !q.chosung && q.hangul && [...q.raw].some(isConsonantJamo) && [...q.raw].some(isSyllable);
    const hanToEng = opts.hanEng !== false && q.hangul ? hangulToQwerty(noSpace(q.raw)) : '';
    const engLower = opts.hanEng !== false && q.codeLike && /^[a-zA-Z]{3,}$/.test(q.raw) ? q.raw.toLowerCase() : '';
    const digits = /^\d{1,5}$/.test(q.raw) ? q.raw : '';

    for (const r of this.records) {
      const inst = r.inst;
      if (opts.asset && inst.assetClass !== opts.asset) continue;
      if (opts.market && inst.market !== opts.market) continue;

      const st: { best: SecurityMatch | null } = { best: null };
      const consider = (m: SecurityMatch) => {
        const b = st.best;
        if (!b || m.tier < b.tier || (m.tier === b.tier && m.sub < b.sub)) st.best = m;
      };

      // T0: 정확한 코드·심볼 별칭·한국어 키워드
      if (q.codeLike && r.codeKeys.includes(q.key)) {
        if (q.short) consider({ rec: r, tier: 3, sub: -1, via: 'code', shortExact: true, codeRanges: [{ start: 0, end: inst.code.length }] });
        else consider({ rec: r, tier: 0, sub: 0, via: 'code', codeRanges: [{ start: 0, end: inst.code.length }] });
      }
      if (q.hangul && r.aliasKeys.includes(q.lower) && !q.short) {
        consider({ rec: r, tier: 0, sub: 1, via: 'alias' });
      }
      // T1: 정확한 전체 이름
      if (!st.best || st.best.tier > 1) {
        if (r.nameKoKey && r.nameKoKey === q.lower) {
          if (q.short) consider({ rec: r, tier: 3, sub: -1, via: 'nameKo', shortExact: true });
          else consider({ rec: r, tier: 1, sub: 0, via: 'nameKo', nameRanges: [{ start: 0, end: (inst.nameKo ?? '').length }] });
        } else if (r.nameEnKey && r.nameEnKey === q.lower) {
          if (q.short) consider({ rec: r, tier: 3, sub: -1, via: 'nameEn', shortExact: true });
          else consider({ rec: r, tier: 1, sub: 1, via: 'nameEn' });
        }
      }
      if (st.best && st.best.tier <= 1) {
        out.push(st.best);
        continue;
      }
      // T3: 코드 앞부분
      if (q.codeLike && q.key) {
        for (const k of r.codeKeys) {
          if (k.length > q.key.length && k.startsWith(q.key)) {
            consider({ rec: r, tier: 3, sub: k.length - q.key.length, via: 'code', codeRanges: k === codeKey(inst.code) ? [{ start: 0, end: q.raw.length }] : undefined });
            break;
          }
        }
      }
      // T4: 이름 앞부분(한글은 음절, 영문은 단어 시작)
      if (r.nameKoKey && r.nameKoKey.startsWith(q.lower) && r.nameKoKey !== q.lower) {
        consider({ rec: r, tier: 4, sub: 0, via: 'nameKo', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', 0, [...q.lower].length)] });
      }
      if (r.aliasKeys.some((a) => a.startsWith(q.lower) && a !== q.lower) && q.hangul) {
        consider({ rec: r, tier: 4, sub: 1, via: 'alias' });
      }
      if (!q.hangul && q.lower) {
        for (const s of r.enStarts) {
          if (s.key.startsWith(q.lower)) {
            consider({ rec: r, tier: 4, sub: s.word === 0 ? 2 : 3, via: 'nameEn', nameRanges: [mapEnRange(inst.nameEn ?? '', s.word, q.lower.length)] });
            break;
          }
        }
      }
      // T5: 자모 앞부분(마지막 음절 미완성). 조합 중에는 T4와 같은 순위(K7)
      if (q.hangul && !q.chosung && r.jamo && r.jamo.startsWith(q.jamo) && !r.nameKoKey.startsWith(q.lower)) {
        const syl = [...q.lower].length;
        consider({ rec: r, tier: opts.composing ? 4 : 5, sub: opts.composing ? 1 : 0, via: 'jamo', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', 0, syl)] });
      }
      // T6: 초성
      if (chosungQuery && r.cho) {
        if (r.cho === chosungQuery) consider({ rec: r, tier: 6, sub: 0, via: 'cho', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', 0, chosungQuery.length)] });
        else if (r.cho.startsWith(chosungQuery)) consider({ rec: r, tier: 6, sub: 1, via: 'cho', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', 0, chosungQuery.length)] });
      } else if (mixedCho && r.nameKoKey) {
        if (matchMixedChosung(q.lower, r.nameKoKey)) {
          consider({ rec: r, tier: 6, sub: 2, via: 'cho', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', 0, [...q.lower].length)] });
        }
      }
      // T7: 음절·단어 경계의 부분 일치, 앞자리 0이 빠진 코드
      if (q.hangul && !q.chosung && r.nameKoKey) {
        const idx = r.nameKoKey.indexOf(q.lower);
        if (idx > 0) consider({ rec: r, tier: 7, sub: idx, via: 'substr', nameRanges: [mapNoSpaceRange(inst.nameKo ?? '', [...r.nameKoKey.slice(0, idx)].length, [...q.lower].length)] });
      }
      if (digits && inst.market && (inst.market === 'KS' || inst.market === 'KQ') && inst.code.length === 6) {
        if (inst.code.replace(/^0+/, '') === digits && digits.length < 6) {
          consider({ rec: r, tier: 7, sub: 0, via: 'zero', codeRanges: [{ start: 6 - digits.length, end: 6 }] });
        }
      }
      // T8: 한/영 변환
      if (hanToEng.length >= 2) {
        if (r.codeKeys.includes(hanToEng)) consider({ rec: r, tier: 8, sub: 0, via: 'hanToEng', converted: hanToEng });
        else if (hanToEng.length >= 2 && r.codeKeys.some((k) => k.length >= 3 && k.startsWith(hanToEng))) {
          consider({ rec: r, tier: 8, sub: 1, via: 'hanToEng', converted: hanToEng });
        }
      }
      if (engLower && r.keys && r.keys.startsWith(engLower)) {
        consider({ rec: r, tier: 8, sub: 2, via: 'engToHan' });
      }
      if (st.best) out.push(st.best);
    }

    // 영→한 줄은 다른 결과가 3개 미만일 때만(05 §8.2)
    const nonConv = out.filter((m) => m.via !== 'engToHan').length;
    return nonConv >= 3 ? out.filter((m) => m.via !== 'engToHan') : out;
  }
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
