import { useEffect, useMemo, useState } from 'react';
import type { CustomDraft, Inputs, Load, Metric, Point, Result, UnitSystem } from './types';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './lib/units';
import { altitudeToPressure, pressureToAltitude } from './lib/atmosphere';
import { fieldErrors, validateCustomLoad, validateInputs } from './lib/validation';
import { dragDescription, firearmLabel, projectileLabel } from './lib/labels';
import { formatDistance, formatNumber } from './lib/format';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathM } from './lib/holdover';
import { calculateAll } from './lib/calculate';
import { saveCsv } from './lib/csv';
import { pointAt } from './lib/trajectory';
import { Field } from './components/Field';
import { Sparkline } from './components/Sparkline';
import { HelpNotes } from './components/HelpNotes';

type Tab = 'overview' | 'table' | 'compare' | 'notes';
type Theme = 'light' | 'dark';
type StatusMode =
  | 'atmosphere'
  | 'summary'
  | 'retainedEnergy'
  | 'mach'
  | 'sphere'
  | 'windage'
  | 'holdover'
  | 'mpbr';

const TABS: Tab[] = ['overview', 'table', 'compare', 'notes'];
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  table: 'Range table',
  compare: 'All-load calculator',
  notes: 'Help',
};

type CompareKey =
  | 'shortName'
  | 'speedMps'
  | 'energyJ'
  | 'payloadEnergy'
  | 'momentumKgms'
  | 'payloadMomentum'
  | 'timeS'
  | 'dropM'
  | 'mpbrM';

function Row({
  label,
  value,
  unit,
  wide,
}: {
  label: string;
  value: string;
  unit?: string;
  wide?: boolean;
}) {
  return (
    <div className="rrow">
      <span className="rlabel">{label}</span>
      <span className={`rval${wide ? ' wide' : ''}`}>
        {value}
        {unit ? <em>{unit}</em> : null}
      </span>
    </div>
  );
}

