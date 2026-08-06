import { useEffect, useMemo, useState } from 'react';
import type { Inputs, Load, Point, Result } from './types';

type UnitSystem = 'metric' | 'imperial';
type Tab = 'overview' | 'table' | 'compare' | 'notes';
type Theme = 'light' | 'dark';
type StatusMode = 'atmosphere' | 'summary' | 'retainedEnergy' | 'mach' | 'sphere' | 'mpbr';
type Metric =
  | 'speedMps'
  | 'energyJ'
  | 'payloadEnergy'
  | 'momentumKgms'
  | 'payloadMomentum'
  | 'dropM'
  | 'timeS'
  | 'spinDriftM';
type CustomDraft = {
  name: string;
  drag: string;
  group: string;
  massG: number;
  mv: number;
  bc: number;
  sphereMm: number;
  density: number;
  count: number;
  length: number;
  diameter: number;
  twist: number;
};
const M_TO_YD = 1.093613298338;
const MPS_TO_FPS = 3.280839895013123;
const J_TO_FTLB = 0.737562149277;
const IN_TO_M = 0.0254;
const GR_TO_KG = 0.00006479891;
const KGMS_TO_LBFTS = MPS_TO_FPS / (GR_TO_KG * 7000);
const CHART_COLORS = [
  '#2f6fda',
  '#b85c18',
  '#218739',
  '#a23f77',
  '#6b57b7',
  '#96720f',
  '#23858c',
  '#b33b3b',
  '#5c718d',
];
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
const altitudeToPressure = (altitudeM: number) =>
  1013.25 *
  Math.pow(1 - (0.0065 * Math.max(0, Math.min(11000, altitudeM))) / 288.15, 5.25578774055217);
const pressureToAltitude = (pressureHpa: number) =>
  (288.15 / 0.0065) *
  (1 - Math.pow(Math.max(226, Math.min(1013.25, pressureHpa)) / 1013.25, 1 / 5.25578774055217));
function validateInputs(value: Inputs) {
  const errors: string[] = [];
  const within = (n: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(n) || n < min || n > max)
      errors.push(`${label} must be between ${min} and ${max}.`);
  };
  within(value.distanceM, 0, 2000, 'Range (m)');
  within(value.temperatureC, -60, 60, 'Temperature (°C)');
  within(value.pressureHpa, 500, 1100, 'Station pressure (hPa)');
  within(value.humidityPercent, 0, 100, 'Humidity (%)');
  within(value.altitudeM, 0, 11000, 'Altitude (m)');
  within(value.headwindMps, -100, 100, 'Headwind (m/s)');
  within(value.vitalZoneM, 0.01, 2, 'Vital zone (m)');
  within(value.shotgunSightM, 0, 0.25, 'Shotgun sight height (m)');
  within(value.rifleSightM, 0, 0.25, 'Rifle sight height (m)');
  within(value.shotgunMvMultiplier, 0.75, 1.25, 'Shotgun velocity multiplier');
  within(value.rifleMvMultiplier, 0.75, 1.25, 'Rifle velocity multiplier');
  within(value.rifleTwistInches, 5, 30, 'Rifle twist (in/turn)');
  return errors;
}

