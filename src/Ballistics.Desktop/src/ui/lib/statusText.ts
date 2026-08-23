import type { Inputs, Result } from '../types';
import { formatNumber } from './format';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathAt } from './holdover';
import { projectileLabel } from './labels';
import { pointAt } from './trajectory';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './units';

export type StatusMode =
    | 'atmosphere'
    | 'summary'
    | 'retainedEnergy'
    | 'mach'
    | 'sphere'
    | 'windage'
    | 'holdover'
    | 'mpbr'
    | 'events';

export type StatusTextOptions = {
    result: Result | null;
    mode: StatusMode;
    selectedLoadId: string | null;
    referenceDistanceM: number;
    inputs: Inputs;
    imperial: boolean;
};

/**
 * Builds the compact explanation shown in the application's status strip.
 * Keeping this as a pure view-model function makes every status mode testable
 * without mounting the application shell or duplicating unit conversions.
 */
export function statusText({
    result,
    mode,
    selectedLoadId,
    referenceDistanceM,
    inputs,
    imperial,
}: StatusTextOptions): string {
    const distance = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const velocity = (metresPerSecond: number) =>
        imperial ? metresPerSecond * MPS_TO_FPS : metresPerSecond;
    const energy = (joules: number) => (imperial ? joules * J_TO_FTLB : joules);
    const momentum = (kilogramMetresPerSecond: number) =>
        imperial ? kilogramMetresPerSecond * KGMS_TO_LBFTS : kilogramMetresPerSecond;
    const displacement = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
    const eventDistance = (value: number | null, status: string) =>
        value === null
            ? status.replaceAll('_', ' ')
            : `${formatNumber(distance(value), 1)} ${imperial ? 'yd' : 'm'}`;
    const eventPath = (value: number | null, status: string) =>
        value === null
            ? status.replaceAll('_', ' ')
            : `${formatNumber(displacement(value), 2)} ${imperial ? 'in' : 'cm'}`;

    if (!result) return 'Waiting for the C++ engine.';

    if (mode === 'atmosphere') {
        const partial = result.loads.filter((load) => load.trajectoryStatus !== 'complete');
        const coverage = partial.length
            ? `${partial.length} ${partial.length === 1 ? 'trajectory ended' : 'trajectories ended'} ` +
              'before the requested range'
            : `complete through ${formatNumber(distance(inputs.distanceM), 0)} ${imperial ? 'yd' : 'm'}`;
        return [
            `Density ${result.atmosphere.densityKgM3.toFixed(4)} kg/m³`,
            `viscosity ${result.atmosphere.viscosityPaS.toExponential(3)} Pa·s`,
            `sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s`,
            'ideal moist-air density · fixed-γ sound speed · Sutherland viscosity',
            'homogeneous atmosphere at the firing point',
            coverage,
        ].join(' · ');
    }

    const selectedLoad = result.loads.find((load) => load.id === selectedLoadId) ?? result.loads[0];
    const point = selectedLoad ? pointAt(selectedLoad.points, referenceDistanceM) : undefined;
    if (!selectedLoad || !point) return 'Select an available load.';

    const count = Math.max(1, selectedLoad.pelletCount);
    const distanceText = `${formatNumber(distance(referenceDistanceM), 1)} ${imperial ? 'yd' : 'm'}`;
    const energyUnit = imperial ? 'ft·lbf' : 'J';
    const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';

    if (mode === 'summary') {
        const payload =
            count > 1
                ? `payload (${count}×): ${formatNumber(
                      energy(point.energyJ * count),
                      0,
                  )} ${energyUnit}, ${formatNumber(
                      momentum(point.momentumKgms * count),
                      2,
                  )} ${momentumUnit}`
                : '';
        return [
            `${selectedLoad.shortName} at ${distanceText}: ${formatNumber(velocity(point.speedMps), 0)} ${
                imperial ? 'ft/s' : 'm/s'
            }`,
            `per ${projectileLabel(selectedLoad)} ${formatNumber(
                energy(point.energyJ),
                0,
            )} ${energyUnit}, ${formatNumber(momentum(point.momentumKgms), 2)} ${momentumUnit}`,
            ...(payload ? [payload] : []),
            `TOF ${point.timeS.toFixed(3)} s`,
            `drop ${formatNumber(displacement(point.dropM), 1)} ${imperial ? 'in' : 'cm'}`,
        ].join(' · ');
    }

    if (mode === 'retainedEnergy') {
        const muzzleEnergy = selectedLoad.points[0]?.energyJ ?? 0;
        const retained = muzzleEnergy ? (point.energyJ / muzzleEnergy) * 100 : 0;
        return [
            `${selectedLoad.shortName} at ${distanceText}: ${retained.toFixed(1)}% retained`,
            `per ${projectileLabel(selectedLoad)} ${formatNumber(
                energy(point.energyJ),
                0,
            )} ${energyUnit}`,
            `payload ${formatNumber(energy(point.energyJ * count), 0)} ${energyUnit} ` +
                `from ${formatNumber(energy(muzzleEnergy * count), 0)} ${energyUnit}`,
        ].join(' · ');
    }

    if (mode === 'mach') {
        const regime =
            point.mach > 1.2 ? 'supersonic' : point.mach >= 0.8 ? 'transonic' : 'subsonic';
        return [
            `${selectedLoad.shortName} at ${distanceText}: Mach ${point.mach.toFixed(3)} (${regime})`,
            `local sound speed ${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s`,
        ].join(' · ');
    }

    if (mode === 'windage') {
        const driftUnit = imperial ? 'in' : 'cm';
        const spin = point.spinDriftM;
        if (spin === null) {
            const reason = selectedLoad.spinDriftStatus?.replaceAll('_', ' ') ?? 'missing data';
            return [
                `${selectedLoad.shortName} at ${distanceText}: wind drift ${formatNumber(
                    displacement(point.windDriftM),
                    1,
                )} ${driftUnit}`,
                `spin drift unavailable (${reason})`,
            ].join('. ');
        }
        const total = point.windDriftM + spin;
        const side = (value: number) => (value >= 0 ? 'right' : 'left');
        const crosswind = imperial ? inputs.crosswindMps / 0.44704 : inputs.crosswindMps;
        return [
            `${selectedLoad.shortName} at ${distanceText}: wind drift ${formatNumber(
                displacement(point.windDriftM),
                1,
            )} ${driftUnit} ${side(point.windDriftM)}`,
            `spin drift ${formatNumber(displacement(spin), 1)} ${driftUnit} ${side(spin)}`,
            `total windage ${formatNumber(displacement(total), 1)} ${driftUnit} ${side(total)}`,
            `crosswind ${formatNumber(crosswind, 1)} ${imperial ? 'mph' : 'm/s'}`,
        ].join(' · ');
    }

    if (mode === 'holdover') {
        const geometry = sightGeometry(selectedLoad, inputs, inputs);
        if (!geometry.available) {
            return (
                `${selectedLoad.shortName}: sight-zero trajectory is unavailable at ` +
                `${formatNumber(distance(geometry.zeroM), 0)} ${imperial ? 'yd' : 'm'}.`
            );
        }
        const path = sightPathAt(point, geometry);
        const displacementUnit = imperial ? 'in' : 'cm';
        const place = path >= 0 ? 'above' : 'below';
        const heading =
            `${selectedLoad.shortName} at ${distanceText} ` +
            `(zero ${formatNumber(distance(geometry.zeroM), 0)} ${imperial ? 'yd' : 'm'})`;
        return [
            `${heading}: path ${formatNumber(displacement(path), 1)} ${displacementUnit} ${place} sight line`,
            `holdover ${formatNumber(holdoverMoa(point.holdoverRad), 1)} MOA / ` +
                `${formatNumber(holdoverMil(point.holdoverRad), 2)} mil`,
        ].join(' · ');
    }

    if (mode === 'events') {
        const events = selectedLoad.trajectoryEvents;
        const crossings = events.machCrossings.length
            ? events.machCrossings
                  .map((crossing) => {
                      const direction = crossing.direction === 'decelerating' ? 'down' : 'up';
                      return (
                          `Mach ${crossing.mach.toFixed(1)} ${direction} at ` +
                          eventDistance(crossing.distanceM, 'complete')
                      );
                  })
                  .join(' · ')
            : 'no Mach 1.2/1.0/0.8 crossings in the analyzed horizon';
        return [
            `${selectedLoad.shortName}: near zero ${eventDistance(
                events.nearZeroM,
                events.zeroCrossingsStatus,
            )}`,
            `far zero ${eventDistance(events.farZeroM, events.zeroCrossingsStatus)}`,
            `maximum ordinate ${eventPath(
                events.maximumOrdinatePathM,
                events.maximumOrdinateStatus,
            )} at ${eventDistance(events.maximumOrdinateDistanceM, events.maximumOrdinateStatus)}`,
            `supersonic range ${eventDistance(events.supersonicRangeM, events.supersonicRangeStatus)}`,
            `ground intersection ${eventDistance(
                events.groundIntersectionM,
                events.groundIntersectionStatus,
            )}`,
            crossings,
        ].join(' · ');
    }

    if (mode === 'sphere') {
        const coefficient = point.cd ?? point.referenceCd;
        if (coefficient === undefined) {
            return `${selectedLoad.shortName} does not expose a drag-coefficient diagnostic.`;
        }
        const validity = selectedLoad.dragValidity;
        const validityText =
            validity.status === 'extrapolated'
                ? ' · outside declared model domain'
                : validity.status === 'within_domain'
                  ? ` · within declared Mach ${validity.supportedMachMin}–${validity.supportedMachMax} domain`
                  : '';
        const diameter =
            selectedLoad.dragModel === 'Sphere'
                ? selectedLoad.sphereDiameterM
                : selectedLoad.dragModel === 'MachCd'
                  ? selectedLoad.dragReferenceDiameterM
                  : 0;
        const diameterText = diameter > 0 ? `diameter ${(diameter * 1000).toFixed(3)} mm` : '';
        const coefficientLabel =
            selectedLoad.dragModel === 'G1' || selectedLoad.dragModel === 'G7'
                ? 'reference Cd'
                : 'Cd';
        const reynolds = point.reynolds === undefined ? 'N/A' : formatNumber(point.reynolds, 0);
        return (
            [
                `${selectedLoad.shortName} at ${distanceText}: ${coefficientLabel} ${coefficient.toFixed(4)}`,
                `Re ${reynolds}`,
                `Mach ${point.mach.toFixed(3)}`,
                ...(diameterText ? [diameterText] : []),
                `${(selectedLoad.massKg / GR_TO_KG).toFixed(2)} gr per ${projectileLabel(selectedLoad)}`,
            ].join(' · ') + validityText
        );
    }

    const sightHeight =
        selectedLoad.firearmGroup === 'rifle' ? inputs.rifleSightM : inputs.shotgunSightM;
    if (selectedLoad.mpbrStatus === 'complete') {
        return [
            `${selectedLoad.shortName}: optimal zero ${formatNumber(
                distance(selectedLoad.zeroM ?? Number.NaN),
                0,
            )} ${imperial ? 'yd' : 'm'}`,
            `MPBR ${formatNumber(distance(selectedLoad.mpbrM ?? Number.NaN), 0)} ${
                imperial ? 'yd' : 'm'
            }`,
            `sight height ${displacement(sightHeight).toFixed(2)} ${imperial ? 'in' : 'cm'}`,
        ].join(' · ');
    }
    const reason = selectedLoad.mpbrStatus?.replaceAll('_', ' ') ?? 'no solution';
    return `${selectedLoad.shortName}: MPBR unavailable (${reason}).`;
}
