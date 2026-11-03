// DES 종목 개요에 보이는 값(03 v0.2). 값마다 출처가 달라서 묶음을 나눠요.
// - live: 한국투자증권 현재가 조회(키가 있을 때). PER·PBR·52주 고저 등
// - master: 한국투자증권 종목 마스터(국내만, 하루 한 번 받는 파일). 업종·상장일·매출액·영업이익·ROE

import type { Freshness } from './freshness';

/** 한국투자증권 현재가 조회에서 온 값. 금액은 그 종목의 통화(원·달러) 그대로예요 */
export interface ProfileLive {
  last?: number;
  /** 현재가 × 상장주식수 */
  marketCap?: number;
  shares?: number;
  per?: number;
  pbr?: number;
  eps?: number;
  bps?: number;
  high52?: number;
  /** 'YYYY-MM-DD' */
  high52Date?: string;
  low52?: number;
  low52Date?: string;
  /** 한국투자증권이 붙인 업종 이름(국내 `bstp_kor_isnm`, 미국 `e_icod`) */
  sector?: string;
  /** 외국인 소진율(%) */
  foreignRatio?: number;
  /** 거래량 회전율(%) */
  turnoverRate?: number;
  faceValue?: number;
  /** 결산 월('12') */
  settleMonth?: string;
  /** 미국 종목의 원화 환산 현재가 */
  krwPrice?: number;
  /** 관리종목·투자주의 같은 상태 문구 */
  warnings?: string[];
  fresh: Freshness;
}

/** 국내 종목 마스터에서 온 값. 금액은 원이에요(파일은 억 원 단위) */
export interface ProfileMaster {
  /** 업종 이름: 대분류 > 중분류(예: 제조 > 전기·전자) */
  sector?: string[];
  /** 'YYYY-MM-DD' */
  listedDate?: string;
  shares?: number;
  /** 전일 종가 기준 시가총액 */
  marketCap?: number;
  sales?: number;
  operatingProfit?: number;
  /** % */
  roe?: number;
  /** 매출액·영업이익·ROE의 기준 월('YYYY-MM') */
  basisMonth?: string;
  faceValue?: number;
  settleMonth?: string;
  warnings?: string[];
  /** 마스터 파일을 받은 날('YYYY-MM-DD') */
  asOf: string;
}

/** DART 기업개황(국내, 인증키가 있을 때): 회사 정보와 국내 산업분류(KSIC) 코드 */
export interface ProfileCompany {
  ceo?: string;
  /** 'YYYY-MM-DD' */
  established?: string;
  homepage?: string;
  address?: string;
  /** 업종코드(KSIC, 한국표준산업분류) */
  ksic?: string;
  /** 결산 월 */
  settleMonth?: string;
}

export interface SecurityProfile {
  id: string;
  currency: string;
  live?: ProfileLive;
  master?: ProfileMaster;
  company?: ProfileCompany;
  /** live를 받지 못한 이유(키가 없음, 조회 실패) */
  liveError?: string;
}
