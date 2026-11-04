// 워크스페이스 파일 내보내기·가져오기(v0.2, 02 화면 탭과 워크스페이스): 다른 컴퓨터로 배치를 옮겨요.
// 파일에는 지금 배치, 저장한 워크스페이스 전부, 관심종목 묶음이 들어가요. 키·설정·기록은 넣지 않아요.
// 가져오기는 지우지 않고 더하기만 해요: 같은 이름의 워크스페이스는 '(가져옴)'을 붙이고, 관심종목은 없는 묶음·종목만 더해요.

import type { NamedWorkspace, WatchGroup } from './stores/state';

export const WORKSPACE_FILE_KIND = 'ticker-workspaces';

export interface WorkspaceFile {
  kind: typeof WORKSPACE_FILE_KIND;
  version: 1;
  /** 내보낸 시각(ms) */
  exportedAt: number;
  /** 내보낼 때의 지금 배치(App의 SavedWorkspace) */
  current: unknown;
  workspaces: NamedWorkspace[];
  watchlists: WatchGroup[];
}

export function buildWorkspaceFile(current: unknown, workspaces: NamedWorkspace[], watchlists: WatchGroup[], now = Date.now()): WorkspaceFile {
  return { kind: WORKSPACE_FILE_KIND, version: 1, exportedAt: now, current, workspaces, watchlists };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 내보낼 파일 이름: TICKER-workspaces-20261104-1530.json(한글 이름은 Chromium이 download로 바꾸는 경우가 있어 영문으로) */
export function workspaceFileName(now = new Date()): string {
  return `TICKER-workspaces-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/** 배치 데이터 모양 확인(화면 탭 목록과 패널 묶음이 있어야 해요) */
function isLayout(x: unknown): boolean {
  const w = x as { screens?: unknown; panels?: unknown } | null;
  return !!w && typeof w === 'object' && Array.isArray(w.screens) && w.screens.length > 0 && !!w.panels && typeof w.panels === 'object';
}

export type ParsedWorkspaceFile = { ok: true; file: WorkspaceFile } | { ok: false; error: string };

/** 파일 내용 읽기. 이 앱이 내보낸 파일이 아니거나 망가졌으면 이유를 알려 줘요 */
export function parseWorkspaceFile(text: string): ParsedWorkspaceFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 파일이 아니에요' };
  }
  const f = raw as Partial<WorkspaceFile> | null;
  if (!f || typeof f !== 'object' || f.kind !== WORKSPACE_FILE_KIND) return { ok: false, error: 'TICKER에서 내보낸 워크스페이스 파일이 아니에요' };
  if (f.version !== 1) return { ok: false, error: `이 앱이 모르는 파일 버전이에요(${String(f.version)}). 앱을 새 버전으로 바꿔 보세요` };
  const workspaces = (Array.isArray(f.workspaces) ? f.workspaces : []).filter(
    (w): w is NamedWorkspace => !!w && typeof w.name === 'string' && w.name.trim() !== '' && isLayout(w.data),
  );
  const watchlists = (Array.isArray(f.watchlists) ? f.watchlists : []).filter(
    (g): g is WatchGroup => !!g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.ids),
  );
  const current = isLayout(f.current) ? f.current : null;
  if (!current && workspaces.length === 0) return { ok: false, error: '파일에 배치가 없어요' };
  return { ok: true, file: { kind: WORKSPACE_FILE_KIND, version: 1, exportedAt: Number(f.exportedAt) || 0, current, workspaces, watchlists } };
}

/** 겹치지 않는 이름: 이름 → 이름 (가져옴) → 이름 (가져옴 2) … */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${name} (가져옴)` : `${name} (가져옴 ${i})`;
    if (!taken.has(n)) return n;
  }
}

/**
 * 가져온 워크스페이스를 저장한 목록에 더해요. 파일의 지금 배치도 '가져온 배치 MM/DD HH:mm'로 더해요.
 * 돌려주는 opened는 바로 열 워크스페이스(파일의 지금 배치, 없으면 첫 워크스페이스)예요
 */
export function mergeWorkspaces(existing: NamedWorkspace[], file: WorkspaceFile, now = Date.now()): { list: NamedWorkspace[]; added: NamedWorkspace[]; opened: NamedWorkspace } {
  const taken = new Set(existing.map((w) => w.name));
  const added: NamedWorkspace[] = [];
  const add = (name: string, data: unknown) => {
    const n = uniqueName(name.slice(0, 40), taken);
    taken.add(n);
    const w = { name: n, savedAt: now, data: { ...(data as object), name: n } };
    added.push(w);
    return w;
  };
  let opened: NamedWorkspace | undefined;
  if (file.current) {
    const d = new Date(file.exportedAt || now);
    opened = add(`가져온 배치 ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, file.current);
  }
  for (const w of file.workspaces) {
    const a = add(w.name, w.data);
    opened ??= a;
  }
  const list = [...existing, ...added].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { list, added, opened: opened! };
}

/** 관심종목 합치기: 없는 묶음은 더하고, 같은 묶음(id)에는 없는 종목만 뒤에 더해요. 지우지 않아요 */
export function mergeWatchlists(existing: WatchGroup[], incoming: WatchGroup[]): { list: WatchGroup[]; addedIds: number } {
  let addedIds = 0;
  const list = existing.map((g) => ({ ...g, ids: [...g.ids] }));
  for (const g of incoming) {
    const same = list.find((x) => x.id === g.id);
    if (!same) {
      list.push({ ...g, ids: [...new Set(g.ids)] });
      addedIds += new Set(g.ids).size;
      continue;
    }
    for (const id of g.ids) {
      if (!same.ids.includes(id)) {
        same.ids.push(id);
        addedIds++;
      }
    }
  }
  return { list, addedIds };
}
