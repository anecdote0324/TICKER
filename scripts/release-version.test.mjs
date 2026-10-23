import { describe, expect, it } from 'vitest';
import { bumpKind, nextVersion, versionFromTag } from './release-version.mjs';

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

describe('다음 버전 번호 자동으로', () => {
  const tags = ['v0.1.0-beta.1', 'v0.1.0-beta.2', 'not-a-tag'];
  it('미리 보기: beta 번호를 하나 올려요', () => {
    expect(nextVersion(tags, 'beta')).toEqual({ version: '0.1.0-beta.3', prerelease: true });
    expect(nextVersion(['v0.1.0-beta.9', 'v0.1.0-beta.10'], 'beta').version).toBe('0.1.0-beta.11');
  });
  it('정식: 미리 보기 다음이면 그 번호의 정식, 정식 다음이면 끝자리 +1', () => {
    expect(nextVersion(tags, 'release')).toEqual({ version: '0.1.0', prerelease: false });
    expect(nextVersion([...tags, 'v0.1.0'], 'release').version).toBe('0.1.1');
  });
  it('정식을 낸 뒤의 미리 보기는 다음 끝자리의 beta.1', () => {
    expect(nextVersion([...tags, 'v0.1.0'], 'beta').version).toBe('0.1.1-beta.1');
  });
  it('다음 단계: 가운데 숫자를 올리고 beta.1부터', () => {
    expect(nextVersion([...tags, 'v0.1.3'], 'stage')).toEqual({ version: '0.2.0-beta.1', prerelease: true });
  });
  it('태그가 하나도 없으면 0.1.0부터', () => {
    expect(nextVersion([], 'beta').version).toBe('0.1.0-beta.1');
    expect(nextVersion([], 'release').version).toBe('0.1.0');
  });
  it('Actions 선택지 이름을 알아봐요', () => {
    expect(bumpKind('미리 보기 (다음 beta 번호)')).toBe('beta');
    expect(bumpKind('정식')).toBe('release');
    expect(bumpKind('다음 단계 (가운데 숫자)')).toBe('stage');
    expect(bumpKind('설치 파일만')).toBeNull();
    expect(bumpKind('')).toBeNull();
  });
});
