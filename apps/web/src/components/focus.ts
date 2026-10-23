// 패널마다 커맨드 라인·본문으로 포커스를 옮기는 함수를 모아 둬요(Ctrl+L, F6, 05 §10.1).

export const focusRegistry = {
  /** 커맨드 라인으로. 글자를 넘기면 그 글자부터 입력돼요 */
  command: new Map<string, (initial: string) => void>(),
  body: new Map<string, () => void>(),
};