const defaults: Inputs = {
  distanceM: 100,
  temperatureC: 15,
  pressureHpa: 1013.25,
  humidityPercent: 50,
  altitudeM: 0,
  headwindMps: 0,
  crosswindMps: 0,
  vitalZoneM: 0.15,
  shotgunSightM: 0.025,
  rifleSightM: 0.04,
  shotgunZeroM: 50,
  rifleZeroM: 100,
  shotgunMvMultiplier: 1,
  rifleMvMultiplier: 1,
  rifleTwistInches: 10,
  twistDirection: 1,
};
export function App() {
  const [inputs, setInputs] = useState<Inputs>(() => {
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem('bw.inputs') || '{}') };
      } catch {
        return defaults;
      }
    }),
    [result, setResult] = useState<Result | null>(null),
    [selected, setSelected] = useState(0);
  const [metric, setMetric] = useState<Metric>('energyJ'),
    [tab, setTab] = useState<Tab>(() => {
      const stored = localStorage.getItem('bw.tab');
      return TABS.includes(stored as Tab) ? (stored as Tab) : 'overview';
    }),
    [units, setUnits] = useState<UnitSystem>(() =>
      localStorage.getItem('bw.units') === 'imperial' ? 'imperial' : 'metric',
    ),
    [theme, setTheme] = useState<Theme>(() =>
      localStorage.getItem('bw.theme') === 'dark' ? 'dark' : 'light',
    ),
    [statusMode, setStatusMode] = useState<StatusMode>('atmosphere'),
    [statusLoad, setStatusLoad] = useState(0),
    [tableStep, setTableStep] = useState(25),
    [chartDistance, setChartDistance] = useState(100),
    [compareSort, setCompareSort] = useState<{ key: CompareKey; ascending: boolean }>({
      key: 'shortName',
      ascending: true,
    }),
    [copied, setCopied] = useState(false);
  const blankCustom: CustomDraft = {
    name: 'Custom load',
    drag: 'G1',
    group: 'rifle',
    massG: 10.886,
    mv: 823,
    bc: 0.475,
    sphereMm: 8.382,
    density: 11340,
    count: 1,
    length: 0,
    diameter: 0.308,
    twist: 0,
  };
  const [customOpen, setCustomOpen] = useState(false),
    [editingCustom, setEditingCustom] = useState<number | null>(null),
    [custom, setCustom] = useState<CustomDraft>(blankCustom),
    [customLoads, setCustomLoads] = useState<CustomDraft[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('bw.customLoads') || '[]');
      } catch {
        return [];
      }
    });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    localStorage.setItem('bw.inputs', JSON.stringify(inputs));
  }, [inputs]);
  useEffect(() => {
    localStorage.setItem('bw.units', units);
  }, [units]);
  useEffect(() => {
    localStorage.setItem('bw.theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('bw.tab', tab);
  }, [tab]);
  useEffect(() => {
    localStorage.setItem('bw.customLoads', JSON.stringify(customLoads));
  }, [customLoads]);
  const validationErrors = useMemo(() => validateInputs(inputs), [inputs]);
  const fieldErrs = useMemo(() => fieldErrors(inputs), [inputs]);
  useEffect(() => {
    if (validationErrors.length) {
      setBusy(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        setResult(await calculateAll(inputs, customLoads));
        setError('');
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [inputs, customLoads, validationErrors.length]);
  const load = result?.loads[selected],
    imperial = units === 'imperial',
    referenceDistance = Math.min(chartDistance, inputs.distanceM);
  useEffect(() => {
    if (result && selected >= result.loads.length) {
      setSelected(0);
    }
    if (result && statusLoad >= result.loads.length) {
      setStatusLoad(0);
    }
  }, [result, selected, statusLoad]);
  const target = useMemo(
    () => (load ? pointAt(load.points, referenceDistance) : undefined),
    [load, referenceDistance],
  );
  const holdGeomFor = (item: Load) => sightGeometry(item, inputs, inputs);
  const targetGeom = load ? holdGeomFor(load) : undefined;
  const targetPathM =
    target && targetGeom ? sightPathM(target.dropM, referenceDistance, targetGeom) : 0;
  const distUnit = imperial ? 'yd' : 'm';
  const energyUnit = imperial ? 'ft·lbf' : 'J';
  const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
  const dropUnit = imperial ? 'in' : 'cm';
  const tableStepM = imperial ? tableStep / M_TO_YD : tableStep;
  const rows = useMemo(() => {
    if (!load) return [];
    const out: Point[] = [];
    for (let d = 0; d <= inputs.distanceM + 0.001; d += tableStepM) {
      const p = pointAt(load.points, d);
      if (p) out.push(p);
    }
    return out;
  }, [load, inputs.distanceM, tableStepM]);
  const compareRows = useMemo(() => {
    if (!result) return [];
    const rows = result.loads.map((item, index) => {
      const point = pointAt(item.points, referenceDistance)!;
      const count = Math.max(1, item.pelletCount);
      return {
        item,
        index,
        count,
        point,
        values: {
          shortName: item.shortName,
          speedMps: point.speedMps,
          energyJ: point.energyJ,
          payloadEnergy: point.energyJ * count,
          momentumKgms: point.momentumKgms,
          payloadMomentum: point.momentumKgms * count,
          timeS: point.timeS,
          dropM: point.dropM,
          mpbrM: item.mpbrM,
        } as Record<CompareKey, number | string>,
      };
    });
    const { key, ascending } = compareSort;
    const direction = ascending ? 1 : -1;
    return rows.sort((a, b) => {
      const x = a.values[key];
      const y = b.values[key];
      if (typeof x === 'string' || typeof y === 'string')
        return String(x).localeCompare(String(y)) * direction;
      return (x - y) * direction;
    });
  }, [result, referenceDistance, compareSort]);
  const sortCompare = (key: CompareKey) =>
    setCompareSort((current) =>
      current.key === key
        ? { key, ascending: !current.ascending }
        : { key, ascending: key === 'shortName' },
    );

  const set =
    <K extends keyof Inputs>(key: K) =>
    (value: number) =>
      setInputs((v) => ({ ...v, [key]: value }));
  const openNewCustom = () => {
    if (customLoads.length >= 3) {
      setError('Up to 3 custom projectiles may be active at once.');
      return;
    }
    setEditingCustom(null);
    setCustom(blankCustom);
    setCustomOpen(true);
  };
  const openEditCustom = () => {
    const index = selected - 6;
    if (index >= 0 && customLoads[index]) {
      setEditingCustom(index);
      setCustom(customLoads[index]);
      setCustomOpen(true);
    }
  };
  const customErrors = useMemo(() => validateCustomLoad(custom), [custom]);
  const addCustom = () => {
    if (customErrors.length) return;
    const usedNames = new Set(
      [
        ...(result?.loads.slice(0, 6).map((item) => item.shortName) ?? []),
        ...customLoads.filter((_, index) => index !== editingCustom).map((item) => item.name),
      ].map((name) => name.trim().toLowerCase()),
    );
    const baseName = custom.name.trim() || 'Custom';
    let uniqueName = baseName;
    let suffix = 2;
    while (usedNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${baseName} (${suffix})`;
      suffix += 1;
    }
    const finalizedCustom = { ...custom, name: uniqueName };
    const next =
      editingCustom === null
        ? [...customLoads, finalizedCustom]
        : customLoads.map((load, index) => (index === editingCustom ? finalizedCustom : load));
    setCustomLoads(next);
    setCustomOpen(false);
    setSelected(6 + (editingCustom ?? next.length - 1));
  };
  const removeCustom = () => {
    const index = selected - 6;
    if (index < 0) return;
    setCustomLoads((loads) => loads.filter((_, i) => i !== index));
    setSelected(0);
  };
  const dist = (m: number) => (imperial ? m * M_TO_YD : m),
    velocity = (v: number) => (imperial ? v * MPS_TO_FPS : v),
    energy = (e: number) => (imperial ? e * J_TO_FTLB : e),
    momentum = (value: number) => (imperial ? value * KGMS_TO_LBFTS : value),
    drop = (m: number) => (imperial ? m / IN_TO_M : m * 100);

  const resetAtmosphere = () =>
    setInputs((current) => ({
      ...current,
      temperatureC: 15,
      pressureHpa: 1013.25,
      altitudeM: 0,
      humidityPercent: 50,
      headwindMps: 0,
      crosswindMps: 0,
    }));
  const exportCsv = () => {
    if (result) saveCsv(result, inputs, tableStepM, imperial);
  };
  const copySummary = async () => {
    if (!load || !target) return;
    const distUnit = imperial ? 'yd' : 'm';
    const count = Math.max(1, load.pelletCount);
    const lines = [
      `${load.name}`,
      `${firearmLabel(load)} · ${dragDescription(load)}${count > 1 ? ` · ${count} pellets` : ''}`,
      `Range: ${formatNumber(dist(referenceDistance), 1)} ${distUnit}`,
      `Velocity: ${formatNumber(velocity(target.speedMps), 1)} ${imperial ? 'ft/s' : 'm/s'}`,
      `Mach: ${formatNumber(target.mach, 2)}`,
      `Energy/${projectileLabel(load)}: ${formatNumber(energy(target.energyJ), 0)} ${imperial ? 'ft·lbf' : 'J'}`,
      ...(count > 1
        ? [
            `Payload energy (${count}×): ${formatNumber(energy(target.energyJ * count), 0)} ${imperial ? 'ft·lbf' : 'J'}`,
          ]
        : []),
      `Momentum/${projectileLabel(load)}: ${formatNumber(momentum(target.momentumKgms), 2)} ${imperial ? 'lb·ft/s' : 'kg·m/s'}`,
      `Drop: ${formatNumber(drop(target.dropM), 1)} ${imperial ? 'in' : 'cm'}`,
      `Wind drift: ${formatNumber(drop(target.windDriftM), 2)} ${imperial ? 'in' : 'cm'}`,
      `Spin drift: ${formatNumber(drop(target.spinDriftM), 2)} ${imperial ? 'in' : 'cm'}`,
      `Total windage: ${formatNumber(drop(target.windDriftM + target.spinDriftM), 2)} ${imperial ? 'in' : 'cm'}`,
      `Sight path: ${formatNumber(drop(targetPathM), 1)} ${imperial ? 'in' : 'cm'} (zero ${formatNumber(dist(targetGeom?.zeroM ?? 0), 0)} ${imperial ? 'yd' : 'm'})`,
      `Holdover: ${formatNumber(holdoverMoa(targetPathM, referenceDistance), 1)} MOA / ${formatNumber(holdoverMil(targetPathM, referenceDistance), 2)} mil`,
      `Time of flight: ${formatNumber(target.timeS, 3)} s`,
      `MPBR: ${formatNumber(dist(load.mpbrM), 1)} ${distUnit} · optimal zero ${formatNumber(dist(load.zeroM), 1)} ${distUnit}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Clipboard access was blocked by the system.');
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          resetAtmosphere();
        } else if (event.key.toLowerCase() === 'e') {
          event.preventDefault();
          exportCsv();
        }
        return;
      }
      // Unmodified shortcuts must not hijack typing in form controls.
      const node = event.target as HTMLElement | null;
      if (node && /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) return;
      const loadCount = result?.loads.length ?? 0;
      if ((event.key === 'ArrowDown' || event.key === ']') && loadCount) {
        event.preventDefault();
        setSelected((current) => (current + 1) % loadCount);
      } else if ((event.key === 'ArrowUp' || event.key === '[') && loadCount) {
        event.preventDefault();
        setSelected((current) => (current - 1 + loadCount) % loadCount);
      } else if (event.key >= '1' && event.key <= '4') {
        event.preventDefault();
        setTab(TABS[Number(event.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unsubscribers = window.ballistics
      ? [
          window.ballistics.onAddCustom(openNewCustom),
          window.ballistics.onOpenHelp(() => setTab('notes')),
          window.ballistics.onExportCsv(exportCsv),
          window.ballistics.onResetAtmosphere(resetAtmosphere),
          window.ballistics.onToggleUnits(() =>
            setUnits((current) => (current === 'imperial' ? 'metric' : 'imperial')),
          ),
          window.ballistics.onToggleTheme(() =>
            setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
          ),
        ]
      : [];
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [result, inputs, tableStepM, imperial]);

  const statusSelectedLoad = result?.loads[statusLoad];
  const statusPoint = statusSelectedLoad
    ? pointAt(statusSelectedLoad.points, referenceDistance)
    : undefined;
  const statusText = (() => {
    if (!result) return 'Waiting for the C++ engine.';
    if (statusMode === 'atmosphere') {
      return `Density ${result.atmosphere.densityKgM3.toFixed(4)} kg/m³ · viscosity ${result.atmosphere.viscosityPaS.toExponential(3)} Pa·s · sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s · integrated to ${formatNumber(dist(inputs.distanceM), 0)} ${imperial ? 'yd' : 'm'}`;
    }
    if (!statusSelectedLoad || !statusPoint) return 'Select an available load.';

    const count = Math.max(1, statusSelectedLoad.pelletCount);
    const distanceText = `${formatNumber(dist(referenceDistance), 1)} ${imperial ? 'yd' : 'm'}`;
    const energyUnit = imperial ? 'ft·lbf' : 'J';
    const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
    if (statusMode === 'summary') {
      const payload =
        count > 1
          ? ` · payload (${count}×): ${formatNumber(energy(statusPoint.energyJ * count), 0)} ${energyUnit}, ${formatNumber(momentum(statusPoint.momentumKgms * count), 2)} ${momentumUnit}`
          : '';
      return `${statusSelectedLoad.shortName} at ${distanceText}: ${formatNumber(velocity(statusPoint.speedMps), 0)} ${imperial ? 'ft/s' : 'm/s'} · per ${projectileLabel(statusSelectedLoad)} ${formatNumber(energy(statusPoint.energyJ), 0)} ${energyUnit}, ${formatNumber(momentum(statusPoint.momentumKgms), 2)} ${momentumUnit}${payload} · TOF ${statusPoint.timeS.toFixed(3)} s · drop ${formatNumber(drop(statusPoint.dropM), 1)} ${imperial ? 'in' : 'cm'}`;
    }
    if (statusMode === 'retainedEnergy') {
      const muzzleEnergy = statusSelectedLoad.points[0]?.energyJ ?? 0;
      const retained = muzzleEnergy ? (statusPoint.energyJ / muzzleEnergy) * 100 : 0;
      return `${statusSelectedLoad.shortName} at ${distanceText}: ${retained.toFixed(1)}% retained · per ${projectileLabel(statusSelectedLoad)} ${formatNumber(energy(statusPoint.energyJ), 0)} ${energyUnit} · payload ${formatNumber(energy(statusPoint.energyJ * count), 0)} ${energyUnit} from ${formatNumber(energy(muzzleEnergy * count), 0)} ${energyUnit}`;
    }
    if (statusMode === 'mach') {
      const regime =
        statusPoint.mach > 1.2 ? 'supersonic' : statusPoint.mach >= 0.8 ? 'transonic' : 'subsonic';
      return `${statusSelectedLoad.shortName} at ${distanceText}: Mach ${statusPoint.mach.toFixed(3)} (${regime}) · local sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s`;
    }
    if (statusMode === 'windage') {
      const driftUnit = imperial ? 'in' : 'cm';
      const total = statusPoint.windDriftM + statusPoint.spinDriftM;
      const side = (value: number) => (value >= 0 ? 'right' : 'left');
      return `${statusSelectedLoad.shortName} at ${distanceText}: wind drift ${formatNumber(drop(statusPoint.windDriftM), 1)} ${driftUnit} ${side(statusPoint.windDriftM)} · spin drift ${formatNumber(drop(statusPoint.spinDriftM), 1)} ${driftUnit} ${side(statusPoint.spinDriftM)} · total windage ${formatNumber(drop(total), 1)} ${driftUnit} ${side(total)} · crosswind ${formatNumber(imperial ? inputs.crosswindMps / 0.44704 : inputs.crosswindMps, 1)} ${imperial ? 'mph' : 'm/s'}`;
    }
    if (statusMode === 'holdover') {
      const geom = holdGeomFor(statusSelectedLoad);
      const path = sightPathM(statusPoint.dropM, referenceDistance, geom);
      const driftUnit = imperial ? 'in' : 'cm';
      const place = path >= 0 ? 'above' : 'below';
      return `${statusSelectedLoad.shortName} at ${distanceText} (zero ${formatNumber(dist(geom.zeroM), 0)} ${imperial ? 'yd' : 'm'}): path ${formatNumber(drop(path), 1)} ${driftUnit} ${place} sight line · holdover ${formatNumber(holdoverMoa(path, referenceDistance), 1)} MOA / ${formatNumber(holdoverMil(path, referenceDistance), 2)} mil`;
    }
    if (statusMode === 'sphere') {
      if (statusSelectedLoad.dragModel !== 'Sphere') {
        return `${statusSelectedLoad.shortName} uses ${statusSelectedLoad.dragModel}; explicit Reynolds-dependent Cd is available only for Sphere loads.`;
      }
      return `${statusSelectedLoad.shortName} at ${distanceText}: Cd ${statusPoint.cd?.toFixed(4) ?? '—'} · Re ${statusPoint.reynolds === undefined ? '—' : formatNumber(statusPoint.reynolds, 0)} · Mach ${statusPoint.mach.toFixed(3)} · diameter ${(statusSelectedLoad.sphereDiameterM * 1000).toFixed(3)} mm · ${(statusSelectedLoad.massKg / GR_TO_KG).toFixed(2)} gr per pellet`;
    }
    const sightHeight =
      statusSelectedLoad.firearmGroup === 'rifle' ? inputs.rifleSightM : inputs.shotgunSightM;
    return `${statusSelectedLoad.shortName}: optimal zero ${formatNumber(dist(statusSelectedLoad.zeroM), 0)} ${imperial ? 'yd' : 'm'} · MPBR ${formatNumber(dist(statusSelectedLoad.mpbrM), 0)} ${imperial ? 'yd' : 'm'} · sight height ${drop(sightHeight).toFixed(2)} ${imperial ? 'in' : 'cm'}`;
  })();
  const engineState = busy
    ? 'Calculating'
    : validationErrors.length
      ? 'Check inputs'
      : error && !result
        ? 'Engine unavailable'
        : 'Ready';
  const engineClass = busy ? 'busy' : (error && !result) || validationErrors.length ? 'err' : '';
  return (
    <div className="app" data-theme={theme}>
      <div className="appbar">
        <span className="app-name">Ballistics Workbench</span>
        <span className="tsep" />
        <button className="tbtn" onClick={openNewCustom}>
          New load…
        </button>
        <button className="tbtn" disabled={selected < 6} onClick={openEditCustom}>
          Edit load…
        </button>
        <button className="tbtn danger" disabled={selected < 6} onClick={removeCustom}>
          Remove load
        </button>
        <span className="tsep" />
        <button
          className="tbtn"
          disabled={!load}
          onClick={copySummary}
          title="Copy the selected load's values at the reference distance"
        >
          {copied ? 'Copied' : 'Copy summary'}
        </button>
        <button className="tbtn" disabled={!result} onClick={exportCsv}>
          Export CSV
        </button>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Units">
          <button className={imperial ? '' : 'active'} onClick={() => setUnits('metric')}>
            Metric
          </button>
          <button className={imperial ? 'active' : ''} onClick={() => setUnits('imperial')}>
            Imperial
          </button>
        </div>
        <div className="seg" role="group" aria-label="Theme">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
            Light
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
            Dark
          </button>
        </div>
      </div>
      <main>
        <aside>
          <div className="groupbox">
            <div className="section-title">
              <span>Environment</span>
              <small>{imperial ? 'US' : 'SI'}</small>
            </div>
            <div className="fields">
              <Field
                label="Range"
                value={dist(inputs.distanceM)}
                unit={imperial ? 'yd' : 'm'}
                error={fieldErrs.distanceM}
                wide
                onChange={(v) => set('distanceM')(imperial ? v / M_TO_YD : v)}
              />
              <Field
                label="Temperature"
                value={imperial ? (inputs.temperatureC * 9) / 5 + 32 : inputs.temperatureC}
                unit={imperial ? '°F' : '°C'}
                error={fieldErrs.temperatureC}
                onChange={(v) => set('temperatureC')(imperial ? ((v - 32) * 5) / 9 : v)}
              />
              <Field
                label="Station pressure"
                value={imperial ? inputs.pressureHpa / 33.8639 : inputs.pressureHpa}
                unit={imperial ? 'inHg' : 'hPa'}
                error={fieldErrs.pressureHpa}
                onChange={(v) => {
                  const pressure = imperial ? v * 33.8639 : v;
                  setInputs((current) => ({
                    ...current,
                    pressureHpa: pressure,
                    altitudeM: pressureToAltitude(pressure),
                  }));
                }}
              />
              <Field
                label="Altitude"
                value={imperial ? inputs.altitudeM / 0.3048 : inputs.altitudeM}
                unit={imperial ? 'ft' : 'm'}
                error={fieldErrs.altitudeM}
                onChange={(v) => {
                  const altitude = imperial ? v * 0.3048 : v;
                  setInputs((current) => ({
                    ...current,
                    altitudeM: altitude,
                    pressureHpa: altitudeToPressure(altitude),
                  }));
                }}
              />
              <Field
                label="Humidity"
                value={inputs.humidityPercent}
                unit="%"
                error={fieldErrs.humidityPercent}
                onChange={set('humidityPercent')}
              />
              <Field
                label="Headwind"
                value={imperial ? inputs.headwindMps / 0.44704 : inputs.headwindMps}
                unit={imperial ? 'mph' : 'm/s'}
                error={fieldErrs.headwindMps}
                onChange={(v) => set('headwindMps')(imperial ? v * 0.44704 : v)}
              />
              <Field
                label="Crosswind (→ right)"
                value={imperial ? inputs.crosswindMps / 0.44704 : inputs.crosswindMps}
                unit={imperial ? 'mph' : 'm/s'}
                error={fieldErrs.crosswindMps}
                onChange={(v) => set('crosswindMps')(imperial ? v * 0.44704 : v)}
              />
            </div>
            <label className="range-control">
              <span>Integration range</span>
              <input
                type="range"
                min="0"
                max={imperial ? 2000 * M_TO_YD : 2000}
                step="1"
                value={dist(inputs.distanceM)}
                onChange={(event) =>
                  set('distanceM')(
                    imperial ? Number(event.target.value) / M_TO_YD : Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
          <div className="groupbox">
            <div className="section-title">
              <span>Firearm profile</span>
            </div>
            <div className="fields">
              <Field
                label="Shotgun MV correction"
                value={(inputs.shotgunMvMultiplier - 1) * 100}
                unit="%"
                error={fieldErrs.shotgunMvMultiplier}
                onChange={(v) => set('shotgunMvMultiplier')(1 + v / 100)}
              />
              <Field
                label="Rifle MV correction"
                value={(inputs.rifleMvMultiplier - 1) * 100}
                unit="%"
                error={fieldErrs.rifleMvMultiplier}
                onChange={(v) => set('rifleMvMultiplier')(1 + v / 100)}
              />
              <Field
                label="Rifle twist"
                value={inputs.rifleTwistInches}
                unit="in/turn"
                error={fieldErrs.rifleTwistInches}
                onChange={set('rifleTwistInches')}
              />
              <label className="field">
                <span>Twist direction</span>
                <select
                  value={inputs.twistDirection}
                  onChange={(e) => set('twistDirection')(Number(e.target.value))}
                >
                  <option value={1}>Right-hand</option>
                  <option value={-1}>Left-hand</option>
                </select>
              </label>
            </div>
          </div>
          <div className="groupbox">
            <div className="section-title">
              <span>Zeroing</span>
            </div>
            <div className="fields">
              <Field
                label="Vital zone"
                value={drop(inputs.vitalZoneM)}
                unit={imperial ? 'in' : 'cm'}
                error={fieldErrs.vitalZoneM}
                wide
                onChange={(v) => set('vitalZoneM')(imperial ? v * IN_TO_M : v / 100)}
              />
              <Field
                label="Shotgun sight"
                value={drop(inputs.shotgunSightM)}
                unit={imperial ? 'in' : 'cm'}
                error={fieldErrs.shotgunSightM}
                onChange={(v) => set('shotgunSightM')(imperial ? v * IN_TO_M : v / 100)}
              />
              <Field
                label="Rifle sight"
                value={drop(inputs.rifleSightM)}
                unit={imperial ? 'in' : 'cm'}
                error={fieldErrs.rifleSightM}
                onChange={(v) => set('rifleSightM')(imperial ? v * IN_TO_M : v / 100)}
              />
              <Field
                label="Shotgun zero"
                value={dist(inputs.shotgunZeroM)}
                unit={imperial ? 'yd' : 'm'}
                error={fieldErrs.shotgunZeroM}
                onChange={(v) => set('shotgunZeroM')(imperial ? v / M_TO_YD : v)}
              />
              <Field
                label="Rifle zero"
                value={dist(inputs.rifleZeroM)}
                unit={imperial ? 'yd' : 'm'}
                error={fieldErrs.rifleZeroM}
                onChange={(v) => set('rifleZeroM')(imperial ? v / M_TO_YD : v)}
              />
            </div>
          </div>
          {validationErrors.length > 0 && (
            <div className="validation-summary">
              {validationErrors.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          )}
          <div className="reset-actions">
            <button className="reset-profile" onClick={resetAtmosphere}>
              Reset atmosphere
            </button>
            <button
              className="reset-profile"
              onClick={() => {
                setInputs(defaults);
                setSelected(0);
                setChartDistance(100);
              }}
            >
              Reset all
            </button>
          </div>
        </aside>
        <section className="workspace">
          <nav className="top-tabs">
            {TABS.map((t, index) => (
              <button
                key={t}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
                title={`${TAB_LABELS[t]} (${index + 1})`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </nav>
          <nav className="loads">
            {result?.loads.map((l, i) => (
              <button
                className={i === selected ? 'active' : ''}
                onClick={() => setSelected(i)}
                key={l.shortName}
              >
                <span>
                  {firearmLabel(l)} · {dragDescription(l)}
                  {l.pelletCount > 1 ? ` · ${l.pelletCount}×` : ''}
                </span>
                {l.shortName}
              </button>
            ))}
          </nav>
          <section className="status-readout" aria-label="Configurable status readout">
            <label>
              Status
              <select
                value={statusMode}
                onChange={(event) => setStatusMode(event.target.value as StatusMode)}
              >
                <option value="atmosphere">Atmosphere &amp; integration</option>
                <option value="summary">Selected load summary</option>
                <option value="retainedEnergy">Energy retained</option>
                <option value="mach">Mach &amp; flight regime</option>
                <option value="sphere">Sphere aerodynamics</option>
                <option value="windage">Windage (wind &amp; spin)</option>
                <option value="holdover">Holdover &amp; sight path</option>
                <option value="mpbr">MPBR &amp; zero</option>
              </select>
            </label>
            <label>
              Load
              <select
                value={statusLoad}
                disabled={statusMode === 'atmosphere'}
                onChange={(event) => setStatusLoad(Number(event.target.value))}
              >
                {result?.loads.map((item, index) => (
                  <option value={index} key={item.shortName}>
                    {item.shortName}
                  </option>
                ))}
              </select>
            </label>
            <p>{statusText}</p>
          </section>
          <div className="content">
            {error && <div className="error">{error}</div>}
            {tab === 'overview' && load && (
              <>
                <div className="load-header">
                  <span className="load-title">{load.name}</span>
                  <span className="load-meta">
                    {firearmLabel(load)} · {dragDescription(load)} ·{' '}
                    {load.pelletCount > 1 ? `${load.pelletCount} pellets` : 'single projectile'}
                  </span>
                </div>
                {load.pelletCount > 1 && (
                  <div className="payload-notice">
                    <strong>{load.pelletCount}-pellet payload:</strong> trajectory values describe
                    one pellet. Payload energy and momentum below are arithmetic {load.pelletCount}×
                    totals; they do not model the pellets as one projectile.
                  </div>
                )}
                <div className="readout-grid">
                  <section className="rgroup">
                    <header>Load &amp; muzzle</header>
                    <Row
                      label="Muzzle velocity"
                      value={formatNumber(
                        velocity(load.muzzleVelocityMps ?? load.points[0]?.speedMps ?? 0),
                        1,
                      )}
                      unit={imperial ? 'ft/s' : 'm/s'}
                    />
                    <Row
                      label={load.pelletCount > 1 ? 'Mass / pellet' : 'Projectile mass'}
                      value={
                        imperial
                          ? (load.massKg / GR_TO_KG).toFixed(2)
                          : (load.massKg * 1000).toFixed(3)
                      }
                      unit={imperial ? 'gr' : 'g'}
                    />
                    {load.dragModel === 'Sphere' ? (
                      <Row
                        label="Sphere diameter"
                        value={(
                          (load.sphereDiameterM ?? 0) * (imperial ? 1 / IN_TO_M : 1000)
                        ).toFixed(3)}
                        unit={imperial ? 'in' : 'mm'}
                      />
                    ) : (
                      <Row
                        label="Ballistic coefficient"
                        value={load.ballisticCoefficient?.toFixed(5) ?? '—'}
                        unit={load.dragModel}
                      />
                    )}
                    <Row label="Payload count" value={String(load.pelletCount)} />
                    <Row label="MPBR" value={formatNumber(dist(load.mpbrM), 1)} unit={distUnit} />
                    <Row
                      label="Optimal zero"
                      value={formatNumber(dist(load.zeroM), 1)}
                      unit={distUnit}
                    />
                    <Row label="Source" value={load.bcKind || 'Reynolds sphere model'} wide />
                  </section>
                  <section className="rgroup">
                    <header>
                      State at {formatNumber(dist(referenceDistance), 0)} {distUnit}
                    </header>
                    <Row
                      label="Velocity"
                      value={formatNumber(velocity(target?.speedMps || 0), 1)}
                      unit={imperial ? 'ft/s' : 'm/s'}
                    />
                    <Row label="Mach" value={formatNumber(target?.mach ?? 0, 3)} />
                    <Row
                      label={`Energy / ${projectileLabel(load)}`}
                      value={formatNumber(energy(target?.energyJ || 0), 0)}
                      unit={energyUnit}
                    />
                    {load.pelletCount > 1 && (
                      <Row
                        label={`Payload energy (${load.pelletCount}×)`}
                        value={formatNumber(energy((target?.energyJ || 0) * load.pelletCount), 0)}
                        unit={energyUnit}
                      />
                    )}
                    <Row
                      label={`Momentum / ${projectileLabel(load)}`}
                      value={formatNumber(momentum(target?.momentumKgms || 0), 2)}
                      unit={momentumUnit}
                    />
                    {load.pelletCount > 1 && (
                      <Row
                        label={`Payload momentum (${load.pelletCount}×)`}
                        value={formatNumber(
                          momentum((target?.momentumKgms || 0) * load.pelletCount),
                          2,
                        )}
                        unit={momentumUnit}
                      />
                    )}
                    <Row label="Flight time" value={formatNumber(target?.timeS || 0, 3)} unit="s" />
                  </section>
                  <section className="rgroup">
                    <header>
                      Trajectory at {formatNumber(dist(referenceDistance), 0)} {distUnit}
                    </header>
                    <Row
                      label="Drop"
                      value={formatNumber(drop(target?.dropM || 0), 1)}
                      unit={dropUnit}
                    />
                    <Row
                      label="Wind drift"
                      value={formatNumber(drop(target?.windDriftM || 0), 1)}
                      unit={dropUnit}
                    />
                    <Row
                      label="Spin drift"
                      value={formatNumber(drop(target?.spinDriftM || 0), 2)}
                      unit={dropUnit}
                    />
                    <Row
                      label="Total windage"
                      value={formatNumber(
                        drop((target?.windDriftM || 0) + (target?.spinDriftM || 0)),
                        2,
                      )}
                      unit={dropUnit}
                    />
                    <Row
                      label={`Sight path · zero ${formatNumber(dist(targetGeom?.zeroM ?? 0), 0)} ${distUnit}`}
                      value={formatNumber(drop(targetPathM), 1)}
                      unit={dropUnit}
                    />
                    <Row
                      label="Holdover"
                      value={formatNumber(holdoverMoa(targetPathM, referenceDistance), 1)}
                      unit="MOA"
                    />
                    <Row
                      label="Holdover"
                      value={formatNumber(holdoverMil(targetPathM, referenceDistance), 2)}
                      unit="mil"
                    />
                  </section>
                </div>
                <div className="panel">
                  <div className="panel-head">
                    <h3>Trajectory</h3>
                    <label className="metric-select">
                      Quantity
                      <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                        <option value="speedMps">Velocity</option>
                        <option value="energyJ">Energy per projectile</option>
                        <option value="payloadEnergy">Payload energy</option>
                        <option value="momentumKgms">Momentum per projectile</option>
                        <option value="payloadMomentum">Payload momentum</option>
                        <option value="dropM">Vertical drop</option>
                        <option value="timeS">Time of flight</option>
                        <option value="spinDriftM">Spin drift</option>
                        <option value="windDriftM">Wind drift</option>
                        <option value="windageM">Total windage</option>
                        <option value="sightPathM">Sight path (vs line of sight)</option>
                        <option value="holdoverMoa">Holdover (MOA)</option>
                      </select>
                    </label>
                  </div>
                  <Sparkline
                    loads={result?.loads ?? [load]}
                    selectedLoad={load}
                    metric={metric}
                    units={units}
                    selectedDistance={referenceDistance}
                    onSelectedDistance={setChartDistance}
                    sightHeights={inputs}
                    zeros={inputs}
                  />
                </div>
              </>
            )}
            {tab === 'table' && load && (
              <div className="panel table-panel">
                <div className="panel-head">
                  <h3>
                    {load.shortName} · reference {formatNumber(dist(referenceDistance), 1)}{' '}
                    {imperial ? 'yd' : 'm'}
                  </h3>
                  <label className="step">
                    Step{' '}
                    <select
                      value={tableStep}
                      onChange={(e) => setTableStep(Number(e.target.value))}
                    >
                      {[1, 5, 10, 25, 50, 100].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>{' '}
                    {imperial ? 'yd' : 'm'}
                  </label>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Distance ({imperial ? 'yd' : 'm'})</th>
                        <th>Velocity ({imperial ? 'ft/s' : 'm/s'})</th>
                        <th>
                          Energy/{projectileLabel(load)} ({imperial ? 'ft·lbf' : 'J'})
                        </th>
                        <th>Payload energy ({imperial ? 'ft·lbf' : 'J'})</th>
                        <th>
                          Momentum/{projectileLabel(load)} ({imperial ? 'lb·ft/s' : 'kg·m/s'})
                        </th>
                        <th>Payload momentum ({imperial ? 'lb·ft/s' : 'kg·m/s'})</th>
                        <th>Time (s)</th>
                        <th>Drop ({imperial ? 'in' : 'cm'})</th>
                        <th>Mach</th>
                        <th>Sphere Cd</th>
                        <th>Sphere Reynolds</th>
                        <th>Spin ({imperial ? 'in' : 'cm'})</th>
                        <th>Wind ({imperial ? 'in' : 'cm'})</th>
                        <th>Windage ({imperial ? 'in' : 'cm'})</th>
                        <th>Path ({imperial ? 'in' : 'cm'})</th>
                        <th>Hold (MOA)</th>
                        <th>Hold (mil)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr
                          className={
                            Math.abs(p.distanceM - referenceDistance) <= tableStepM / 2
                              ? 'selected-row'
                              : ''
                          }
                          key={p.distanceM}
                        >
                          <td>{formatNumber(dist(p.distanceM), 1)}</td>
                          <td>{formatNumber(velocity(p.speedMps), 1)}</td>
                          <td>{formatNumber(energy(p.energyJ), 0)}</td>
                          <td>{formatNumber(energy(p.energyJ * load.pelletCount), 0)}</td>
                          <td>{momentum(p.momentumKgms).toFixed(3)}</td>
                          <td>{momentum(p.momentumKgms * load.pelletCount).toFixed(3)}</td>
                          <td>{p.timeS.toFixed(3)}</td>
                          <td>{drop(p.dropM).toFixed(2)}</td>
                          <td>{p.mach.toFixed(3)}</td>
                          <td>{p.cd?.toFixed(3) || '—'}</td>
                          <td>{p.reynolds === undefined ? '—' : formatNumber(p.reynolds, 0)}</td>
                          <td>{drop(p.spinDriftM).toFixed(2)}</td>
                          <td>{drop(p.windDriftM).toFixed(2)}</td>
                          <td>{drop(p.spinDriftM + p.windDriftM).toFixed(2)}</td>
                          {(() => {
                            const path = sightPathM(p.dropM, p.distanceM, targetGeom!);
                            return (
                              <>
                                <td>{drop(path).toFixed(2)}</td>
                                <td>{holdoverMoa(path, p.distanceM).toFixed(1)}</td>
                                <td>{holdoverMil(path, p.distanceM).toFixed(2)}</td>
                              </>
                            );
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {tab === 'compare' && result && (
              <div className="panel compare">
                <span className="eyebrow">
                  ALL LOADS AT {formatNumber(dist(referenceDistance), 0)}{' '}
                  {imperial ? 'YARDS' : 'METRES'} · CLICK A HEADING TO SORT
                </span>
                <div className="table-wrap calculator-table">
                  <table>
                    <thead>
                      <tr>
                        {(
                          [
                            ['shortName', 'Load'],
                            ['speedMps', `Velocity (${imperial ? 'ft/s' : 'm/s'})`],
                            ['energyJ', `Energy/projectile (${imperial ? 'ft·lbf' : 'J'})`],
                            ['payloadEnergy', `Payload energy (${imperial ? 'ft·lbf' : 'J'})`],
                            [
                              'momentumKgms',
                              `Momentum/projectile (${imperial ? 'lb·ft/s' : 'kg·m/s'})`,
                            ],
                            [
                              'payloadMomentum',
                              `Payload momentum (${imperial ? 'lb·ft/s' : 'kg·m/s'})`,
                            ],
                            ['timeS', 'Flight time (s)'],
                            ['dropM', `Drop (${imperial ? 'in' : 'cm'})`],
                            ['mpbrM', `MPBR (${imperial ? 'yd' : 'm'})`],
                          ] as [CompareKey, string][]
                        ).map(([key, label]) => (
                          <th
                            key={key}
                            className={`sortable${compareSort.key === key ? ' sorted' : ''}`}
                            onClick={() => sortCompare(key)}
                            title="Click to sort"
                          >
                            {label}
                            <i>
                              {compareSort.key === key ? (compareSort.ascending ? '▲' : '▼') : ''}
                            </i>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map(({ item, index, count, point }) => (
                        <tr
                          className={index === selected ? 'selected-row' : ''}
                          key={item.shortName}
                          onClick={() => setSelected(index)}
                        >
                          <td>
                            <strong>{item.shortName}</strong>
                            <small>
                              {firearmLabel(item)} · {dragDescription(item)}
                              {count > 1 ? ` · ${count} pellets` : ''}
                            </small>
                          </td>
                          <td>{formatNumber(velocity(point.speedMps), 1)}</td>
                          <td>{formatNumber(energy(point.energyJ), 0)}</td>
                          <td>{formatNumber(energy(point.energyJ * count), 0)}</td>
                          <td>{formatNumber(momentum(point.momentumKgms), 3)}</td>
                          <td>{formatNumber(momentum(point.momentumKgms * count), 3)}</td>
                          <td>{formatNumber(point.timeS, 3)}</td>
                          <td>{formatNumber(drop(point.dropM), 2)}</td>
                          <td>{formatNumber(dist(item.mpbrM), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {tab === 'notes' && (
              <div className="panel notes">
                <HelpNotes />
              </div>
            )}
          </div>
        </section>
      </main>
      <div className="statusbar">
        <span className="seg-item">
          <i className={`ind ${engineClass}`} />
          {engineState}
        </span>
        <span className="seg-item">
          <span className="lab">ρ</span>
          <b>{result ? `${result.atmosphere.densityKgM3.toFixed(4)} kg/m³` : '—'}</b>
        </span>
        <span className="seg-item">
          <span className="lab">a</span>
          <b>{result ? `${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s` : '—'}</b>
        </span>
        <span className="seg-item grow">
          <span className="lab">load</span>
          <b>{load ? load.shortName : '—'}</b>
        </span>
        <span className="seg-item">
          <span className="lab">ref</span>
          <b>
            {formatNumber(dist(referenceDistance), 1)} {imperial ? 'yd' : 'm'}
          </b>
        </span>
        <span className="seg-item">
          <span className="lab">range</span>
          <b>
            {formatNumber(dist(inputs.distanceM), 0)} {imperial ? 'yd' : 'm'}
          </b>
        </span>
        <span className="seg-item">{imperial ? 'US' : 'SI'}</span>
      </div>
      {customOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCustomOpen(false);
          }}
        >
          <section className="modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">USER-DEFINED BALLISTIC MODEL</span>
                <h2>Custom projectile</h2>
              </div>
              <button onClick={() => setCustomOpen(false)}>×</button>
            </div>
            <div className="modal-grid">
              <label>
                Name
                <input
                  value={custom.name}
                  onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                />
              </label>
              <label>
                Drag model
                <select
                  value={custom.drag}
                  onChange={(e) => setCustom({ ...custom, drag: e.target.value })}
                >
                  <option>G1</option>
                  <option>G7</option>
                  <option>Sphere</option>
                </select>
              </label>
              <label>
                Firearm profile
                <select
                  value={custom.group}
                  onChange={(e) => setCustom({ ...custom, group: e.target.value })}
                >
                  <option value="shotgun">Shotgun</option>
                  <option value="rifle">Rifle</option>
                </select>
              </label>
              <label>
                Muzzle velocity ({imperial ? 'ft/s' : 'm/s'})
                <input
                  type="number"
                  value={imperial ? custom.mv * MPS_TO_FPS : custom.mv}
                  onChange={(e) =>
                    setCustom({
                      ...custom,
                      mv: imperial ? Number(e.target.value) / MPS_TO_FPS : Number(e.target.value),
                    })
                  }
                />
              </label>
              {custom.drag === 'Sphere' ? (
                <>
                  <label>
                    Sphere diameter ({imperial ? 'in' : 'mm'})
                    <input
                      type="number"
                      value={imperial ? custom.sphereMm / 25.4 : custom.sphereMm}
                      onChange={(e) =>
                        setCustom({
                          ...custom,
                          sphereMm: imperial
                            ? Number(e.target.value) * 25.4
                            : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Material density (kg/m³)
                    <input
                      type="number"
                      value={custom.density}
                      onChange={(e) => setCustom({ ...custom, density: Number(e.target.value) })}
                    />
                  </label>
                  <p className="modal-note">
                    Derived mass per pellet:{' '}
                    {imperial
                      ? `${((custom.density * Math.PI * Math.pow(custom.sphereMm / 1000, 3)) / 6 / GR_TO_KG).toFixed(2)} gr`
                      : `${(((custom.density * Math.PI * Math.pow(custom.sphereMm / 1000, 3)) / 6) * 1000).toFixed(3)} g`}
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Projectile mass ({imperial ? 'gr' : 'g'})
                    <input
                      type="number"
                      value={imperial ? custom.massG / (GR_TO_KG * 1000) : custom.massG}
                      onChange={(e) =>
                        setCustom({
                          ...custom,
                          massG: imperial
                            ? Number(e.target.value) * GR_TO_KG * 1000
                            : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Ballistic coefficient
                    <input
                      type="number"
                      step="0.001"
                      value={custom.bc}
                      onChange={(e) => setCustom({ ...custom, bc: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
              <label>
                Projectiles / pellets in payload
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={custom.count}
                  onChange={(e) => setCustom({ ...custom, count: Number(e.target.value) })}
                />
              </label>
              {custom.group === 'rifle' && (
                <>
                  <label>
                    Bullet length (in)
                    <input
                      type="number"
                      value={custom.length}
                      onChange={(e) => setCustom({ ...custom, length: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Bullet diameter (in)
                    <input
                      type="number"
                      value={custom.diameter}
                      onChange={(e) => setCustom({ ...custom, diameter: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Twist override (in)
                    <input
                      type="number"
                      value={custom.twist}
                      onChange={(e) => setCustom({ ...custom, twist: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
            </div>
            {custom.drag === 'Sphere' && (
              <p className="modal-explanation">
                Sphere mass is derived from diameter and density; the projectile-mass and BC fields
                are not used. Payload totals equal one-pellet values × count.
              </p>
            )}
            {!!customErrors.length && (
              <div className="validation-summary">
                {customErrors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setCustomOpen(false)}>Cancel</button>
              <button className="primary" disabled={!!customErrors.length} onClick={addCustom}>
                {editingCustom === null ? 'Add custom load' : 'Save custom load'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
