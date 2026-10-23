# Terminal

블룸버그 터미널을 닮은 **개인용 데스크톱 시세 터미널**이에요.

> 지금은 **v0.1 개발 중**이에요. 설계는 [`docs/design/`](docs/design/)에 있고, 코드는 그 설계를 따라요. 버전마다 들어가는 기능과 진행 상황은 [버전별 기능](docs/versions.md)에 있어요.

## 한눈에 보기

- 검정 배경에 주황 포인트를 쓰는 촘촘한 멀티 패널 화면, 키보드 중심의 커맨드 라인
- 국내·미국 주식(한국투자증권 Open API), 코인(Binance USDT), 환율, 그리고 단계적으로 금리 커브·채권·매크로·옵션·원자재까지
- 블룸버그 기능을 최대한 구현하되, 개인에게 의미 없는 속도의 데이터가 필요한 기능과 매매 기능은 빼요. 유료 데이터는 쓰지 않아요
- 실시간이 아닌 값에는 늘 회색 신선도 배지(`5초 주기`, `일별 10/22`, `마감`, `⚠ 멈춤`, `데모`)가 붙어요
- Windows 우선이고 macOS(Apple Silicon)도 지원하는 Electron 데스크톱 앱
- 나 혼자 쓰는 개인용 (시세를 다른 사람에게 재배포하지 않음)

## v0.1에서 되는 것

| 영역 | 내용 |
|---|---|
| 기능 | MON 관심종목, GP 가격 차트, GIP 장중 차트, WEI 세계 지수, FXC 환율 매트릭스, CRYP 코인 시세판 |
| 커맨드 라인 | Tab 채우기·Enter 실행, 애매하면 Enter 두 번, ⏎ 라벨, 흐린 글씨, 후보 목록·설명 창·진행 표시, 한글 이름·초성·한/영 실수 교정, 네 가지 도움 수준, 명령 팔레트(Ctrl+K) |
| 데이터 | Binance 실시간(일반 주소가 막히면 시세 전용 주소), ECB 기준환율(일별), 한국투자증권(키를 넣으면 실시간·조회), 키가 없으면 주식·지수는 데모 시세 |
| 화면 | v0.1 기본 배치, 화면 탭, 패널 떼어내기(다른 모니터로), 연동 그룹, 워크스페이스 저장·복원, 설정 창 |

## 실행하기 (개발 중)

필요한 것: Node.js 22 이상, pnpm(없으면 스크립트가 `corepack enable`로 켜요).

- Windows: `start.bat`을 더블클릭
- Mac: `start.command`를 더블클릭
- 직접: `pnpm install` 다음 `pnpm dev`

내장 서버(127.0.0.1:8787)와 화면 개발 서버(127.0.0.1:5173)가 함께 켜지고 브라우저가 열려요. 실행할 때마다 새 접속 토큰을 만들어 주소(`#token=…`)로 넘겨요. 끌 때는 그 창에서 Ctrl+C예요.

한국투자증권 앱키·앱시크릿은 앱의 설정(Ctrl+,) → 데이터 연결에서 넣어요. 키는 PC 안에 암호화해서 저장하고, 저장소에는 절대 올리지 않아요. 시세용으로는 잔고가 없는 별도 계좌의 키를 권해요.

## 데스크톱 앱 만들기

```
pnpm build            # 화면과 Electron 메인 프로세스 묶기
pnpm --filter @bt/desktop start   # 개발용으로 Electron 창 띄우기
pnpm dist             # 지금 OS용 설치 파일(apps/desktop/release)
```

### 새 버전 내기

```
git tag v0.1.0
git push origin v0.1.0
```

- GitHub Actions가 Windows 설치 파일(.exe, 설치형·휴대용)과 Mac(Apple Silicon) .dmg를 만들어 **초안 릴리스**에 올려요. GitHub의 Releases 화면에서 공개를 누르면 다운로드할 수 있어요.
- 앱 버전 번호는 태그에서 가져와요. package.json의 version은 고치지 않아도 돼요.
- 번호는 고치는 판이면 끝자리(`v0.1.1`), 다음 단계 기능이 다 들어가면 가운데(`v0.2.0`)를 올려요. `-`가 붙은 태그(`v0.2.0-beta.1`)는 미리 보기 릴리스예요.
- 자동 업데이트는 없어요. 새 버전 설치 파일을 받아 덮어 설치하면 설정·키·화면 배치는 그대로 남아요.
- 개인용이라 코드 서명은 하지 않아서, 새 버전을 처음 실행할 때 경고가 떠요([01](docs/design/01-overview.md) 설치 파일과 서명).

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `apps/desktop` | Electron 메인 프로세스, 창 관리, 메뉴, 패키징 |
| `apps/web` | 화면(React + Vite + dockview + Lightweight Charts) |
| `apps/server` | 내장 서버(Fastify + WebSocket): 시세 중계, 데이터 소스 어댑터, 설정·키 저장 |
| `packages/shared` | 공통 형식: 종목·시세, 신선도 정보와 배지 계산, 기능 목록, 설정 |
| `packages/command` | 커맨드 라인 해석기·완성기(한글 처리, 색인, Enter 규칙) |
| `docs/design` | 설계 문서 |

검사: `pnpm typecheck`, `pnpm test`.

## 설계 문서

| 문서 | 내용 |
|---|---|
| [버전별 기능](docs/versions.md) | v0.1~v0.11과 후순위에 들어가는 기능, 지금까지 만든 것과 남은 일 |
| [01 개요와 결정 사항](docs/design/01-overview.md) | 목표, 확정된 결정, 전체 구조, 실행·종료 방식, Windows/Mac 지원 |
| [02 화면 디자인](docs/design/02-ui.md) | 디자인 컨셉, 색과 글꼴, 패널 구조, 화면 배치, 데이터 신선도 표시 |
| [03 기능 코드와 단계별 범위](docs/design/03-functions.md) | MON, GP 같은 기능 코드 목록, 단계별 범위 |
| [04 데이터 소스](docs/design/04-data-sources.md) | 한국투자증권, Binance, 환율, 공시·뉴스, 제약과 대응 |
| [05 커맨드 라인과 자동완성](docs/design/05-command-line.md) | 입력 문법, Tab·Enter 규칙, 한글 입력 처리, 겹치는 이름 처리 |
| [06 설정 화면](docs/design/06-settings.md) | 설정 창 구성, 자동완성 도움 수준 바꾸기 |
| [07 미정 사항과 확인할 것](docs/design/07-open-questions.md) | 아직 정하지 않은 것, 실제로 확인해야 할 것 |
| [08 블룸버그 기능 커버리지](docs/design/08-bloomberg-coverage.md) | 블룸버그 기능별로 넣을지·뺄지 판정, 데이터 소스, v0.1~v0.11 로드맵 |

## 화면 목업

claude.ai 목업 (비공개, 소유자만 열람 가능): https://claude.ai/artifact/1AE6PgM1jVf4bTsRT85xoV

개발을 시작하기 전에 화면을 미리 보려고 만든 것이에요. 이제는 더 이상 고치지 않아서 실제 앱과 다를 수 있어요. 화면의 기준은 실제 앱과 [02 화면 디자인](docs/design/02-ui.md)이에요.

목업의 숫자와 뉴스는 모두 모의 데이터예요.
