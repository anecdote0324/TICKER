// 화면 탭을 통째로 떼어낸 창들(02 화면 탭과 워크스페이스). 화면 id → 그 창.
// 팔레트·도움말을 어느 창에 그릴지, 화면 탭을 누르면 어느 창을 앞으로 가져올지 정할 때 써요.

export const screenWindows = new Map<string, Window>();

/** 지금 포커스가 있는 떼어낸 화면 창의 화면 id. 메인 창(또는 패널만 떼어낸 창)이면 undefined */
export function focusedScreenWindow(): string | undefined {
  for (const [id, w] of screenWindows) {
    try {
      if (!w.closed && w.document.hasFocus()) return id;
    } catch {
      // 닫히는 중인 창은 건너뛰어요
    }
  }
  return undefined;
}
