// v0.5 NOTE 메모: 종목·테마에 태그를 단 메모. 내장 서버의 SQLite(notes.db)에 둬요.

export interface Note {
  id: number;
  /** 연결한 종목(없으면 종목 없는 메모) */
  securityId?: string;
  /** 태그(# 없이, 소문자로 맞춘 영문·한글) */
  tags: string[];
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface NoteInput {
  securityId?: string;
  tags?: string[];
  body: string;
}

export interface NotesResponse {
  notes: Note[];
  /** 모든 메모의 태그와 개수(많은 것부터) */
  tags: Array<{ tag: string; count: number }>;
}

/** 태그 하나를 맞춰요: 앞의 #과 양끝 문장부호를 빼고 영문은 소문자로 */
export function normalizeTag(t: string): string {
  return t
    .trim()
    .replace(/^#+/, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}_-]+$/gu, '')
    .toLowerCase();
}

/** 태그 칸(쉼표·공백으로 나눔)과 본문의 #태그를 합쳐요. 같은 태그는 한 번만 */
export function collectTags(field: string[] | string | undefined, body: string): string[] {
  const raw = Array.isArray(field) ? field : String(field ?? '').split(/[\s,]+/);
  const fromBody = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);
  const out: string[] = [];
  for (const t of [...raw, ...fromBody]) {
    const n = normalizeTag(t);
    if (n && n.length <= 30 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 20);
}
