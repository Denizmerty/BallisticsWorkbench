import type { Inputs, Result, UncertaintySettings } from '../types';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './units';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathAt } from './holdover';
import { firearmLabel } from './labels';
import { pointAt, uncertaintyAt } from './trajectory';
import { densityToAltitude, pressureToAltitude } from './atmosphere';

const CONFIDENCE_95_MULTIPLIER = 1.959963984540054;

const neutralizeFormula = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value);

export function buildCsv(
    result: Result,
    inputs: Inputs,
    step: number,
    imperial: boolean,
    uncertainty?: UncertaintySettings,
): string {
    const distanceUnit = imperial ? 'yd' : 'm';
    const velocityUnit = imperial ? 'ft/s' : 'm/s';
    const energyUnit = imperial ? 'ft·lbf' : 'J';
    const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
    const dropUnit = imperial ? 'in' : 'cm';
    const rows: string[][] = [
        ['# Ballistics Workbench range-table export'],
        [
            '# Model identity',
            `engine=${result.engineVersion}`,
            `model=${result.modelVersion}`,
            `protocol=${result.protocolVersion}`,
        ],
        [
            '# Atmosphere',
            `temperature=${inputs.temperatureC.toFixed(3)} °C`,
            `pressure source=${inputs.pressureSource}`,
            `resolved station pressure=${inputs.pressureHpa.toFixed(3)} hPa`,
            `pressure altitude=${pressureToAltitude(inputs.pressureHpa).toFixed(3)} m`,
            `entered pressure altitude=${inputs.pressureAltitudeM.toFixed(3)} m`,
            `field elevation=${inputs.geometricAltitudeM.toFixed(3)} m`,
            `altimeter setting=${inputs.altimeterSettingHpa.toFixed(3)} hPa`,
            `humidity=${inputs.humidityPercent.toFixed(3)} %`,
            `headwind=${inputs.headwindMps.toFixed(3)} m/s`,
            `crosswind=${inputs.crosswindMps.toFixed(3)} m/s`,
        ],
        [
            '# Zeroing',
            `shotgun zero=${inputs.shotgunZeroM.toFixed(3)} m`,
            `rifle zero=${inputs.rifleZeroM.toFixed(3)} m`,
        ],
        uncertainty?.enabled
            ? [
                  '# Uncertainty inputs (independent 1-sigma)',
                  'method=first_order_central_difference',
                  'confidence=0.95',
                  `shotgun muzzle velocity SD=${uncertainty.shotgunMuzzleVelocityStandardDeviationMps.toFixed(6)} m/s`,
                  `rifle muzzle velocity SD=${uncertainty.rifleMuzzleVelocityStandardDeviationMps.toFixed(6)} m/s`,
                  `BC/drag relative SD=${uncertainty.dragRelativeStandardDeviation.toFixed(8)}`,
                  `temperature SD=${uncertainty.temperatureStandardDeviationC.toFixed(6)} °C`,
                  `station pressure SD=${uncertainty.stationPressureStandardDeviationHpa.toFixed(6)} hPa`,
                  `headwind SD=${uncertainty.headwindStandardDeviationMps.toFixed(6)} m/s`,
                  `crosswind SD=${uncertainty.crosswindStandardDeviationMps.toFixed(6)} m/s`,
                  `shotgun zero range SD=${uncertainty.shotgunZeroRangeStandardDeviationM.toFixed(6)} m`,
                  `rifle zero range SD=${uncertainty.rifleZeroRangeStandardDeviationM.toFixed(6)} m`,
              ]
            : ['# Uncertainty inputs', 'not requested'],
        [
            '# Derived atmosphere',
            `density=${result.atmosphere.densityKgM3.toFixed(6)} kg/m³`,
            `density altitude=${densityToAltitude(result.atmosphere.densityKgM3).toFixed(3)} m`,
            `dynamic viscosity=${result.atmosphere.viscosityPaS.toExponential(6)} Pa·s`,
            `speed of sound=${result.atmosphere.speedOfSoundMps.toFixed(6)} m/s`,
            `density model=${result.atmosphere.densityModel}`,
            `speed-of-sound model=${result.atmosphere.speedOfSoundModel}`,
            `viscosity model=${result.atmosphere.viscosityModel}`,
            `density within declared domain=${result.atmosphere.densityWithinDeclaredDomain}`,
            `sound speed within declared domain=${result.atmosphere.soundSpeedWithinDeclaredDomain}`,
            `viscosity within declared domain=${result.atmosphere.viscosityWithinDeclaredDomain}`,
            `altitude behavior=${result.atmosphere.altitudeBehavior}`,
            `target inclination=${result.scenarioModel.targetInclinationRad.toFixed(9)} rad`,
            `local gravity=${result.scenarioModel.localGravity}`,
            `coriolis=${result.scenarioModel.coriolis}`,
            `latitude=${result.scenarioModel.latitudeDeg.toFixed(6)} deg`,
            `azimuth=${result.scenarioModel.azimuthDeg.toFixed(6)} deg`,
            `wind layers=${result.scenarioModel.windLayerCount}`,
        ],
        ...result.loads.map((load) => {
            const events = load.trajectoryEvents;
            const measurement = (value: number | null) => (value === null ? '' : value.toFixed(6));
            return [
                '# Trajectory events',
                `load=${neutralizeFormula(load.name)}`,
                `analyzed horizon=${events.analyzedDistanceM.toFixed(6)} m`,
                `zero crossings status=${events.zeroCrossingsStatus}`,
                `near zero=${measurement(events.nearZeroM)} m`,
                `far zero=${measurement(events.farZeroM)} m`,
                `maximum ordinate status=${events.maximumOrdinateStatus}`,
                `maximum ordinate distance=${measurement(events.maximumOrdinateDistanceM)} m`,
                `maximum ordinate path=${measurement(events.maximumOrdinatePathM)} m`,
                `supersonic range status=${events.supersonicRangeStatus}`,
                `supersonic range=${measurement(events.supersonicRangeM)} m`,
                `ground intersection status=${events.groundIntersectionStatus}`,
                `ground intersection=${measurement(events.groundIntersectionM)} m`,
                `Mach crossings=${events.machCrossings
                    .map(
                        (crossing) =>
                            `${crossing.mach.toFixed(1)}:${crossing.distanceM.toFixed(6)}:${crossing.direction}`,
                    )
                    .join('|')}`,
            ];
        }),
        ...result.loads.flatMap((load) => {
            const pattern = load.buckshotPattern;
            if (!pattern) return [];
            return [
                [
                    '# Empirical buckshot pattern',
                    `load=${neutralizeFormula(load.name)}`,
                    `status=${pattern.status}`,
                    `choke=${pattern.choke}`,
                    `deformation class=${pattern.deformationClass}`,
                    `pellet velocity SD=${pattern.pelletVelocityStandardDeviationMps.toFixed(6)} m/s`,
                    `calibration range=${pattern.calibrationRangeMinM.toFixed(6)}-${pattern.calibrationRangeMaxM.toFixed(6)} m`,
                    `target range=${pattern.targetRangeM.toFixed(6)} m`,
                    `predicted D90=${pattern.predictedDiameter90M.toFixed(6)} m`,
                    `predicted D90 95% interval=${pattern.predictedDiameter90Low95M.toFixed(6)}-${pattern.predictedDiameter90High95M.toFixed(6)} m`,
                    `calibration RMSE=${pattern.calibrationRmseM.toFixed(6)} m`,
                    `holdout RMSE=${pattern.holdoutRmseM.toFixed(6)} m`,
                    `per-pellet hit probability=${pattern.perPelletHitProbability.toFixed(8)}`,
                    `expected pellet count=${pattern.expectedPelletCount.toFixed(8)}`,
                    `probability at least ${pattern.minimumPelletCount}=${pattern.probabilityAtLeastMinimum.toFixed(8)}`,
                    `pellet-count PMF=${pattern.pelletCountProbabilities
                        .map((probability, count) => `${count}:${probability.toFixed(8)}`)
                        .join('|')}`,
                    `residuals=${pattern.residuals
                        .map(
                            (residual) =>
                                `${residual.role}:${residual.rangeM.toFixed(6)}:` +
                                `${residual.measuredDiameter90M.toFixed(6)}:` +
                                `${residual.predictedDiameter90M.toFixed(6)}:` +
                                residual.residualM.toFixed(6),
                        )
                        .join('|')}`,
                    `validity=${neutralizeFormula(pattern.validityStatement)}`,
                ],
            ];
        }),
        [],
        [
            `Distance (${distanceUnit})`,
            'Load',
            'Firearm profile',
            'Drag model',
            'BC kind',
            'Ballistic coefficient',
            'BC schedule (minimum m/s:BC)',
            `Drag reference diameter (${imperial ? 'in' : 'mm'})`,
            'Mach–Cd curve (Mach:Cd)',
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
            'Drag coefficient',
            'Reynolds',
            `Spin drift (${dropUnit})`,
            `Wind drift (${dropUnit})`,
            `Total windage (${dropUnit})`,
            `Sight path (${dropUnit})`,
            'Holdover (MOA)',
            'Holdover (mil)',
            'Uncertainty status',
            `Velocity SD (${velocityUnit})`,
            `Velocity 95% half-width (${velocityUnit})`,
            `Energy SD (${energyUnit})`,
            `Energy 95% half-width (${energyUnit})`,
            `Momentum SD (${momentumUnit})`,
            `Momentum 95% half-width (${momentumUnit})`,
            'Flight-time SD (s)',
            'Flight-time 95% half-width (s)',
            `Drop SD (${dropUnit})`,
            `Drop 95% half-width (${dropUnit})`,
            `Wind-drift SD (${dropUnit})`,
            `Wind-drift 95% half-width (${dropUnit})`,
            `Sight-path SD (${dropUnit})`,
            `Sight-path 95% half-width (${dropUnit})`,
            'Holdover SD (MOA)',
            'Holdover 95% half-width (MOA)',
            'Holdover SD (mil)',
            'Holdover 95% half-width (mil)',
        ],
    ];
    const geometry = new Map(
        result.loads.map((load) => [load.name, sightGeometry(load, inputs, inputs)]),
    );
    for (
        let d = 0;
        d <= Math.max(...result.loads.map((l) => l.points.at(-1)?.distanceM || 0));
        d += step
    )
        for (const load of result.loads) {
            const p = pointAt(load.points, d);
            if (!p) continue;
            const count = Math.max(1, load.pelletCount);
            const spin = p.spinDriftM;
            const uncertaintySample = load.uncertainty
                ? uncertaintyAt(load.uncertainty.points, d)
                : undefined;
            const uncertaintyAvailable =
                uncertaintySample?.available === true &&
                (load.uncertainty?.status === 'complete' ||
                    load.uncertainty?.status === 'no_inputs');
            const uncertaintyValue = (
                standardDeviation: number,
                conversion: number,
                confidence = false,
            ) =>
                uncertaintyAvailable
                    ? (
                          standardDeviation *
                          conversion *
                          (confidence ? CONFIDENCE_95_MULTIPLIER : 1)
                      ).toFixed(6)
                    : '';
            rows.push([
                imperial ? (d * M_TO_YD).toFixed(1) : d.toFixed(1),
                neutralizeFormula(load.name),
                neutralizeFormula(firearmLabel(load)),
                neutralizeFormula(load.dragModel),
                neutralizeFormula(load.bcKind),
                load.dragModel === 'G1' || load.dragModel === 'G7'
                    ? load.ballisticCoefficient.toFixed(8)
                    : '',
                load.ballisticCoefficientBands
                    .map(
                        (band) =>
                            `${band.minimumVelocityMps.toFixed(3)}:${band.ballisticCoefficient.toFixed(6)}`,
                    )
                    .join('|'),
                load.dragModel === 'MachCd'
                    ? imperial
                        ? (load.dragReferenceDiameterM / IN_TO_M).toFixed(5)
                        : (load.dragReferenceDiameterM * 1000).toFixed(5)
                    : '',
                load.machCdPoints
                    .map((point) => `${point.mach.toFixed(5)}:${point.dragCoefficient.toFixed(6)}`)
                    .join('|'),
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
                (p.cd ?? p.referenceCd)?.toFixed(6) || '',
                p.reynolds?.toFixed(0) || '',
                spin === null ? '' : (spin * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
                (p.windDriftM * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
                spin === null
                    ? ''
                    : ((spin + p.windDriftM) * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
                ...(() => {
                    const path = sightPathAt(p, geometry.get(load.name)!);
                    if (!Number.isFinite(path)) return ['', '', ''];
                    return [
                        (path * (imperial ? 1 / IN_TO_M : 100)).toFixed(4),
                        holdoverMoa(p.holdoverRad).toFixed(4),
                        holdoverMil(p.holdoverRad).toFixed(4),
                    ];
                })(),
                load.uncertainty?.status ?? 'not_requested',
                uncertaintyValue(
                    uncertaintySample?.speedStandardDeviationMps ?? Number.NaN,
                    imperial ? MPS_TO_FPS : 1,
                ),
                uncertaintyValue(
                    uncertaintySample?.speedStandardDeviationMps ?? Number.NaN,
                    imperial ? MPS_TO_FPS : 1,
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.energyStandardDeviationJ ?? Number.NaN,
                    imperial ? J_TO_FTLB : 1,
                ),
                uncertaintyValue(
                    uncertaintySample?.energyStandardDeviationJ ?? Number.NaN,
                    imperial ? J_TO_FTLB : 1,
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.momentumStandardDeviationKgms ?? Number.NaN,
                    imperial ? KGMS_TO_LBFTS : 1,
                ),
                uncertaintyValue(
                    uncertaintySample?.momentumStandardDeviationKgms ?? Number.NaN,
                    imperial ? KGMS_TO_LBFTS : 1,
                    true,
                ),
                uncertaintyValue(uncertaintySample?.timeStandardDeviationS ?? Number.NaN, 1),
                uncertaintyValue(uncertaintySample?.timeStandardDeviationS ?? Number.NaN, 1, true),
                uncertaintyValue(
                    uncertaintySample?.dropStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                ),
                uncertaintyValue(
                    uncertaintySample?.dropStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.windDriftStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                ),
                uncertaintyValue(
                    uncertaintySample?.windDriftStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.pathStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                ),
                uncertaintyValue(
                    uncertaintySample?.pathStandardDeviationM ?? Number.NaN,
                    imperial ? 1 / IN_TO_M : 100,
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.holdoverStandardDeviationRad ?? Number.NaN,
                    holdoverMoa(1),
                ),
                uncertaintyValue(
                    uncertaintySample?.holdoverStandardDeviationRad ?? Number.NaN,
                    holdoverMoa(1),
                    true,
                ),
                uncertaintyValue(
                    uncertaintySample?.holdoverStandardDeviationRad ?? Number.NaN,
                    holdoverMil(1),
                ),
                uncertaintyValue(
                    uncertaintySample?.holdoverStandardDeviationRad ?? Number.NaN,
                    holdoverMil(1),
                    true,
                ),
            ]);
        }
    return (
        '\ufeff' +
        rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    );
}

export async function saveCsv(
    result: Result,
    inputs: Inputs,
    step: number,
    imperial: boolean,
    uncertainty?: UncertaintySettings,
) {
    const csv = buildCsv(result, inputs, step, imperial, uncertainty);
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
