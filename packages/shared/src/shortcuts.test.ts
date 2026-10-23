import { describe, expect, it } from 'vitest';
import { bindingFromEvent, findConflict, formatBinding, isReservedBinding, matchesShortcut, type KeyLike } from './shortcuts';

const key = (code: string, k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('단축키', () => {
  it('Mod는 Windows Ctrl, Mac ⌘', () => {
    expect(matchesShortcut(key('KeyK', 'k', { ctrlKey: true }), 'palette', {}, false)).toBe(true);
    expect(matchesShortcut(key('KeyK', 'k', { ctrlKey: true }), 'palette', {}, true)).toBe(false);
    expect(matchesShortcut(key('KeyK', 'k', { metaKey: true }), 'palette', {}, true)).toBe(true);
  });

  it('한글 모드에서도 자리로 알아봐요(Ctrl+Shift+ㄷ = Ctrl+Shift+E)', () => {
    expect(matchesShortcut(key('KeyE', 'ㄷ', { ctrlKey: true, shiftKey: true }), 'assetEquity', {}, false)).toBe(true);
  });

  it('바꾼 키가 기본값을 대신해요', () => {
    const keys = { openList: ['Alt+ArrowDown'] };
    expect(matchesShortcut(key('Space', ' ', { ctrlKey: true }), 'openList', {}, false)).toBe(true);
    expect(matchesShortcut(key('Space', ' ', { ctrlKey: true }), 'openList', keys, false)).toBe(false);
    expect(matchesShortcut(key('ArrowDown', 'ArrowDown', { altKey: true }), 'openList', keys, false)).toBe(true);
  });

  it('누른 키를 이름으로, 화면에는 플랫폼 표기로', () => {
    expect(bindingFromEvent(key('KeyE', 'E', { ctrlKey: true, altKey: true }), false)).toBe('Mod+Alt+E');
    expect(bindingFromEvent(key('ShiftLeft', 'Shift', { shiftKey: true }), false)).toBeNull();
    expect(formatBinding('Mod+Shift+E', false)).toBe('Ctrl+Shift+E');
    expect(formatBinding('Mod+Shift+E', true)).toBe('⇧⌘E');
    expect(formatBinding('Alt+ArrowDown', false)).toBe('Alt+↓');
  });

  it('겹치는 키와 고정 키를 알아봐요', () => {
    expect(findConflict('Mod+K', 'settings', {}, false)?.id).toBe('palette');
    expect(findConflict('Mod+K', 'palette', {}, false)).toBeUndefined();
    expect(isReservedBinding('Tab', false)).toBe(true);
    expect(isReservedBinding('Shift+A', false)).toBe(true);
    expect(isReservedBinding('Mod+3', false)).toBe(true);
    expect(isReservedBinding('Mod+Z', false)).toBe(true);
    expect(isReservedBinding('Alt+Shift+E', false)).toBe(false);
  });
});
