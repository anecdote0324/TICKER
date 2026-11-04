// 패널 상태: 지금 기능, 띄운 종목, 연동 그룹, 뒤로·앞으로 기록.
// 연동 그룹(같은 색)끼리는 종목이 함께 바뀌어요. 기능 변경은 퍼지지 않아요(05 §3.4).

import type { Execution } from '@bt/command';
import { canonicalSecurity, type FunctionDef } from '@bt/shared';
import { getInstrument } from './instruments';
import { recordHistory, recordUsage } from './state';
import { createStore } from './store';
import { showToast } from './ui';

export type LinkColor = 'blue' | 'purple' | 'teal';

export const LINK_COLORS: Record<LinkColor, { label: string; color: string }> = {
  blue: { label: '파랑', color: '#3DA5FF' },
  purple: { label: '보라', color: '#B98CFF' },
  teal: { label: '청록', color: '#5CD6D6' },
};

export interface NavEntry {
  fn?: string;
  securityId?: string;
  /** 기능 인자(MOST KQ의 'KQ') */
  args?: string[];
}

export interface PanelState {
  id: string;
  num: number;
  fn?: string;
  securityId?: string;
  /** 기능 인자(MOST의 시장 등, 05 §3.1) */
  args?: string[];
  link: LinkColor | null;
  back: NavEntry[];
  fwd: NavEntry[];
  /** MON이 보여 줄 관심종목 묶음 */
  watchGroups?: string[];
  /** GP에서 고른 봉 단위와 보이는 기간(시간봉은 기간을 따로), GIP에서 고른 보이는 기간(패널마다 기억) */
  gpInterval?: '1h' | '2h' | '4h' | '1d' | '1w' | '1M';
  gpRange?: string;
  gpHourRange?: string;
  gipRange?: string;
  /** MON에서 고른 묶음 탭('all'이면 전체). 화면을 떼어냈다 돌려놓거나 다시 켜도 그대로예요 */
  monTab?: string;
  /** N에서 고른 탭(전체·공시·국내 뉴스·해외 뉴스)과 종목이 있어도 전체를 볼지 */
  newsTab?: string;
  newsAll?: boolean;
  /** HMAP에서 펼친 업종 */
  hmapSector?: string;
  /** COMP에서 고른 기간 */
  compRange?: string;
  /** MOST에서 고른 순위 종류(거래량·거래대금·상승률·하락률) */
  mostKind?: 'volume' | 'turnover' | 'gainers' | 'losers';
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
        next[p.id] = { ...p, securityId, back: [...p.back, { fn: p.fn, securityId: p.securityId, args: p.args }].slice(-50), fwd: [] };
      }
    }
    return next;
  });
}

/** 커맨드 라인 실행 결과를 패널에 적용해요 */
export function applyExecution(panelId: string, exec: Execution) {
  const p = panels.get()[panelId];
  if (!p || exec.kind !== 'function' || !exec.fn) return;
  const prev: NavEntry = { fn: p.fn, securityId: p.securityId, args: p.args };
  const securityId = exec.instrumentId ?? p.securityId;
  // 종목만 바꿔 지금 기능을 유지하면(COMP를 보던 패널에서 000660⏎) 비교 종목 같은 인자도 그대로 둬요
  const args = exec.args ?? (exec.keepArgs && exec.fn === p.fn ? p.args : undefined);
  patchPanel(panelId, { fn: exec.fn, securityId, args, back: [...p.back, prev].slice(-50), fwd: [] });
  if (exec.instrumentId) {
    propagateSecurity({ ...p, fn: exec.fn }, exec.instrumentId);
    const inst = getInstrument(exec.instrumentId);
    // 기능 메뉴·로컬 검색 페이지는 기능 사용 횟수에 넣지 않아요
    const internal = exec.fn === 'MENU' || exec.fn === 'SEARCH';
    recordUsage(exec.instrumentId, exec.setsSecurityOnly || internal ? undefined : exec.fn, inst?.assetClass);
  }
  if (exec.canonical) recordHistory(exec.canonical, panelId);
}

/** MON 행 고르기처럼 종목만 바꿀 때 */
/** 연동 색이 없는 패널에서 줄·칸을 눌렀다고 알려 준 패널(이번 실행 동안 패널마다 한 번) */
const noLinkHinted = new Set<string>();

/** 목록 위젯(MON·WEI·CRYP·MOST·FXC 등)에서 고른 종목을 같은 연동 그룹의 패널에 퍼뜨려요 */
export function setPanelSecurity(panelId: string, securityId: string) {
  const p = panels.get()[panelId];
  if (!p) return;
  if (!p.link && !noLinkHinted.has(panelId)) {
    noLinkHinted.add(panelId);
    showToast('이 패널은 연동 색이 없어서 다른 패널이 바뀌지 않아요 · 제목 줄의 ■를 눌러 차트 패널과 같은 색으로 맞춰요', undefined, 8000);
  }
  propagateSecurity(p, securityId);
}

export function navigate(panelId: string, dir: 'back' | 'fwd') {
  const p = panels.get()[panelId];
  if (!p) return;
  const from = dir === 'back' ? p.back : p.fwd;
  if (from.length === 0) return;
  const target = from[from.length - 1];
  const cur: NavEntry = { fn: p.fn, securityId: p.securityId, args: p.args };
  // 예전 기록에는 인자 칸이 없어서 지금 인자가 남지 않게 명시해요
  const to = { fn: target.fn, securityId: target.securityId, args: target.args };
  if (dir === 'back') patchPanel(panelId, { ...to, back: p.back.slice(0, -1), fwd: [...p.fwd, cur] });
  else patchPanel(panelId, { ...to, fwd: p.fwd.slice(0, -1), back: [...p.back, cur] });
}

/** 패널에 띄운 명령(표준형) */
export function panelCanonical(p: PanelState, fn: FunctionDef | undefined): string {
  if (!p.fn) return '';
  const inst = getInstrument(p.securityId);
  if (fn && fn.security === 'one' && inst) return `${canonicalSecurity(inst)} ${p.fn}`;
  // 기능 메뉴는 종목만(다시 치면 메뉴), 로컬 검색 페이지는 빈 줄
  if (p.fn === 'MENU') return inst ? canonicalSecurity(inst) : '';
  if (p.fn === 'SEARCH') return '';
  // 인자를 받는 기능: MOST KQ
  return p.args?.length ? `${p.fn} ${p.args.join(' ')}` : p.fn;
}
