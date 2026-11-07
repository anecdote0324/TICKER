// GRAB 화면 캡처(v0.5): 패널을 PNG로 클립보드에 복사하고, 알림의 '파일로 저장'으로 그림 파일로도 저장해요.
// 데스크톱 앱에서만 돼요(Electron이 창을 찍어요). 브라우저(개발용)에서는 안내만 해요.

import { formatYmd, formatHms } from '@bt/shared';
import { getInstrument } from './stores/instruments';
import { panels } from './stores/panels';
import { showToast } from './stores/ui';

/** 파일 이름은 영문·숫자만: GRAB_GP_005930_20261107-153001.png */
export function grabFileName(fn: string | undefined, code: string | undefined, now: number): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9.-]/g, '_').slice(0, 20);
  const stamp = `${formatYmd(now).replace(/-/g, '')}-${formatHms(now).replace(/:/g, '')}`;
  return ['GRAB', fn ? safe(fn) : '', code ? safe(code) : '', stamp].filter(Boolean).join('_') + '.png';
}

export async function grabPanel(panelId: string, doc: Document): Promise<void> {
  const bridge = window.btBridge;
  if (!bridge?.capture) {
    showToast('GRAB은 데스크톱 앱에서 돼요(브라우저에서는 운영체제의 화면 캡처를 써 주세요)');
    return;
  }
  const el = doc.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(panelId)}"]`);
  // 패널 제목 줄(탭)까지 함께 찍어요
  const box = (el?.closest('.dv-groupview') as HTMLElement | null) ?? el;
  if (!box) {
    showToast('찍을 패널을 찾지 못했어요');
    return;
  }
  // 후보 목록·⏎ 라벨이 사진에 남지 않게 커맨드 라인 포커스를 빼고 한 번 그린 뒤 찍어요
  (doc.activeElement as HTMLElement | null)?.blur?.();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = box.getBoundingClientRect();
  const view = doc.defaultView ?? window;
  const name = view === window ? '' : view.name;
  try {
    const res = await bridge.capture(name, { x: r.left, y: r.top, width: r.width, height: r.height });
    if (!res.ok) {
      showToast(`캡처하지 못했어요: ${res.message ?? '알 수 없는 오류'}`);
      return;
    }
    const p = panels.get()[panelId];
    const file = grabFileName(p?.fn, getInstrument(p?.securityId)?.code, Date.now());
    showToast(
      '패널을 이미지로 클립보드에 복사했어요(메신저·메일에 붙여넣기)',
      {
        label: '파일로 저장',
        run: () => {
          void bridge.saveCapture?.(file).then((s) => s.ok && s.path && showToast(`저장했어요: ${s.path}`));
        },
      },
      10_000,
    );
  } catch (e) {
    showToast(`캡처하지 못했어요: ${(e as Error).message}`);
  }
}
