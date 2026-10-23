// 도움말, 알림

import { shortcutLabel } from '../keys';
import { useStore } from '../stores/store';
import { ui } from '../stores/ui';
import { SyntaxCard } from './CandidateList';

export function HelpOverlay() {
  const help = useStore(ui, (s) => s.help);
  if (!help) return null;
  const close = () => ui.set((s) => ({ ...s, help: null }));
  return (
    <div className="overlay" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1}>
      <div className="help" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px' }}>{help === 'syntax' ? '명령 문법' : '도움말'}</h3>
        <SyntaxCard />
        {help === 'help' && (
          <>
            <p>
              <b>Tab은 채우고, Enter는 실행해요.</b> 입력이 여러 뜻일 수 있으면 첫 Enter는 1번 줄을 <b>선택</b>만 하고, 두 번째 Enter가 실행해요. 커맨드 라인 오른쪽의 ⏎ 라벨이 Enter가 할 일을 늘 알려 줘요.
            </p>
            <p>
              예: <code>005930⏎</code> 삼성전자 · <code>삼성⏎⏎</code> 이름으로 찾기 · <code>ㅅㅅㅈㅈ</code> 초성 · <code>AAPL US GIP⏎</code> · <code>BTC⏎</code> · <code>WEI⏎</code> · <code>USDKRW⏎</code>
            </p>
            <p>
              <b>데이터 신선도</b>: 배지가 없으면 실시간이에요. 실시간이 아닌 값에는 `5초 주기`, `15분 지연`, `일별 10/21`, `마감`, `⚠ 멈춤`, `데모` 같은 회색 배지가 붙어요. 배지에 마우스를 올리면 출처와 기준 시각을 보여 줘요.
            </p>
            <p className="label">
              {[
                [shortcutLabel('palette'), '명령 팔레트'],
                [shortcutLabel('focusCommand'), '커맨드 라인'],
                [shortcutLabel('toggleFocus'), '본문 ↔ 커맨드 라인'],
                [shortcutLabel('settings'), '설정'],
                ['Esc', '닫기'],
              ]
                .filter(([k]) => k)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function ToastView() {
  const t = useStore(ui, (s) => s.toast);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span>{t.text}</span>
      {t.action && (
        <button
          className="btn"
          onClick={() => {
            t.action!.run();
            ui.set((s) => ({ ...s, toast: null }));
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="icon-btn" aria-label="닫기" onClick={() => ui.set((s) => ({ ...s, toast: null }))}>
        ✕
      </button>
    </div>
  );
}
