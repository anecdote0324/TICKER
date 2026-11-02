import { describe, expect, it } from 'vitest';
import { josa } from './format';

describe('조사', () => {
  it('받침에 맞춰 은/는을 붙이고, 한글로 끝나지 않으면 두 형태를 함께 적어요', () => {
    expect(josa('코스피', '은', '는')).toBe('코스피는');
    expect(josa('셀트리온', '은', '는')).toBe('셀트리온은');
    expect(josa('AAPL', '은', '는')).toBe('AAPL은(는)');
    expect(josa('', '은', '는')).toBe('은(는)');
  });
});
