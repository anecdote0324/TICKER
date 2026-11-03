// F1 기능 목록(05 §4.9, v0.2): 지금 쓸 수 있는 기능을 두 묶음으로 보여 줘요.
// - 종목 다음에 쓰는 기능(005930 DES): 종목이 있어야 하는 기능. N처럼 종목 없이도 되는 기능은 표시를 붙여요
// - 종목 없이 쓰는 기능(WEI): 기능 코드만 쳐요
// 줄을 고르면 지금 줄에 친 종목(없으면 패널의 종목)과 그 기능으로 명령 줄을 만들어요.

import { canonicalSecurity, FUNCTIONS, type FunctionDef, type Instrument } from '@bt/shared';
import type { ChosenToken, Row } from './types';

/** 목록에 보이는 기능(만든 기능만) */
export function listedFunctions(): { withSecurity: FunctionDef[]; standalone: FunctionDef[] } {
  const built = FUNCTIONS.filter((f) => f.implemented);
  return {
    withSecurity: built.filter((f) => f.security !== 'none'),
    standalone: built.filter((f) => f.security === 'none'),
  };
}

function argHint(f: FunctionDef): string {
  const a = f.args;
  if (!a) return '';
  if (a.kind === 'securities') return ` · 뒤에 ${a.label} ${a.max ?? 1}개까지`;
  return ` · 뒤에 ${a.label}(${a.choices.map((c) => c.code).join('·')})`;
}

function fnRow(f: FunctionDef): Row {
  return {
    id: `flist:${f.code}`,
    kind: 'function',
    badge: 'FN',
    code: f.code,
    name: f.nameKo,
    nameEn: f.nameEn,
    info: `${f.summary}${f.security === 'optional' ? ' · 종목 없이도 돼요' : ''}${argHint(f)}`,
    flags: [],
    canonical: f.examples[0] ?? f.code,
    tier: 0,
    insert: f.code,
    fnCode: f.code,
  };
}

function header(id: string, name: string): Row {
  return { id, kind: 'header', badge: '', code: '', name, info: '', flags: [], canonical: '', tier: 0, insert: '' };
}

/** 목록 줄: 머리줄 두 개와 기능 줄 */
export function functionListRows(): Row[] {
  const { withSecurity, standalone } = listedFunctions();
  return [
    header('flist:hdr:sec', '종목 다음에 쓰는 기능 · 예: 005930 DES ⏎'),
    ...withSecurity.map(fnRow),
    header('flist:hdr:none', '종목 없이 쓰는 기능 · 예: WEI ⏎'),
    ...standalone.map(fnRow),
  ];
}

/**
 * 목록에서 고른 기능으로 만들 명령 줄.
 * - 종목이 필요한(또는 받을 수 있는) 기능: 지금 줄에 친 글자 뒤에 기능을 붙여요(005930 → 005930 DES).
 *   빈 줄이면 패널의 종목으로(그 기능이 받는 자산군일 때). 종목이 없으면 기능만 써서 뒤에 종목을 치게 해요(DES 005930도 돼요)
 * - 종목 없이 쓰는 기능: 기능 코드만
 * chosen은 기능 칸을 기능으로 읽게 하는 표시예요(N처럼 종목 앞부분과 겹치는 한 글자 기능)
 */
export function functionListLine(fnCode: string, text: string, panelSecurity?: Instrument): { line: string; chosen?: ChosenToken } {
  const f = FUNCTIONS.find((x) => x.code === fnCode);
  if (!f) return { line: text };
  // 앞 공백은 그대로 둬요(고른 종목 표시의 위치가 바뀌지 않게)
  const typed = text.trimEnd();
  if (f.security === 'none') return { line: f.code, chosen: { start: 0, text: f.code, rowId: `fn:${f.code}` } };
  if (typed.trim()) return { line: `${typed} ${f.code}` };
  if (panelSecurity && f.assetClasses.includes(panelSecurity.assetClass)) return { line: `${canonicalSecurity(panelSecurity)} ${f.code}` };
  return { line: f.code, chosen: { start: 0, text: f.code, rowId: `fn:${f.code}` } };
}
