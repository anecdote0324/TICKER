import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectTags } from '@bt/shared';
import { NoteStore } from './notes';

describe('NOTE 메모', () => {
  it('태그 칸과 본문의 #태그를 합쳐요', () => {
    expect(collectTags('반도체, #HBM  ', '실적 좋음 #AI #hbm 끝.')).toEqual(['반도체', 'hbm', 'ai']);
    expect(collectTags(undefined, 'url#anchor는 태그가 아니에요')).toEqual([]);
  });
  for (const mode of ['sqlite', 'memory'] as const) {
    it(`추가·고치기·지우기·검색(${mode})`, () => {
      const store = new NoteStore(mode === 'sqlite' ? join(mkdtempSync(join(tmpdir(), 'bt-notes-')), 'notes.db') : undefined);
      const a = store.add({ securityId: 'EQ:KS:005930', body: '삼성 HBM 납품 #반도체', tags: ['관심'] });
      store.add({ body: '금리 인하 기대 #매크로' });
      expect(a.tags).toEqual(['관심', '반도체']);
      expect(store.list().notes).toHaveLength(2);
      expect(store.list({ securityId: 'EQ:KS:005930' }).notes.map((n) => n.id)).toEqual([a.id]);
      expect(store.list({ tag: '#매크로' }).notes).toHaveLength(1);
      expect(store.list({ q: 'hbm 삼성' }).notes).toHaveLength(1);
      expect(store.list({ q: '#반도체' }).notes).toHaveLength(1);
      expect(store.list().tags.map((t) => t.tag).sort()).toEqual(['관심', '매크로', '반도체'].sort());
      const b = store.update(a.id, { securityId: 'EQ:KS:005930', body: '수정함 #메모리' });
      expect(b.tags).toEqual(['메모리']);
      expect(() => store.add({ body: '   ' })).toThrow();
      expect(store.remove(a.id)).toBe(true);
      expect(store.list().notes).toHaveLength(1);
      store.close();
    });
  }
});
