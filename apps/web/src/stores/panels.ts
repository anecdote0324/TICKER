// 패널 상태: 지금 기능, 띄운 종목, 연동 그룹, 뒤로·앞으로 기록.
// 연동 그룹(같은 색)끼리는 종목이 함께 바뀌어요. 기능 변경은 퍼지지 않아요(05 §3.4).

import type { Execution } from '@bt/command';
import { canonicalSecurity, type FunctionDef } from '@bt/shared';
import { getInstrument } from './instruments';
import { recordHistory, recordUsage } from './state';
import { createStore } from './store';

export type LinkColor = 'blue' | 'purple' | 'teal';

export const LINK_COLORS: Record<LinkColor, { label: string; color: string }> = {
  blue: { label: '파랑', color: '#3DA5FF' },
  purple: { label: '보라', color: '#B98CFF' },
  teal: { label: '청록', color: '#5CD6D6' },
};

export interface NavEntry {
  fn?: string;
  securityId?: string;
}

export interface PanelState {
  id: string;
  num: number;
  fn?: string;
  securityId?: string;
  link: LinkColor | null;
  back: NavEntry[];
  fwd: NavEntry[];
  /** MON이 보여 줄 관심종목 묶음 */
  watchGroups?: string[];
  /** GP에서 고른 봉 단위와 보이는 기간, GIP에서 고른 보이는 기간과 봉 크기(패널마다 기억) */
  gpInterval?: '1d' | '1w' | '1M';
  gpRange?: string;
  gipRange?: string;
  /** GIP 봉 크기(분: 1·5·15·60) */
  gipMinutes?: number;
  /** MON에서 고른 묶음 탭('all'이면 전체). 화면을 떼어냈다 돌려놓거나 다시 켜도 그대로예요 */
  monTab?: string;
}

export const panels = createStore<Record<string, PanelState>>({});
export const activePanelId = createStore<string | null>(null);

export function nextPanelNumber(): number {
  const used = new Set(Object.values(panels.get()).map((p) => p.num));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function upsertPanel(p: PanelState) {
  panels.set((all) => ({ ...all, [p.id]: p }));
}

export function removePanel(id: string) {
  panels.set((all) => {
    const next = { ...all };
    delete next[id];
    return next;
  });
}

export function patchPanel(id: string, patch: Partial<PanelState>) {
  panels.set((all) => (all[id] ? { ...all, [id]: { ...all[id], ...patch } } : all));
}

/** 연동 그룹 전체에 종목을 퍼뜨려요 */
function propagateSecurity(from: PanelState, securityId: string) {
  if (!from.link) return;
  panels.set((all) => {
    const next = { ...all };
    for (const p of Object.values(all)) {
      if (p.id !== from.id && p.link === from.link && p.securityId !== securityId) {
        next[p.id] = { ...p, securityId, back: [...p.back, { fn: p.fn, securityId: p.securityId }].slice(-50), fwd: [] };
      }
    }
    return next;
  });
}

/** 커맨드 라인 실행 결과를 패널에 적용해요 */
export function applyExecution(panelId: string, exec: Execution) {
  const p = panels.get()[panelId];
  if (!p || exec.kind !== 'function' || !exec.fn) return;
  const prev: NavEntry = { fn: p.fn, securityId: p.securityId };
  const securityId = exec.instrumentId ?? p.securityId;
  patchPanel(panelId, { fn: exec.fn, securityId, back: [...p.back, prev].slice(-50), fwd: [] });
  if (exec.instrumentId) {
    propagateSecurity({ ...p, fn: exec.fn }, exec.instrumentId);
    const inst = getInstrument(exec.instrumentId);
    recordUsage(exec.instrumentId, exec.setsSecurityOnly ? undefined : exec.fn, inst?.assetClass);
  }
  recordHistory(exec.canonical, panelId);
}

/** MON 행 고르기처럼 종목만 바꿀 때 */
export function setPanelSecurity(panelId: string, securityId: string) {
  const p = panels.get()[panelId];
  if (!p) return;
  propagateSecurity(p, securityId);
}

export function navigate(panelId: string, dir: 'back' | 'fwd') {
  const p = panels.get()[panelId];
  if (!p) return;
  const from = dir === 'back' ? p.back : p.fwd;
  if (from.length === 0) return;
  const target = from[from.length - 1];
  const cur: NavEntry = { fn: p.fn, securityId: p.securityId };
  if (dir === 'back') patchPanel(panelId, { ...target, back: p.back.slice(0, -1), fwd: [...p.fwd, cur] });
  else patchPanel(panelId, { ...target, fwd: p.fwd.slice(0, -1), back: [...p.back, cur] });
}

/** 패널에 띄운 명령(표준형) */
export function panelCanonical(p: PanelState, fn: FunctionDef | undefined): string {
  if (!p.fn) return '';
  const inst = getInstrument(p.securityId);
  if (fn && fn.security === 'one' && inst) return `${canonicalSecurity(inst)} ${p.fn}`;
  return p.fn;
}
