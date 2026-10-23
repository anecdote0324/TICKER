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

export function sortMatches(matches: SecurityMatch[], ctx: EngineContext): SecurityMatch[] {
  const scored = matches.map((m) => ({ m, s: score(m.rec.inst, ctx), p: flagPenalty(m.rec.inst) }));
  scored.sort((a, b) => {
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
  });
  return placePreferred(scored.map((x) => x.m));
}

/** 우선주는 보통주 바로 아래예요. 보통주 위로 가지 않아요(05 §6.5-6) */
export function placePreferred(list: SecurityMatch[]): SecurityMatch[] {
  const ids = new Set(list.map((m) => m.rec.inst.id));
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
