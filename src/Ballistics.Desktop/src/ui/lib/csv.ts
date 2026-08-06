import type { Inputs, Result } from '../types';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './units';
import { firearmLabel } from './labels';
import { pointAt } from './trajectory';

export function buildCsv(result: Result, inputs: Inputs, step: number, imperial: boolean): string {
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
  return (
    '\ufeff' +
    rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  );
}

export async function saveCsv(result: Result, inputs: Inputs, step: number, imperial: boolean) {
  const csv = buildCsv(result, inputs, step, imperial);
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
