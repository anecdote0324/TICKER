// 앱 틀: 맨 위 줄, 화면 탭별 패널 배치, 시세 흐름 띠, 상태 표시줄(02 화면 공통 요소).

import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpOverlay, ToastView } from './components/Overlays';
import { Palette } from './components/Palette';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { TickerTape } from './components/TickerTape';
import { TopBar, type Screen } from './components/TopBar';
import { ScreenWindow, ScreenWindowBar } from './components/ScreenWindow';
import { addPanel, dockApis, Workspace, type ScreenLayout } from './components/Workspace';
import { WorkspaceMenu } from './components/WorkspaceMenu';
import { AlertWatcher } from './components/AlertWatcher';
import { buildWorkspaceFile, mergeWatchlists, mergeWorkspaces, parseWorkspaceFile, workspaceFileName } from './workspaceFile';
import { attachGlobalKeys } from './keys';
import { focusRegistry } from './components/focus';
import { panels, type PanelState } from './stores/panels';
import { settings } from './stores/settings';
import { appState, updateState, type NamedWorkspace } from './stores/state';
import { useStore } from './stores/store';
import { showToast, ui } from './stores/ui';
import { screenWindows } from './stores/windows';

export interface SavedWorkspace {
  /** 불러온(또는 마지막으로 저장한) 이름 붙인 워크스페이스 */
  name?: string;
  screens: Screen[];
  active: string;
  layouts: Record<string, ScreenLayout>;
  panels: Record<string, PanelState>;
}

function loadSaved(): SavedWorkspace | null {
  const w = appState.get().workspace as SavedWorkspace | null;
  if (!w || !Array.isArray(w.screens) || !settings.get().general.restoreWorkspace) return null;
  return w;
}

/** 떼어낸 화면의 창 id(같은 창에 화면 탭이 여러 개일 수 있어요, v0.2). 예전 저장분은 화면 id가 창 id */
const winOf = (s: Screen): string | undefined => (s.detached ? (s.win ?? s.id) : undefined);

// v0.3: 두 번째 화면 탭 Deep Dive(한 종목 깊게 보기). 저장된 배치에는 더하지 않아요(기본 배치로 새로 시작하면 생겨요)
const DEFAULT_WORKSPACE: SavedWorkspace = {
  screens: [
    { id: 'main', name: 'Market Pulse' },
    { id: 'deep', name: 'Deep Dive' },
  ],
  active: 'main',
  layouts: {},
  panels: {},
};

