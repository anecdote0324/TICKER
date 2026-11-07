// 이 파일은 scripts/gen-function-catalog.mjs가 만들어요. 직접 고치지 말고 08 문서를 고친 뒤 다시 만들어요.

export interface CatalogEntry {
  code: string;
  nameKo: string;
  desc: string;
  section: string;
  speed: string;
  /** 'v0.4' 같은 단계, 'later'는 후순위 */
  version: string;
  approx: boolean;
  aliases: string[];
}

export const FUNCTION_CATALOG: CatalogEntry[] = [
  {
    "code": "BLP",
    "nameKo": "런치패드",
    "desc": "여러 패널을 배치한 화면",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "LAST",
    "nameKo": "최근 화면",
    "desc": "최근 연 화면 목록",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.2",
    "approx": false,
    "aliases": []
  },
  {
    "code": "PDF",
    "nameKo": "개인 설정",
    "desc": "설정 창 열기",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HELP",
    "nameKo": "도움말",
    "desc": "기능 설명서",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FXTF",
    "nameKo": "FX 티커 찾기",
    "desc": "환율 종목 찾기",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FAVE",
    "nameKo": "즐겨찾기",
    "desc": "기능·종목 북마크",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "GRAB",
    "nameKo": "화면 캡처",
    "desc": "패널을 PNG로 저장하거나 클립보드로 복사(이메일 대신)",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "NOTE",
    "nameKo": "메모",
    "desc": "종목·테마에 태그를 단 메모와 검색",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CIX",
    "nameKo": "수식 티커",
    "desc": "시세를 조합한 사용자 지수(스프레드, 비율)",
    "section": "공통·도구",
    "speed": "원래 시세와 같음",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "BQL",
    "nameKo": "쿼리 언어",
    "desc": "앱 데이터로 스크리닝·시계열 식 계산",
    "section": "공통·도구",
    "speed": "계산",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "DAPI",
    "nameKo": "내보내기",
    "desc": "표·시계열을 CSV·XLSX로",
    "section": "공통·도구",
    "speed": "정적",
    "version": "v0.9",
    "approx": false,
    "aliases": [
      "BDP",
      "BDH",
      "BDS",
      "XLTP"
    ]
  },
  {
    "code": "BQNT",
    "nameKo": "스크립트 콘솔",
    "desc": "사용자 스크립트로 리서치",
    "section": "공통·도구",
    "speed": "계산",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ALRT",
    "nameKo": "알림",
    "desc": "가격·지표·뉴스 조건 알림",
    "section": "공통·도구",
    "speed": "실시간",
    "version": "v0.3",
    "approx": false,
    "aliases": []
  },
  {
    "code": "MON",
    "nameKo": "관심종목",
    "desc": "주식·코인·환율을 섞은 목록",
    "section": "주식 시세·차트",
    "speed": "실시간(환율은 지연)",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WATC",
    "nameKo": "관심종목 분석",
    "desc": "MON 목록의 성과·뉴스·공시·이벤트를 모아 보기",
    "section": "주식 시세·차트",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "GP",
    "nameKo": "가격 차트",
    "desc": "일·주·월봉. GPO는 바, GPC는 캔들 표시",
    "section": "주식 시세·차트",
    "speed": "일 1회(현재가는 실시간)",
    "version": "v0.1",
    "approx": false,
    "aliases": [
      "GPO",
      "GPC"
    ]
  },
  {
    "code": "GIP",
    "nameKo": "장중 차트",
    "desc": "분봉",
    "section": "주식 시세·차트",
    "speed": "실시간",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "G",
    "nameKo": "사용자 차트",
    "desc": "여러 지표, 템플릿 저장",
    "section": "주식 시세·차트",
    "speed": "일 1회·실시간",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "TECH",
    "nameKo": "기술적 지표",
    "desc": "지표 목록과 설명, G에 추가",
    "section": "주식 시세·차트",
    "speed": "계산",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "TDEF",
    "nameKo": "차트 기본값",
    "desc": "지표·차트 기본 설정",
    "section": "주식 시세·차트",
    "speed": "정적",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HP",
    "nameKo": "과거 시세 표",
    "desc": "종가·거래량·등락률 표, CSV 내보내기",
    "section": "주식 시세·차트",
    "speed": "일 1회",
    "version": "v0.5",
    "approx": false,
    "aliases": [
      "HCP",
      "HCPI"
    ]
  },
  {
    "code": "BQ",
    "nameKo": "쿼트 대시보드",
    "desc": "10호가만 보여 줘요(사용자 결정: 가격·지표 칸은 빼고 호가창만, v0.4). KRX·NXT·통합 호가를 버튼으로 고르고, 호가는 조회로 2초마다 받아 WS 슬롯을 쓰지 않아요",
    "section": "주식 시세·차트",
    "speed": "2초 조회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "QR",
    "nameKo": "체결 테이프",
    "desc": "지금 보는 1~수 종목의 당일 체결",
    "section": "주식 시세·차트",
    "speed": "2초 조회",
    "version": "v0.5",
    "approx": false,
    "aliases": [
      "GIT"
    ]
  },
  {
    "code": "AQR",
    "nameKo": "체결 요약·가격대별 거래량",
    "desc": "VWAP, 매물대",
    "section": "주식 시세·차트",
    "speed": "지연",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "VAP",
    "nameKo": "체결 요약·가격대별 거래량",
    "desc": "VWAP, 매물대",
    "section": "주식 시세·차트",
    "speed": "지연",
    "version": "v0.5",
    "approx": false,
    "aliases": []
  },
  {
    "code": "IVAT",
    "nameKo": "시간대별 거래량",
    "desc": "오늘 분봉 거래량을 과거 평균과 비교",
    "section": "주식 시세·차트",
    "speed": "지연",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "COMP",
    "nameKo": "비교 차트",
    "desc": "여러 종목·지수를 겹쳐 비교",
    "section": "주식 시세·차트",
    "speed": "일 1회",
    "version": "v0.2",
    "approx": false,
    "aliases": []
  },
  {
    "code": "DES",
    "nameKo": "종목 개요",
    "desc": "개요·비율·업종. ETF 유형은 v0.4, 채권 유형은 v0.7",
    "section": "종목 리서치·공시·소유",
    "speed": "실시간·정적",
    "version": "v0.2",
    "approx": false,
    "aliases": [
      "ISSD"
    ]
  },
  {
    "code": "MGMT",
    "nameKo": "경영진",
    "desc": "임원·이사회·보수",
    "section": "종목 리서치·공시·소유",
    "speed": "정적",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "RELS",
    "nameKo": "관계사·자본 구조",
    "desc": "자회사, 타법인출자, 계열사",
    "section": "종목 리서치·공시·소유",
    "speed": "정적",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "CAST"
    ]
  },
  {
    "code": "FA",
    "nameKo": "재무제표",
    "desc": "손익·재무상태·현금흐름·비율",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회(원천은 분기)",
    "version": "v0.3",
    "approx": false,
    "aliases": []
  },
  {
    "code": "GF",
    "nameKo": "재무 차트",
    "desc": "매출·EPS를 주가와 함께",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ERN",
    "nameKo": "실적 이력",
    "desc": "실제 실적과 발표일 주가 반응. 서프라이즈는 추정치가 있을 때만",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "EM",
    "nameKo": "실적 추세",
    "desc": "분기 실적 추세(실제치)",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "EA",
    "nameKo": "실적 시즌 집계",
    "desc": "지수·업종 단위 실적 집계",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "EE",
    "nameKo": "실적 추정치",
    "desc": "추정 EPS·매출. 화면 라벨은 \"KIS 제공 추정\"이고 \"컨센서스\"라고 쓰지 않아요",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "EEO"
    ]
  },
  {
    "code": "ANR",
    "nameKo": "투자의견·목표가",
    "desc": "증권사별 의견·목표가",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "BRC",
    "nameKo": "리포트 원문",
    "desc": "증권사 리포트",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "DVD",
    "nameKo": "배당·분할",
    "desc": "배당 이력, 배당수익률",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "BDVD",
    "nameKo": "배당 예측",
    "desc": "다음 배당 추정",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "v0.9",
    "approx": true,
    "aliases": []
  },
  {
    "code": "CACS",
    "nameKo": "기업행위·캘린더",
    "desc": "증자, 감자, 자사주, 분할, 합병, 보호예수(의무예치) 해제 일정",
    "section": "종목 리서치·공시·소유",
    "speed": "지연(공시 폴링)",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "CACT"
    ]
  },
  {
    "code": "HDS",
    "nameKo": "보유자",
    "desc": "최대주주, 5% 보유, 임원·주요주주, 미국 13F",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OWN",
    "nameKo": "보유 구조·내부자 매매",
    "desc": "내부자 매매를 주가 차트에 표시",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "SI",
    "nameKo": "공매도",
    "desc": "공매도 거래·잔고 추이",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KINV",
    "nameKo": "투자자별 매매동향",
    "desc": "외국인·기관·개인 순매수. 블룸버그 코드 아님",
    "section": "종목 리서치·공시·소유",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KPGM",
    "nameKo": "프로그램 매매",
    "desc": "차익·비차익 프로그램 매매. 블룸버그 코드 아님",
    "section": "종목 리서치·공시·소유",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KCRD",
    "nameKo": "신용·대차 잔고",
    "desc": "블룸버그 코드 아님",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KWRN",
    "nameKo": "시장경보·VI",
    "desc": "투자주의·투자경고·투자위험예고·투자위험, 관리종목, 거래정지, 단기과열, VI 발동, 상·하한가. 블룸버그 코드 아님",
    "section": "종목 리서치·공시·소유",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "KVI"
    ]
  },
  {
    "code": "BETA",
    "nameKo": "베타·상관",
    "desc": "지수 대비 베타 회귀, 종목 간 상관",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.8",
    "approx": false,
    "aliases": [
      "CORR"
    ]
  },
  {
    "code": "TRA",
    "nameKo": "총수익률",
    "desc": "배당 재투자를 넣은 수익률",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.8",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WACC",
    "nameKo": "자본비용",
    "desc": "WACC, ROIC, EVA. 가정값은 사용자가 고쳐요",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "DDM",
    "nameKo": "배당할인모형",
    "desc": "내재가치 계산기",
    "section": "종목 리서치·공시·소유",
    "speed": "계산",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "AZS",
    "nameKo": "Altman Z",
    "desc": "파산 위험 지표(금융사 제외)",
    "section": "종목 리서치·공시·소유",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "DRSK",
    "nameKo": "부도 위험",
    "desc": "부도 거리",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "v0.9",
    "approx": true,
    "aliases": []
  },
  {
    "code": "EQRP",
    "nameKo": "주식 위험프리미엄",
    "desc": "내재 ERP",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "v0.9",
    "approx": true,
    "aliases": []
  },
  {
    "code": "SPLC",
    "nameKo": "공급망",
    "desc": "공급사·고객사",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "PPC",
    "nameKo": "제품 기준 동종사",
    "desc": "매출 제품 분류로 동종사 비교",
    "section": "종목 리서치·공시·소유",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "DSCO",
    "nameKo": "공시 전문 검색",
    "desc": "공시·IR 문서 전문 검색",
    "section": "종목 리서치·공시·소유",
    "speed": "지연",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WEI",
    "nameKo": "세계 지수",
    "desc": "주요국 지수",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연~실시간",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WEIS",
    "nameKo": "지수 순위",
    "desc": "WEI를 등락률순으로",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "MAP",
    "nameKo": "세계지도",
    "desc": "지역별 시장 현황",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.3",
    "approx": false,
    "aliases": [
      "WM"
    ]
  },
  {
    "code": "IMAP",
    "nameKo": "업종 타일",
    "desc": "업종별 등락",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.2",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HMAP",
    "nameKo": "업종 히트맵",
    "desc": "업종·종목 등락 셀. 업종×시총 매트릭스 보기 추가(MMAP, 니모닉 확인 필요)",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연·일 1회",
    "version": "v0.2",
    "approx": false,
    "aliases": []
  },
  {
    "code": "GRID",
    "nameKo": "소형 차트 격자",
    "desc": "여러 지수·환율의 소형 차트",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.3",
    "approx": false,
    "aliases": []
  },
  {
    "code": "MOST",
    "nameKo": "상위 종목",
    "desc": "거래량·거래대금·등락률 상위",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.2",
    "approx": false,
    "aliases": [
      "LVI"
    ]
  },
  {
    "code": "MEMB",
    "nameKo": "지수 구성종목·비중",
    "desc": "지수의 구성종목, 비중, 기준일",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": true,
    "aliases": []
  },
  {
    "code": "MOV",
    "nameKo": "등락 상위·지수 기여도",
    "desc": "많이 오르고 내린 종목, 지수 등락 기여",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "IMOV"
    ]
  },
  {
    "code": "MRR",
    "nameKo": "구성종목 기간 수익률 순위",
    "desc": "구성종목의 상위·하위 수익률",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": true,
    "aliases": [
      "GRR"
    ]
  },
  {
    "code": "EQS",
    "nameKo": "종목 스크리너",
    "desc": "조건 저장, 결과 백테스트",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "RV",
    "nameKo": "상대가치",
    "desc": "동종군 PER·PBR·ROE 비교",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": [
      "RVR"
    ]
  },
  {
    "code": "RVC",
    "nameKo": "상대가치 상관",
    "desc": "동종군 수익률 상관",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "EQBT",
    "nameKo": "팩터 백테스트",
    "desc": "공시일 기준 재무, 상장폐지 종목 포함",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": [
      "FTST"
    ]
  },
  {
    "code": "BTST",
    "nameKo": "기술적 전략 백테스트",
    "desc": "파라미터 최적화",
    "section": "시장 지도·순위·스크리닝·백테스트",
    "speed": "계산",
    "version": "v0.9",
    "approx": false,
    "aliases": [
      "BT"
    ]
  },
  {
    "code": "N",
    "nameKo": "뉴스·공시",
    "desc": "공시와 뉴스 헤드라인",
    "section": "뉴스·이벤트·공시",
    "speed": "지연",
    "version": "v0.2",
    "approx": false,
    "aliases": []
  },
  {
    "code": "TOP",
    "nameKo": "주요 뉴스",
    "desc": "출처 가중치와 중복 제거로 고른 헤드라인",
    "section": "뉴스·이벤트·공시",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CN",
    "nameKo": "종목 뉴스",
    "desc": "종목명·티커로 맞춘 뉴스와 공시",
    "section": "뉴스·이벤트·공시",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "NI",
    "nameKo": "주제별 뉴스",
    "desc": "키워드 태그(실적, 채권 등)",
    "section": "뉴스·이벤트·공시",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "NSE",
    "nameKo": "뉴스 검색",
    "desc": "저장 검색",
    "section": "뉴스·이벤트·공시",
    "speed": "지연",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FIRS",
    "nameKo": "속보",
    "desc": "속보 헤드라인",
    "section": "뉴스·이벤트·공시",
    "speed": "—",
    "version": "v0.4",
    "approx": true,
    "aliases": []
  },
  {
    "code": "CF",
    "nameKo": "공시 검색",
    "desc": "공시 목록, 원문 보기",
    "section": "뉴스·이벤트·공시",
    "speed": "지연(1~5분 폴링)",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "EVTS",
    "nameKo": "기업 이벤트 캘린더",
    "desc": "실적 발표, IR, 주총, 공모주 청약, 보호예수 해제",
    "section": "뉴스·이벤트·공시",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "IPO",
    "nameKo": "공모·증자",
    "desc": "청약 일정, 수요예측, 상장 뒤 수익률",
    "section": "IPO·M&A·ETF·펀드",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": [
      "ECDR"
    ]
  },
  {
    "code": "ETF",
    "nameKo": "ETF 분석",
    "desc": "NAV 괴리율, 구성종목, 자금 흐름",
    "section": "IPO·M&A·ETF·펀드",
    "speed": "지연(괴리율)·일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FFLO",
    "nameKo": "ETF 자금 흐름",
    "desc": "상장좌수 변화 × NAV",
    "section": "IPO·M&A·ETF·펀드",
    "speed": "일 1회",
    "version": "v0.4",
    "approx": false,
    "aliases": []
  },
  {
    "code": "MA",
    "nameKo": "M&A 목록",
    "desc": "합병, 분할, 양수도, 공개매수 공시",
    "section": "IPO·M&A·ETF·펀드",
    "speed": "일 1회",
    "version": "v0.9",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FSRC",
    "nameKo": "펀드 검색",
    "desc": "펀드 찾기",
    "section": "IPO·M&A·ETF·펀드",
    "speed": "일 1회",
    "version": "later",
    "approx": false,
    "aliases": [
      "FUND"
    ]
  },
  {
    "code": "GC",
    "nameKo": "금리 커브",
    "desc": "겹쳐보기, 과거 비교, 커브 간 스프레드. CRVF는 커브 선택기",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.3",
    "approx": false,
    "aliases": [
      "YCRV",
      "CRVF"
    ]
  },
  {
    "code": "BTMM",
    "nameKo": "금리 종합",
    "desc": "정책·단기금리, 국채, 지표 일정(한·미부터)",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OIS",
    "nameKo": "무위험지표금리",
    "desc": "fixing 이력, 복리 계산기",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WB",
    "nameKo": "세계 국채",
    "desc": "국가별 2/5/10/30Y",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WBX",
    "nameKo": "국가 간 스프레드",
    "desc": "KR10Y−US10Y 등",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "SOVM",
    "nameKo": "국채·국가부채",
    "desc": "국채 금리와 국가부채",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회(부채는 분기)",
    "version": "v0.6",
    "approx": false,
    "aliases": [
      "DEBT"
    ]
  },
  {
    "code": "CMX",
    "nameKo": "커브 매트릭스",
    "desc": "커브×테너 금리와 변화량",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FWCM",
    "nameKo": "선도금리 매트릭스",
    "desc": "1Y1Y, 2Y3Y 등",
    "section": "금리·커브·중앙은행",
    "speed": "계산",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HSA",
    "nameKo": "커브 전략 모니터",
    "desc": "2s10s, 버터플라이, 국가 간 스프레드",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FICM",
    "nameKo": "크레딧 스프레드",
    "desc": "등급별 회사채 금리 − 국채 금리",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CENB",
    "nameKo": "중앙은행",
    "desc": "정책금리, 회의 일정, 성명(금통위 포함)",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": [
      "FED"
    ]
  },
  {
    "code": "FOMC",
    "nameKo": "FOMC 결과",
    "desc": "성명, 의사록. 금통위도 같은 형식",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": [
      "FOMS"
    ]
  },
  {
    "code": "DOTS",
    "nameKo": "점도표",
    "desc": "FOMC 위원 금리 전망",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회(분기)",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WIRP",
    "nameKo": "정책금리 경로 확률",
    "desc": "회의별 금리 변경 확률",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": true,
    "aliases": [
      "FFIP"
    ]
  },
  {
    "code": "ICVS",
    "nameKo": "IRS 커브 구축",
    "desc": "사용자 정의 스왑 커브",
    "section": "금리·커브·중앙은행",
    "speed": "계산",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "SWPM",
    "nameKo": "스왑 가격 계산",
    "desc": "스왑 평가",
    "section": "금리·커브·중앙은행",
    "speed": "계산",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "SDRV",
    "nameKo": "스왑 저장소 거래량",
    "desc": "IRS·NDF·FX옵션 공개 체결",
    "section": "금리·커브·중앙은행",
    "speed": "일 1회",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WEIF",
    "nameKo": "세계 지수선물",
    "desc": "지수선물 시세, 베이시스, 이론가(자체 계산), 미결제약정. KOSPI200은 주간과 야간(KRX 야간 파생시장, 2025-06 개장)을 이어서 보여 줘요. 보는 계약의 호가 탭",
    "section": "지수선물",
    "speed": "실시간(보는 계약만 WS)",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "YAS",
    "nameKo": "채권 수익률·리스크",
    "desc": "가격↔수익률, 듀레이션, DV01, G·Z 스프레드, 캐리. 평가가는 금융위 T+1 → ECOS 커브 이론가 → 장내 마지막 체결(체결 시각 표시) 순서로 고르고 출처를 보여 줘요",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "SRCH",
    "nameKo": "채권 검색",
    "desc": "발행사, 쿠폰, 만기, 등급으로 찾기",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FIPX",
    "nameKo": "채권 시세",
    "desc": "장내채권 체결 테이프와 호가",
    "section": "채권·크레딧",
    "speed": "실시간(체결 테이프만)",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FACT",
    "nameKo": "거래 활발한 채권",
    "desc": "거래량 상위 채권",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "TDH",
    "nameKo": "체결 이력",
    "desc": "종목별 체결 이력",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": [
      "TFLO"
    ]
  },
  {
    "code": "NIM",
    "nameKo": "신규 발행",
    "desc": "새로 발행된 채권",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "NIA",
    "nameKo": "신규 발행 적정가",
    "desc": "",
    "section": "채권·크레딧",
    "speed": "—",
    "version": "v0.7",
    "approx": true,
    "aliases": []
  },
  {
    "code": "FIW",
    "nameKo": "비교 워크시트",
    "desc": "여러 채권의 리스크 비교",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FIHZ",
    "nameKo": "보유기간·시나리오",
    "desc": "평행이동, 스티프닝, 버터플라이 손익",
    "section": "채권·크레딧",
    "speed": "계산",
    "version": "v0.7",
    "approx": false,
    "aliases": [
      "FISA"
    ]
  },
  {
    "code": "FIHG",
    "nameKo": "헤지 계산기",
    "desc": "DV01을 맞춘 국채선물·국채 수량",
    "section": "채권·크레딧",
    "speed": "계산",
    "version": "v0.7",
    "approx": false,
    "aliases": [
      "FIGH",
      "FIHR",
      "FYH"
    ]
  },
  {
    "code": "FIRV",
    "nameKo": "채권 상대가치",
    "desc": "같은 발행사·비교군 비교",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": false,
    "aliases": [
      "COMB"
    ]
  },
  {
    "code": "WBF",
    "nameKo": "국채·금리 선물",
    "desc": "KTB 3/10/30Y, 이론가·베이시스. 보는 계약의 호가 탭",
    "section": "채권·크레딧",
    "speed": "실시간(KR)·일 1회(US)",
    "version": "v0.7",
    "approx": false,
    "aliases": [
      "WIR"
    ]
  },
  {
    "code": "DDIS",
    "nameKo": "부채 만기 분포",
    "desc": "채권·CP 미상환 잔액을 만기별로. KCB와 연결",
    "section": "채권·크레딧",
    "speed": "일 1회(원천은 분기)",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KCB",
    "nameKo": "메자닌(CB·BW)",
    "desc": "전환사채·신주인수권부사채의 전환가, 리픽싱, 미전환 잔량, 전환청구 공시. DDIS와 연결. 블룸버그 코드 아님",
    "section": "채권·크레딧",
    "speed": "지연(공시 폴링)",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WBIX",
    "nameKo": "채권지수",
    "desc": "",
    "section": "채권·크레딧",
    "speed": "—",
    "version": "v0.7",
    "approx": true,
    "aliases": []
  },
  {
    "code": "BVAL",
    "nameKo": "평가가격",
    "desc": "",
    "section": "채권·크레딧",
    "speed": "—",
    "version": "v0.7",
    "approx": true,
    "aliases": []
  },
  {
    "code": "CRPR",
    "nameKo": "신용등급",
    "desc": "발행사·채권 등급과 이력",
    "section": "채권·크레딧",
    "speed": "일 1회",
    "version": "v0.7",
    "approx": true,
    "aliases": []
  },
  {
    "code": "RATC",
    "nameKo": "등급 변경",
    "desc": "등급 변경 목록",
    "section": "채권·크레딧",
    "speed": "—",
    "version": "v0.7",
    "approx": true,
    "aliases": []
  },
  {
    "code": "RATD",
    "nameKo": "등급 체계",
    "desc": "국내외 등급 매핑 표",
    "section": "채권·크레딧",
    "speed": "정적",
    "version": "v0.7",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CSDR",
    "nameKo": "국가 신용등급",
    "desc": "평가사별 국가 등급",
    "section": "채권·크레딧",
    "speed": "정적",
    "version": "v0.6",
    "approx": true,
    "aliases": []
  },
  {
    "code": "OAS1",
    "nameKo": "옵션부 채권 OAS",
    "desc": "",
    "section": "채권·크레딧",
    "speed": "계산",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CDSW",
    "nameKo": "CDS 계산기",
    "desc": "스프레드를 넣으면 평가",
    "section": "채권·크레딧",
    "speed": "계산",
    "version": "later",
    "approx": true,
    "aliases": [
      "QCDS"
    ]
  },
  {
    "code": "BOOM",
    "nameKo": "머니마켓 오퍼",
    "desc": "",
    "section": "채권·크레딧",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "ECO",
    "nameKo": "경제 캘린더",
    "desc": "발표 일시, 실제, 이전. 시각이 없는 소스는 \"시각 미상\"으로 표시. 예상 칸은 빈칸이거나 사용자 입력",
    "section": "매크로",
    "speed": "일 1회",
    "version": "v0.3",
    "approx": false,
    "aliases": [
      "WECO"
    ]
  },
  {
    "code": "ECOD",
    "nameKo": "지표 상세",
    "desc": "발표 이력, 수정치",
    "section": "매크로",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ECST",
    "nameKo": "경제 통계",
    "desc": "국가별 통계 표·차트",
    "section": "매크로",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ECOF",
    "nameKo": "지표 찾기",
    "desc": "지표 검색",
    "section": "매크로",
    "speed": "정적",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ECMX",
    "nameKo": "세계 경제 매트릭스",
    "desc": "국가×지표",
    "section": "매크로",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "IFMO",
    "nameKo": "인플레이션 모니터",
    "desc": "CPI, PPI, 기대인플레(BEI 탭)",
    "section": "매크로",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "ECFC",
    "nameKo": "경제 전망 비교",
    "desc": "",
    "section": "매크로",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "FXC",
    "nameKo": "환율 매트릭스",
    "desc": "주요 통화 환율 표. 원화는 서울 외환시장이 다음 날 02:00까지 열려서, 값마다 기준 시각을 보여 줘요. 칸을 누르면 연동 그룹 차트가 그 환율로(v0.2)",
    "section": "외환",
    "speed": "지연(30~60초)",
    "version": "v0.1",
    "approx": false,
    "aliases": [
      "WCR"
    ]
  },
  {
    "code": "FXIP",
    "nameKo": "FX 홈",
    "desc": "FXC, 귀금속, FX 뉴스",
    "section": "외환",
    "speed": "지연",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FXCA",
    "nameKo": "환산 계산기",
    "desc": "현재·과거 환율로 환산",
    "section": "외환",
    "speed": "계산",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FRD",
    "nameKo": "선물환 계산기",
    "desc": "금리평형 이론값. 실제 스왑포인트와 다를 수 있다고 표시",
    "section": "외환",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FIXI",
    "nameKo": "공식 고시환율",
    "desc": "매매기준율, ECB 기준환율, H.10. 고시 기준 시각 표시",
    "section": "외환",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WCRS",
    "nameKo": "통화 순위",
    "desc": "수익률, 금리, 변동성, 캐리, PPP",
    "section": "외환",
    "speed": "일 1회",
    "version": "v0.6",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FXFM",
    "nameKo": "환율 도달 확률",
    "desc": "",
    "section": "외환",
    "speed": "계산",
    "version": "v0.10",
    "approx": true,
    "aliases": []
  },
  {
    "code": "OVML",
    "nameKo": "FX 옵션 계산",
    "desc": "Garman-Kohlhagen",
    "section": "외환",
    "speed": "계산",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CRYP",
    "nameKo": "코인 시세판",
    "desc": "USDT 현물 주요 코인",
    "section": "크립토",
    "speed": "실시간",
    "version": "v0.1",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OMON",
    "nameKo": "옵션 체인",
    "desc": "만기별 콜·풋, IV, 그릭스",
    "section": "옵션·변동성",
    "speed": "지연(REST 폴링, 수 초~수십 초)",
    "version": "v0.10",
    "approx": false,
    "aliases": [
      "CALL",
      "PUT",
      "COAT",
      "POAT"
    ]
  },
  {
    "code": "OMST",
    "nameKo": "거래 많은 옵션",
    "desc": "거래량·미결제 상위",
    "section": "옵션·변동성",
    "speed": "지연",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OVDV",
    "nameKo": "변동성 곡면",
    "desc": "스큐, 기간구조",
    "section": "옵션·변동성",
    "speed": "지연",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HVG",
    "nameKo": "실현 변동성",
    "desc": "실현 vol 그래프",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "HIVG",
    "nameKo": "내재 vol 이력",
    "desc": "IV 지수와 행사가별 IV의 이력",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "GV",
    "nameKo": "변동성 비교 그래프",
    "desc": "IV, 실현 vol, 지수 vol",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "VCA",
    "nameKo": "변동성·상관 분석",
    "desc": "실현 대 내재, 상관",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "VOLC",
    "nameKo": "IV와 실현 vol 시계열",
    "desc": "두 시계열 비교",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OVME",
    "nameKo": "주식 파생 계산",
    "desc": "블랙-숄즈, 이항, 전략 손익",
    "section": "옵션·변동성",
    "speed": "계산",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OSA",
    "nameKo": "옵션 시나리오",
    "desc": "포지션 손익표",
    "section": "옵션·변동성",
    "speed": "계산",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OV",
    "nameKo": "OTC 옵션 계산",
    "desc": "프리미엄↔IV",
    "section": "옵션·변동성",
    "speed": "계산",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "KELS",
    "nameKo": "ELS 녹인 모니터",
    "desc": "기초지수 종가와 배리어 비교, 몬테카를로 확률. 블룸버그 코드 아님",
    "section": "옵션·변동성",
    "speed": "일 1회",
    "version": "v0.10",
    "approx": false,
    "aliases": []
  },
  {
    "code": "DLIB",
    "nameKo": "구조화상품",
    "desc": "",
    "section": "옵션·변동성",
    "speed": "—",
    "version": "v0.10",
    "approx": true,
    "aliases": []
  },
  {
    "code": "GLCO",
    "nameKo": "원자재 모니터",
    "desc": "에너지·금속·농산물, 거래소 탭",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": [
      "CMBQ",
      "ICE",
      "LFP",
      "EFNS",
      "ICFP"
    ]
  },
  {
    "code": "CTM",
    "nameKo": "선물 계약·월물 표",
    "desc": "계약 명세, 월물별 정산가·미결제, 만기 일정",
    "section": "원자재",
    "speed": "정적·일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": [
      "CT",
      "CEM"
    ]
  },
  {
    "code": "CCRV",
    "nameKo": "선물 커브",
    "desc": "콘탱고, 백워데이션",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FHG",
    "nameKo": "가격·미결제약정",
    "desc": "가격과 OI를 한 그래프에",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "SEAG",
    "nameKo": "계절성",
    "desc": "캘린더 스프레드를 과거 연도와 비교",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CMSP",
    "nameKo": "스프레드·크랙",
    "desc": "정제마진, 크러시",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": [
      "CRCK"
    ]
  },
  {
    "code": "COT",
    "nameKo": "CFTC 포지션",
    "desc": "투자자 유형별 순포지션",
    "section": "원자재",
    "speed": "주 1회(토요일 새벽 KST)",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FDM",
    "nameKo": "원자재 펀더멘털",
    "desc": "재고, 리그 카운트",
    "section": "원자재",
    "speed": "일 1회(원천은 주간)",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "CRR",
    "nameKo": "수익률 순위·지수 기여",
    "desc": "",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "FMV",
    "nameKo": "수익률 순위·지수 기여",
    "desc": "",
    "section": "원자재",
    "speed": "일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "UNTC",
    "nameKo": "단위 환산",
    "desc": "금 원/g 등",
    "section": "원자재",
    "speed": "계산",
    "version": "v0.11",
    "approx": false,
    "aliases": []
  },
  {
    "code": "MTL",
    "nameKo": "금속·농산물 현물",
    "desc": "귀금속, 비철, 농산물",
    "section": "원자재",
    "speed": "지연·일 1회",
    "version": "v0.11",
    "approx": false,
    "aliases": [
      "METL",
      "AGGP",
      "SPOT"
    ]
  },
  {
    "code": "BOIL",
    "nameKo": "원유·제품 평가가",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "v0.11",
    "approx": true,
    "aliases": []
  },
  {
    "code": "BGAS",
    "nameKo": "북미 가스 현물",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "v0.11",
    "approx": true,
    "aliases": []
  },
  {
    "code": "NGAS",
    "nameKo": "가스 통계·OPEC 산유량",
    "desc": "",
    "section": "원자재",
    "speed": "일·월 1회",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "OPEC",
    "nameKo": "가스 통계·OPEC 산유량",
    "desc": "",
    "section": "원자재",
    "speed": "일·월 1회",
    "version": "later",
    "approx": false,
    "aliases": []
  },
  {
    "code": "WETR",
    "nameKo": "날씨",
    "desc": "",
    "section": "원자재",
    "speed": "일 1회",
    "version": "later",
    "approx": false,
    "aliases": [
      "WFOR"
    ]
  },
  {
    "code": "CMCX",
    "nameKo": "BCOM 지수",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "CPFC",
    "nameKo": "원자재 전망",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": [
      "CPF"
    ]
  },
  {
    "code": "BMAP",
    "nameKo": "자산·선박·무역 흐름",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "AHOY",
    "nameKo": "자산·선박·무역 흐름",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "LINE",
    "nameKo": "자산·선박·무역 흐름",
    "desc": "",
    "section": "원자재",
    "speed": "—",
    "version": "later",
    "approx": true,
    "aliases": []
  },
  {
    "code": "PORT",
    "nameKo": "포트폴리오",
    "desc": "보유 손익. 미국 보유분은 원화로 환산",
    "section": "포트폴리오·리스크",
    "speed": "실시간",
    "version": "v0.3",
    "approx": false,
    "aliases": []
  },
  {
    "code": "PRTU",
    "nameKo": "포트폴리오 관리",
    "desc": "여러 포트폴리오 만들기·고치기. 계좌·출처(신한 CSV, 직접 입력)로 구분",
    "section": "포트폴리오·리스크",
    "speed": "정적",
    "version": "v0.8",
    "approx": false,
    "aliases": []
  },
  {
    "code": "PMEN",
    "nameKo": "포트폴리오 메뉴",
    "desc": "PORT에서 쓸 수 있는 기능 목록",
    "section": "포트폴리오·리스크",
    "speed": "정적",
    "version": "v0.8",
    "approx": false,
    "aliases": []
  },
  {
    "code": "PREP",
    "nameKo": "리포트",
    "desc": "PORT 결과를 PDF 파일로 내보내기",
    "section": "포트폴리오·리스크",
    "speed": "일 1회",
    "version": "v0.8",
    "approx": false,
    "aliases": [
      "BSA"
    ]
  },
  {
    "code": "MARS",
    "nameKo": "멀티에셋 리스크",
    "desc": "",
    "section": "포트폴리오·리스크",
    "speed": "—",
    "version": "v0.8",
    "approx": true,
    "aliases": []
  }
];