function validateCustomLoad(
  draft: CustomDraft,
  _existing: CustomDraft[],
  _editingIndex: number | null,
) {
  const errors: string[] = [];
  const within = (value: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${label} must be between ${min} and ${max}.`);
    }
  };

  if (!draft.name.trim()) {
    errors.push('Name is required.');
  }
  if (!Number.isFinite(draft.mv) || draft.mv <= 0) {
    errors.push('Muzzle velocity must be positive.');
  }
  within(draft.count, 1, 1000, 'Payload count');
  if (!Number.isInteger(draft.count)) {
    errors.push('Payload count must be a whole number.');
  }

  if (draft.drag === 'Sphere') {
    within(draft.sphereMm, 1, 50, 'Sphere diameter (mm)');
    within(draft.density, 500, 25000, 'Material density (kg/m³)');
  } else {
    if (!Number.isFinite(draft.massG) || draft.massG <= 0) {
      errors.push('Projectile mass must be positive.');
    }
    if (!Number.isFinite(draft.bc) || draft.bc <= 0 || draft.bc > 2) {
      errors.push('Ballistic coefficient must be positive and at most 2.');
    }
  }

  if (draft.group === 'rifle') {
    if (
      !Number.isFinite(draft.length) ||
      !Number.isFinite(draft.diameter) ||
      !Number.isFinite(draft.twist) ||
      draft.length < 0 ||
      draft.diameter < 0 ||
      draft.twist < 0
    ) {
      errors.push('Optional rifle dimensions cannot be negative.');
    }
  }
  return errors;
}

function firearmLabel(load: Load) {
  return load.firearmGroup === 'rifle' ? 'Rifle' : 'Shotgun';
}

function projectileLabel(load: Load) {
  return load.pelletCount > 1 ? 'pellet' : 'projectile';
}

function dragDescription(load: Load) {
  if (load.dragModel === 'Sphere') {
    return 'Reynolds–Mach sphere';
  }
  return `${load.dragModel} reference`;
}

async function calculate(inputs: Inputs): Promise<Result> {
  if (window.ballistics) return window.ballistics.calculate(inputs);
  const query = new URLSearchParams(
    Object.entries(inputs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`/api/calculate?${query}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const customToInputs = (draft: CustomDraft): Partial<Inputs> => ({
  customName: draft.name,
  customDrag: draft.drag,
  customGroup: draft.group,
  customMassKg: draft.massG / 1000,
  customMuzzleVelocityMps: draft.mv,
  customBc: draft.bc,
  customSphereDiameterM: draft.sphereMm / 1000,
  customDensityKgM3: draft.density,
  customPelletCount: draft.count,
  customBulletLengthInches: draft.length,
  customBulletDiameterInches: draft.diameter,
  customTwistInches: draft.twist,
});
async function calculateAll(inputs: Inputs, customLoads: CustomDraft[]): Promise<Result> {
  const {
    customName,
    customDrag,
    customGroup,
    customMassKg,
    customMuzzleVelocityMps,
    customBc,
    customSphereDiameterM,
    customDensityKgM3,
    customPelletCount,
    customBulletLengthInches,
    customBulletDiameterInches,
    customTwistInches,
    ...standardInputs
  } = inputs;
  const base = await calculate(standardInputs);
  if (!customLoads.length) return base;
  const customResults = await Promise.all(
    customLoads.map((draft) => calculate({ ...standardInputs, ...customToInputs(draft) })),
  );
  return {
    ...base,
    loads: [...base.loads, ...customResults.map((result) => result.loads.at(-1)!)],
  };
}

function Field({
  label,
  value,
  unit,
  onChange,
  step = 'any',
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  step?: number | 'any';
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          step={step}
          value={Number(value.toFixed(4))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <b>{unit}</b>
      </div>
    </label>
  );
}
function pointAt(points: Point[], distance: number): Point | undefined {
  if (!points.length) return undefined;
  if (distance <= points[0].distanceM) return points[0];
  if (distance >= points.at(-1)!.distanceM) return points.at(-1);
  const hi = points.findIndex((p) => p.distanceM >= distance),
    a = points[hi - 1],
    b = points[hi],
    f = (distance - a.distanceM) / (b.distanceM - a.distanceM);
  const n = (key: keyof Point) =>
    Number(a[key] ?? 0) + f * (Number(b[key] ?? 0) - Number(a[key] ?? 0));
  return {
    distanceM: distance,
    speedMps: n('speedMps'),
    energyJ: n('energyJ'),
    momentumKgms: n('momentumKgms'),
    timeS: n('timeS'),
    dropM: n('dropM'),
    mach: n('mach'),
    spinDriftM: n('spinDriftM'),
    cd: a.cd === undefined ? undefined : n('cd'),
    reynolds: a.reynolds === undefined ? undefined : n('reynolds'),
  };
}
function Sparkline({
  loads,
  selectedLoad,
  metric,
  units,
  selectedDistance,
  onSelectedDistance,
}: {
  loads: Load[];
  selectedLoad: Load;
  metric: Metric;
  units: UnitSystem;
  selectedDistance: number;
  onSelectedDistance: (distance: number) => void;
}) {
  if (!loads.length || !selectedLoad.points.length) return null;

  const imperial = units === 'imperial';
  const xMax = Math.max(1, ...loads.map((load) => load.points.at(-1)?.distanceM ?? 0));
  const convert = (load: Load, point: Point) =>
    metric === 'speedMps'
      ? point.speedMps * (imperial ? MPS_TO_FPS : 1)
      : metric === 'energyJ'
        ? point.energyJ * (imperial ? J_TO_FTLB : 1)
        : metric === 'payloadEnergy'
          ? point.energyJ * load.pelletCount * (imperial ? J_TO_FTLB : 1)
          : metric === 'momentumKgms'
            ? point.momentumKgms * (imperial ? KGMS_TO_LBFTS : 1)
            : metric === 'payloadMomentum'
              ? point.momentumKgms * load.pelletCount * (imperial ? KGMS_TO_LBFTS : 1)
              : metric === 'dropM'
                ? point.dropM * (imperial ? 1 / IN_TO_M : 100)
                : metric === 'timeS'
                  ? point.timeS
                  : point.spinDriftM * (imperial ? 1 / IN_TO_M : 100);

  const series = loads.map((load, index) => ({
    load,
    color: CHART_COLORS[index % CHART_COLORS.length],
    values: load.points.map((point) => convert(load, point)),
  }));
  const allValues = series.flatMap((item) => item.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const left = 66;
  const right = 980;
  const top = 22;
  const bottom = 252;
  const width = right - left;
  const height = bottom - top;
  const x = (distance: number) => left + (distance / xMax) * width;
  const y = (value: number) => top + ((max - value) / span) * height;
  const selectedM = Math.max(0, Math.min(selectedDistance, xMax));
  const selectedX = x(selectedM);
  const selectedPoint = pointAt(selectedLoad.points, selectedM)!;
  const selectedY = y(convert(selectedLoad, selectedPoint));
  const xUnit = imperial ? 'yd' : 'm';
  const yUnit =
    metric === 'speedMps'
      ? imperial
        ? 'ft/s'
        : 'm/s'
      : metric === 'energyJ' || metric === 'payloadEnergy'
        ? imperial
          ? 'ft·lbf'
          : 'J'
        : metric === 'momentumKgms' || metric === 'payloadMomentum'
          ? imperial
            ? 'lb·ft/s'
            : 'kg·m/s'
          : metric === 'timeS'
            ? 's'
            : imperial
              ? 'in'
              : 'cm';
  const digits = metric === 'dropM' || metric === 'spinDriftM' || metric === 'timeS' ? 3 : 1;
  const choose = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * 1000;
    onSelectedDistance(Math.max(0, Math.min(xMax, ((px - left) / width) * xMax)));
  };
  return (
    <div className="chart-shell">
      <svg
        className="chart"
        viewBox="0 0 1000 285"
        onPointerMove={choose}
        onClick={choose}
        role="img"
        aria-label={`Interactive ${metric} chart`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={`y${f}`}>
            <line
              className="grid"
              x1={left}
              x2={right}
              y1={top + height * f}
              y2={top + height * f}
            />
            <text className="tick" x={left - 10} y={top + height * f + 3} textAnchor="end">
              {(max - span * f).toFixed(
                metric === 'dropM' || metric === 'spinDriftM' || metric === 'timeS' ? 2 : 0,
              )}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={`x${f}`}>
            <line
              className="grid vertical"
              x1={left + width * f}
              x2={left + width * f}
              y1={top}
              y2={bottom}
            />
            <text className="tick" x={left + width * f} y={bottom + 20} textAnchor="middle">
              {(xMax * f * (imperial ? M_TO_YD : 1)).toFixed(0)}
            </text>
          </g>
        ))}
        {series.map(({ load, color, values }) => {
          const path = load.points
            .map((point, index) => `${index ? 'L' : 'M'} ${x(point.distanceM)} ${y(values[index])}`)
            .join(' ');
          return (
            <path
              className={`trace ${load.shortName === selectedLoad.shortName ? 'selected' : ''}`}
              d={path}
              key={load.shortName}
              style={{ stroke: color }}
            />
          );
        })}
        <line className="crosshair" x1={selectedX} x2={selectedX} y1={top} y2={bottom} />
        <circle className="chart-point" cx={selectedX} cy={selectedY} r="5" />
        <text className="axis-label" x={(left + right) / 2} y="282" textAnchor="middle">
          Distance ({xUnit})
        </text>
        <text
          className="axis-label"
          transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yUnit}
        </text>
      </svg>
      <div className="chart-readout">
        <strong>
          {selectedM * (imperial ? M_TO_YD : 1) >= 10
            ? (selectedM * (imperial ? M_TO_YD : 1)).toFixed(1)
            : (selectedM * (imperial ? M_TO_YD : 1)).toFixed(2)}{' '}
          {xUnit}
        </strong>
        <div>
          {series.map(({ load, color }) => {
            const point = pointAt(load.points, selectedM)!;
            return (
              <span
                className={load.shortName === selectedLoad.shortName ? 'selected' : ''}
                key={load.shortName}
              >
                <i style={{ background: color }} />
                {load.shortName}: {convert(load, point).toFixed(digits)} {yUnit}
              </span>
            );
          })}
        </div>
      </div>
      <p className="chart-hint">
        Move across the chart or click to inspect every load at an exact distance. Summary cards
        follow the selected point.
      </p>
    </div>
  );
}
async function saveCsv(result: Result, inputs: Inputs, step: number, imperial: boolean) {
  const distanceUnit = imperial ? 'yd' : 'm';
  const velocityUnit = imperial ? 'ft/s' : 'm/s';
  const energyUnit = imperial ? 'ft·lbf' : 'J';
  const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
  const dropUnit = imperial ? 'in' : 'cm';
  const rows: string[][] = [
    ['# Ballistics Workbench range-table export'],
    [
      '# Atmosphere',
      `temperature=${inputs.temperatureC.toFixed(3)} °C`,
      `station pressure=${inputs.pressureHpa.toFixed(3)} hPa`,
      `humidity=${inputs.humidityPercent.toFixed(3)} %`,
      `altitude=${inputs.altitudeM.toFixed(3)} m`,
      `headwind=${inputs.headwindMps.toFixed(3)} m/s`,
    ],
    [
      '# Derived atmosphere',
      `density=${result.atmosphere.densityKgM3.toFixed(6)} kg/m³`,
      `dynamic viscosity=${result.atmosphere.viscosityPaS.toExponential(6)} Pa·s`,
      `speed of sound=${result.atmosphere.speedOfSoundMps.toFixed(6)} m/s`,
    ],
    [],
    [
      `Distance (${distanceUnit})`,
      'Load',
      'Firearm profile',
      'Drag model',
      'BC kind',
      'Ballistic coefficient',
      `Projectile/pellet mass (${imperial ? 'gr' : 'g'})`,
      `Sphere diameter (${imperial ? 'in' : 'mm'})`,
      'Payload count',
      `Velocity (${velocityUnit})`,
      `Energy/projectile (${energyUnit})`,
      `Payload energy (${energyUnit})`,
      `Momentum/projectile (${momentumUnit})`,
      `Payload momentum (${momentumUnit})`,
      'Flight time (s)',
      `Drop (${dropUnit})`,
      'Mach',
      'Sphere Cd',
      'Sphere Reynolds',
      `Spin drift (${dropUnit})`,
    ],
  ];
  for (
    let d = 0;
    d <= Math.max(...result.loads.map((l) => l.points.at(-1)?.distanceM || 0));
    d += step
  )
    for (const load of result.loads) {
      const p = pointAt(load.points, d);
      if (!p) continue;
      const count = Math.max(1, load.pelletCount);
      rows.push([
        imperial ? (d * M_TO_YD).toFixed(1) : d.toFixed(1),
        load.name,
        firearmLabel(load),
        load.dragModel,
        load.bcKind,
        load.dragModel === 'Sphere' ? '' : load.ballisticCoefficient.toFixed(8),
        imperial ? (load.massKg / GR_TO_KG).toFixed(3) : (load.massKg * 1000).toFixed(5),
        load.dragModel === 'Sphere'
          ? imperial
            ? (load.sphereDiameterM / IN_TO_M).toFixed(5)
            : (load.sphereDiameterM * 1000).toFixed(5)
          : '',
        String(count),
        (p.speedMps * (imperial ? MPS_TO_FPS : 1)).toFixed(3),
        (p.energyJ * (imperial ? J_TO_FTLB : 1)).toFixed(3),
        (p.energyJ * count * (imperial ? J_TO_FTLB : 1)).toFixed(3),
        (p.momentumKgms * (imperial ? KGMS_TO_LBFTS : 1)).toFixed(5),
        (p.momentumKgms * count * (imperial ? KGMS_TO_LBFTS : 1)).toFixed(5),
        p.timeS.toFixed(6),
        (p.dropM * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
        p.mach.toFixed(5),
        p.cd?.toFixed(6) || '',
        p.reynolds?.toFixed(0) || '',
        (p.spinDriftM * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
      ]);
    }
  const csv =
    '\ufeff' +
    rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  if (window.ballistics) {
    await window.ballistics.saveCsv(csv, 'ballistics_range_table.csv');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'ballistics_range_table.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function HelpNotes() {
  return (
    <article className="help-document">
      <span className="eyebrow">MODEL REFERENCE AND OPERATING GUIDE</span>
      <h2>Quick Start</h2>
      <p>
        Choose a distance and atmospheric conditions, then read all loads in the Compare tab. The
        Range Table shows one selected load at regular increments. The Overview chart plots every
        active load continuously. The calculation is numerical and does not interpolate a prewritten
        range table.
      </p>

      <h3>Controllable status readout</h3>
      <p>
        The status readout is never tied silently to the first projectile. Use its Status and Load
        selectors to choose atmosphere and integration extent, a complete selected-load summary,
        retained-energy percentage, Mach and flight regime, sphere aerodynamics, or MPBR and optimal
        zero. Sphere aerodynamics reports instantaneous Cd and Reynolds number only for spherical
        loads. The readout updates when distance, load, units, or model inputs change.
      </p>

      <h2>Drag Model</h2>
      <p>
        The program integrates one shared point-mass trajectory state with fourth-order Runge–Kutta
        steps in horizontal distance. G1 uses the Ingalls/Mayevski piecewise retardation law. G7
        uses a Mach-indexed reference drag-coefficient table. Sphere loads use Morrison’s
        Reynolds-dependent smooth-sphere Cd relation combined with the Collins transonic correction
        fitted to Miller–Bailey sphere-drag data. Air density, dynamic viscosity, and local speed of
        sound are recomputed from the active atmosphere. Headwind and tailwind enter every model
        through air-relative velocity. The sphere model uses the same trajectory, gravity, chart,
        MPBR, status, unit, and export architecture as the other loads.
      </p>

      <h2>Projectile and Payload Values</h2>
      <p>
        Velocity, drop, time of flight, Mach, Cd, and Reynolds number describe one projectile or
        pellet. Energy and momentum are shown both per projectile and for the complete payload. For
        a slug or rifle cartridge, payload count is one and the two values are identical. For the
        built-in nine-pellet 00-buck load, payload totals are nine times the one-pellet scalar
        values. This arithmetic total does not imply that nine pellets behave as one solid
        projectile or follow one wound path.
      </p>

      <h2>Firearm Profiles</h2>
      <h3>Separate muzzle-velocity corrections</h3>
      <p>
        Shotgun and rifle corrections are independent. Use chronograph-derived percentages to
        represent a particular barrel and ammunition lot. A correction changes launch velocity and
        therefore every downstream result for that firearm group. It is not a barrel-length formula.
      </p>
      <h3>Sight height and MPBR</h3>
      <p>
        Shotgun and rifle sight heights are measured from bore axis to sight line. MPBR includes
        this offset, the selected vital-zone diameter, gravity, and drag. The displayed MPBR is the
        farthest range at which the optimized trajectory stays inside plus or minus half the
        vital-zone diameter. The MPBR status mode also shows the computed optimal zero.
      </p>
      <h3>Rifle twist and spin drift</h3>
      <p>
        Twist rate and direction belong to the rifle, not the cartridge. The rifle profile therefore
        controls both built-in .308 loads. A custom rifle projectile may optionally supply its own
        twist override. Spin drift uses the Miller stability estimate with velocity and air-density
        corrections, followed by the Litz empirical time-of-flight relation. Positive drift is
        rightward for right-hand twist and negative for left-hand twist. This remains an estimate,
        not a full six-degree-of-freedom solution.
      </p>

      <h2>Calibration</h2>
      <h3>White Blackout HV</h3>
      <p>
        575 m/s nominal; published 443 m/s at 33 m and 384 m/s at 50 m. Effective G1 BC = 0.05452.
        Model error at those anchors is about −0.5% and +0.4%.
      </p>
      <h3>BlackShock</h3>
      <p>455 m/s nominal; published 373 m/s at 33 m. Effective G1 BC = 0.07099.</p>
      <h3>Winchester X123RS15</h3>
      <p>
        1,760 ft/s with manufacturer-published G1 BC 0.068. The model reproduces the published 50,
        100, and 125 yd velocities to roughly 0.3%.
      </p>
      <h3>Winchester Super-X nine-pellet 00 buck</h3>
      <p>
        The built-in sphere load uses nine nominal 0.330-inch pure-lead pellets at 1,325 ft/s. A
        pure-lead sphere at that diameter is calculated as about 53.96 gr (3.497 g) per pellet. Its
        drag is not represented by a fitted ballistic coefficient. The shared fixed-step solver has
        been regression-tested against the standalone adaptive RK4 sphere solver under matched
        dry-air settings; ordinary-range velocity differences are far below 0.1%.
      </p>
      <h3>Hornady BLACK .308 Win 168 gr A-MAX, item 80971</h3>
      <p>
        2,700 ft/s from a 24-inch test barrel and manufacturer G1 BC 0.475. The published 100–500 yd
        velocity series is reproduced within about 0.11%.
      </p>
      <h3>Federal Power-Shok .308 Win 150 gr SP, 308A</h3>
      <p>
        2,820 ft/s from a 24-inch test barrel. Effective G1 BC 0.313 is fitted to Federal’s
        published velocity series and reproduces it within about 0.14%.
      </p>

      <h2>Custom Projectiles</h2>
      <p>
        Metric mode uses grams and metres per second; imperial mode uses grains and feet per second.
        Select G1, G7, or Sphere and choose the shotgun or rifle profile. For Sphere, enter
        diameter, material density, and payload count; mass is derived geometrically and the
        ordinary mass and BC fields are ignored. Custom names must be unique. For rifle spin drift,
        enter bullet length and diameter. Custom names are made unique automatically. A zero twist
        value means use the global rifle-profile twist.
      </p>

      <h2>Limitations</h2>
      <p>
        Slug BCs are effective coefficients derived from sparse measurements. Rifle BCs are
        manufacturer G1 values or fitted to official tables. These are average point-mass models,
        not CFD or six-degree-of-freedom simulations. Launch yaw, choke interaction, projectile or
        pellet deformation, pellet-pellet aerodynamic interaction, pattern spread, aerodynamic jump,
        true crosswind drift, Coriolis effect, and dynamic instability are not explicitly solved.
        The sphere correlation treats an isolated smooth sphere; launch flattening, alloy hardness,
        buffering, and pellet contact can change real drag. Uncertainty increases beyond measured
        regions and through transonic flight. Always verify real firearms with chronographing and
        actual zeroing.
      </p>
    </article>
  );
}

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
  const customErrors = useMemo(
    () => validateCustomLoad(custom, customLoads, editingCustom),
    [custom, customLoads, editingCustom],
  );
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
