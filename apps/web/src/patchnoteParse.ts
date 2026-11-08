// 패치노트(저장소 patchnote/ 폴더의 마크다운) 해석. 화면 없이 시험할 수 있게 따로 둬요.
// 파일 이름이 버전이에요(v0.5.0-beta.1.md). next.md는 아직 릴리스하지 않은 변경이라 창에는 띄우지 않아요.

import { compareVersions } from '@bt/shared';

export interface PatchNote {
  /** '0.5.0-beta.1' */
  version: string;
  /** 첫 줄 '# v0.5.0-beta.1 (2026-11-09)'의 날짜 */
  date?: string;
  /** 제목 줄을 뺀 본문 */
  body: string;
}

/** 파일 경로·내용 묶음 → 버전 순(최신 먼저) 패치노트. README·next.md와 버전 모양이 아닌 이름은 빼요 */
export function parsePatchNotes(files: Record<string, string>): PatchNote[] {
  const out: PatchNote[] = [];
  for (const [path, text] of Object.entries(files)) {
    const m = path.match(/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/);
    if (!m) continue;
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let date: string | undefined;
    if (lines[0]?.startsWith('# ')) {
      date = lines[0].match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
      lines.shift();
    }
    out.push({ version: m[1], date, body: lines.join('\n').trim() });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * 업데이트 뒤 보여 줄 패치노트: 지난번에 본 버전보다 새롭고 지금 버전 이하인 것(최신 먼저).
 * 본 버전 기록이 없으면(처음 깔았거나 이 기능이 없던 버전에서 올라온 경우) 지금 버전 것만
 */
export function notesToShow(notes: PatchNote[], current: string, seen: string | undefined): PatchNote[] {
  if (seen && compareVersions(current, seen) <= 0) return [];
  return notes.filter((n) => compareVersions(n.version, current) <= 0 && (seen ? compareVersions(n.version, seen) > 0 : compareVersions(n.version, current) === 0));
}

export type NoteBlock = { kind: 'h'; level: 2 | 3; text: string } | { kind: 'li'; depth: number; text: string } | { kind: 'p'; text: string };

/** 패치노트에 쓰는 마크다운 일부(## 제목, - 목록, 문단)만 블록으로 나눠요. HTML은 쓰지 않아요 */
export function noteBlocks(body: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const raw of body.split('\n')) {
    if (!raw.trim()) continue;
    const h = raw.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      out.push({ kind: 'h', level: h[1].length as 2 | 3, text: h[2].trim() });
      continue;
    }
    const li = raw.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) {
      out.push({ kind: 'li', depth: Math.min(2, Math.floor(li[1].length / 2)), text: li[2].trim() });
      continue;
    }
    const last = out[out.length - 1];
    // 목록 줄 아래 들여 쓴 이어지는 줄은 그 줄에 붙여요
    if (last && last.kind !== 'h' && /^\s+/.test(raw)) last.text += ` ${raw.trim()}`;
    else out.push({ kind: 'p', text: raw.trim() });
  }
  return out;
}

/** **굵게**와 `코드`만 나눠요 */
export function inlineParts(text: string): Array<{ t: string; b?: boolean; code?: boolean }> {
  const out: Array<{ t: string; b?: boolean; code?: boolean }> = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let pos = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > pos) out.push({ t: text.slice(pos, m.index) });
    out.push(m[1] !== undefined ? { t: m[1], b: true } : { t: m[2], code: true });
    pos = m.index! + m[0].length;
  }
  if (pos < text.length) out.push({ t: text.slice(pos) });
  return out;
}
