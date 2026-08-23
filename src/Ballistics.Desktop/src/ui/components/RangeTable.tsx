import { useMemo } from 'react';
import type { Inputs, Load, Point } from '../types';
import { formatNumber } from '../lib/format';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathAt } from '../lib/holdover';
import { projectileLabel } from '../lib/labels';
import { pointAt, uncertaintyAt } from '../lib/trajectory';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';

const CONFIDENCE_95_MULTIPLIER = 1.959963984540054;

type Props = {
    load: Load;
    inputs: Inputs;
    imperial: boolean;
    referenceDistance: number;
    tableStep: number;
    onTableStepChange: (step: number) => void;
};

export function RangeTable({
    load,
    inputs,
    imperial,
    referenceDistance,
    tableStep,
    onTableStepChange,
}: Props) {
    const dist = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const velocity = (value: number) => (imperial ? value * MPS_TO_FPS : value);
    const energy = (value: number) => (imperial ? value * J_TO_FTLB : value);
    const momentum = (value: number) => (imperial ? value * KGMS_TO_LBFTS : value);
    const drop = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
    const tableStepM = imperial ? tableStep / M_TO_YD : tableStep;
    const showUncertainty = load.uncertainty?.status === 'complete';
    const geometry = sightGeometry(load, inputs, inputs);
    const rows = useMemo(() => {
        const samples: Point[] = [];
        for (let distance = 0; distance <= inputs.distanceM + 0.001; distance += tableStepM) {
            const sample = pointAt(load.points, distance);
            if (sample) samples.push(sample);
        }
        return samples;
    }, [inputs.distanceM, load, tableStepM]);

    return (
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
                        onChange={(e) => onTableStepChange(Number(e.target.value))}
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
                            {showUncertainty && (
                                <th>Velocity 95% ± ({imperial ? 'ft/s' : 'm/s'})</th>
                            )}
                            <th>
                                Energy/{projectileLabel(load)} ({imperial ? 'ft·lbf' : 'J'})
                            </th>
                            <th>Payload energy ({imperial ? 'ft·lbf' : 'J'})</th>
                            {showUncertainty && <th>Energy 95% ± ({imperial ? 'ft·lbf' : 'J'})</th>}
                            <th>
                                Momentum/{projectileLabel(load)} ({imperial ? 'lb·ft/s' : 'kg·m/s'})
                            </th>
                            <th>Payload momentum ({imperial ? 'lb·ft/s' : 'kg·m/s'})</th>
                            <th>Time (s)</th>
                            <th>Drop ({imperial ? 'in' : 'cm'})</th>
                            {showUncertainty && <th>Drop 95% ± ({imperial ? 'in' : 'cm'})</th>}
                            <th>Mach</th>
                            <th>Cd</th>
                            <th>Reynolds</th>
                            <th>Spin ({imperial ? 'in' : 'cm'})</th>
                            <th>Wind ({imperial ? 'in' : 'cm'})</th>
                            {showUncertainty && <th>Wind 95% ± ({imperial ? 'in' : 'cm'})</th>}
                            <th>Windage ({imperial ? 'in' : 'cm'})</th>
                            <th>Path ({imperial ? 'in' : 'cm'})</th>
                            {showUncertainty && <th>Path 95% ± ({imperial ? 'in' : 'cm'})</th>}
                            <th>Hold (MOA)</th>
                            <th>Hold (mil)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => {
                            const uncertaintySample =
                                load.uncertainty?.status === 'complete'
                                    ? uncertaintyAt(load.uncertainty.points, p.distanceM)
                                    : undefined;
                            const available = uncertaintySample?.available === true;
                            const confidence = (standardDeviation: number) =>
                                available
                                    ? standardDeviation * CONFIDENCE_95_MULTIPLIER
                                    : Number.NaN;
                            return (
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
                                    {showUncertainty && (
                                        <td>
                                            {formatNumber(
                                                velocity(
                                                    confidence(
                                                        uncertaintySample?.speedStandardDeviationMps ??
                                                            Number.NaN,
                                                    ),
                                                ),
                                                1,
                                            )}
                                        </td>
                                    )}
                                    <td>{formatNumber(energy(p.energyJ), 0)}</td>
                                    <td>{formatNumber(energy(p.energyJ * load.pelletCount), 0)}</td>
                                    {showUncertainty && (
                                        <td>
                                            {formatNumber(
                                                energy(
                                                    confidence(
                                                        uncertaintySample?.energyStandardDeviationJ ??
                                                            Number.NaN,
                                                    ),
                                                ),
                                                0,
                                            )}
                                        </td>
                                    )}
                                    <td>{momentum(p.momentumKgms).toFixed(3)}</td>
                                    <td>
                                        {momentum(p.momentumKgms * load.pelletCount).toFixed(3)}
                                    </td>
                                    <td>{p.timeS.toFixed(3)}</td>
                                    <td>{drop(p.dropM).toFixed(2)}</td>
                                    {showUncertainty && (
                                        <td>
                                            {formatNumber(
                                                drop(
                                                    confidence(
                                                        uncertaintySample?.dropStandardDeviationM ??
                                                            Number.NaN,
                                                    ),
                                                ),
                                                2,
                                            )}
                                        </td>
                                    )}
                                    <td>{p.mach.toFixed(3)}</td>
                                    <td>{(p.cd ?? p.referenceCd)?.toFixed(3) || 'N/A'}</td>
                                    <td>
                                        {p.reynolds === undefined
                                            ? 'N/A'
                                            : formatNumber(p.reynolds, 0)}
                                    </td>
                                    <td>{formatNumber(drop(p.spinDriftM ?? Number.NaN), 2)}</td>
                                    <td>{drop(p.windDriftM).toFixed(2)}</td>
                                    {showUncertainty && (
                                        <td>
                                            {formatNumber(
                                                drop(
                                                    confidence(
                                                        uncertaintySample?.windDriftStandardDeviationM ??
                                                            Number.NaN,
                                                    ),
                                                ),
                                                2,
                                            )}
                                        </td>
                                    )}
                                    <td>
                                        {formatNumber(
                                            drop(
                                                p.spinDriftM === null
                                                    ? Number.NaN
                                                    : p.spinDriftM + p.windDriftM,
                                            ),
                                            2,
                                        )}
                                    </td>
                                    {(() => {
                                        const path = sightPathAt(p, geometry);
                                        return (
                                            <>
                                                <td>{drop(path).toFixed(2)}</td>
                                                {showUncertainty && (
                                                    <td>
                                                        {formatNumber(
                                                            drop(
                                                                confidence(
                                                                    uncertaintySample?.pathStandardDeviationM ??
                                                                        Number.NaN,
                                                                ),
                                                            ),
                                                            2,
                                                        )}
                                                    </td>
                                                )}
                                                <td>{holdoverMoa(p.holdoverRad).toFixed(1)}</td>
                                                <td>{holdoverMil(p.holdoverRad).toFixed(2)}</td>
                                            </>
                                        );
                                    })()}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
