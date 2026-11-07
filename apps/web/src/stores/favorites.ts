// FAVE 즐겨찾기(v0.5): 커맨드 라인에 그대로 칠 수 있는 명령을 앱 상태(state-favorites.json)에 둬요.

import { appState, updateState, type Favorite } from './state';

export const MAX_FAVORITES = 100;

export function isFavorite(command: string): boolean {
  return (appState.get().favorites ?? []).some((f) => f.command === command);
}

export function addFavorite(command: string, label: string): boolean {
  const cmd = command.trim();
  if (!cmd || isFavorite(cmd)) return false;
  const item: Favorite = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, command: cmd, label, at: Date.now() };
  updateState('favorites', (list) => [...(list ?? []), item].slice(-MAX_FAVORITES));
  return true;
}

export function removeFavorite(command: string): Favorite | undefined {
  const old = (appState.get().favorites ?? []).find((f) => f.command === command);
  if (old) updateState('favorites', (list) => (list ?? []).filter((f) => f.command !== command));
  return old;
}

/** 지운 것을 같은 자리로 되돌려요 */
export function restoreFavorite(item: Favorite, at: number) {
  updateState('favorites', (list) => {
    const l = (list ?? []).filter((f) => f.command !== item.command);
    l.splice(Math.max(0, Math.min(at, l.length)), 0, item);
    return l;
  });
}

export function moveFavorite(command: string, dir: -1 | 1) {
  updateState('favorites', (list) => {
    const l = [...(list ?? [])];
    const i = l.findIndex((f) => f.command === command);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  });
}
