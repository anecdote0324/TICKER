// 서버 공용 도우미

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TimeoutError extends Error {}

/** 정한 시간 안에 끝나지 않으면 실패로 봐요(끝나지 않는 약속 때문에 화면이 멈추지 않게) */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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

/** 최근 기록을 돌려주는 기록기(진단 정보 복사) */
export interface RecordingLogger extends Logger {
  recent(): string[];
  /** 기록 파일 경로(없으면 메모리에만) */
  file?: string;
}

const RECENT_LINES = 400;
const MAX_FILE_BYTES = 1_000_000;

/**
 * 서버 기록: 콘솔에 쓰고, 최근 기록을 메모리에 두고, 파일을 주면 파일에도 써요(데이터 폴더의 logs/server.log).
 * 파일이 1MB를 넘으면 server.log.1로 넘기고 새로 써요. 앱키·앱시크릿·토큰은 기록하지 않아요(부르는 쪽이 넣지 않아요).
 */
export function recordingLogger(scope: string, opts: { quiet?: boolean; file?: string } = {}): RecordingLogger {
  const lines: string[] = [];
  const { file } = opts;
  let size = 0;
  if (file) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      size = statSync(file).size;
    } catch {
      size = 0;
    }
  }
  const write = (lvl: string, msg: string, rest: unknown[]) => {
    const extra = rest.length ? ` ${rest.map((r) => (r instanceof Error ? r.message : String(r))).join(' ')}` : '';
    const line = `${new Date().toISOString()} ${lvl} [${scope}] ${msg}${extra}`;
    lines.push(line);
    if (lines.length > RECENT_LINES) lines.splice(0, lines.length - RECENT_LINES);
    if (!file) return;
    try {
      if (size > MAX_FILE_BYTES) {
        renameSync(file, `${file}.1`);
        size = 0;
      }
      appendFileSync(file, `${line}\n`);
      size += Buffer.byteLength(line) + 1;
    } catch {
      // 기록을 못 써도 앱은 계속 돌아가요
    }
  };
  const con = consoleLogger(scope, opts.quiet);
  return {
    file,
    recent: () => lines.slice(),
    debug: (m, ...r) => {
      con.debug(m, ...r);
      if (process.env.BT_DEBUG) write('DEBUG', m, r);
    },
    info: (m, ...r) => {
      con.info(m, ...r);
      write('INFO', m, r);
    },
    warn: (m, ...r) => {
      con.warn(m, ...r);
      write('WARN', m, r);
    },
    error: (m, ...r) => {
      con.error(m, ...r);
      write('ERROR', m, r);
    },
  };
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
