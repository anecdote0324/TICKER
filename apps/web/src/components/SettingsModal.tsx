// 설정 화면(06). 바꾸면 바로 적용되고 저장 버튼은 없어요(키 입력만 '저장하고 연결 테스트').

import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '@bt/command';
import {
  ACCENT_CHOICES,
  ASSIST_LABEL,
  bindingFromEvent,
  bindingsFor,
  findConflict,
  FIXED_SHORTCUTS,
  formatBinding,
  isReservedBinding,
  SHORTCUTS,
  type AssistLevel,
  type CredentialStatus,
  type ShortcutId,
  type SourceStatus,
} from '@bt/shared';
import { api, isMac } from '../api';
import { clearImeLog, exportImeLog, imeLog, setImeLogEnabled } from '../imeLog';
import { keyCapture } from '../keys';
import { engine } from '../stores/instruments';
import { settings, updateSettings } from '../stores/settings';
import { FUNCTION_SLOT_COST, kisSlots } from '../stores/slots';
import { updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { showToast, ui } from '../stores/ui';

const SECTIONS = [
  ['general', '일반'],
  ['display', '화면'],
  ['command', '커맨드 라인'],
  ['keys', '단축키'],
  ['data', '데이터 연결'],
  ['alerts', '알림'],
  ['about', '정보'],
] as const;

export function SettingsModal() {
  const u = useStore(ui);
  const [section, setSection] = useState<string>(u.settingsSection ?? 'command');
  useEffect(() => {
    if (u.settingsSection) setSection(u.settingsSection);
  }, [u.settingsSection]);
  const close = () => ui.set((s) => ({ ...s, settings: false, settingsSection: undefined }));
  return (
    <div className="overlay" style={{ paddingTop: '6vh' }} onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal" role="dialog" aria-label="설정" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>설정</h2>
          <span className="label">바꾸면 바로 적용돼요 · 모든 패널과 떼어낸 창에 함께</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="닫기" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <nav className="modal-nav">
            {SECTIONS.map(([id, name]) => (
              <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
                {name}
              </button>
            ))}
          </nav>
          <div className="modal-main">
            {section === 'general' && <General />}
            {section === 'display' && <Display />}
            {section === 'command' && <Command />}
            {section === 'keys' && <Keys />}
            {section === 'data' && <Data />}
            {section === 'alerts' && <p className="note">알림은 v0.3(ALRT)과 함께 추가돼요. 앱이 켜져 있을 때만 동작해요.</p>}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      <button className={on ? 'on' : ''} onClick={() => onChange(true)}>
        켬
      </button>
      <button className={!on ? 'on' : ''} onClick={() => onChange(false)}>
        끔
      </button>
    </div>
  );
}

function General() {
  const s = useStore(settings);
  return (
    <>
      <h3>일반</h3>
      <div className="field">
        <label>시작할 때 마지막 배치 복원</label>
        <Toggle label="배치 복원" on={s.general.restoreWorkspace} onChange={(v) => void updateSettings({ general: { restoreWorkspace: v } })} />
      </div>
      <p className="note">앱을 끄면 모든 창과 화면 탭의 배치가 워크스페이스로 저장되고, 다음 실행 때 복원돼요.</p>
    </>
  );
}

function Display() {
  const s = useStore(settings);
  return (
    <>
      <h3>테마</h3>
      <div className="field">
        <label>테마</label>
        <div className="seg">
          <button className="on">Modern</button>
          <button disabled title="후순위 선택 사항이에요">
            Classic (후순위)
          </button>
        </div>
      </div>
      <div className="field">
        <label>강조 색</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {ACCENT_CHOICES.map((c) => (
            <button
              key={c}
              aria-label={`강조 색 ${c}`}
              onClick={() => void updateSettings({ display: { accent: c } })}
              style={{ width: 24, height: 24, background: c, border: s.display.accent === c ? '2px solid #fff' : '1px solid #333', cursor: 'pointer' }}
            />
          ))}
        </div>
      </div>
      <p className="note">등락·선택·자산군 칩 색과 겹치지 않는 색만 골랐어요.</p>
      <h3>등락 색</h3>
      <div className="field">
        <label>방식</label>
        <div className="seg">
          <button className={s.display.upDown === 'global' ? 'on' : ''} onClick={() => void updateSettings({ display: { upDown: 'global' } })}>
            글로벌식 (기본) <span style={{ color: '#3FD08A' }}>▲</span> <span style={{ color: '#FF5F57' }}>▼</span>
          </button>
          <button className={s.display.upDown === 'korean' ? 'on' : ''} onClick={() => void updateSettings({ display: { upDown: 'korean' } })}>
            한국식 <span style={{ color: '#FF5F57' }}>▲</span> <span style={{ color: '#4C9AFF' }}>▼</span>
          </button>
        </div>
      </div>
      <h3>글자 크기</h3>
      <div className="field">
        <label>배율</label>
        <div className="seg">
          {[0.9, 1, 1.1, 1.2].map((f) => (
            <button key={f} className={s.display.fontScale === f ? 'on' : ''} onClick={() => void updateSettings({ display: { fontScale: f } })}>
              {Math.round(f * 100)}%
            </button>
          ))}
        </div>
      </div>
      <h3>데이터 신선도 배지</h3>
      <p className="note">실시간이 아닌 값에는 늘 회색 배지(`5초 주기`, `15분 지연`, `일별 10/21`, `마감`, `⚠ 멈춤`)가 붙어요. 늦은 값을 실시간으로 착각하지 않게 하려는 거라 끌 수 없어요.</p>
    </>
  );
}

const ASSIST_DESC: Record<AssistLevel, string> = {
  beginner: '목록·설명·키 안내·팁을 모두 보여 줘요',
  standard: '목록과 흐린 글씨. 키 안내와 팁은 숨겨요',
  expert: '애매하거나 오류일 때만 목록을 열어요',
  off: '⏎ 라벨만. 목록은 ↓로 열어요',
};

const COMPARE: Array<[string, Record<AssistLevel, string>]> = [
  ['후보 목록', { beginner: '입력하면 바로', standard: '입력하면 바로', expert: 'Tab·↓·Alt+↓, 애매·오류', off: '↓·Alt+↓만' }],
  ['흐린 글씨 미리보기', { beginner: '✓', standard: '✓', expert: '✓', off: '—' }],
  ['기능 설명', { beginner: '✓', standard: '✓', expert: '코드와 이름만', off: '—' }],
  ['설명 창', { beginner: '자리가 있으면 자동', standard: 'F1', expert: 'F1', off: 'F1' }],
  ['진행 표시', { beginner: '전체', standard: '전체', expert: '메시지만', off: '메시지만' }],
  ['키 안내·시작 목록·팁', { beginner: '✓', standard: '—', expert: '—', off: '—' }],
  ['⏎ 라벨', { beginner: '✓', standard: '✓', expert: '✓', off: '✓' }],
];

function Preview({ level }: { level: AssistLevel }) {
  const a: Analysis = useMemo(() => engine.analyze('0059', 4, { panel: {}, assist: level, hanEng: true, tabAutofill: true }), [level]);
  const showList = level === 'beginner' || level === 'standard';
  return (
    <div style={{ border: '1px solid #262626', background: '#0a0a0a', padding: 8, marginTop: 10, fontFamily: 'var(--cmd)' }}>
      <div className="label" style={{ fontFamily: 'var(--sans)', marginBottom: 6 }}>
        미리보기: <code>0059</code>를 입력했을 때
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <span>
          <span style={{ color: '#f2f2f2' }}>0059</span>
          {level !== 'off' && a.ghost && (
            <span style={{ color: '#a8a8a8', outline: a.ghost.confirmed ? undefined : '1px dashed #555' }}>
              {a.ghost.tab}
              <span style={{ color: '#7a7a7a' }}>¦{a.ghost.rest}</span>
              {!a.ghost.confirmed && <span style={{ color: '#7a7a7a' }}>?</span>}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <span className="label" style={{ fontFamily: 'var(--sans)' }}>
          {a.label}
        </span>
      </div>
      {showList &&
        a.rows.slice(0, 3).map((r, i) => (
          <div key={r.id} className={`ac-row ${i === 0 ? 'hl' : ''}`} style={{ fontFamily: 'var(--sans)' }}>
            <span className="ac-badge asset">{r.badge}</span>
            <span className="ac-code">{r.code}</span>
            <span className={`ac-name ${r.child ? 'child' : ''}`}>{r.name}</span>
            <span className="ac-info">{r.info}</span>
            <span className="ac-canon">{r.canonical}</span>
          </div>
        ))}
      {level === 'beginner' && <div className="ac-keys" style={{ fontFamily: 'var(--sans)' }}>Tab 자동완성 · ↑↓ 고르기 · ⏎ 실행 · Esc 닫기 · F1 설명</div>}
      {(level === 'expert' || level === 'off') && (
        <div className="label" style={{ fontFamily: 'var(--sans)', marginTop: 4 }}>
          {level === 'expert' ? '목록은 Tab·↓를 누를 때 열려요' : '목록은 ↓를 누를 때만 열려요'}
        </div>
      )}
    </div>
  );
}

function Command() {
  const s = useStore(settings);
  const level = s.commandLine.assist;
  return (
    <>
      <h3>자동완성 도움 수준</h3>
      <div className="cards">
        {(Object.keys(ASSIST_LABEL) as AssistLevel[]).map((k) => (
          <button key={k} className={`card ${k === level ? 'on' : ''}`} onClick={() => void updateSettings({ commandLine: { assist: k } })}>
            <b>{ASSIST_LABEL[k]}</b>
            <span>{ASSIST_DESC[k]}</span>
          </button>
        ))}
      </div>
      <table className="cmp">
        <thead>
          <tr>
            <th>보이는 것</th>
            {(Object.keys(ASSIST_LABEL) as AssistLevel[]).map((k) => (
              <th key={k} className={k === level ? 'on' : ''}>
                {ASSIST_LABEL[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE.map(([name, v]) => (
            <tr key={name}>
              <td className="label">{name}</td>
              {(Object.keys(ASSIST_LABEL) as AssistLevel[]).map((k) => (
                <td key={k} className={k === level ? 'on' : ''}>
                  {v[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">수준은 보이는 것만 바꿔요. Tab·Enter가 하는 일은 모든 수준에서 같아요. 상태 표시줄의 `도움: ▾`에서도 바꿀 수 있어요.</p>
      <Preview level={level} />

      <h3>종목만 입력하고 Enter를 누르면</h3>
      <div className="field">
        <label>동작</label>
        <div className="seg">
          <button className="on">지금 기능 유지 (기본값)</button>
          <button disabled title="v0.2부터">
            블룸버그식 기능 메뉴 (v0.2)
          </button>
        </div>
      </div>
      <p className="note">GIP를 보던 패널에서 `005930⏎` → `005930 KS EQUITY GIP`. 지금 기능이 종목용이 아니면(WEI 등) GP로 열어요.</p>

      <h3>입력 도우미</h3>
      <div className="field">
        <label>Tab으로 시장·자산군 채우기</label>
        <Toggle label="자동 채우기" on={s.commandLine.tabAutofill} onChange={(v) => void updateSettings({ commandLine: { tabAutofill: v } })} />
      </div>
      <div className="field">
        <label>한/영 실수 교정</label>
        <Toggle label="한/영 교정" on={s.commandLine.hanEngCorrection} onChange={(v) => void updateSettings({ commandLine: { hanEngCorrection: v } })} />
      </div>
      <div className="field">
        <label>사용 팁</label>
        <Toggle label="사용 팁" on={s.commandLine.tips} onChange={(v) => void updateSettings({ commandLine: { tips: v } })} />
      </div>
      <div className="field">
        <label>기억된 선택 초기화</label>
        <button
          className="btn"
          onClick={() => {
            updateState('remembered', () => ({}));
            updateState('defaults', () => ({ chosen: {}, picks: {} }));
            showToast('기억된 선택(↺)과 겹침 기본값을 지웠어요. 사용 기록은 남아요');
          }}
        >
          초기화
        </button>
      </div>
      <p className="note">나중에 추가할 항목: 6자리 코드를 치면 바로 여는 HTS 방식(v0.2, 기본 꺼짐), F키 모드(Windows, v0.2), 자산군별 기본 기능(v0.2).</p>
      <ImeRecorder />
    </>
  );
}

/** 한글 입력 기록기(05 §8.1 K13): Windows IME·Mac에서 커맨드 라인 이벤트 순서를 남겨 보내요 */
function ImeRecorder() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    imeLog.listeners.add(f);
    return () => {
      imeLog.listeners.delete(f);
    };
  }, []);
  return (
    <>
      <h3>한글 입력 기록기</h3>
      <p className="note">
        커맨드 라인에서 한글을 칠 때 키·조합·입력 이벤트의 순서를 남겨요. Tab·Enter·클릭이 이상하게 동작하면 켜 두고 다시 해 본 뒤, 기록을 복사해 보내 주세요. 기록에는 커맨드 라인에 친 글자가 들어가요(앱키 입력칸은 기록하지 않아요).
      </p>
      <div className="field">
        <label>기록</label>
        <div className="seg">
          <button className={imeLog.enabled ? 'on' : ''} onClick={() => setImeLogEnabled(true)}>
            켜기
          </button>
          <button className={!imeLog.enabled ? 'on' : ''} onClick={() => setImeLogEnabled(false)}>
            끄기
          </button>
        </div>
        <span className="label mono">{imeLog.entries.length}개</span>
        <button
          className="btn"
          disabled={imeLog.entries.length === 0}
          onClick={() =>
            void navigator.clipboard.writeText(exportImeLog()).then(
              () => showToast('한글 입력 기록을 복사했어요'),
              () => showToast('복사하지 못했어요'),
            )
          }
        >
          기록 복사
        </button>
        <button className="btn" disabled={imeLog.entries.length === 0} onClick={clearImeLog}>
          지우기
        </button>
      </div>
    </>
  );
}

function Keys() {
  const keys = useStore(settings, (s) => s.keys);
  const [capturing, setCapturing] = useState<{ id: ShortcutId; index: number } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const setKeys = (id: ShortcutId, list: string[] | undefined) => {
    const next = { ...keys };
    if (list === undefined) delete next[id];
    else next[id] = list;
    void updateSettings({ keys: next });
  };

  // 새 키 받기: 다음에 누른 조합을 그 자리에 넣어요. Esc는 취소, Backspace는 그 키 빼기
  useEffect(() => {
    if (!capturing) return;
    keyCapture.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = bindingsFor(capturing.id, keys, isMac);
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        setCapturing(null);
        return;
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        setKeys(capturing.id, cur.filter((_, i) => i !== capturing.index));
        setCapturing(null);
        return;
      }
      const b = bindingFromEvent(e, isMac);
      if (!b) return;
      if (isReservedBinding(b, isMac)) {
        setWarn(`${formatBinding(b, isMac)}는 입력이나 고정 키라서 쓸 수 없어요`);
        return;
      }
      const other = findConflict(b, capturing.id, keys, isMac);
      if (other) {
        setWarn(`${formatBinding(b, isMac)}는 '${other.label}'에서 쓰고 있어요. 그쪽을 먼저 바꿔 주세요`);
        return;
      }
      const next = [...cur];
      next[capturing.index] = b;
      setKeys(capturing.id, [...new Set(next)]);
      setWarn(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      keyCapture.active = false;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [capturing, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = Object.keys(keys).length > 0;
  return (
    <>
      <h3>단축키</h3>
      <p className="note">키를 눌러 바꿔요. 새 키를 누르면 바로 적용돼요(Esc 취소, Backspace 그 키 빼기). Windows 언어 전환 단축키(Ctrl+Shift, Ctrl+Space 등)와 겹치면 여기서 다른 키로 바꿔요.</p>
      {warn && <p className="note" style={{ color: 'var(--error)' }}>{warn}</p>}
      <table className="cmp keys-table">
        <tbody>
          {SHORTCUTS.map((sc) => {
            const list = bindingsFor(sc.id, keys, isMac);
            const custom = keys[sc.id] !== undefined;
            return (
              <tr key={sc.id}>
                <td style={{ width: 230 }}>
                  {sc.label}
                  <span className="label" style={{ marginLeft: 6, fontSize: 10.5 }}>
                    {sc.scope}
                  </span>
                </td>
                <td>
                  {list.map((b, i) => (
                    <button
                      key={`${b}${i}`}
                      className={`keycap ${capturing?.id === sc.id && capturing.index === i ? 'capturing' : ''}`}
                      title="눌러서 바꾸기"
                      onClick={() => {
                        setWarn(null);
                        setCapturing({ id: sc.id, index: i });
                      }}
                    >
                      {capturing?.id === sc.id && capturing.index === i ? '새 키를 누르세요…' : formatBinding(b, isMac)}
                    </button>
                  ))}
                  {capturing?.id === sc.id && capturing.index === list.length ? (
                    <button className="keycap capturing">새 키를 누르세요…</button>
                  ) : (
                    <button
                      className="keycap add"
                      title="키 추가"
                      aria-label={`${sc.label} 키 추가`}
                      onClick={() => {
                        setWarn(null);
                        setCapturing({ id: sc.id, index: list.length });
                      }}
                    >
                      +
                    </button>
                  )}
                  {list.length === 0 && <span className="label">없음</span>}
                </td>
                <td style={{ width: 80, textAlign: 'right' }}>
                  {custom && (
                    <button className="btn" style={{ height: 22, fontSize: 11 }} onClick={() => setKeys(sc.id, undefined)}>
                      기본값
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="field" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!changed} onClick={() => void updateSettings({ keys: {} })}>
          모두 기본값으로
        </button>
      </div>
      <h3>바꿀 수 없는 키</h3>
      <table className="cmp">
        <tbody>
          {FIXED_SHORTCUTS.map((f) => (
            <tr key={f.keys}>
              <td className="mono" style={{ width: 230 }}>
                {f.keys.replace('Mod+', isMac ? '⌘' : 'Ctrl+').replace('Alt+', isMac ? '⌥' : 'Alt+')}
              </td>
              <td>{f.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Data() {
  const [cred, setCred] = useState<(CredentialStatus & { secretKind: string }) | null>(null);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [env, setEnv] = useState<'real' | 'virtual'>('real');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const load = () => api.get<CredentialStatus & { secretKind: string }>('/api/credentials').then(setCred, () => undefined);
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put<{ test: { ok: boolean; message: string }; status: CredentialStatus & { secretKind: string } }>('/api/credentials/kis', { appKey, appSecret, env });
      setMsg(r.test);
      setCred(r.status);
      if (r.test.ok) {
        setAppKey('');
        setAppSecret('');
      }
    } catch (e) {
      setMsg({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>한국투자증권 Open API</h3>
      <div className="warnbox">
        시세용으로는 <b>잔고가 없는 별도 계좌의 키</b>를 권해요. 이 앱에는 매매 기능이 없지만, 앱키로는 주문도 낼 수 있어요.
        <br />
        앱키와 앱시크릿은 가려서 보여 주고, PC 안에 암호화해서 저장해요({cred?.secretKind === 'os' ? 'OS 보안 저장소' : '데이터 폴더의 키 파일(개발용)'}).
      </div>
      <div className="field">
        <label>상태</label>
        <span>
          {cred?.kis.configured ? (
            <>
              저장됨 · 앱키 {cred.kis.appKeyHint} · {cred.kis.env === 'real' ? '실전' : '모의'}
              {cred.kis.lastTest && <span className={cred.kis.lastTest.ok ? 'okmsg' : 'err'}> {cred.kis.lastTest.message}</span>}
            </>
          ) : (
            <span className="label">키 없음 · 주식·지수는 데모 시세로 보여요</span>
          )}
        </span>
      </div>
      <div className="field">
        <label htmlFor="kis-key">앱키</label>
        <input id="kis-key" type="password" autoComplete="off" value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder={cred?.kis.configured ? '바꿀 때만 입력' : ''} />
      </div>
      <div className="field">
        <label htmlFor="kis-secret">앱시크릿</label>
        <input id="kis-secret" type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
      </div>
      <div className="field">
        <label>서버</label>
        <div className="seg">
          <button className={env === 'real' ? 'on' : ''} onClick={() => setEnv('real')}>
            실전
          </button>
          <button className={env === 'virtual' ? 'on' : ''} onClick={() => setEnv('virtual')}>
            모의투자
          </button>
        </div>
      </div>
      <div className="field">
        <label />
        <button className="btn primary" disabled={busy || !appKey || !appSecret} onClick={() => void save()}>
          {busy ? '연결 테스트 중…' : '저장하고 연결 테스트'}
        </button>
        {cred?.kis.configured && (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api.post<{ test: { ok: boolean; message: string } }>('/api/credentials/kis/test').catch((e: Error) => ({ test: { ok: false, message: e.message } }));
                setMsg(r.test);
                setBusy(false);
                void load();
              }}
            >
              다시 테스트
            </button>
            <button
              className="btn"
              onClick={async () => {
                await api.del('/api/credentials/kis');
                setMsg(null);
                void load();
              }}
            >
              키 지우기
            </button>
          </>
        )}
      </div>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.message}</p>}
      <p className="note">실시간 구독은 약 40개, 조회는 초당 약 20건까지예요. 화면에 보이는 종목부터 실시간으로 받고, 넘치는 종목은 몇 초 간격으로 조회해요.</p>
      <KisUsage />

      <h3>Binance</h3>
      <p className="note">키가 필요 없어요. USDT 현물 공개 시세만 써요. 일반 주소가 막히면 시세 전용 주소(data-api·data-stream.binance.vision)로 바꿔 연결해요.</p>

      <h3>환율</h3>
      <p className="note">
        지금은 ECB 기준환율(Frankfurter, 키 없음)을 써요. 하루 한 번 바뀌는 값이라 '일별' 배지가 붙어요. 한국투자증권 환율 조회는 실제로 붙여 본 뒤 주기 조회로 바꿀 예정이에요.
      </p>

      <h3>앞으로 추가될 키</h3>
      <p className="note">DART(v0.2), BOK ECOS·FRED·KOSIS·SEC EDGAR 연락처(v0.3), 네이버·KRX Open API(v0.4), 공공데이터포털(v0.7), EIA(v0.11). 소스마다 출처 표시 문구와 이용 조건 링크를 함께 보여 줄 거예요.</p>
    </>
  );
}

/** 실시간 슬롯·호출 예산 사용량(06 데이터 연결, 08 §4.1). 열려 있는 동안 2초마다 새로 읽어요 */
function KisUsage() {
  const [u, setU] = useState<{ sources: SourceStatus[]; kisBudget?: { lastSecond: number; queued: number; perSecond: number } } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api.get<typeof u>('/api/status').then(
        (r) => alive && setU(r),
        () => undefined,
      );
    void tick();
    const t = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const slots = u ? kisSlots(u.sources) : undefined;
  return (
    <>
      <table className="cmp" style={{ marginTop: 6 }}>
        <tbody>
          <tr>
            <td style={{ width: 200 }}>실시간 슬롯</td>
            <td className="mono">{slots ? `${slots.used} / ${slots.limit} 사용${slots.overflow ? ` · ${slots.overflow}개는 주기 조회` : ''}` : '— (키를 넣으면 보여요)'}</td>
          </tr>
          <tr>
            <td>조회 호출</td>
            <td className="mono">{u?.kisBudget ? `지난 1초 ${u.kisBudget.lastSecond} / 초당 ${u.kisBudget.perSecond}건 · 대기 ${u.kisBudget.queued}건` : '—'}</td>
          </tr>
        </tbody>
      </table>
      <h3>기능별 실시간 슬롯</h3>
      <table className="cmp">
        <tbody>
          {Object.entries(FUNCTION_SLOT_COST).map(([code, cost]) => (
            <tr key={code}>
              <td className="mono" style={{ width: 200 }}>
                {code}
              </td>
              <td>{cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">국내·미국 주식의 체결만 슬롯을 써요. 기능을 열 때 슬롯이 모자라면 몇 초 간격 조회로 바뀐다고 알려 줘요. 기능 설명 창(F1)에도 슬롯 수가 보여요.</p>
    </>
  );
}

function About() {
  const [info, setInfo] = useState<{ version: string } | null>(null);
  useEffect(() => {
    void api.get<{ version: string }>('/api/hello').then(setInfo, () => undefined);
  }, []);
  return (
    <>
      <h3>정보</h3>
      <div className="field">
        <label>앱 버전</label>
        <span className="mono">{window.btBridge?.version ?? info?.version ?? '—'}</span>
      </div>
      <p className="note">나 혼자 쓰는 개인용 터미널이에요. 시세를 다른 사람에게 보여주거나 재배포하지 않아요.</p>
      <h3>데이터 출처</h3>
      <p className="note">
        한국투자증권 Open API · Binance 공개 시세 · ECB 기준환율(Frankfurter) · KIS 종목 마스터 파일. 블룸버그와 관련이 없는 개인 프로젝트예요.
      </p>
    </>
  );
}
