// NOTE 메모(v0.5): 종목·테마에 태그를 단 메모와 검색. 메모는 내장 서버의 notes.db(SQLite)에 둬요.

import { useCallback, useEffect, useState } from 'react';
import { formatHm, formatYmd, type Note as NoteItem, type NotesResponse } from '@bt/shared';
import { api } from '../api';
import { getInstrument, useInstrument } from '../stores/instruments';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { showToast } from '../stores/ui';
import { TitleBar } from './common';

const when = (t: number) => `${formatYmd(t)} ${formatHm(t)}`;
const instLabel = (id: string | undefined) => {
  const inst = getInstrument(id);
  return inst ? `${inst.nameKo || inst.nameEn || inst.code} ${inst.code}` : id;
};

export function Note({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const onlyThis = !!inst && !panel.noteAll;
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [data, setData] = useState<NotesResponse | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // 쓰는 칸: editing이 있으면 그 메모를 고치는 중
  const [editing, setEditing] = useState<NoteItem | null>(null);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [link, setLink] = useState(true);
  const [busy, setBusy] = useState(false);

  const path = `/api/notes?${new URLSearchParams({ q, tag, id: onlyThis ? inst!.id : '' })}`;
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .get<NotesResponse>(path)
        .then((d) => alive && (setData(d), setError('')))
        .catch((e: Error) => alive && setError(e.message));
    }, 200);
    // 다른 패널에서 고친 메모도 보이게 30초마다
    const iv = window.setInterval(() => setReload((n) => n + 1), 30_000);
    return () => {
      alive = false;
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [path, reload]);

  const reset = useCallback(() => {
    setEditing(null);
    setBody('');
    setTags('');
    setLink(true);
  }, []);

  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const securityId = editing ? (link ? (editing.securityId ?? inst?.id) : undefined) : link ? inst?.id : undefined;
    const payload = { securityId, tags: tags.split(/[\s,]+/).filter(Boolean), body };
    try {
      if (editing) await api.put(`/api/notes/${editing.id}`, payload);
      else await api.post('/api/notes', payload);
      reset();
      setReload((n) => n + 1);
    } catch (e) {
      showToast(`메모를 저장하지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const edit = (n: NoteItem) => {
    setEditing(n);
    setBody(n.body);
    setTags(n.tags.join(' '));
    setLink(!!n.securityId);
  };

  const remove = async (n: NoteItem) => {
    try {
      await api.del(`/api/notes/${n.id}`);
      if (editing?.id === n.id) reset();
      setReload((x) => x + 1);
      showToast('메모를 지웠어요', {
        label: '되돌리기',
        run: () => void api.post('/api/notes', { securityId: n.securityId, tags: n.tags, body: n.body }).then(() => setReload((x) => x + 1)),
      });
    } catch (e) {
      showToast(`메모를 지우지 못했어요: ${(e as Error).message}`);
    }
  };

  const linkTarget = editing ? (editing.securityId ?? inst?.id) : inst?.id;
  const tools = inst ? (
    <>
      <button className={onlyThis ? 'on' : ''} onClick={() => patchPanel(panel.id, { noteAll: false })}>
        이 종목
      </button>
      <button className={!onlyThis ? 'on' : ''} onClick={() => patchPanel(panel.id, { noteAll: true })}>
        전체
      </button>
    </>
  ) : undefined;
  return (
    <>
      <TitleBar fn="NOTE" name="메모" sub={inst ? instLabel(inst.id) : '전체'} tools={tools} />
      <div className="pbody flow note">
        <div className="note-edit" onKeyDown={(e) => e.stopPropagation()}>
          <textarea
            value={body}
            placeholder={'메모를 쓰고 Ctrl+Enter(Mac ⌘+Enter)로 저장. 본문의 #태그도 태그가 돼요'}
            aria-label="메모 내용"
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape' && editing) reset();
            }}
          />
          <div className="note-edit-row">
            <input value={tags} placeholder="태그(띄어 쓰기로 여러 개, 예: 반도체 실적)" aria-label="태그" onChange={(e) => setTags(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
            {linkTarget && (
              <label className="note-link">
                <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
                {instLabel(linkTarget)}
              </label>
            )}
            <button onClick={() => void save()} disabled={!body.trim() || busy}>
              {editing ? '고친 것 저장' : '저장'}
            </button>
            {editing && <button onClick={reset}>그만두기</button>}
          </div>
        </div>
        <div className="note-search" onKeyDown={(e) => e.stopPropagation()}>
          <input value={q} placeholder="검색(본문·태그, 띄어 쓰면 모두 들어간 것)" aria-label="메모 검색" onChange={(e) => setQ(e.target.value)} />
          {tag && (
            <button className="on" onClick={() => setTag('')} title="태그 거르기 풀기">
              {`#${tag} ✕`}
            </button>
          )}
        </div>
        {data && data.tags.length > 0 && (
          <div className="note-tags">
            {data.tags.slice(0, 30).map((t) => (
              <button key={t.tag} className={t.tag === tag ? 'on' : ''} onClick={() => setTag(t.tag === tag ? '' : t.tag)}>
                {`#${t.tag} ${t.count}`}
              </button>
            ))}
          </div>
        )}
        {error && !data && <div className="empty-body err">{error}</div>}
        {data && data.notes.length === 0 && <div className="des-note label">{q || tag ? '찾는 메모가 없어요' : onlyThis ? '이 종목 메모가 아직 없어요' : '아직 메모가 없어요'}</div>}
        {data?.notes.map((n) => (
          <div key={n.id} className={`note-item ${editing?.id === n.id ? 'sel' : ''}`}>
            <div className="note-head">
              <span className="label">{when(n.updatedAt)}</span>
              {n.securityId && (
                <button className="note-sec" title="이 패널에서 그 종목의 메모로" onClick={() => setPanelSecurity(panel.id, n.securityId!)}>
                  {instLabel(n.securityId)}
                </button>
              )}
              {n.tags.map((t) => (
                <button key={t} className="note-tag" onClick={() => setTag(t)}>{`#${t}`}</button>
              ))}
              <span className="grow" />
              <button onClick={() => edit(n)}>고치기</button>
              <button onClick={() => void remove(n)}>지우기</button>
            </div>
            <div className="note-body">{n.body}</div>
          </div>
        ))}
      </div>
      <div className="attr">메모는 데이터 폴더의 notes.db에 남아요(이 컴퓨터에만) · 종목 화면에서 열면 그 종목 메모만, 전체 버튼으로 모두 봐요</div>
    </>
  );
}
