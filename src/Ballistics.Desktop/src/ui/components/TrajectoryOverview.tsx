import type { Inputs, Load, Metric, UnitSystem } from '../types';
import { formatNumber } from '../lib/format';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathAt } from '../lib/holdover';
import { dragDescription, firearmLabel, projectileLabel } from '../lib/labels';
import { pointAt, uncertaintyAt } from '../lib/trajectory';
import { GR_TO_KG, IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';
import { Sparkline } from './Sparkline';

const CONFIDENCE_95_MULTIPLIER = 1.959963984540054;

type Props = {
    load: Load;
    loads: Load[];
    inputs: Inputs;
    units: UnitSystem;
    referenceDistanceM: number;
    metric: Metric;
    onMetricChange: (metric: Metric) => void;
    onReferenceDistanceChange: (distanceM: number) => void;
};

type RowProps = {
    label: string;
    value: string;
    unit?: string;
    wide?: boolean;
};

function Row({ label, value, unit, wide }: RowProps) {
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

export function TrajectoryOverview({
    load,
    loads,
    inputs,
    units,
    referenceDistanceM,
    metric,
    onMetricChange,
    onReferenceDistanceChange,
}: Props) {
    const imperial = units === 'imperial';
    const distance = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const velocity = (metresPerSecond: number) =>
        imperial ? metresPerSecond * MPS_TO_FPS : metresPerSecond;
    const energy = (joules: number) => (imperial ? joules * J_TO_FTLB : joules);
    const momentum = (kilogramMetresPerSecond: number) =>
        imperial ? kilogramMetresPerSecond * KGMS_TO_LBFTS : kilogramMetresPerSecond;
    const displacement = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
    const distanceUnit = imperial ? 'yd' : 'm';
    const energyUnit = imperial ? 'ft·lbf' : 'J';
    const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
    const displacementUnit = imperial ? 'in' : 'cm';
    const target = pointAt(load.points, referenceDistanceM);
    const targetUncertainty = (() => {
        if (load.uncertainty?.status !== 'complete') return undefined;
        const sample = uncertaintyAt(load.uncertainty.points, referenceDistanceM);
        return sample?.available ? sample : undefined;
    })();
    const targetGeometry = sightGeometry(load, inputs, inputs);
    const targetPathM = target ? sightPathAt(target, targetGeometry) : 0;
    const eventDistance = (value: number | null, status: string) =>
        value === null
            ? status.replaceAll('_', ' ')
            : `${formatNumber(distance(value), 1)} ${distanceUnit}`;
    const eventPath = (value: number | null, status: string) =>
        value === null
            ? status.replaceAll('_', ' ')
            : `${formatNumber(displacement(value), 2)} ${displacementUnit}`;

    return (
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
                    totals. They do not model the pellets as one projectile.
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
                            value={(load.sphereDiameterM * (imperial ? 1 / IN_TO_M : 1000)).toFixed(
                                3,
                            )}
                            unit={imperial ? 'in' : 'mm'}
                        />
                    ) : load.dragModel === 'MachCd' ? (
                        <Row
                            label="Drag reference diameter"
                            value={(
                                load.dragReferenceDiameterM * (imperial ? 1 / IN_TO_M : 1000)
                            ).toFixed(3)}
                            unit={imperial ? 'in' : 'mm'}
                        />
                    ) : (
                        <Row
                            label="Ballistic coefficient"
                            value={load.ballisticCoefficient?.toFixed(5) ?? 'N/A'}
                            unit={load.dragModel}
                        />
                    )}
                    <Row label="Payload count" value={String(load.pelletCount)} />
                    <Row
                        label="MPBR"
                        value={formatNumber(distance(load.mpbrM ?? Number.NaN), 1)}
                        unit={distanceUnit}
                    />
                    <Row
                        label="Optimal zero"
                        value={formatNumber(distance(load.zeroM ?? Number.NaN), 1)}
                        unit={distanceUnit}
                    />
                    <Row label="Source" value={load.bcKind || 'Reynolds sphere model'} wide />
                </section>
                <section className="rgroup">
                    <header>
                        State at {formatNumber(distance(referenceDistanceM), 0)} {distanceUnit}
                    </header>
                    <Row
                        label="Velocity"
                        value={formatNumber(velocity(target?.speedMps ?? 0), 1)}
                        unit={imperial ? 'ft/s' : 'm/s'}
                    />
                    {targetUncertainty && (
                        <Row
                            label="Velocity 95% half-width"
                            value={formatNumber(
                                velocity(targetUncertainty.speedStandardDeviationMps) *
                                    CONFIDENCE_95_MULTIPLIER,
                                1,
                            )}
                            unit={imperial ? 'ft/s' : 'm/s'}
                        />
                    )}
                    <Row label="Mach" value={formatNumber(target?.mach ?? 0, 3)} />
                    <Row
                        label={`Energy / ${projectileLabel(load)}`}
                        value={formatNumber(energy(target?.energyJ ?? 0), 0)}
                        unit={energyUnit}
                    />
                    {targetUncertainty && (
                        <Row
                            label="Energy 95% half-width"
                            value={formatNumber(
                                energy(targetUncertainty.energyStandardDeviationJ) *
                                    CONFIDENCE_95_MULTIPLIER,
                                0,
                            )}
                            unit={energyUnit}
                        />
                    )}
                    {load.pelletCount > 1 && (
                        <Row
                            label={`Payload energy (${load.pelletCount}×)`}
                            value={formatNumber(
                                energy((target?.energyJ ?? 0) * load.pelletCount),
                                0,
                            )}
                            unit={energyUnit}
                        />
                    )}
                    <Row
                        label={`Momentum / ${projectileLabel(load)}`}
                        value={formatNumber(momentum(target?.momentumKgms ?? 0), 2)}
                        unit={momentumUnit}
                    />
                    {load.pelletCount > 1 && (
                        <Row
                            label={`Payload momentum (${load.pelletCount}×)`}
                            value={formatNumber(
                                momentum((target?.momentumKgms ?? 0) * load.pelletCount),
                                2,
                            )}
                            unit={momentumUnit}
                        />
                    )}
                    <Row label="Flight time" value={formatNumber(target?.timeS ?? 0, 3)} unit="s" />
                    {targetUncertainty && (
                        <Row
                            label="Time 95% half-width"
                            value={formatNumber(
                                targetUncertainty.timeStandardDeviationS * CONFIDENCE_95_MULTIPLIER,
                                3,
                            )}
                            unit="s"
                        />
                    )}
                </section>
                <section className="rgroup">
                    <header>
                        Trajectory at {formatNumber(distance(referenceDistanceM), 0)} {distanceUnit}
                    </header>
                    <Row
                        label="Drop"
                        value={formatNumber(displacement(target?.dropM ?? 0), 1)}
                        unit={displacementUnit}
                    />
                    {targetUncertainty && (
                        <Row
                            label="Drop 95% half-width"
                            value={formatNumber(
                                displacement(targetUncertainty.dropStandardDeviationM) *
                                    CONFIDENCE_95_MULTIPLIER,
                                2,
                            )}
                            unit={displacementUnit}
                        />
                    )}
                    <Row
                        label="Wind drift"
                        value={formatNumber(displacement(target?.windDriftM ?? 0), 1)}
                        unit={displacementUnit}
                    />
                    {targetUncertainty && (
                        <Row
                            label="Wind 95% half-width"
                            value={formatNumber(
                                displacement(targetUncertainty.windDriftStandardDeviationM) *
                                    CONFIDENCE_95_MULTIPLIER,
                                2,
                            )}
                            unit={displacementUnit}
                        />
                    )}
                    <Row
                        label="Spin drift"
                        value={formatNumber(displacement(target?.spinDriftM ?? Number.NaN), 2)}
                        unit={displacementUnit}
                    />
                    <Row
                        label="Total windage"
                        value={formatNumber(
                            displacement(
                                target?.spinDriftM === null || target?.spinDriftM === undefined
                                    ? Number.NaN
                                    : (target.windDriftM ?? 0) + target.spinDriftM,
                            ),
                            2,
                        )}
                        unit={displacementUnit}
                    />
                    <Row
                        label={`Sight path · zero ${formatNumber(
                            distance(targetGeometry.zeroM),
                            0,
                        )} ${distanceUnit}`}
                        value={formatNumber(displacement(targetPathM), 1)}
                        unit={displacementUnit}
                    />
                    {targetUncertainty && (
                        <Row
                            label="Path 95% half-width"
                            value={formatNumber(
                                displacement(targetUncertainty.pathStandardDeviationM) *
                                    CONFIDENCE_95_MULTIPLIER,
                                2,
                            )}
                            unit={displacementUnit}
                        />
                    )}
                    <Row
                        label="Holdover"
                        value={formatNumber(holdoverMoa(target?.holdoverRad ?? Number.NaN), 1)}
                        unit="MOA"
                    />
                    <Row
                        label="Holdover"
                        value={formatNumber(holdoverMil(target?.holdoverRad ?? Number.NaN), 2)}
                        unit="mil"
                    />
                </section>
                <section className="rgroup">
                    <header>
                        Trajectory events ·{' '}
                        {formatNumber(distance(load.trajectoryEvents.analyzedDistanceM), 0)}{' '}
                        {distanceUnit} horizon
                    </header>
                    <Row
                        label="Near zero"
                        value={eventDistance(
                            load.trajectoryEvents.nearZeroM,
                            load.trajectoryEvents.zeroCrossingsStatus,
                        )}
                        wide
                    />
                    <Row
                        label="Far zero"
                        value={eventDistance(
                            load.trajectoryEvents.farZeroM,
                            load.trajectoryEvents.zeroCrossingsStatus,
                        )}
                        wide
                    />
                    <Row
                        label="Maximum ordinate"
                        value={eventPath(
                            load.trajectoryEvents.maximumOrdinatePathM,
                            load.trajectoryEvents.maximumOrdinateStatus,
                        )}
                        wide
                    />
                    <Row
                        label="At distance"
                        value={eventDistance(
                            load.trajectoryEvents.maximumOrdinateDistanceM,
                            load.trajectoryEvents.maximumOrdinateStatus,
                        )}
                        wide
                    />
                    <Row
                        label="Supersonic range"
                        value={eventDistance(
                            load.trajectoryEvents.supersonicRangeM,
                            load.trajectoryEvents.supersonicRangeStatus,
                        )}
                        wide
                    />
                    <Row
                        label="Ground intersection"
                        value={eventDistance(
                            load.trajectoryEvents.groundIntersectionM,
                            load.trajectoryEvents.groundIntersectionStatus,
                        )}
                        wide
                    />
                    <Row
                        label="Mach crossings"
                        value={
                            load.trajectoryEvents.machCrossings.length
                                ? load.trajectoryEvents.machCrossings
                                      .map((crossing) => {
                                          const direction =
                                              crossing.direction === 'decelerating' ? '↓' : '↑';
                                          const crossingDistance = formatNumber(
                                              distance(crossing.distanceM),
                                              1,
                                          );
                                          return (
                                              `${crossing.mach.toFixed(1)} ${direction} @ ` +
                                              `${crossingDistance} ${distanceUnit}`
                                          );
                                      })
                                      .join(' · ')
                                : 'none in horizon'
                        }
                        wide
                    />
                </section>
            </div>
            {load.buckshotPattern ? (
                <section className="panel buckshot-pattern-result">
                    <div className="panel-head">
                        <h3>Empirical buckshot pattern</h3>
                        <span className={`pattern-status ${load.buckshotPattern.status}`}>
                            {load.buckshotPattern.status.replaceAll('_', ' ')}
                        </span>
                    </div>
                    <div className="readout-grid pattern-readout-grid">
                        <div className="rgroup">
                            <header>Pattern fit</header>
                            <Row
                                label="Target range"
                                value={formatNumber(distance(load.buckshotPattern.targetRangeM), 1)}
                                unit={distanceUnit}
                            />
                            <Row
                                label="Predicted D90"
                                value={formatNumber(
                                    displacement(load.buckshotPattern.predictedDiameter90M),
                                    1,
                                )}
                                unit={displacementUnit}
                            />
                            <Row
                                label="D90 95% interval"
                                value={`${formatNumber(
                                    displacement(load.buckshotPattern.predictedDiameter90Low95M),
                                    1,
                                )}–${formatNumber(
                                    displacement(load.buckshotPattern.predictedDiameter90High95M),
                                    1,
                                )}`}
                                unit={displacementUnit}
                            />
                            <Row
                                label="Calibration RMSE"
                                value={formatNumber(
                                    displacement(load.buckshotPattern.calibrationRmseM),
                                    2,
                                )}
                                unit={displacementUnit}
                            />
                            <Row
                                label="Holdout RMSE"
                                value={formatNumber(
                                    displacement(load.buckshotPattern.holdoutRmseM),
                                    2,
                                )}
                                unit={displacementUnit}
                            />
                        </div>
                        <div className="rgroup">
                            <header>Pellet-count distribution</header>
                            <Row
                                label="Per-pellet hit probability"
                                value={formatNumber(
                                    load.buckshotPattern.perPelletHitProbability * 100,
                                    1,
                                )}
                                unit="%"
                            />
                            <Row
                                label="Expected pellet count"
                                value={formatNumber(load.buckshotPattern.expectedPelletCount, 2)}
                                unit={`of ${load.pelletCount}`}
                            />
                            <Row
                                label={`Probability of ≥${load.buckshotPattern.minimumPelletCount}`}
                                value={formatNumber(
                                    load.buckshotPattern.probabilityAtLeastMinimum * 100,
                                    1,
                                )}
                                unit="%"
                            />
                            <Row label="Choke" value={load.buckshotPattern.choke} wide />
                            <Row
                                label="Pellet condition"
                                value={load.buckshotPattern.deformationClass}
                                wide
                            />
                        </div>
                    </div>
                    <p className="pattern-validity">{load.buckshotPattern.validityStatement}</p>
                </section>
            ) : null}
            <div className="panel">
                <div className="panel-head">
                    <h3>Trajectory</h3>
                    <label className="metric-select">
                        Quantity
                        <select
                            value={metric}
                            onChange={(event) => onMetricChange(event.target.value as Metric)}
                        >
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
                    loads={loads}
                    selectedLoad={load}
                    metric={metric}
                    units={units}
                    selectedDistance={referenceDistanceM}
                    onSelectedDistance={onReferenceDistanceChange}
                    sightHeights={inputs}
                    zeros={inputs}
                />
            </div>
        </>
    );
}
