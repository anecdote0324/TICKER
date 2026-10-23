// 바꿀 수 있는 단축키(05 §10, 06 단축키). Windows 언어 전환 단축키(Ctrl+Shift, Ctrl+Space 등)와 겹치면 설정에서 다시 지정해요.
// 키 이름은 "Mod+Shift+E"처럼 써요. Mod는 Windows의 Ctrl, Mac의 ⌘예요.
// 글자·숫자·기호 키는 눌린 자리(KeyboardEvent.code)로 알아봐서 한글 모드에서도 같게 동작해요(05 §2).

export type ShortcutId =
  | 'palette'
  | 'settings'
  | 'focusCommand'
  | 'toggleFocus'
  | 'bodyFocus'
  | 'back'
  | 'forward'
  | 'nextPanel'
  | 'prevPanel'
  | 'openList'
  | 'descCard'
  | 'assetEquity'
  | 'assetCrypto'
  | 'assetCurncy'
  | 'assetIndex';

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  /** 어디서 쓰는지 */
  scope: '어디서나' | '커맨드 라인';
  win: string[];
  mac: string[];
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'palette', label: '명령 팔레트', scope: '어디서나', win: ['Mod+K'], mac: ['Mod+K'] },
  { id: 'settings', label: '설정 창', scope: '어디서나', win: ['Mod+,'], mac: ['Mod+,'] },
  { id: 'focusCommand', label: '활성 패널의 커맨드 라인으로', scope: '어디서나', win: ['Mod+L'], mac: ['Mod+L'] },
  { id: 'toggleFocus', label: '커맨드 라인 ↔ 패널 본문', scope: '어디서나', win: ['F6'], mac: ['F6'] },
  // Mac의 Ctrl+↓는 시스템 단축키(앱 윈도우)와 겹칠 수 있어서 기본으로 묶지 않아요(05 §10.1)
  { id: 'bodyFocus', label: '패널 본문으로', scope: '커맨드 라인', win: ['Ctrl+ArrowDown'], mac: [] },
  { id: 'back', label: '패널 화면 뒤로', scope: '어디서나', win: ['Alt+ArrowLeft'], mac: ['Mod+['] },
  { id: 'forward', label: '패널 화면 앞으로', scope: '어디서나', win: ['Alt+ArrowRight'], mac: ['Mod+]'] },
  { id: 'nextPanel', label: '다음 패널', scope: '어디서나', win: ['Ctrl+Tab'], mac: ['Ctrl+Tab'] },
  { id: 'prevPanel', label: '이전 패널', scope: '어디서나', win: ['Ctrl+Shift+Tab'], mac: ['Ctrl+Shift+Tab'] },
  // Ctrl+Space는 일부 IME에서 입력 언어 전환 키예요. Mac에서는 입력 소스 전환이라 묶지 않아요
  { id: 'openList', label: '지금 칸 목록 열기(다른 뜻 보기)', scope: '커맨드 라인', win: ['Alt+ArrowDown', 'Ctrl+Space'], mac: ['Alt+ArrowDown'] },
  { id: 'descCard', label: '설명 창 / 문법 요약', scope: '커맨드 라인', win: ['F1', 'Mod+/'], mac: ['F1', 'Mod+/'] },
  { id: 'assetEquity', label: '자산군 EQUITY', scope: '커맨드 라인', win: ['Mod+Shift+E'], mac: ['Mod+Shift+E'] },
  { id: 'assetCrypto', label: '자산군 CRYPTO', scope: '커맨드 라인', win: ['Mod+Shift+C'], mac: ['Mod+Shift+C'] },
  { id: 'assetCurncy', label: '자산군 CURNCY', scope: '커맨드 라인', win: ['Mod+Shift+X'], mac: ['Mod+Shift+X'] },
  { id: 'assetIndex', label: '자산군 INDEX', scope: '커맨드 라인', win: ['Mod+Shift+I'], mac: ['Mod+Shift+I'] },
];

/** 바꿀 수 없는 키(입력 규칙의 일부라서) */
export const FIXED_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Tab', label: '채우기(Shift+Tab: 앞 토큰 고치기)' },
  { keys: 'Enter', label: '실행(애매하면 두 번)' },
  { keys: 'Esc', label: '목록 닫기 → 줄 지우기 → 패널 본문으로' },
  { keys: '↑ / ↓', label: '목록 이동, 빈 줄의 ↑는 기록' },
  { keys: 'Mod+1…9', label: '그 번호 패널로' },
  { keys: 'Alt+1…9', label: '명령 팔레트의 대상 패널 바꾸기' },
];

