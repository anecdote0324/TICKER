import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSecretBox, Store } from './store';

async function storeWith(settings: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'bt-store-'));
  if (settings) await writeFile(join(dir, 'settings.json'), JSON.stringify(settings));
  const store = new Store(dir, await fileSecretBox(dir));
  await store.load();
  return { store, dir };
}

const OLD = {
  general: { restoreWorkspace: true },
  display: { theme: 'modern', upDown: 'korean', accent: '#FB8B1E', fontScale: 1 },
  commandLine: { assist: 'standard', securityOnlyEnter: 'keep-function', tabAutofill: true, hanEngCorrection: true, tips: true },
  data: { fxIntervalSec: 60 },
};

describe('설정 저장', () => {
  it('기본 등락 색은 글로벌식', async () => {
    const { store } = await storeWith(null);
    expect(store.getSettings().display.upDown).toBe('global');
  });

  it('예전 기본값(한국식)으로 통째로 저장된 파일은 등락 색만 새 기본값으로, 나머지는 그대로', async () => {
    const { store } = await storeWith(OLD);
    expect(store.getSettings().display.upDown).toBe('global');
    expect(store.getSettings().commandLine.assist).toBe('standard');
  });

  it('새로 저장한 뒤에 고른 한국식은 유지돼요', async () => {
    const { store, dir } = await storeWith(OLD);
    await store.setSettings({ display: { ...store.getSettings().display, upDown: 'korean' } });
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).schema).toBe(3);
    const again = new Store(dir, await fileSecretBox(dir));
    await again.load();
    expect(again.getSettings().display.upDown).toBe('korean');
  });

  it('예전 기본 강조 색(#FB8B1E)으로 저장된 파일은 새 기본값(블룸버그 앰버)으로, 고른 다른 색은 그대로', async () => {
    const { store } = await storeWith({ ...OLD, schema: 2 });
    expect(store.getSettings().display.accent).toBe('#FFA028');
    const teal = await storeWith({ ...OLD, display: { ...OLD.display, accent: '#2EC4B6' }, schema: 2 });
    expect(teal.store.getSettings().display.accent).toBe('#2EC4B6');
  });

  it('앱키는 암호화해서 저장해요', async () => {
    const { store, dir } = await storeWith(null);
    await store.setSecret('kis', 'my-app-secret');
    const raw = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('my-app-secret');
    expect(await store.getSecret('kis')).toBe('my-app-secret');
  });
});
