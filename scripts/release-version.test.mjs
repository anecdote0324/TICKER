import { describe, expect, it } from 'vitest';
import { versionFromTag } from './release-version.mjs';

describe('태그에서 버전 번호', () => {
  it('v를 떼고 그대로 써요', () => {
    expect(versionFromTag('v0.1.0')).toEqual({ version: '0.1.0', prerelease: false });
    expect(versionFromTag('v0.10.12')).toEqual({ version: '0.10.12', prerelease: false });
  });
  it('-가 붙으면 미리 보기', () => {
    expect(versionFromTag('v0.2.0-beta.1')).toEqual({ version: '0.2.0-beta.1', prerelease: true });
  });
  it('형식이 다르면 멈춰요', () => {
    for (const bad of ['0.1.0', 'v0.1', 'v1', 'release-0.1.0', 'v0.1.0-', 'v0.1.0 ']) expect(() => versionFromTag(bad)).toThrow();
  });
});
