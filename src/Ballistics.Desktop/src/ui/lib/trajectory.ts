import type { Point } from '../types';

export function pointAt(points: Point[], distance: number): Point | undefined {
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
