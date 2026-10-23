// 설정(06 설정 화면). 바꾸면 바로 적용되고, 모든 패널과 떼어낸 창에 함께 적용돼요.

export type AssistLevel = 'beginner' | 'standard' | 'expert' | 'off';

export const ASSIST_LABEL: Record<AssistLevel, string> = {
  beginner: '입문',
  standard: '표준',
  expert: '전문가',
  off: '끔',
};

export type UpDownStyle = 'korean' | 'global';

export interface Settings {
  general: {
    restoreWorkspace: boolean;
  };
  display: {
    theme: 'modern';
    /** 등락 색. 기본 한국식(02) */
    upDown: UpDownStyle;
    accent: string;
    /** 글자 크기 배율 */
    fontScale: number;
  };
  commandLine: {
    assist: AssistLevel;
    /** 종목만 입력하고 Enter: v0.1은 '지금 기능 유지' 하나 */
    securityOnlyEnter: 'keep-function';
    tabAutofill: boolean;
    hanEngCorrection: boolean;
    tips: boolean;
  };
  data: {
    /** 환율 갱신 주기(초) */
    fxIntervalSec: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  general: { restoreWorkspace: true },
  display: { theme: 'modern', upDown: 'korean', accent: '#FB8B1E', fontScale: 1 },
  commandLine: {
    assist: 'beginner',
    securityOnlyEnter: 'keep-function',
    tabAutofill: true,
    hanEngCorrection: true,
    tips: true,
  },
  data: { fxIntervalSec: 60 },
};

/** 비밀 정보 입력 상태. 값 자체는 화면으로 돌려보내지 않아요 */
export interface CredentialStatus {
  kis: {
    configured: boolean;
    /** 앱키 끝 4자리만 */
    appKeyHint?: string;
    /** 실전 / 모의 */
    env: 'real' | 'virtual';
    /** 연결 테스트 결과 */
    lastTest?: { ok: boolean; message: string; at: number };
  };
}

/** 강조 색 후보: 등락·선택·자산군 칩 색과 겹치지 않는 색만(02) */
export const ACCENT_CHOICES = ['#FB8B1E', '#E8E8E8', '#2EC4B6'];
