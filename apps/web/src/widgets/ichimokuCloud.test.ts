// 일목 구름 칠하기: 위아래가 바뀌는 곳에서 나눠 칠해요
import { describe, expect, it } from 'vitest';
import { cloudSegments } from './ichimokuCloud';

describe('cloudSegments', () => {
  it('스팬 1이 위(화면 y가 작음)면 상승 구름 하나', () => {
    const s = cloudSegments([
      { x: 0, ya: 10, yb: 20 },
      { x: 10, ya: 12, yb: 22 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].up).toBe(true);
  });

  it('두 선이 엇갈리면 만나는 점에서 상승·하락 둘로', () => {
    const s = cloudSegments([
      { x: 0, ya: 10, yb: 20 },
      { x: 10, ya: 30, yb: 20 },
    ]);
    expect(s.map((x) => x.up)).toEqual([true, false]);
    // 만나는 점: ya가 20이 되는 x = 5
    expect(s[0].poly[1]).toEqual([5, 20]);
    expect(s[1].poly[0]).toEqual([5, 20]);
  });
});