export function App() {
  const saved = useRef<SavedWorkspace | null>(null);
  if (saved.current === null) {
    saved.current = loadSaved() ?? DEFAULT_WORKSPACE;
    if (Object.keys(saved.current.panels).length) panels.set(saved.current.panels);
  }
  const [screens, setScreens] = useState<Screen[]>(saved.current.screens);
  /** 떼어낸 창마다 보이는 화면 탭(v0.2) */
  const [winActive, setWinActive] = useState<Record<string, string>>({});
  const [active, setActive] = useState(saved.current.active);
  const [wsName, setWsName] = useState(saved.current.name);
  // 워크스페이스를 불러오면 모든 화면 탭의 배치를 새로 만들어요
  const [generation, setGeneration] = useState(0);
  const layouts = useRef<Record<string, ScreenLayout>>(saved.current.layouts);
  const u = useStore(ui);
  const named = useStore(appState, (s) => s.workspaces);

  // 워크스페이스 저장: 모든 화면 탭의 배치와 패널 상태를 하나로 묶어요
  const snapshot = useCallback((): SavedWorkspace => {
    const next = { ...layouts.current };
    for (const s of screens) {
      const api = dockApis.get(s.id);
      if (api) next[s.id] = { dock: api.toJSON() };
    }
    layouts.current = next;
    return { name: wsName, screens, active, layouts: next, panels: panels.get() };
  }, [screens, active, wsName]);
  const save = useCallback(() => {
    updateState('workspace', () => snapshot());
  }, [snapshot]);
  const saveTimer = useRef(0);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 600);
  }, [save]);
  useEffect(() => panels.subscribe(scheduleSave), [scheduleSave]);
  useEffect(scheduleSave, [screens, active, scheduleSave]);

  const applyWorkspace = (w: SavedWorkspace) => {
    const copy = structuredClone(w);
    panels.set(copy.panels);
    layouts.current = copy.layouts;
    setScreens(copy.screens.length ? copy.screens : DEFAULT_WORKSPACE.screens);
    setActive(copy.screens.some((s) => s.id === copy.active) ? copy.active : (copy.screens[0]?.id ?? 'main'));
    setWsName(copy.name);
    setGeneration((g) => g + 1);
  };
  /** 바꾸기 전 배치로 돌아가는 되돌리기 */
  const undoTo = (before: SavedWorkspace) => ({ label: '되돌리기', run: () => applyWorkspace(before) });

  const saveNamed = (name: string) => {
    const data = { ...snapshot(), name };
    updateState('workspaces', (list) => [...list.filter((w) => w.name !== name), { name, savedAt: Date.now(), data }].sort((a, b) => a.name.localeCompare(b.name, 'ko')));
    setWsName(name);
    showToast(`'${name}' 워크스페이스를 저장했어요`);
  };
  const loadNamed = (w: NamedWorkspace) => {
    const before = snapshot();
    applyWorkspace({ ...(w.data as SavedWorkspace), name: w.name });
    showToast(`'${w.name}' 워크스페이스를 불러왔어요`, undoTo(before));
  };
  const deleteNamed = (name: string) => {
    const removed = appState.get().workspaces.find((w) => w.name === name);
    updateState('workspaces', (list) => list.filter((w) => w.name !== name));
    if (wsName === name) setWsName(undefined);
    if (removed) {
      showToast(`'${name}' 워크스페이스를 지웠어요`, {
        label: '되돌리기',
        run: () => updateState('workspaces', (list) => [...list.filter((w) => w.name !== name), removed].sort((a, b) => a.name.localeCompare(b.name, 'ko'))),
      });
    }
  };
  // ── 파일로 내보내기·가져오기(v0.2): 다른 컴퓨터로 배치 옮기기 ──
  const exportWorkspaces = () => {
    const st = appState.get();
    const file = buildWorkspaceFile(snapshot(), st.workspaces, st.watchlists);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = workspaceFileName();
    document.body.appendChild(a);
    a.click();
    // 바로 지우면 파일 이름이 'download'가 되는 경우가 있어서 조금 뒤에 지워요
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10_000);
    showToast(`지금 배치와 워크스페이스 ${st.workspaces.length}개, 관심종목을 파일로 내보냈어요`);
  };
  const importWorkspaces = async (f: File) => {
    const parsed = parseWorkspaceFile(await f.text());
    if (!parsed.ok) {
      showToast(`가져오지 못했어요: ${parsed.error}`);
      return;
    }
    const st = appState.get();
    const merged = mergeWorkspaces(st.workspaces, parsed.file);
    const wl = mergeWatchlists(st.watchlists, parsed.file.watchlists);
    updateState('workspaces', () => merged.list);
    if (wl.addedIds > 0) updateState('watchlists', () => wl.list);
    const before = snapshot();
    applyWorkspace({ ...(merged.opened.data as SavedWorkspace), name: merged.opened.name });
    showToast(`워크스페이스 ${merged.added.length}개를 가져와 '${merged.opened.name}'을(를) 열었어요${wl.addedIds ? ` · 관심종목 ${wl.addedIds}개 더함` : ''}`, undoTo(before), 8000);
  };

  const resetWorkspace = () => {
    const before = snapshot();
    applyWorkspace(DEFAULT_WORKSPACE);
    showToast('기본 배치로 새로 시작했어요', undoTo(before));
  };

  /** 화면 탭 닫기: 그 화면의 패널(떼어낸 창 포함)도 함께 닫고, 알림에서 되돌릴 수 있어요 */
  const closeScreen = (id: string) => {
    if (screens.length <= 1) return;
    const index = screens.findIndex((s) => s.id === id);
    const screen = screens[index];
    if (!screen) return;
    const api = dockApis.get(id);
    const layout: ScreenLayout | null = api ? { dock: api.toJSON() } : (layouts.current[id] ?? null);
    const panelIds = api ? api.panels.map((p) => (p.params as { panelId?: string } | undefined)?.panelId).filter((x): x is string => !!x) : [];
    const removed = Object.fromEntries(panelIds.map((pid) => [pid, panels.get()[pid]]).filter(([, v]) => v)) as Record<string, PanelState>;

    const rest = screens.filter((s) => s.id !== id);
    setScreens(rest);
    if (active === id) setActive(rest[Math.max(0, index - 1)].id);
    const nextLayouts = { ...layouts.current };
    delete nextLayouts[id];
    layouts.current = nextLayouts;
    panels.set((all) => {
      const next = { ...all };
      for (const pid of panelIds) delete next[pid];
      return next;
    });
    showToast(`'${screen.name}' 화면을 닫았어요${panelIds.length ? ` · 패널 ${panelIds.length}개` : ''}`, {
      label: '되돌리기',
      run: () => {
        panels.set((all) => ({ ...all, ...removed }));
        if (layout) layouts.current = { ...layouts.current, [id]: layout };
        setScreens((s) => {
          if (s.some((x) => x.id === id)) return s;
          const next = [...s];
          next.splice(Math.min(index, next.length), 0, screen);
          return next;
        });
        setActive(id);
      },
    });
  };

  /** 지금 배치를 기억해 둬요. 화면을 다른 창으로 옮기면 배치를 새로 그려서, 옮기기 직전 것을 써요 */
  const keepLayout = (id: string) => {
    const api = dockApis.get(id);
    if (api) layouts.current = { ...layouts.current, [id]: { dock: api.toJSON() } };
  };

  /** 화면 탭을 통째로 새 창으로 떼어내요. 메인 창에는 화면이 하나 이상 남아야 해요 */
  const detachScreen = (id: string) => {
    const rest = screens.filter((s) => !s.detached && s.id !== id);
    if (!rest.length) return;
    keepLayout(id);
    setScreens((all) => all.map((s) => (s.id === id ? { ...s, detached: true, win: id } : s)));
    if (active === id) {
      // 메인 창은 왼쪽 옆 화면을 보여 줘요
      const left = screens.slice(0, screens.findIndex((s) => s.id === id)).filter((s) => !s.detached);
      setActive((left[left.length - 1] ?? rest[0]).id);
    }
  };

  /** 떼어낸 화면을 메인 창으로 돌려놓아요(창을 닫아도 같아요) */
  const attachScreen = (id: string, bounds?: Screen['bounds']) => {
    keepLayout(id);
    setScreens((all) => all.map((s) => (s.id === id ? { ...s, detached: false, win: undefined, bounds: bounds ?? s.bounds } : s)));
    setActive(id);
    window.focus();
  };

  /** 떼어낸 창을 닫았어요: 그 창의 화면을 모두 메인 창으로 */
  const closeWindow = (win: string, bounds?: Screen['bounds']) => {
    const ids = screens.filter((s) => winOf(s) === win).map((s) => s.id);
    for (const id of ids) keepLayout(id);
    setScreens((all) => all.map((s) => (ids.includes(s.id) ? { ...s, detached: false, win: undefined, bounds: bounds ?? s.bounds } : s)));
    if (ids[0]) setActive(winActive[win] && ids.includes(winActive[win]) ? winActive[win] : ids[0]);
    window.focus();
  };

  /** 떼어낸 창 안에 화면 탭 추가(v0.2) */
  const addScreenInWindow = (win: string) => {
    const id = `s${Date.now().toString(36)}`;
    const bounds = screens.find((s) => winOf(s) === win)?.bounds;
    setScreens((s) => [...s, { id, name: `화면 ${s.length + 1}`, detached: true, win, bounds }]);
    setWinActive((m) => ({ ...m, [win]: id }));
  };

  // 메인 창이 보여 줄 화면: 고른 화면이 떼어낸 것이면 메인 창에 남은 첫 화면
  const mainScreens = screens.filter((s) => !s.detached);
  const mainActive = mainScreens.some((s) => s.id === active) ? active : (mainScreens[0]?.id ?? active);
  // 팔레트·도움말을 떼어낸 화면 창에 그릴지(그 창에서 열었을 때)
  const overlayHost = u.host && screens.some((s) => winOf(s) === u.host) ? u.host : undefined;
  // 떼어낸 창들(창 id 순서는 화면 순서)
  const wins = [...new Set(screens.map(winOf).filter((w): w is string => !!w))];

  // 화면 탭 옮기기(v0.4): 누른 창의 화면 탭 목록에서 오른쪽·왼쪽으로(끝에서는 처음으로 돌아가요)
  const screenNav = useRef<(dir: 1 | -1, view: Window | null) => void>(() => undefined);
  screenNav.current = (dir, view) => {
    const win = [...screenWindows.entries()].find(([, w]) => w === view)?.[0];
    if (win) {
      const ids = screens.filter((s) => winOf(s) === win).map((s) => s.id);
      if (ids.length < 2) return;
      const cur = winActive[win] && ids.includes(winActive[win]) ? winActive[win] : ids[0];
      setWinActive((m) => ({ ...m, [win]: ids[(ids.indexOf(cur) + dir + ids.length) % ids.length] }));
      return;
    }
    const ids = mainScreens.map((s) => s.id);
    if (ids.length < 2) return;
    setActive(ids[(ids.indexOf(mainActive) + dir + ids.length) % ids.length]);
  };
  useEffect(() => {
    focusRegistry.screenNav = (dir, view) => screenNav.current(dir, view);
    return () => {
      focusRegistry.screenNav = undefined;
    };
  }, []);

  useEffect(() => {
    attachGlobalKeys(window);
    const onUnload = () => save();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [save]);

  return (
    <div className="app">
      <TopBar
        screens={screens}
        active={mainActive}
        onSelect={(id) => {
          // 떼어낸 화면이면 그 창을 앞으로 가져와요
          const s = screens.find((x) => x.id === id);
          const win = s ? winOf(s) : undefined;
          const w = win ? screenWindows.get(win) : undefined;
          if (win && w && !w.closed) {
            setWinActive((m) => ({ ...m, [win]: id }));
            w.focus();
          } else setActive(id);
        }}
        onAdd={() => {
          const id = `s${Date.now().toString(36)}`;
          setScreens((s) => [...s, { id, name: `화면 ${s.length + 1}` }]);
          setActive(id);
        }}
        onRename={(id, name) => setScreens((s) => s.map((x) => (x.id === id ? { ...x, name } : x)))}
        onClose={closeScreen}
        onDetach={detachScreen}
        onAttach={(id) => attachScreen(id)}
        onAddPanel={() => {
          const api = dockApis.get(mainActive);
          if (api) addPanel(api);
        }}
        workspaceMenu={<WorkspaceMenu current={wsName} list={named} onSave={saveNamed} onLoad={loadNamed} onDelete={deleteNamed} onReset={resetWorkspace} onExport={exportWorkspaces} onImport={(f) => void importWorkspaces(f)} />}
      />
      {screens
        .filter((s) => !s.detached)
        .map((s) => (
          <Workspace
            key={`${generation}:${s.id}:main`}
            screenId={s.id}
            visible={s.id === mainActive}
            initial={layouts.current[s.id] ?? null}
            onChange={(l) => {
              layouts.current = { ...layouts.current, [s.id]: l };
              scheduleSave();
            }}
          />
        ))}
      {wins.map((win) => {
        const tabs = screens.filter((s) => winOf(s) === win);
        const shown = tabs.find((t) => t.id === winActive[win]) ?? tabs[0];
        if (!shown) return null;
        return (
          <ScreenWindow
            key={`${generation}:${win}:window`}
            winId={win}
            title={shown.name}
            bounds={tabs[0].bounds}
            screenIds={tabs.map((t) => t.id)}
            onClosed={(bounds) => closeWindow(win, bounds)}
            onFailed={() => {
              closeWindow(win);
              showToast(`'${shown.name}' 화면을 새 창으로 열지 못해서 메인 창에 두었어요`);
            }}
            onBounds={(bounds) => setScreens((all) => all.map((x) => (winOf(x) === win ? { ...x, bounds } : x)))}
          >
            <ScreenWindowBar
              tabs={tabs.map((t) => ({ id: t.id, name: t.name }))}
              active={shown.id}
              onSelect={(id) => setWinActive((m) => ({ ...m, [win]: id }))}
              onAddScreen={() => addScreenInWindow(win)}
              onRename={(id, name) => setScreens((all) => all.map((x) => (x.id === id ? { ...x, name } : x)))}
              onCloseTab={(id) => closeScreen(id)}
              onAttach={(id) => attachScreen(id)}
              onAddPanel={() => {
                const api = dockApis.get(shown.id);
                if (api) addPanel(api);
              }}
            />
            {tabs.map((t) => (
              <Workspace
                key={`${generation}:${t.id}:window`}
                screenId={t.id}
                visible={t.id === shown.id}
                initial={layouts.current[t.id] ?? null}
                onChange={(l) => {
                  layouts.current = { ...layouts.current, [t.id]: l };
                  scheduleSave();
                }}
              />
            ))}
            {overlayHost === win && u.palette && <Palette />}
            {overlayHost === win && <HelpOverlay />}
          </ScreenWindow>
        );
      })}
      <TickerTape />
      <StatusBar />
      <AlertWatcher />
      {!overlayHost && u.palette && <Palette />}
      {u.settings && <SettingsModal />}
      {!overlayHost && <HelpOverlay />}
      <ToastView />
    </div>
  );
}
