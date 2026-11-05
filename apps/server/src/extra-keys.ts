// v0.3 키(BOK ECOS, FRED, SEC EDGAR 연락처): 저장·확인·적용을 한 모양으로 다뤄요(06 설정 → 데이터 연결).
// 값은 보안 저장소에 { key, lastTest }로 두고, 화면에는 끝 4자리(연락처는 앞부분)만 돌려줘요.

import type { ExtraKeyName } from '@bt/shared';

export interface ExtraKeyDef {
  /** 기록·오류 문구에 쓰는 이름 */
  label: string;
  /** 모양이 틀리면 이유 */
  validate(key: string): string | undefined;
  test(key: string): Promise<{ ok: boolean; message: string }>;
  /** 서비스에 넣기(지우면 undefined) */
  apply(key: string | undefined): void;
  /** 화면에 보여 줄 힌트 */
  hint(key: string): string;
}

export type ExtraKeys = Partial<Record<ExtraKeyName, ExtraKeyDef>>;

export const EXTRA_KEY_NAMES: ExtraKeyName[] = ['ecos', 'fred', 'sec', 'krx'];

/** 끝 4자리 힌트 */
export const tailHint = (k: string) => `…${k.slice(-4)}`;
