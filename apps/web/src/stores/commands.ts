// 저장해 둔 명령(LAST 기록, FAVE 즐겨찾기)을 다시 해석하고 패널에서 여는 도우미.

import { labelFor, type EngineContext, type Execution } from '@bt/command';
import { FUNCTIONS } from '@bt/shared';
import { engine, index, supports } from './instruments';
import { applyExecution } from './panels';
import { usageScore } from './state';

const ctx = (): EngineContext => ({ panel: {}, assist: 'expert', hanEng: false, tabAutofill: false, supports, usage: usageScore });

/**
 * 명령 → 실행. 커맨드 라인 규칙상 `N`처럼 짧은 기능 코드는 첫 Enter에 선택만 해서,
 * 종목이 필요 없는 기능 코드 한 단어면 바로 그 기능으로 열어요
 */
function resolve(cmd: string): { exec: Execution; label: string } | undefined {
  const a = engine.analyze(cmd, cmd.length, ctx());
  if (a.plan.kind === 'execute') return { exec: a.plan.exec, label: labelFor(a.plan, index).replace(/^⏎ 실행: /, '') };
  const code = cmd.trim().toUpperCase();
  const fn = FUNCTIONS.find((f) => f.code === code && f.implemented && f.security !== 'one');
  if (!fn) return undefined;
  return { exec: { kind: 'function', fn: fn.code, canonical: fn.code, notes: [] }, label: `${fn.nameKo} (${fn.code})` };
}

/** 명령을 다시 해석해서 무엇이 열리는지(⏎ 라벨) 보여 줘요 */
export function describeCommand(cmd: string): { label: string; ok: boolean } {
  const r = resolve(cmd);
  return r ? { label: r.label, ok: true } : { label: '지금은 열 수 없어요', ok: false };
}

/** 명령을 패널에서 열어요. 열었으면 true */
export function openCommand(panelId: string, cmd: string): boolean {
  const r = resolve(cmd);
  if (!r) return false;
  applyExecution(panelId, r.exec);
  return true;
}

/** 명령의 표준형(예: 삼성⏎ → 005930 KS EQUITY). 열 수 없으면 undefined */
export function canonicalCommand(cmd: string): string | undefined {
  const r = resolve(cmd);
  return r ? r.exec.canonical || cmd.trim() : undefined;
}
