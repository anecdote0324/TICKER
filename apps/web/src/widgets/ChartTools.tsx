// v0.5 차트 도구: TECH 기술적 지표(목록·계산법·읽는 법, G·GP에 켜기)와 TDEF 차트 기본값(새 차트의 표시 모드·지표·기간).

import { CHART_STYLES, DEFAULT_CHART_PREFS, type ChartStyle } from './chartPrefs';
import { GP_RANGES } from './chartRange';
import { activeIndicators, INDICATOR_HOW, INDICATORS, type IndicatorId } from './indicators';
import { getInstrument } from '../stores/instruments';
import { panels, patchPanel, type PanelState } from '../stores/panels';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar } from './common';

const GROUP_LABEL = { ma: '이동평균', overlay: '가격 위에 겹쳐 그리기', pane: '아래 창' } as const;

/** TECH가 지표를 켤 차트: 같은 연동 색의 G, 없으면 GP(연동 색이 없으면 처음 찾은 G·GP) */
export function techTarget(all: Record<string, PanelState>, me: PanelState): PanelState | undefined {
  const charts = Object.values(all)
    .filter((p) => p.id !== me.id && (p.fn === 'G' || p.fn === 'GP'))
    .sort((a, b) => (a.fn === b.fn ? a.num - b.num : a.fn === 'G' ? -1 : 1));
  return (me.link ? charts.find((p) => p.link === me.link) : undefined) ?? charts[0];
}

export function Tech({ panel }: { panel: PanelState }) {
  const all = useStore(panels, (s) => s);
  const prefs = useStore(appState, (s) => s.chart ?? DEFAULT_CHART_PREFS);
  const target = techTarget(all, panel);
  const on = target ? activeIndicators(target.gpIndicators, prefs.defaults.indicators) : [];
  const toggle = (id: IndicatorId) => {
    if (!target) return;
    patchPanel(target.id, { gpIndicators: on.includes(id) ? on.filter((x) => x !== id) : [...on, id] });
  };
  const tInst = target?.securityId ? getInstrument(target.securityId) : undefined;
  return (
    <>
      <TitleBar fn="TECH" name="기술적 지표" sub={target ? `켜는 곳: ${target.num}번 ${target.fn}${tInst ? ` · ${tInst.nameKo || tInst.code}` : ''}` : '켤 G·GP 패널이 없어요'} />
      <div className="pbody flow">
        {(['ma', 'overlay', 'pane'] as const).map((g) => (
          <div key={g}>
            <div className="grp">
              <span>{GROUP_LABEL[g]}</span>
            </div>
            <table className="flow-table tech-table">
              <tbody>
                {INDICATORS.filter((d) => d.group === g).map((d) => (
                  <tr key={d.id}>
                    <td style={{ width: 120 }}>
                      <i style={{ display: 'inline-block', width: 10, height: 2, background: d.color, verticalAlign: 'middle', marginRight: 6 }} />
                      {g === 'ma' ? `${d.label}봉 이동평균` : d.label}
                    </td>
                    <td style={{ textAlign: 'left', whiteSpace: 'normal', color: 'var(--value)' }}>
                      <div>{d.desc}</div>
                      <div className="label">{INDICATOR_HOW[d.id] ?? ''}</div>
                    </td>
                    <td style={{ width: 70 }}>
                      <button className={`btn ${on.includes(d.id) ? 'primary' : ''}`} disabled={!target} onClick={() => toggle(d.id)}>
                        {on.includes(d.id) ? '끄기' : '켜기'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="attr">같은 연동 색의 G(없으면 GP) 패널에 켜요. 연동 색이 없으면 처음 찾은 G·GP 패널이에요. 지표는 그 패널의 지표 메뉴에서도 켜고 꺼요.</div>
      </div>
    </>
  );
}

export function Tdef({ panel }: { panel: PanelState }) {
  void panel;
  const prefs = useStore(appState, (s) => s.chart ?? DEFAULT_CHART_PREFS);
  const d = prefs.defaults;
  const set = (patch: Partial<typeof d>) => updateState('chart', (c) => ({ ...(c ?? DEFAULT_CHART_PREFS), defaults: { ...(c ?? DEFAULT_CHART_PREFS).defaults, ...patch } }));
  const toggle = (id: IndicatorId) => set({ indicators: d.indicators.includes(id) ? d.indicators.filter((x) => x !== id) : [...d.indicators, id] });
  return (
    <>
      <TitleBar fn="TDEF" name="차트 기본값" sub="새 GP·G 패널(직접 고르지 않은 패널)에 써요" />
      <div className="pbody flow tdef">
        <div className="grp">
          <span>표시 모드</span>
        </div>
        <div className="tdef-row">
          {CHART_STYLES.map((s) => (
            <label key={s.code} title={s.desc}>
              <input type="radio" name="tdef-style" checked={d.style === s.code} onChange={() => set({ style: s.code as ChartStyle })} /> {s.label}
            </label>
          ))}
        </div>
        <div className="grp">
          <span>일·주·월봉 처음 보이는 기간</span>
        </div>
        <div className="tdef-row">
          {Object.keys(GP_RANGES).map((r) => (
            <label key={r}>
              <input type="radio" name="tdef-range" checked={d.range === r} onChange={() => set({ range: r })} /> {r}
            </label>
          ))}
        </div>
        <div className="grp">
          <span>처음 켜 둘 지표</span>
        </div>
        <div className="tdef-row">
          {INDICATORS.map((x) => (
            <label key={x.id} title={x.desc}>
              <input type="checkbox" checked={d.indicators.includes(x.id)} onChange={() => toggle(x.id)} /> {x.group === 'ma' ? `${x.label}선` : x.label}
            </label>
          ))}
        </div>
        <div className="tdef-row">
          <button className="btn" onClick={() => set(DEFAULT_CHART_PREFS.defaults)}>
            처음 값으로(캔들, 3M, 20·60선)
          </button>
        </div>
        <div className="attr">패널에서 표시 모드·지표·기간을 직접 고른 GP·G는 그 값을 그대로 써요. 저장한 템플릿 {prefs.templates.length}개, 그림이 있는 종목 {Object.keys(prefs.drawings).length}개.</div>
      </div>
    </>
  );
}
