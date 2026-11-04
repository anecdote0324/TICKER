// 워크스페이스 파일 내보내기·가져오기(v0.2)
import { describe, expect, it } from 'vitest';
import { buildWorkspaceFile, mergeWatchlists, mergeWorkspaces, parseWorkspaceFile, uniqueName, workspaceFileName } from './workspaceFile';

const layout = (n: string) => ({ name: n, screens: [{ id: 'main', name: 'Market Pulse' }], active: 'main', layouts: {}, panels: { p1: { id: 'p1', num: 1, fn: 'GP' } } });
const named = (n: string) => ({ name: n, savedAt: 1, data: layout(n) });

describe('내보내기 파일', () => {
  it('내보낸 파일을 그대로 다시 읽어요', () => {
    const f = buildWorkspaceFile(layout('지금'), [named('A')], [{ id: 'kr', name: '국내', ids: ['EQ:KS:005930'] }], Date.UTC(2026, 10, 4));
    const p = parseWorkspaceFile(JSON.stringify(f));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.file.workspaces.map((w) => w.name)).toEqual(['A']);
      expect(p.file.watchlists[0].ids).toEqual(['EQ:KS:005930']);
      expect(p.file.current).toBeTruthy();
    }
  });

  it('다른 파일·망가진 파일은 이유를 알려 줘요', () => {
    expect(parseWorkspaceFile('{')).toEqual({ ok: false, error: 'JSON 파일이 아니에요' });
    expect(parseWorkspaceFile('{"a":1}')).toMatchObject({ ok: false, error: expect.stringContaining('워크스페이스 파일이 아니에요') });
    expect(parseWorkspaceFile(JSON.stringify({ kind: 'ticker-workspaces', version: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining('버전') });
    expect(parseWorkspaceFile(JSON.stringify({ kind: 'ticker-workspaces', version: 1, workspaces: [{ name: 'x', data: {} }] }))).toMatchObject({ ok: false, error: '파일에 배치가 없어요' });
  });

  it('파일 이름에 날짜와 시각', () => {
    expect(workspaceFileName(new Date(2026, 10, 4, 15, 30))).toBe('TICKER-workspaces-20261104-1530.json');
  });
});

describe('가져오기는 더하기만', () => {
  it('같은 이름은 (가져옴)을 붙이고, 파일의 지금 배치는 가져온 배치로 더해 바로 열어요', () => {
    const f = buildWorkspaceFile(layout('지금'), [named('A'), named('B')], [], new Date(2026, 10, 4, 9, 5).getTime());
    const r = mergeWorkspaces([named('A')], f, 2);
    expect(r.added.map((w) => w.name)).toEqual(['가져온 배치 11/04 09:05', 'A (가져옴)', 'B']);
    expect(r.list.map((w) => w.name).sort()).toEqual(['A', 'A (가져옴)', 'B', '가져온 배치 11/04 09:05'].sort());
    expect(r.opened.name).toBe('가져온 배치 11/04 09:05');
    expect((r.added[1].data as { name: string }).name).toBe('A (가져옴)');
  });

  it('이름이 계속 겹치면 번호를 붙여요', () => {
    expect(uniqueName('A', new Set(['A', 'A (가져옴)']))).toBe('A (가져옴 2)');
  });

  it('관심종목: 없는 묶음은 더하고 같은 묶음에는 없는 종목만 뒤에', () => {
    const r = mergeWatchlists(
      [{ id: 'kr', name: '국내', ids: ['A', 'B'] }],
      [
        { id: 'kr', name: '국내', ids: ['B', 'C'] },
        { id: 'g1', name: '반도체', ids: ['D', 'D'] },
      ],
    );
    expect(r.list).toEqual([
      { id: 'kr', name: '국내', ids: ['A', 'B', 'C'] },
      { id: 'g1', name: '반도체', ids: ['D'] },
    ]);
    expect(r.addedIds).toBe(2);
  });
});
