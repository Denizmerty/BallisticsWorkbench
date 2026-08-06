import { useEffect, useMemo, useState } from 'react';
import type { CustomDraft, Inputs, Metric, Point, Result, UnitSystem } from './types';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './lib/units';
import { altitudeToPressure, pressureToAltitude } from './lib/atmosphere';
import { validateCustomLoad, validateInputs } from './lib/validation';
import { dragDescription, firearmLabel, projectileLabel } from './lib/labels';
import { calculateAll } from './lib/calculate';
import { saveCsv } from './lib/csv';
import { pointAt } from './lib/trajectory';
import { Field } from './components/Field';
import { Sparkline } from './components/Sparkline';
import { HelpNotes } from './components/HelpNotes';

type Tab = 'overview' | 'table' | 'compare' | 'notes';
type Theme = 'light' | 'dark';
type StatusMode = 'atmosphere' | 'summary' | 'retainedEnergy' | 'mach' | 'sphere' | 'mpbr';

const defaults: Inputs = {
  distanceM: 100,
  temperatureC: 15,
  pressureHpa: 1013.25,
  humidityPercent: 50,
  altitudeM: 0,
  headwindMps: 0,
  vitalZoneM: 0.15,
  shotgunSightM: 0.025,
  rifleSightM: 0.04,
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
    [tab, setTab] = useState<Tab>('overview'),
    [units, setUnits] = useState<UnitSystem>(() =>
      localStorage.getItem('bw.units') === 'imperial' ? 'imperial' : 'metric',
    ),
    [theme, setTheme] = useState<Theme>(() =>
      localStorage.getItem('bw.theme') === 'dark' ? 'dark' : 'light',
    ),
    [statusMode, setStatusMode] = useState<StatusMode>('atmosphere'),
    [statusLoad, setStatusLoad] = useState(0),
    [tableStep, setTableStep] = useState(25),
    [chartDistance, setChartDistance] = useState(100);
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
    localStorage.setItem('bw.customLoads', JSON.stringify(customLoads));
  }, [customLoads]);
  const validationErrors = useMemo(() => validateInputs(inputs), [inputs]);
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
    }));
  const exportCsv = () => {
    if (result) saveCsv(result, inputs, tableStepM, imperial);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        resetAtmosphere();
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        exportCsv();
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
      return `Density ${result.atmosphere.densityKgM3.toFixed(4)} kg/m³ · viscosity ${result.atmosphere.viscosityPaS.toExponential(3)} Pa·s · sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s · integrated to ${dist(inputs.distanceM).toFixed(0)} ${imperial ? 'yd' : 'm'}`;
    }
    if (!statusSelectedLoad || !statusPoint) return 'Select an available load.';

    const count = Math.max(1, statusSelectedLoad.pelletCount);
    const distanceText = `${dist(referenceDistance).toFixed(1)} ${imperial ? 'yd' : 'm'}`;
    const energyUnit = imperial ? 'ft·lbf' : 'J';
    const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
    if (statusMode === 'summary') {
      const payload =
        count > 1
          ? ` · payload (${count}×): ${energy(statusPoint.energyJ * count).toFixed(0)} ${energyUnit}, ${momentum(statusPoint.momentumKgms * count).toFixed(2)} ${momentumUnit}`
          : '';
      return `${statusSelectedLoad.shortName} at ${distanceText}: ${velocity(statusPoint.speedMps).toFixed(0)} ${imperial ? 'ft/s' : 'm/s'} · per ${projectileLabel(statusSelectedLoad)} ${energy(statusPoint.energyJ).toFixed(0)} ${energyUnit}, ${momentum(statusPoint.momentumKgms).toFixed(2)} ${momentumUnit}${payload} · TOF ${statusPoint.timeS.toFixed(3)} s · drop ${drop(statusPoint.dropM).toFixed(1)} ${imperial ? 'in' : 'cm'}`;
    }
    if (statusMode === 'retainedEnergy') {
      const muzzleEnergy = statusSelectedLoad.points[0]?.energyJ ?? 0;
      const retained = muzzleEnergy ? (statusPoint.energyJ / muzzleEnergy) * 100 : 0;
      return `${statusSelectedLoad.shortName} at ${distanceText}: ${retained.toFixed(1)}% retained · per ${projectileLabel(statusSelectedLoad)} ${energy(statusPoint.energyJ).toFixed(0)} ${energyUnit} · payload ${energy(statusPoint.energyJ * count).toFixed(0)} ${energyUnit} from ${energy(muzzleEnergy * count).toFixed(0)} ${energyUnit}`;
    }
    if (statusMode === 'mach') {
      const regime =
        statusPoint.mach > 1.2 ? 'supersonic' : statusPoint.mach >= 0.8 ? 'transonic' : 'subsonic';
      return `${statusSelectedLoad.shortName} at ${distanceText}: Mach ${statusPoint.mach.toFixed(3)} (${regime}) · local sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s`;
    }
    if (statusMode === 'sphere') {
      if (statusSelectedLoad.dragModel !== 'Sphere') {
        return `${statusSelectedLoad.shortName} uses ${statusSelectedLoad.dragModel}; explicit Reynolds-dependent Cd is available only for Sphere loads.`;
      }
      return `${statusSelectedLoad.shortName} at ${distanceText}: Cd ${statusPoint.cd?.toFixed(4) ?? '—'} · Re ${statusPoint.reynolds?.toFixed(0) ?? '—'} · Mach ${statusPoint.mach.toFixed(3)} · diameter ${(statusSelectedLoad.sphereDiameterM * 1000).toFixed(3)} mm · ${(statusSelectedLoad.massKg / GR_TO_KG).toFixed(2)} gr per pellet`;
    }
    const sightHeight =
      statusSelectedLoad.firearmGroup === 'rifle' ? inputs.rifleSightM : inputs.shotgunSightM;
    return `${statusSelectedLoad.shortName}: optimal zero ${dist(statusSelectedLoad.zeroM).toFixed(0)} ${imperial ? 'yd' : 'm'} · MPBR ${dist(statusSelectedLoad.mpbrM).toFixed(0)} ${imperial ? 'yd' : 'm'} · sight height ${drop(sightHeight).toFixed(2)} ${imperial ? 'in' : 'cm'}`;
  })();
  return (
    <div className="app" data-theme={theme}>
      <header>
        <div className="brand">
          <span className="mark">BW</span>
          <div>
            <h1>Ballistics Workbench</h1>
            <p>External trajectory calculator</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="unit-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle dark/light theme"
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button
            className="unit-toggle"
            onClick={() => setUnits(imperial ? 'metric' : 'imperial')}
          >
            {imperial ? 'Imperial' : 'Metric'}
          </button>
          <div
            className={`engine ${(error && !result) || validationErrors.length ? 'offline' : ''}`}
          >
            <i className={busy ? 'pulse' : ''} />
            {busy
              ? 'Calculating'
              : validationErrors.length
                ? 'Check inputs'
                : error && !result
                  ? 'Engine unavailable'
                  : 'Engine Ready'}
          </div>
        </div>
      </header>
      <main>
        <aside>
          <div className="section-title">
            <span>Environment</span>
            <small>{imperial ? 'US' : 'SI'}</small>
          </div>
          <div className="fields">
            <Field
              label="Range"
              value={dist(inputs.distanceM)}
              unit={imperial ? 'yd' : 'm'}
              onChange={(v) => set('distanceM')(imperial ? v / M_TO_YD : v)}
            />
            <Field
              label="Temperature"
              value={imperial ? (inputs.temperatureC * 9) / 5 + 32 : inputs.temperatureC}
              unit={imperial ? '°F' : '°C'}
              onChange={(v) => set('temperatureC')(imperial ? ((v - 32) * 5) / 9 : v)}
            />
            <Field
              label="Station pressure"
              value={imperial ? inputs.pressureHpa / 33.8639 : inputs.pressureHpa}
              unit={imperial ? 'inHg' : 'hPa'}
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
              onChange={set('humidityPercent')}
            />
            <Field
              label="Headwind"
              value={imperial ? inputs.headwindMps / 0.44704 : inputs.headwindMps}
              unit={imperial ? 'mph' : 'm/s'}
              onChange={(v) => set('headwindMps')(imperial ? v * 0.44704 : v)}
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
          <div className="section-title">
            <span>Firearm profiles</span>
          </div>
          <div className="fields">
            <Field
              label="Shotgun MV correction"
              value={(inputs.shotgunMvMultiplier - 1) * 100}
              unit="%"
              onChange={(v) => set('shotgunMvMultiplier')(1 + v / 100)}
            />
            <Field
              label="Rifle MV correction"
              value={(inputs.rifleMvMultiplier - 1) * 100}
              unit="%"
              onChange={(v) => set('rifleMvMultiplier')(1 + v / 100)}
            />
            <Field
              label="Rifle twist"
              value={inputs.rifleTwistInches}
              unit="in/turn"
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
          <div className="section-title">
            <span>Zeroing</span>
          </div>
          <div className="fields">
            <Field
              label="Vital zone"
              value={drop(inputs.vitalZoneM)}
              unit={imperial ? 'in' : 'cm'}
              onChange={(v) => set('vitalZoneM')(imperial ? v * IN_TO_M : v / 100)}
            />
            <Field
              label="Shotgun sight"
              value={drop(inputs.shotgunSightM)}
              unit={imperial ? 'in' : 'cm'}
              onChange={(v) => set('shotgunSightM')(imperial ? v * IN_TO_M : v / 100)}
            />
            <Field
              label="Rifle sight"
              value={drop(inputs.rifleSightM)}
              unit={imperial ? 'in' : 'cm'}
              onChange={(v) => set('rifleSightM')(imperial ? v * IN_TO_M : v / 100)}
            />
          </div>
          {validationErrors.length > 0 && (
            <div className="validation-summary">
              {validationErrors.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          )}
          {result && (
            <div className="air">
              <span>
                Air density <b>{result.atmosphere.densityKgM3.toFixed(4)} kg/m³</b>
              </span>
              <span>
                Speed of sound <b>{result.atmosphere.speedOfSoundMps.toFixed(1)} m/s</b>
              </span>
            </div>
          )}
          <div className="reset-actions">
            <button className="reset-profile" onClick={resetAtmosphere}>
              Reset atmosphere (Ctrl+R)
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
            <div>
              {(['overview', 'table', 'compare', 'notes'] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'table'
                    ? 'Range table'
                    : t === 'compare'
                      ? 'All-load calculator'
                      : t === 'notes'
                        ? 'Help'
                        : 'Overview'}
                </button>
              ))}
            </div>
            <div className="tab-actions">
              {selected >= 6 && (
                <button className="export" onClick={openEditCustom}>
                  Edit selected
                </button>
              )}
              <button className="export" onClick={openNewCustom}>
                + Custom load
              </button>
              {selected >= 6 && (
                <button className="export danger" onClick={removeCustom}>
                  Remove selected
                </button>
              )}
              <button className="export" disabled={!result} onClick={exportCsv}>
                Export CSV (Ctrl+E)
              </button>
            </div>
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
          {error && <div className="error">{error}</div>}
          {tab === 'overview' && load && (
            <>
              <div className="hero">
                <div>
                  <span className="eyebrow">
                    FIREARM PROFILE: {firearmLabel(load).toUpperCase()} · REFERENCE DRAG:{' '}
                    {dragDescription(load).toUpperCase()} · PAYLOAD:{' '}
                    {load.pelletCount > 1 ? `${load.pelletCount} PELLETS` : 'ONE PROJECTILE'}
                  </span>
                  <h2>{load.name}</h2>
                </div>
                <div className="stat primary">
                  <small>MPBR</small>
                  <strong>{dist(load.mpbrM).toFixed(1)}</strong>
                  <span>{imperial ? 'yards' : 'metres'}</span>
                </div>
                <div className="stat">
                  <small>Optimal zero</small>
                  <strong>{dist(load.zeroM).toFixed(1)}</strong>
                  <span>{imperial ? 'yards' : 'metres'}</span>
                </div>
              </div>
              <dl className="load-specs">
                <div>
                  <dt>Launch velocity</dt>
                  <dd>
                    {velocity(load.muzzleVelocityMps ?? load.points[0]?.speedMps ?? 0).toFixed(1)}{' '}
                    {imperial ? 'ft/s' : 'm/s'}
                  </dd>
                </div>
                <div>
                  <dt>{load.pelletCount > 1 ? 'Mass per pellet' : 'Projectile mass'}</dt>
                  <dd>
                    {imperial
                      ? `${(load.massKg / GR_TO_KG).toFixed(2)} gr`
                      : `${(load.massKg * 1000).toFixed(3)} g`}
                  </dd>
                </div>
                <div>
                  <dt>Drag data</dt>
                  <dd>
                    {load.dragModel === 'Sphere'
                      ? `${((load.sphereDiameterM ?? 0) * (imperial ? 1 / IN_TO_M : 1000)).toFixed(3)} ${imperial ? 'in diameter' : 'mm diameter'}`
                      : `${load.dragModel} BC ${load.ballisticCoefficient?.toFixed(5) ?? '—'}`}
                  </dd>
                </div>
                <div>
                  <dt>Source / calibration</dt>
                  <dd>{load.bcKind || 'Reynolds-dependent sphere model'}</dd>
                </div>
              </dl>
              {load.pelletCount > 1 && (
                <div className="payload-notice">
                  <strong>{load.pelletCount}-pellet payload:</strong> trajectory values describe one
                  pellet. Payload energy and momentum below are arithmetic {load.pelletCount}×
                  totals; they do not model the pellets as one projectile.
                </div>
              )}
              <div className="cards">
                <article>
                  <small>
                    Velocity at {dist(referenceDistance).toFixed(0)} {imperial ? 'yd' : 'm'}
                  </small>
                  <strong>{velocity(target?.speedMps || 0).toFixed(1)}</strong>
                  <span>{imperial ? 'ft/s' : 'm/s'}</span>
                </article>
                <article>
                  <small>Energy per {projectileLabel(load)}</small>
                  <strong>{energy(target?.energyJ || 0).toFixed(0)}</strong>
                  <span>{imperial ? 'ft·lbf' : 'joules'}</span>
                </article>
                <article>
                  <small>Payload energy ({load.pelletCount}×)</small>
                  <strong>{energy((target?.energyJ || 0) * load.pelletCount).toFixed(0)}</strong>
                  <span>{imperial ? 'ft·lbf' : 'joules'}</span>
                </article>
                <article>
                  <small>Momentum per {projectileLabel(load)}</small>
                  <strong>{momentum(target?.momentumKgms || 0).toFixed(2)}</strong>
                  <span>{imperial ? 'lb·ft/s' : 'kg·m/s'}</span>
                </article>
                <article>
                  <small>Payload momentum ({load.pelletCount}×)</small>
                  <strong>
                    {momentum((target?.momentumKgms || 0) * load.pelletCount).toFixed(2)}
                  </strong>
                  <span>{imperial ? 'lb·ft/s' : 'kg·m/s'}</span>
                </article>
                <article>
                  <small>Drop</small>
                  <strong>{drop(target?.dropM || 0).toFixed(1)}</strong>
                  <span>{imperial ? 'in' : 'cm'}</span>
                </article>
                <article>
                  <small>Mach / flight time</small>
                  <strong>{target?.mach.toFixed(2)}</strong>
                  <span>{((target?.timeS || 0) * 1000).toFixed(0)} ms</span>
                </article>
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">Trajectory chart</span>
                    <h3>Inspect trajectory</h3>
                  </div>
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
                />
              </div>
            </>
          )}
          {tab === 'table' && load && (
            <div className="panel table-panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">NUMERICAL RANGE TABLE</span>
                  <h3>
                    {load.shortName} · selected {dist(referenceDistance).toFixed(1)}{' '}
                    {imperial ? 'yd' : 'm'}
                  </h3>
                </div>
                <label className="step">
                  Step{' '}
                  <select value={tableStep} onChange={(e) => setTableStep(Number(e.target.value))}>
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
                        <td>{dist(p.distanceM).toFixed(1)}</td>
                        <td>{velocity(p.speedMps).toFixed(1)}</td>
                        <td>{energy(p.energyJ).toFixed(0)}</td>
                        <td>{energy(p.energyJ * load.pelletCount).toFixed(0)}</td>
                        <td>{momentum(p.momentumKgms).toFixed(3)}</td>
                        <td>{momentum(p.momentumKgms * load.pelletCount).toFixed(3)}</td>
                        <td>{p.timeS.toFixed(3)}</td>
                        <td>{drop(p.dropM).toFixed(2)}</td>
                        <td>{p.mach.toFixed(3)}</td>
                        <td>{p.cd?.toFixed(3) || '—'}</td>
                        <td>{p.reynolds?.toFixed(0) || '—'}</td>
                        <td>{drop(p.spinDriftM).toFixed(2)}</td>
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
                ALL LOADS AT {dist(referenceDistance).toFixed(0)} {imperial ? 'YARDS' : 'METRES'}
              </span>
              <div className="table-wrap calculator-table">
                <table>
                  <thead>
                    <tr>
                      <th>Load</th>
                      <th>Velocity ({imperial ? 'ft/s' : 'm/s'})</th>
                      <th>Energy/projectile ({imperial ? 'ft·lbf' : 'J'})</th>
                      <th>Payload energy ({imperial ? 'ft·lbf' : 'J'})</th>
                      <th>Momentum/projectile ({imperial ? 'lb·ft/s' : 'kg·m/s'})</th>
                      <th>Payload momentum ({imperial ? 'lb·ft/s' : 'kg·m/s'})</th>
                      <th>Flight time (s)</th>
                      <th>Drop ({imperial ? 'in' : 'cm'})</th>
                      <th>MPBR ({imperial ? 'yd' : 'm'})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.loads.map((item, index) => {
                      const point = pointAt(item.points, referenceDistance)!;
                      const count = Math.max(1, item.pelletCount);
                      return (
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
                          <td>{velocity(point.speedMps).toFixed(1)}</td>
                          <td>{energy(point.energyJ).toFixed(0)}</td>
                          <td>{energy(point.energyJ * count).toFixed(0)}</td>
                          <td>{momentum(point.momentumKgms).toFixed(3)}</td>
                          <td>{momentum(point.momentumKgms * count).toFixed(3)}</td>
                          <td>{point.timeS.toFixed(3)}</td>
                          <td>{drop(point.dropM).toFixed(2)}</td>
                          <td>{dist(item.mpbrM).toFixed(0)}</td>
                        </tr>
                      );
                    })}
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
        </section>
      </main>
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