export type ShortcutMap = Partial<Record<ShortcutId, string[]>>;

/** 키보드 이벤트에서 필요한 것만 */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

interface Combo {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'OS']);

const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
};

/** 이벤트의 키 이름: 글자·숫자·기호는 자리(code)로, 나머지는 key로 */
export function keyName(e: Pick<KeyLike, 'key' | 'code'>): string {
  const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code);
  if (m) return m[1];
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  if (e.key === ' ') return 'Space';
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function parse(binding: string, mac: boolean): Combo | null {
  // 마지막 '+'가 키 자체일 수 있어요(예: Mod++)
  const parts = binding.endsWith('++') ? [...binding.slice(0, -2).split('+'), '+'] : binding.split('+');
  const key = parts.pop();
  if (!key) return null;
  const c: Combo = { ctrl: false, meta: false, alt: false, shift: false, key };
  for (const p of parts) {
    if (p === 'Mod') {
      if (mac) c.meta = true;
      else c.ctrl = true;
    } else if (p === 'Ctrl') c.ctrl = true;
    else if (p === 'Meta') c.meta = true;
    else if (p === 'Alt') c.alt = true;
    else if (p === 'Shift') c.shift = true;
    else return null;
  }
  return c;
}

export function matchesBinding(e: KeyLike, binding: string, mac: boolean): boolean {
  const c = parse(binding, mac);
  if (!c) return false;
  return c.ctrl === e.ctrlKey && c.meta === e.metaKey && c.alt === e.altKey && c.shift === e.shiftKey && c.key === keyName(e);
}

/** 이 플랫폼의 단축키(사용자가 바꾼 값 우선) */
export function bindingsFor(id: ShortcutId, overrides: ShortcutMap | undefined, mac: boolean): string[] {
  const o = overrides?.[id];
  if (o) return o;
  const d = SHORTCUTS.find((s) => s.id === id);
  return d ? (mac ? d.mac : d.win) : [];
}

export function matchesShortcut(e: KeyLike, id: ShortcutId, overrides: ShortcutMap | undefined, mac: boolean): boolean {
  return bindingsFor(id, overrides, mac).some((b) => matchesBinding(e, b, mac));
}

/** 눌린 키를 단축키 이름으로(설정에서 새 키를 받을 때). 수정 키만 눌렸으면 null */
export function bindingFromEvent(e: KeyLike, mac: boolean): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (!mac && e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName(e));
  return parts.join('+');
}

const KEY_LABEL: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Escape: 'Esc',
};

/** 화면에 보이는 단축키 이름(Windows: Ctrl+Shift+E, Mac: ⌘⇧E) */
export function formatBinding(binding: string, mac: boolean): string {
  const c = parse(binding, mac);
  if (!c) return binding;
  const key = KEY_LABEL[c.key] ?? c.key;
  if (mac) return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${key}`;
  return [c.ctrl && 'Ctrl', c.meta && 'Win', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}

/** 같은 키를 쓰는 다른 단축키 */
export function findConflict(binding: string, except: ShortcutId, overrides: ShortcutMap | undefined, mac: boolean): ShortcutDef | undefined {
  const norm = (b: string) => JSON.stringify(parse(b, mac));
  const n = norm(binding);
  return SHORTCUTS.find((s) => s.id !== except && bindingsFor(s.id, overrides, mac).some((b) => norm(b) === n));
}

/** 바꿀 수 없는 키와 겹치는지(Tab·Enter·Esc·화살표, Mod+숫자, Alt+숫자) */
export function isReservedBinding(binding: string, mac: boolean): boolean {
  const c = parse(binding, mac);
  if (!c) return true;
  const plain = !c.ctrl && !c.meta && !c.alt;
  if (plain && ['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(c.key)) return true;
  // 글자·숫자·기호만(수정 키 없이 또는 Shift만)은 입력이에요
  if (plain && c.key.length === 1) return true;
  if (plain && c.key === 'Space') return true;
  if (/^[1-9]$/.test(c.key) && !c.shift && ((mac ? c.meta : c.ctrl) || c.alt)) return true;
  // 되돌리기·잘라내기·복사·붙여넣기·모두 선택
  if ((mac ? c.meta : c.ctrl) && !c.alt && !c.shift && ['Z', 'Y', 'X', 'C', 'V', 'A'].includes(c.key)) return true;
  return false;
}
