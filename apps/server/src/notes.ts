// v0.5 NOTE 메모: 데이터 폴더의 notes.db(SQLite)에 둬요. SQLite를 쓸 수 없으면 메모리에만(앱을 끄면 사라져요).

import { DatabaseSync } from 'node:sqlite';
import { collectTags, type Note, type NoteInput, type NotesResponse } from '@bt/shared';
import type { Logger } from './util';

const MAX_BODY = 20_000;

interface Row {
  id: number;
  security_id: string | null;
  tags: string;
  body: string;
  created_at: number;
  updated_at: number;
}

const toNote = (r: Row): Note => ({
  id: Number(r.id),
  securityId: r.security_id ?? undefined,
  tags: r.tags ? r.tags.split(' ').filter(Boolean) : [],
  body: r.body,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export interface NoteQuery {
  /** 본문·태그에 들어간 글자(공백으로 나누면 모두 들어간 것) */
  q?: string;
  tag?: string;
  securityId?: string;
}

export class NoteStore {
  private db?: DatabaseSync;
  private mem: Note[] = [];
  private nextId = 1;

  constructor(file: string | undefined, log?: Logger) {
    if (!file) return;
    try {
      this.db = new DatabaseSync(file);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, security_id TEXT, tags TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notes_updated ON notes (updated_at DESC);
        CREATE INDEX IF NOT EXISTS notes_security ON notes (security_id, updated_at DESC);
      `);
    } catch (e) {
      log?.warn(`메모 저장소를 쓸 수 없어요(메모리에만 둬요): ${(e as Error).message}`);
      this.db = undefined;
    }
  }

  private clean(input: NoteInput): { securityId: string | null; tags: string[]; body: string } {
    const body = String(input.body ?? '').slice(0, MAX_BODY).trim();
    if (!body) throw new Error('메모 내용이 비어 있어요');
    const securityId = typeof input.securityId === 'string' && input.securityId.trim() ? input.securityId.trim().slice(0, 80) : null;
    return { securityId, tags: collectTags(input.tags, body), body };
  }

  add(input: NoteInput): Note {
    const c = this.clean(input);
    const now = Date.now();
    if (this.db) {
      const r = this.db.prepare('INSERT INTO notes (security_id, tags, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(c.securityId, c.tags.join(' '), c.body, now, now);
      return this.get(Number(r.lastInsertRowid))!;
    }
    const n: Note = { id: this.nextId++, securityId: c.securityId ?? undefined, tags: c.tags, body: c.body, createdAt: now, updatedAt: now };
    this.mem.unshift(n);
    return n;
  }

  get(id: number): Note | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
      return r ? toNote(r) : undefined;
    }
    return this.mem.find((n) => n.id === id);
  }

  update(id: number, input: NoteInput): Note {
    const old = this.get(id);
    if (!old) throw new Error('메모를 찾을 수 없어요');
    const c = this.clean(input);
    const now = Date.now();
    if (this.db) {
      this.db.prepare('UPDATE notes SET security_id = ?, tags = ?, body = ?, updated_at = ? WHERE id = ?').run(c.securityId, c.tags.join(' '), c.body, now, id);
      return this.get(id)!;
    }
    Object.assign(old, { securityId: c.securityId ?? undefined, tags: c.tags, body: c.body, updatedAt: now });
    return old;
  }

  remove(id: number): boolean {
    if (this.db) return Number(this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes) > 0;
    const before = this.mem.length;
    this.mem = this.mem.filter((n) => n.id !== id);
    return this.mem.length < before;
  }

  private all(): Note[] {
    if (this.db) return (this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC, id DESC').all() as unknown as Row[]).map(toNote);
    return [...this.mem].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
  }

  /** 개인 메모라 수가 많지 않아서 모두 읽은 뒤 거르고, 태그 개수도 함께 셉니다(최대 500개 돌려줘요) */
  list(query: NoteQuery = {}): NotesResponse {
    const all = this.all();
    const counts = new Map<string, number>();
    for (const n of all) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const words = String(query.q ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const tag = query.tag ? collectTags([query.tag], '')[0] : undefined;
    const notes = all.filter((n) => {
      if (query.securityId && n.securityId !== query.securityId) return false;
      if (tag && !n.tags.includes(tag)) return false;
      if (words.length) {
        const hay = `${n.body} ${n.tags.map((t) => `#${t}`).join(' ')}`.toLowerCase();
        if (!words.every((w) => hay.includes(w.replace(/^#/, '')))) return false;
      }
      return true;
    });
    return {
      notes: notes.slice(0, 500),
      tags: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([t, count]) => ({ tag: t, count })),
    };
  }

  close() {
    this.db?.close();
  }
}
