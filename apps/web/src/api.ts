// 내장 서버와 통신. 토큰은 Electron이 preload로 넘겨 주거나(배포판), 개발 중에는 주소의 #token= 으로 받아요.

declare global {
  interface Window {
    btBridge?: {
      token: string;
      platform: string;
      version: string;
      openExternal(url: string): void;
      /** 화면 전체 배율(글자 크기 설정, 06). 모든 창에 적용돼요 */
      setZoom?(factor: number): void;
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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-bt-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
