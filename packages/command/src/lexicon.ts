// 닫힌 칸의 단어: 시장, 자산군, 명령(05 §3.1~3.3, §7.5)

import type { AssetClass, Market } from '@bt/shared';

/**
 * 해석기 안에서만 쓰는 정규화: NFC, 전각 영문·숫자는 반각으로, 꺾쇠 제거.
 * NFKC를 통째로 쓰면 낱자 자모(ㅈ, U+3148)가 조합용 자모(U+110C)로 바뀌어 초성·한/영 변환이 깨져요.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[<>]/g, '');
}

/** 코드 키: 대문자, 구분자 제거(BRK.B, BRK/B, BRK-B → BRKB) */
export function codeKey(s: string): string {
  return s.toUpperCase().replace(/[./\-\s]/g, '');
}

export const MARKET_WORDS: Record<string, Market | 'IGNORE'> = {
  KS: 'KS',
  KQ: 'KQ',
  US: 'US',
  UN: 'US',
  UW: 'US',
  UQ: 'US',
  UA: 'US',
  UP: 'US',
  NAS: 'US',
  NYS: 'US',
  AMS: 'US',
  BN: 'IGNORE',
  BINANCE: 'IGNORE',
};

/** 블룸버그의 다른 나라 거래소 코드: 지원하지 않는 시장 안내에 써요 */
export const FOREIGN_MARKETS = new Set([
  'LN', 'JP', 'JT', 'HK', 'CH', 'CN', 'GR', 'GY', 'FP', 'AU', 'CT', 'SP', 'IM', 'NA', 'SW', 'SS', 'TT', 'IN', 'SJ',
  'SM', 'BB', 'DC', 'FH', 'NO', 'ID', 'PL', 'BZ', 'MM', 'TB', 'MK', 'SK', 'VN',
]);

export const ASSET_WORDS: Record<string, AssetClass> = {
  EQUITY: 'EQUITY',
  EQ: 'EQUITY',
  EQY: 'EQUITY',
  주식: 'EQUITY',
  CRYPTO: 'CRYPTO',
  CRY: 'CRYPTO',
  CURNCY: 'CURNCY',
  CRNCY: 'CURNCY',
  CUR: 'CURNCY',
  FX: 'CURNCY',
  INDEX: 'INDEX',
  IDX: 'INDEX',
  IND: 'INDEX',
};

/** 나중에 열 자산군(05 §3.7) */
export const RESERVED_ASSET_WORDS: Record<string, string> = {
  GOVT: 'v0.7',
  CORP: 'v0.7',
  COMDTY: 'v0.7',
  MTGE: '계획 없음',
  MMKT: '계획 없음',
  PFD: '계획 없음',
};

export type CommandWord = 'help' | 'syntax' | 'settings';

export const COMMAND_WORDS: Record<string, { cmd: CommandWord; nameKo: string; summary: string }> = {
  '?': { cmd: 'syntax', nameKo: '문법 요약', summary: '명령어 문법 안내' },
  도움말: { cmd: 'help', nameKo: '도움말', summary: '커맨드 라인 도움말' },
  HELP: { cmd: 'help', nameKo: '도움말', summary: '커맨드 라인 도움말' },
  설정: { cmd: 'settings', nameKo: '설정', summary: '설정 창 열기' },
  PDF: { cmd: 'settings', nameKo: '개인 설정', summary: '설정 창 열기 (블룸버그 Personal Defaults)' },
};

/** 표시용 전체 이름 */
export const ASSET_FULL: Record<AssetClass, string> = {
  EQUITY: 'EQUITY',
  CRYPTO: 'CRYPTO',
  CURNCY: 'CURNCY',
  INDEX: 'INDEX',
};
