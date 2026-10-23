// 서버 공용 도우미

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${url.split('?')[0]}`, text.slice(0, 500));
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}

export async function fetchBytes(url: string, timeoutMs = 30_000): Promise<Uint8Array> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

export function consoleLogger(scope: string, quiet = false): Logger {
  const fmt = (lvl: string, msg: string) => `${new Date().toISOString()} ${lvl} [${scope}] ${msg}`;
  return {
    debug: (m, ...r) => {
      if (!quiet && process.env.BT_DEBUG) console.debug(fmt('DEBUG', m), ...r);
    },
    info: (m, ...r) => {
      if (!quiet) console.info(fmt('INFO', m), ...r);
    },
    warn: (m, ...r) => console.warn(fmt('WARN', m), ...r),
    error: (m, ...r) => console.error(fmt('ERROR', m), ...r),
  };
}

/** 'YYYY-MM-DD' (UTC 기준 날짜를 그대로) */
export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 문자열에서 안정적인 32비트 정수(데모 시세의 씨앗) */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 씨앗이 같으면 같은 수열을 내는 난수 */
export function seededRandom(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return ((a >>> 0) % 1_000_000) / 1_000_000;
  };
}
