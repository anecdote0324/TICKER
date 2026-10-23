# 작업 규칙

- **현재 단계는 개발**이에요. v0.1부터 [03 기능 코드와 단계별 범위](docs/design/03-functions.md)의 순서대로 만들어요.
- 설계 문서(`docs/design/`)가 기준이에요. 만들다가 설계와 다르게 하기로 하면 해당 문서를 같은 커밋에서 고쳐요.
  - 문서에 문서 버전이나 변경 이력은 적지 않아요. 기록은 git 커밋으로 남아요.
  - 여러 문서에 걸친 결정은 모든 관련 문서를 함께 고쳐요. 특히 `01-overview.md`의 결정 표를 최신으로 유지해요.
- 버전별 기능과 진행 상황은 `docs/versions.md`에서 관리해요. 기능을 만들거나 범위가 바뀌면 상태와 남은 일을 같은 커밋에서 고쳐요.
- 아직 정하지 않은 것과 실제로 확인해야 할 것은 `docs/design/07-open-questions.md`에서 관리해요. 결정되거나 확인되면 해당 문서로 옮기고 목록에서 지워요.
- 문서와 화면 문구는 한국어로 써요. 코드의 이름은 영어, 주석은 한국어로 써요.
- 화면 디자인이 바뀌면 claude.ai 목업(https://claude.ai/artifact/1AE6PgM1jVf4bTsRT85xoV)도 함께 갱신해요.
- API 키, 앱시크릿 같은 비밀 정보는 절대 커밋하지 않아요. 종목 마스터처럼 내려받은 데이터 파일도 커밋하지 않아요.

# 개발

- pnpm 모노레포예요: `apps/desktop`(Electron), `apps/web`(화면), `apps/server`(내장 서버), `packages/shared`(공통 형식), `packages/command`(커맨드 라인 해석기·완성기).
- 커밋 전에 `pnpm typecheck`와 `pnpm test`를 통과시켜요.
- 커맨드 라인 동작을 바꾸면 [05](docs/design/05-command-line.md)의 걸어 보기 예시를 테스트로 남겨요.
