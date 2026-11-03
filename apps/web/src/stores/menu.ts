// 블룸버그식 기능 메뉴(v0.2): 종목에 쓸 수 있는 기능을 번호로. 번호는 숫자 + Enter로 골라요(05 §10.2).

import { FUNCTION_ORDER, FUNCTIONS, isSecurityFunction, type FunctionDef, type Instrument } from '@bt/shared';
import { supports } from './instruments';

/** 패널 안에서만 쓰는 화면(블룸버그 코드가 아니에요): 기능 메뉴, 로컬 검색 페이지 */
export const INTERNAL_PAGES = new Set(['MENU', 'SEARCH']);

/** 메뉴 순서: 자산군의 대표 순서 → 그 밖의 종목 기능 → 종목을 함께 볼 수 있는 기능(N) */
export function menuFunctions(inst: Instrument): FunctionDef[] {
  const usable = (f: FunctionDef | undefined): f is FunctionDef =>
    !!f && f.implemented && f.assetClasses.includes(inst.assetClass) && (!isSecurityFunction(f) || supports(f.code, inst));
  const out: FunctionDef[] = [];
  const add = (f: FunctionDef | undefined) => {
    if (usable(f) && !out.includes(f)) out.push(f);
  };
  for (const c of FUNCTION_ORDER[inst.assetClass]) add(FUNCTIONS.find((f) => f.code === c));
  for (const f of FUNCTIONS) if (f.security === 'one') add(f);
  for (const f of FUNCTIONS) if (f.security === 'optional') add(f);
  return out;
}

/** 아직 없는 기능 중 이 자산군에 쓸 것(메뉴 아래에 흐리게) */
export function upcomingFunctions(inst: Instrument): FunctionDef[] {
  return FUNCTIONS.filter((f) => !f.implemented && f.security === 'one' && f.assetClasses.includes(inst.assetClass)).slice(0, 8);
}
