import { describe, expect, it } from 'vitest';
import { assetFor, compareVersions, isReleaseAssetUrl, pickUpdate, type GithubRelease } from './update';

const rel = (tag: string, prerelease: boolean, names: string[], extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  draft: false,
  prerelease,
  html_url: `https://github.com/anecdote0324/TICKER/releases/tag/${tag}`,
  assets: names.map((n) => ({ name: n, size: 100, browser_download_url: `https://github.com/anecdote0324/TICKER/releases/download/${tag}/${n}`, digest: 'sha256:ABC' })),
  ...extra,
});

describe('업데이트 버전 비교', () => {
  it('시맨틱 버전 순서', () => {
    expect(compareVersions('0.5.0-beta.2', '0.5.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('0.5.0-beta.10', '0.5.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('0.5.0', '0.5.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.4.0', '0.5.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('pickUpdate', () => {
  const list = [
    rel('v0.5.0-beta.2', true, ['TICKER.Setup.0.5.0-beta.2.exe', 'TICKER.0.5.0-beta.2.exe']),
    rel('v0.5.0-beta.1', true, ['TICKER.Setup.0.5.0-beta.1.exe', 'TICKER.0.5.0-beta.1.exe', 'TICKER-0.5.0-beta.1-arm64.dmg']),
    rel('v0.4.0', false, ['TICKER.Setup.0.4.0.exe']),
    rel('v0.6.0-beta.1', true, ['TICKER.Setup.0.6.0-beta.1.exe'], { draft: true }),
  ];
  it('미리 보기 포함이면 가장 새 미리 보기(초안은 빼요)', () => {
    const u = pickUpdate(list, '0.4.0-beta.3', 'win-setup', true)!;
    expect(u.version).toBe('0.5.0-beta.2');
    expect(u.asset.name).toBe('TICKER.Setup.0.5.0-beta.2.exe');
    expect(u.asset.sha256).toBe('abc');
  });
  it('정식만이면 정식', () => {
    expect(pickUpdate(list, '0.3.0', 'win-setup', false)?.version).toBe('0.4.0');
    expect(pickUpdate(list, '0.4.0', 'win-setup', false)).toBeUndefined();
  });
  it('이 컴퓨터용 파일이 있는 릴리스만(Mac 파일이 없는 릴리스는 건너뜀)', () => {
    expect(pickUpdate(list, '0.4.0', 'mac-arm64', true)?.version).toBe('0.5.0-beta.1');
    expect(pickUpdate(list, '0.4.0', 'win-portable', true)?.asset.name).toBe('TICKER.0.5.0-beta.2.exe');
  });
  it('이미 최신이면 없어요', () => {
    expect(pickUpdate(list, '0.5.0-beta.2', 'win-setup', true)).toBeUndefined();
  });
  it('Mac은 zip을 먼저, 없으면 dmg', () => {
    const r = rel('v0.6.0-beta.1', true, ['TICKER-0.6.0-beta.1-arm64.dmg', 'TICKER-0.6.0-beta.1-arm64-mac.zip']);
    expect(assetFor(r, 'mac-arm64')?.name).toBe('TICKER-0.6.0-beta.1-arm64-mac.zip');
    expect(assetFor(list[1], 'mac-arm64')?.name).toBe('TICKER-0.5.0-beta.1-arm64.dmg');
  });
  it('파일 고르기와 주소 확인', () => {
    expect(assetFor(list[0], 'win-setup')?.name).toContain('Setup');
    expect(isReleaseAssetUrl('https://github.com/anecdote0324/TICKER/releases/download/v1/a.exe')).toBe(true);
    expect(isReleaseAssetUrl('https://evil.example/anecdote0324/TICKER/releases/download/v1/a.exe')).toBe(false);
  });
});
