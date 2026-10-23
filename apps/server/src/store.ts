// 설정, 앱 상태(기록·관심종목·배치 등), 비밀 정보 저장.
// 기록과 사용 점수는 서버(메인 프로세스)만 써요. 여러 창이 동시에 써서 기록이 사라지는 일을 막아요(05 §14.2).
// 앱키·앱시크릿은 암호화해서 저장해요(01 보안). Electron에서는 OS 보안 저장소(safeStorage)를 써요.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@bt/shared';

export interface SecretBox {
  /** 'os': OS 보안 저장소, 'file': 데이터 폴더의 키 파일(개발용) */
  kind: 'os' | 'file';
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}

/** 개발용: 데이터 폴더의 무작위 키(권한 600)로 AES-256-GCM 암호화 */
export async function fileSecretBox(dataDir: string): Promise<SecretBox> {
  const keyPath = join(dataDir, 'secret.key');
  let key: Buffer;
  try {
    key = await readFile(keyPath);
    if (key.length !== 32) throw new Error('bad key');
  } catch {
    key = randomBytes(32);
    await writeFile(keyPath, key, { mode: 0o600 });
    await chmod(keyPath, 0o600).catch(() => undefined);
  }
  return {
    kind: 'file',
    async encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    },
    async decrypt(cipher) {
      const buf = Buffer.from(cipher, 'base64');
      const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

/** 화면이 읽고 쓸 수 있는 상태 이름 */
export const STATE_NAMES = ['history', 'usage', 'fnUsage', 'remembered', 'defaults', 'watchlists', 'workspace', 'tips'] as const;
export type StateName = (typeof STATE_NAMES)[number];

export class Store {
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private state = new Map<string, unknown>();
  private secrets: Record<string, string> = {};
  private writing = new Map<string, Promise<void>>();

  constructor(
    public dataDir: string,
    private box: SecretBox,
  ) {}

  get secretKind() {
    return this.box.kind;
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    const s = await this.readJson<Partial<Settings>>('settings.json');
    if (s) this.settings = mergeSettings(s);
    for (const n of STATE_NAMES) {
      const v = await this.readJson(`state-${n}.json`);
      if (v !== undefined) this.state.set(n, v);
    }
    this.secrets = (await this.readJson<Record<string, string>>('secrets.json')) ?? {};
  }

  private async readJson<T = unknown>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.dataDir, file), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  /** 파일 하나에 쓰기를 차례로: 임시 파일에 쓰고 이름을 바꿔요 */
  private async writeJson(file: string, value: unknown, mode?: number) {
    const prev = this.writing.get(file) ?? Promise.resolve();
    const next = prev.then(async () => {
      const path = join(this.dataDir, file);
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 1), mode ? { mode } : undefined);
      await rename(tmp, path);
    });
    this.writing.set(file, next.catch(() => undefined));
    return next;
  }

  getSettings(): Settings {
    return this.settings;
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = mergeSettings({ ...this.settings, ...patch, general: { ...this.settings.general, ...patch.general }, display: { ...this.settings.display, ...patch.display }, commandLine: { ...this.settings.commandLine, ...patch.commandLine }, data: { ...this.settings.data, ...patch.data } });
    await this.writeJson('settings.json', this.settings);
    return this.settings;
  }

  getState(name: StateName): unknown {
    return this.state.get(name);
  }

  async setState(name: StateName, value: unknown) {
    this.state.set(name, value);
    await this.writeJson(`state-${name}.json`, value);
  }

  async getSecret(name: string): Promise<string | undefined> {
    const c = this.secrets[name];
    if (!c) return undefined;
    try {
      return await this.box.decrypt(c);
    } catch {
      return undefined;
    }
  }

  async setSecret(name: string, value: string | undefined) {
    if (value === undefined) delete this.secrets[name];
    else this.secrets[name] = await this.box.encrypt(value);
    await this.writeJson('secrets.json', this.secrets, 0o600);
  }
}

function mergeSettings(s: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    general: { ...d.general, ...s.general },
    display: { ...d.display, ...s.display },
    commandLine: { ...d.commandLine, ...s.commandLine },
    data: { ...d.data, ...s.data },
  };
}
