// 앱 틀: 맨 위 줄, 화면 탭별 패널 배치, 시세 흐름 띠, 상태 표시줄(02 화면 공통 요소).

import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpOverlay, ToastView } from './components/Overlays';
import { Palette } from './components/Palette';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { TickerTape } from './components/TickerTape';
import { TopBar, type Screen } from './components/TopBar';
import { addPanel, dockApis, Workspace, type ScreenLayout } from './components/Workspace';
import { WorkspaceMenu } from './components/WorkspaceMenu';
import { attachGlobalKeys } from './keys';
import { panels, type PanelState } from './stores/panels';
import { settings } from './stores/settings';
import { appState, updateState, type NamedWorkspace } from './stores/state';
import { useStore } from './stores/store';
import { showToast, ui } from './stores/ui';

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

const DEFAULT_WORKSPACE: SavedWorkspace = { screens: [{ id: 'main', name: 'Market Pulse' }], active: 'main', layouts: {}, panels: {} };

export function App() {
  const saved = useRef<SavedWorkspace | null>(null);
  if (saved.current === null) {
    saved.current = loadSaved() ?? DEFAULT_WORKSPACE;
    if (Object.keys(saved.current.panels).length) panels.set(saved.current.panels);
  }
  const [screens, setScreens] = useState<Screen[]>(saved.current.screens);
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
        active={active}
        onSelect={setActive}
        onAdd={() => {
          const id = `s${Date.now().toString(36)}`;
          setScreens((s) => [...s, { id, name: `화면 ${s.length + 1}` }]);
          setActive(id);
        }}
        onRename={(id, name) => setScreens((s) => s.map((x) => (x.id === id ? { ...x, name } : x)))}
        onClose={closeScreen}
        onAddPanel={() => {
          const api = dockApis.get(active);
          if (api) addPanel(api);
        }}
        workspaceMenu={<WorkspaceMenu current={wsName} list={named} onSave={saveNamed} onLoad={loadNamed} onDelete={deleteNamed} onReset={resetWorkspace} />}
      />
      {screens.map((s) => (
        <Workspace
          key={`${generation}:${s.id}`}
          screenId={s.id}
          visible={s.id === active}
          initial={layouts.current[s.id] ?? null}
          onChange={(l) => {
            layouts.current = { ...layouts.current, [s.id]: l };
            scheduleSave();
          }}
        />
      ))}
      <TickerTape />
      <StatusBar />
      {u.palette && <Palette />}
      {u.settings && <SettingsModal />}
      <HelpOverlay />
      <ToastView />
    </div>
  );
}
