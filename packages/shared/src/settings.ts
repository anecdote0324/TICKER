// 설정(06 설정 화면). 바꾸면 바로 적용되고, 모든 패널과 떼어낸 창에 함께 적용돼요.

import type { AssetClass } from './instrument';
import type { ShortcutMap } from './shortcuts';

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
    /** 등락 색. 기본 글로벌식(초록 상승·빨강 하락, 02) */
    upDown: UpDownStyle;
    accent: string;
    /** 글자 크기 배율 */
    fontScale: number;
  };
  commandLine: {
    assist: AssistLevel;
    /** 종목만 입력하고 Enter: 지금 기능 유지(기본) 또는 블룸버그식 기능 메뉴(v0.2) */
    securityOnlyEnter: 'keep-function' | 'menu';
    tabAutofill: boolean;
    hanEngCorrection: boolean;
    tips: boolean;
    /** 자산군별 기본 기능(v0.2): 종목만 쳤는데 지금 기능을 그 종목에 못 쓸 때 열 기능. 없으면 GP */
    defaultFunctions: Partial<Record<AssetClass, string>>;
    /** F키 모드(Windows, v0.2): F8 EQUITY, F9 CRYPTO, F10 INDEX, F11 CURNCY */
    fKeyMode: boolean;
    /** HTS식 6자리 바로 열기(v0.2, 기본 꺼짐): 국내 종목코드 6자리를 다 치면 Enter 없이 종목을 바꿔요 */
    htsSixDigit: boolean;
  };
  data: {
    /** 환율 갱신 주기(초) */
    fxIntervalSec: number;
  };
  /** 사용자가 바꾼 단축키만(06 단축키). 없는 것은 기본값 */
  keys: ShortcutMap;
}

export const DEFAULT_SETTINGS: Settings = {
  general: { restoreWorkspace: true },
  display: { theme: 'modern', upDown: 'global', accent: '#FFA028', fontScale: 1 },
  commandLine: {
    assist: 'beginner',
    securityOnlyEnter: 'keep-function',
    tabAutofill: true,
    hanEngCorrection: true,
    tips: true,
    defaultFunctions: {},
    fKeyMode: false,
    htsSixDigit: false,
  },
  data: { fxIntervalSec: 60 },
  keys: {},
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
  /** DART 전자공시 인증키(N 뉴스·공시, v0.2) */
  dart?: ApiKeyStatus;
  /** 한국은행 ECOS 인증키(GC 국고채 커브, ECO, PORT 환율 이력, v0.3) */
  ecos?: ApiKeyStatus;
  /** FRED API 키(ECO 발표일, 크레딧 스프레드, v0.3) */
  fred?: ApiKeyStatus;
  /** SEC EDGAR 요청에 넣을 연락처(FA 미국 재무제표, v0.3). SEC가 요청마다 연락처를 달라고 해요 */
  sec?: ApiKeyStatus;
}

export interface ApiKeyStatus {
  configured: boolean;
  /** 끝 4자리만(연락처는 앞부분만) */
  keyHint?: string;
  lastTest?: { ok: boolean; message: string; at: number };
}

/** 설정 → 데이터 연결에서 넣는 v0.3 키 */
export type ExtraKeyName = 'ecos' | 'fred' | 'sec';

/** 강조 색 후보: 등락·선택·자산군 칩 색과 겹치지 않는 색만(02) */
/** 강조 색 후보: 블룸버그 앰버(기본), 예전 주황, 흰색, 청록 */
export const ACCENT_CHOICES = ['#FFA028', '#FB8B1E', '#E8E8E8', '#2EC4B6'];
