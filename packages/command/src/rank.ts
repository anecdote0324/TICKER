// 같은 등급 안의 순서와 배치 규칙(05 §6.5, §6.6)

import type { Instrument } from '@bt/shared';
import type { SecurityMatch } from './search-index';
import type { EngineContext } from './types';

/** 점수 = 0.5 × 사용 점수 + 0.3 × 인기도 + 0.2 × 문맥. 무게는 기본값(바꿀 수 있음)이에요 */
export function score(inst: Instrument, ctx: EngineContext): number {
  const usage = Math.min(1, ctx.usage?.(inst.id) ?? 0);
  const pop = inst.popularity ?? 0;
  let context = 0;
  const panel = ctx.panel.security;
  if (panel) {
    if (panel.assetClass === inst.assetClass) context += 0.5;
    if (panel.market && panel.market === inst.market) context += 0.25;
  }
  if (ctx.watchlist?.has(inst.id)) context += 0.25;
  return 0.5 * usage + 0.3 * pop + 0.2 * Math.min(1, context);
}

function flagPenalty(inst: Instrument): number {
  const f = inst.flags ?? [];
  if (f.includes('DELISTED')) return 100;
  if (f.includes('ETN') || f.includes('SPAC')) return 1;
  return 0;
}

/** 목록에 보일 수 있는 줄 수(더 보기 포함). 이보다 뒤는 순서를 매기지 않아요 */
const SORT_CAP = 240;

interface Scored {
  m: SecurityMatch;
  s: number;
  p: number;
}

function compare(a: Scored, b: Scored): number {
  // 상장폐지는 맨 아래
  if ((a.p >= 100) !== (b.p >= 100)) return a.p >= 100 ? 1 : -1;
  if (a.m.tier !== b.m.tier) return a.m.tier - b.m.tier;
  if (a.m.sub !== b.m.sub) return a.m.sub - b.m.sub;
  if (a.p !== b.p) return a.p - b.p;
  if (a.s !== b.s) return b.s - a.s;
  const la = a.m.rec.inst.code.length;
  const lb = b.m.rec.inst.code.length;
  if (la !== lb) return la - lb;
  return a.m.rec.inst.id < b.m.rec.inst.id ? -1 : 1;
}

/** compare와 같은 순서를 숫자 하나로(동점은 compare가 마저 가려요) */
function sortKey(m: SecurityMatch, s: number, p: number): number {
  const dead = p >= 100 ? 1 : 0;
  const sub = Math.max(0, Math.min(255, Math.round(m.sub) + 1));
  const q = Math.round((1 - Math.max(0, Math.min(1, s))) * 65535);
  const len = Math.min(15, m.rec.inst.code.length);
  return ((((dead * 16 + m.tier) * 256 + sub) * 4 + Math.min(3, p)) * 65536 + q) * 16 + len;
}

/** k번째(0부터)로 작은 값. 배열을 바꿔요(퀵셀렉트, 평균 O(n)) */
function nthSmallest(a: Float64Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

/** 전체를 비교 함수로 정렬(테스트에서 부분 정렬과 비교할 때 써요) */
export function sortMatchesFull(matches: SecurityMatch[], ctx: EngineContext): SecurityMatch[] {
  const scored: Scored[] = matches.map((m) => ({ m, s: score(m.rec.inst, ctx), p: flagPenalty(m.rec.inst) }));
  return placePreferred(scored.sort(compare).map((x) => x.m));
}

export function sortMatches(matches: SecurityMatch[], ctx: EngineContext): SecurityMatch[] {
  if (matches.length <= SORT_CAP * 2) {
    const scored: Scored[] = matches.map((m) => ({ m, s: score(m.rec.inst, ctx), p: flagPenalty(m.rec.inst) }));
    return placePreferred(scored.sort(compare).map((x) => x.m));
  }
  // 결과가 많으면(한 글자 검색, ETF처럼 흔한 단어) 보일 수 있는 앞부분만 제대로 정렬해요(05 §14.1).
  // 숫자 키로 경계를 찾고, 경계 안쪽만 비교 함수로 정렬해요. 뒤쪽은 어차피 더 뒤라서 순서를 매기지 않아요
  const n = matches.length;
  const keys = new Float64Array(n);
  const ss = new Float64Array(n);
  const ps = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const inst = matches[i].rec.inst;
    ss[i] = score(inst, ctx);
    ps[i] = flagPenalty(inst);
    keys[i] = sortKey(matches[i], ss[i], ps[i]);
  }
  const cut = nthSmallest(keys.slice(), SORT_CAP - 1);
  const head: Scored[] = [];
  const tail: SecurityMatch[] = [];
  for (let i = 0; i < n; i++) {
    if (keys[i] <= cut) head.push({ m: matches[i], s: ss[i], p: ps[i] });
    else tail.push(matches[i]);
  }
  head.sort(compare);
  const out = head.map((x) => x.m);
  for (const m of tail) out.push(m);
  return placePreferred(out);
}

/** 우선주는 보통주 바로 아래예요. 보통주 위로 가지 않아요(05 §6.5-6) */
export function placePreferred(list: SecurityMatch[]): SecurityMatch[] {
  // 목록에 있는 우선주의 보통주만 모아요(전체 id 모음은 크고 느려요)
  const commons = new Set<string>();
  for (const m of list) if (m.rec.inst.commonId) commons.add(m.rec.inst.commonId);
  if (commons.size === 0) return list;
  const ids = new Set<string>();
  for (const m of list) if (commons.has(m.rec.inst.id)) ids.add(m.rec.inst.id);
  const prefs = new Map<string, SecurityMatch[]>();
  const rest: SecurityMatch[] = [];
  for (const m of list) {
    const common = m.rec.inst.commonId;
    if (common && ids.has(common)) {
      const arr = prefs.get(common);
      if (arr) arr.push(m);
      else prefs.set(common, [m]);
    } else rest.push(m);
  }
  if (prefs.size === 0) return list;
  const out: SecurityMatch[] = [];
  for (const m of rest) {
    out.push(m);
    const p = prefs.get(m.rec.inst.id);
    if (p) out.push(...p);
  }
  return out;
}
