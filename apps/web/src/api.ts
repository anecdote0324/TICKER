// 내장 서버와 통신. 토큰은 Electron이 preload로 넘겨 주거나(배포판), 개발 중에는 주소의 #token= 으로 받아요.

import type { UpdateState } from '@bt/shared';

declare global {
  interface Window {
    btBridge?: {
      token: string;
      platform: string;
      version: string;
      openExternal(url: string): void;
      /** 화면 전체 배율(글자 크기 설정, 06). 모든 창에 적용돼요 */
      setZoom?(factor: number): void;
      /** 이름이 name인 창(빈 이름은 메인 창)의 전체 화면을 바꿔요. 바뀐 뒤 전체 화면인지 */
      toggleFullScreen?(name: string): Promise<boolean>;
      /** GRAB(v0.5): 이 창의 영역(CSS 픽셀)을 찍어 클립보드에. 마지막 캡처를 파일로 저장 */
      capture?(name: string, rect: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; message?: string }>;
      saveCapture?(fileName: string): Promise<{ ok: boolean; path?: string; message?: string }>;
      /** 앱 업데이트(데스크톱) */
      update?: {
        state(): Promise<UpdateState | undefined>;
        check(prerelease: boolean): Promise<UpdateState | undefined>;
        download(): Promise<UpdateState | undefined>;
        install(): Promise<{ ok: boolean; quit?: boolean; message?: string }>;
        reveal(): Promise<void>;
      };
    };
  }
}

function readToken(): string {
  if (window.btBridge?.token) return window.btBridge.token;
  const m = location.hash.match(/token=([^&]+)/);
  if (m) {
    sessionStorage.setItem('bt-token', m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    return m[1];
  }
  // 떼어낸 창은 부모 창의 토큰을 써요
  try {
    const parentToken = (window.opener as Window | null)?.sessionStorage?.getItem('bt-token');
    if (parentToken) return parentToken;
  } catch {
    // 다른 출처면 접근할 수 없어요
  }
  return sessionStorage.getItem('bt-token') ?? '';
}

export const token = readToken();

export const isMac = (window.btBridge?.platform ?? navigator.platform).toLowerCase().includes('mac');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 내장 서버가 이 시간 안에 답하지 않으면 실패로 알려요(버튼이 `… 중`에 멈춰 있지 않게) */
const REQUEST_TIMEOUT_MS = 60_000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-bt-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    if (ctl.signal.aborted) throw new ApiError(0, `내장 서버가 ${REQUEST_TIMEOUT_MS / 1000}초 동안 답하지 않았어요. 설정 → 정보의 진단 정보 복사로 상태를 알려 주세요`);
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, body),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  del: <T>(path: string) => call<T>('DELETE', path),
};

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}
