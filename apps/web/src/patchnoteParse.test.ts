import { describe, expect, it } from 'vitest';
import { inlineParts, noteBlocks, notesToShow, parsePatchNotes } from './patchnoteParse';

const files = {
  '../../../patchnote/README.md': '# 안내',
  '../../../patchnote/next.md': '## 새 기능\n- 아직',
  '../../../patchnote/v0.5.0-beta.1.md': '# v0.5.0-beta.1 (2026-11-09)\n\n## 새 기능\n- **업데이트** 기능',
  '../../../patchnote/v0.4.0-beta.5.md': '## 고친 것\n- 하나',
  '../../../patchnote/v0.5.0.md': '# v0.5.0 (2026-11-20)\n\n본문',
};

describe('패치노트', () => {
  const notes = parsePatchNotes(files);
  it('버전 파일만, 최신 먼저, 날짜와 제목 줄', () => {
    expect(notes.map((n) => n.version)).toEqual(['0.5.0', '0.5.0-beta.1', '0.4.0-beta.5']);
    expect(notes[1].date).toBe('2026-11-09');
    expect(notes[1].body.startsWith('## 새 기능')).toBe(true);
  });
  it('본 버전과 지금 버전 사이의 것만', () => {
    expect(notesToShow(notes, '0.5.0-beta.1', '0.4.0-beta.4').map((n) => n.version)).toEqual(['0.5.0-beta.1', '0.4.0-beta.5']);
    expect(notesToShow(notes, '0.5.0-beta.1', '0.5.0-beta.1')).toEqual([]);
    // 기록이 없으면 지금 버전 것만
    expect(notesToShow(notes, '0.5.0-beta.1', undefined).map((n) => n.version)).toEqual(['0.5.0-beta.1']);
    expect(notesToShow(notes, '0.1.0', undefined)).toEqual([]);
  });
  it('블록과 굵게·코드', () => {
    expect(noteBlocks('## 새 기능\n- 하나\n  이어짐\n  - 아래\n문단')).toEqual([
      { kind: 'h', level: 2, text: '새 기능' },
      { kind: 'li', depth: 0, text: '하나 이어짐' },
      { kind: 'li', depth: 1, text: '아래' },
      { kind: 'p', text: '문단' },
    ]);
    expect(inlineParts('a **b** `c` d')).toEqual([{ t: 'a ' }, { t: 'b', b: true }, { t: ' ' }, { t: 'c', code: true }, { t: ' d' }]);
  });
});
