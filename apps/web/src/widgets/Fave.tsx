// FAVE 즐겨찾기(v0.5): 자주 여는 명령(기능·종목)을 모아 두고 누르면 이 패널에서 열어요.
// 추가는 패널 머리글의 ☆, 이 화면의 명령 칸, 또는 열린 화면 목록의 +로 해요.

import { useState } from 'react';
import { FUNCTIONS } from '@bt/shared';
import { canonicalCommand, describeCommand, openCommand } from '../stores/commands';
import { addFavorite, moveFavorite, removeFavorite, restoreFavorite } from '../stores/favorites';
import { panelCanonical, panels, type PanelState } from '../stores/panels';
import { appState } from '../stores/state';
import { useStore } from '../stores/store';
import { showToast } from '../stores/ui';
import { TitleBar } from './common';

export function Fave({ panel }: { panel: PanelState }) {
  const list = useStore(appState, (s) => s.favorites ?? []);
  const all = useStore(panels, (s) => s);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const have = new Set(list.map((f) => f.command));
  // 지금 열린 다른 패널의 화면 중 아직 없는 것
  const open = Object.values(all)
    .filter((p) => p.id !== panel.id && p.fn && p.fn !== 'FAVE')
    .map((p) => ({ p, cmd: panelCanonical(p, FUNCTIONS.find((f) => f.code === p.fn)) }))
    .filter((x, i, arr) => x.cmd && !have.has(x.cmd) && arr.findIndex((y) => y.cmd === x.cmd) === i && describeCommand(x.cmd).ok);
  const add = (cmd: string) => {
    const canon = canonicalCommand(cmd);
    if (!canon) {
      setErr(`'${cmd}'은(는) 지금 열 수 있는 명령이 아니에요`);
      return false;
    }
    if (!addFavorite(canon, describeCommand(canon).label)) {
      setErr('이미 즐겨찾기에 있어요');
      return false;
    }
    setErr('');
    return true;
  };
  const remove = (cmd: string, i: number) => {
    const old = removeFavorite(cmd);
    if (old) showToast(`즐겨찾기에서 뺐어요: ${cmd}`, { label: '되돌리기', run: () => restoreFavorite(old, i) });
  };
  return (
    <>
      <TitleBar fn="FAVE" name="즐겨찾기" sub={`${list.length}개`} />
      <div className="pbody flow">
        <div className="fave-add">
          <input
            value={text}
            placeholder="명령 추가(예: 005930 GP, WEI) 후 Enter"
            aria-label="즐겨찾기에 넣을 명령"
            onChange={(e) => {
              setText(e.target.value);
              setErr('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim() && add(text.trim())) setText('');
              e.stopPropagation();
            }}
          />
          {err && <span className="err">{err}</span>}
        </div>
        {list.length === 0 ? (
          <div className="des-note label">아직 즐겨찾기가 없어요. 패널 머리글의 ☆을 누르거나 위 칸에 명령을 넣어요.</div>
        ) : (
          <table className="flow-table fave-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>명령</th>
                <th style={{ textAlign: 'left' }}>여는 화면</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((f, i) => {
                const d = describeCommand(f.command);
                return (
                  <tr key={f.id} className={d.ok ? 'click' : 'nolink'} title={d.ok ? '누르면 이 패널에서 열어요' : d.label} onClick={() => d.ok && openCommand(panel.id, f.command)}>
                    <td>{i + 1}</td>
                    <td style={{ textAlign: 'left' }} className="last-cmd">
                      {f.command}
                    </td>
                    <td style={{ textAlign: 'left' }} className={d.ok ? 'last-desc' : 'label'}>
                      {d.ok ? d.label : `${f.label} (${d.label})`}
                    </td>
                    <td className="fave-act" onClick={(e) => e.stopPropagation()}>
                      <button title="위로" disabled={i === 0} onClick={() => moveFavorite(f.command, -1)}>
                        ↑
                      </button>
                      <button title="아래로" disabled={i === list.length - 1} onClick={() => moveFavorite(f.command, 1)}>
                        ↓
                      </button>
                      <button title="빼기" onClick={() => remove(f.command, i)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {open.length > 0 && (
          <>
            <div className="fave-sub label">지금 열린 화면에서 추가</div>
            <table className="flow-table fave-table">
              <tbody>
                {open.map(({ p, cmd }) => (
                  <tr key={p.id}>
                    <td>{`패널 ${p.num}`}</td>
                    <td style={{ textAlign: 'left' }} className="last-cmd">
                      {cmd}
                    </td>
                    <td style={{ textAlign: 'left' }} className="label">
                      {describeCommand(cmd).label}
                    </td>
                    <td className="fave-act">
                      <button title="즐겨찾기에 추가" onClick={() => add(cmd)}>
                        +
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="attr">줄을 누르면 이 패널에서 열어요 · 패널 머리글의 ☆로 그 화면을 넣고 빼요 · 즐겨찾기는 데이터 폴더(state-favorites.json)에 남아요</div>
    </>
  );
}
