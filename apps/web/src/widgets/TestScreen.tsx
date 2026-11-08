// TEST 업데이트 시험(v0.5): 앱 업데이트·패치노트가 제대로 들어왔는지 보는 화면이에요.

import { openPatchNotes } from '../components/PatchNotes';
import { PATCH_NOTES } from '../patchnotes';
import type { PanelState } from '../stores/panels';
import { settings } from '../stores/settings';
import { useStore } from '../stores/store';
import { openSettings } from '../stores/ui';
import { updateState } from '../stores/update';
import { TitleBar } from './common';

const PHASE: Record<string, string> = {
  idle: '아직 확인 안 함',
  checking: '확인하는 중',
  none: '가장 새 버전이에요',
  available: '새 버전이 있어요',
  downloading: '받는 중',
  ready: '다 받음(설치 대기)',
  error: '확인 실패',
  unsupported: '이 컴퓨터는 업데이트 파일이 없어요',
};

export function TestScreen({ panel: _panel }: { panel: PanelState }) {
  const st = useStore(updateState);
  const seen = useStore(settings, (s) => s.updates?.seen);
  const version = window.btBridge?.version;
  const latestNote = PATCH_NOTES[0];
  return (
    <>
      <TitleBar fn="TEST" name="업데이트 시험" />
      <div className="pbody flow">
        <div className="test-ok">이 화면이 보이면 TEST 기능이 들어간 버전으로 업데이트된 거예요.</div>
        <table className="flow-table test-table">
          <tbody>
            <tr>
              <td>앱 버전</td>
              <td>{version ? `v${version}` : '브라우저(개발용)'}</td>
            </tr>
            <tr>
              <td>앱에 든 가장 새 패치노트</td>
              <td>{latestNote ? `v${latestNote.version}${latestNote.date ? ` (${latestNote.date})` : ''}` : '없음'}</td>
            </tr>
            <tr>
              <td>패치노트 창을 마지막으로 본 버전</td>
              <td>{seen ? `v${seen}` : '—'}</td>
            </tr>
            <tr>
              <td>업데이트 확인</td>
              <td>{st ? `${PHASE[st.phase] ?? st.phase}${st.info ? ` · 새 버전 v${st.info.version}` : ''}` : '데스크톱 앱에서만'}</td>
            </tr>
          </tbody>
        </table>
        <div className="tv-more" style={{ textAlign: 'left', display: 'flex', gap: 8 }}>
          <button onClick={() => openPatchNotes(true)}>패치노트 보기</button>
          <button onClick={() => openSettings('about')}>업데이트 설정 열기</button>
        </div>
      </div>
      <div className="attr">업데이트·패치노트 시험용 화면이에요(블룸버그 코드가 아닌 자체 코드)</div>
    </>
  );
}
