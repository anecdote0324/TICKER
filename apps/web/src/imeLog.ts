// 한글 입력 이벤트 기록기(05 §8.1 K3-8, K13). 커맨드 라인의 keydown·keyup·composition·input 이벤트와
// 미뤄 둔 의도(K3)를 순서대로 남겨요. 실제 기기(Windows IME, Mac 2벌식)에서 기록한 것을 단위 테스트로 옮겨요.
// 설정 → 커맨드 라인에서 켜고, 기록을 복사해 보내요. 입력한 글자가 들어가므로 키·비밀번호 입력칸에는 붙이지 않아요.

export interface ImeEntry {
  /** 기록을 켠 뒤 지난 시간(ms) */
  t: number;
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
  isComposing?: boolean;
  repeat?: boolean;
  data?: string | null;
  inputType?: string;
  value?: string;
  caret?: number | null;
  /** 의도 기록·실행·삼킴 같은 해석기 쪽 메모 */
  note?: string;
}

const MAX = 3000;
const KEY = 'bt-ime-log';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const imeLog = {
  enabled: readEnabled(),
  start: performance.now(),
  entries: [] as ImeEntry[],
  listeners: new Set<() => void>(),
};

export function setImeLogEnabled(on: boolean) {
  imeLog.enabled = on;
  if (on) {
    imeLog.start = performance.now();
    imeLog.entries = [];
  }
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // 저장 못 해도 이번 실행에는 켜져요
  }
  imeLog.listeners.forEach((f) => f());
}

export function clearImeLog() {
  imeLog.entries = [];
  imeLog.start = performance.now();
  imeLog.listeners.forEach((f) => f());
}

type AnyEvent = Event & Partial<KeyboardEvent & CompositionEvent & InputEvent>;

/** 이벤트 하나를 남겨요. 꺼져 있으면 아무것도 안 해요 */
export function logIme(e: AnyEvent | null, note?: string) {
  if (!imeLog.enabled) return;
  const target = e?.target as HTMLInputElement | null;
  const entry: ImeEntry = { t: Math.round((performance.now() - imeLog.start) * 10) / 10, type: e?.type ?? 'note' };
  if (e) {
    if ('key' in e && e.key !== undefined) entry.key = e.key;
    if ('code' in e && e.code !== undefined) entry.code = e.code;
    if ('keyCode' in e && e.keyCode !== undefined) entry.keyCode = e.keyCode;
    if ('isComposing' in e && e.isComposing !== undefined) entry.isComposing = e.isComposing;
    if ('repeat' in e && e.repeat) entry.repeat = true;
    if ('data' in e && e.data !== undefined) entry.data = e.data;
    if ('inputType' in e && e.inputType) entry.inputType = e.inputType;
    if (target && 'value' in target) {
      entry.value = target.value;
      entry.caret = target.selectionStart;
    }
  }
  if (note) entry.note = note;
  imeLog.entries.push(entry);
  if (imeLog.entries.length > MAX) imeLog.entries.splice(0, imeLog.entries.length - MAX);
  imeLog.listeners.forEach((f) => f());
}

/** 복사해서 보낼 글: 환경 정보 + 기록(JSON 한 줄씩) */
export function exportImeLog(): string {
  const head = { app: 'TICKER', userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, at: new Date().toISOString(), count: imeLog.entries.length };
  return [JSON.stringify(head), ...imeLog.entries.map((x) => JSON.stringify(x))].join('\n');
}
