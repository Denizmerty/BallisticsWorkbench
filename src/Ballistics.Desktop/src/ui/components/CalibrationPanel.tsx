import { useEffect, useRef, useState } from 'react';
import type {
    CalibrationObservation,
    CalibrationRequest,
    CalibrationResult,
    CustomDraft,
    Inputs,
} from '../types';
import { MPS_TO_FPS, M_TO_YD } from '../lib/units';
import {
    calibrateReferenceBc,
    createCalibrationRequest,
    saveCalibrationCsv,
    validateCalibrationObservations,
} from '../lib/calibration';

type Props = {
    draft: CustomDraft;
    inputs: Inputs;
    imperial: boolean;
    onApply: (patch: Partial<CustomDraft>) => void;
};

const initialObservations = (): CalibrationObservation[] => [
    { distanceM: 100, velocityMps: Number.NaN, standardDeviationMps: 1, role: 'calibration' },
    { distanceM: 200, velocityMps: Number.NaN, standardDeviationMps: 1, role: 'calibration' },
    { distanceM: 300, velocityMps: Number.NaN, standardDeviationMps: 1, role: 'holdout' },
];

const shown = (value: number, scale = 1) => (Number.isFinite(value) ? value * scale : '');

export function CalibrationPanel({ draft, inputs, imperial, onApply }: Props) {
    const [fitKind, setFitKind] = useState<'constant' | 'velocityBands'>('constant');
    const [thresholds, setThresholds] = useState([
        0,
        Math.min(2000, Math.max(100, draft.mv * 0.8)),
    ]);
    const [observations, setObservations] = useState(initialObservations);
    const [result, setResult] = useState<CalibrationResult | null>(null);
    const [resultRequest, setResultRequest] = useState<CalibrationRequest | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const distanceScale = imperial ? M_TO_YD : 1;
    const velocityScale = imperial ? MPS_TO_FPS : 1;
    const parameterCount = fitKind === 'constant' ? 1 : thresholds.length;
    const thresholdErrors =
        fitKind === 'velocityBands'
            ? [
                  ...(thresholds.length < 2 || thresholds.length > 4
                      ? ['Use between 2 and 4 velocity bands.']
                      : []),
                  ...(thresholds[0] !== 0 ? ['The first velocity band must begin at 0 m/s.'] : []),
                  ...(thresholds.some(
                      (value, index) =>
                          !Number.isFinite(value) ||
                          value < 0 ||
                          value > 2000 ||
                          (index > 0 && value <= thresholds[index - 1]),
                  )
                      ? ['Velocity-band thresholds must be strictly increasing from 0 to 2000 m/s.']
                      : []),
              ]
            : [];
    const validationErrors = [
        ...thresholdErrors,
        ...validateCalibrationObservations(observations, parameterCount),
    ];

    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        setResult(null);
        setResultRequest(null);
    }, [draft.drag, draft.massG, draft.mv, draft.bc, fitKind, inputs, observations, thresholds]);

    const updateObservation = (index: number, patch: Partial<CalibrationObservation>) =>
        setObservations((current) =>
            current.map((observation, itemIndex) =>
                itemIndex === index ? { ...observation, ...patch } : observation,
            ),
        );

    const runFit = async () => {
        if (validationErrors.length) return;
        const request = createCalibrationRequest(
            inputs,
            draft,
            observations,
            fitKind,
            fitKind === 'velocityBands' ? thresholds : [],
            `calibration-${Date.now().toString(36)}`,
        );
        const nextController = new AbortController();
        controller.current?.abort();
        controller.current = nextController;
        setBusy(true);
        setError('');
        try {
            const nextResult = await calibrateReferenceBc(request, nextController.signal);
            if (nextController.signal.aborted) return;
            setResult(nextResult);
            setResultRequest(request);
        } catch (reason) {
            if (reason instanceof DOMException && reason.name === 'AbortError') return;
            setError(reason instanceof Error ? reason.message : 'Calibration failed.');
        } finally {
            if (controller.current === nextController) {
                controller.current = null;
                setBusy(false);
            }
        }
    };

    const applyFit = () => {
        if (
            !result ||
            result.calibration.status !== 'converged' ||
            !result.calibration.estimates.length
        )
            return;
        if (result.calibration.fitKind === 'constant') {
            onApply({
                bcMode: 'constant',
                bc: result.calibration.estimates[0].ballisticCoefficient,
            });
            return;
        }
        onApply({
            bcMode: 'velocityBands',
            bcBands: result.calibration.estimates.map((estimate) => ({
                minimumVelocityMps: estimate.minimumVelocityMps,
                ballisticCoefficient: estimate.ballisticCoefficient,
            })),
            bc: result.calibration.estimates.at(-1)!.ballisticCoefficient,
        });
    };

    return (
        <details className="calibration-panel">
            <summary>Fit G1/G7 BC from measured velocities</summary>
            <p className="calibration-intro">
                Enter chronograph or Doppler velocity observations and their one-sigma uncertainty.
                Calibration points determine the coefficients. Holdout points are evaluated only
                after fitting.
            </p>
            <div className="calibration-controls">
                <label>
                    Fit
                    <select
                        value={fitKind}
                        onChange={(event) => setFitKind(event.target.value as typeof fitKind)}
                    >
                        <option value="constant">Constant BC</option>
                        <option value="velocityBands">Velocity-banded BC</option>
                    </select>
                </label>
                <span>
                    Uses the current {draft.drag} projectile, mass, muzzle velocity, atmosphere, and
                    wind.
                </span>
            </div>
            {fitKind === 'velocityBands' && (
                <div className="calibration-thresholds">
                    <div className="calibration-threshold-head">
                        <span>Band minimum ({imperial ? 'ft/s' : 'm/s'})</span>
                        <span />
                    </div>
                    {thresholds.map((threshold, index) => (
                        <div className="calibration-threshold-row" key={index}>
                            <input
                                aria-label={`Fit band ${index + 1} minimum velocity`}
                                type="number"
                                disabled={index === 0}
                                value={shown(threshold, velocityScale)}
                                onChange={(event) =>
                                    setThresholds((current) =>
                                        current.map((value, itemIndex) =>
                                            itemIndex === index
                                                ? event.currentTarget.valueAsNumber / velocityScale
                                                : value,
                                        ),
                                    )
                                }
                            />
                            <button
                                type="button"
                                disabled={index === 0 || thresholds.length <= 2}
                                onClick={() =>
                                    setThresholds((current) =>
                                        current.filter((_value, itemIndex) => itemIndex !== index),
                                    )
                                }
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        disabled={thresholds.length >= 4 || (thresholds.at(-1) ?? 0) >= 2000}
                        onClick={() =>
                            setThresholds((current) => [
                                ...current,
                                Math.min(2000, (current.at(-1) ?? 0) + 100),
                            ])
                        }
                    >
                        Add fit band
                    </button>
                </div>
            )}
            <div className="calibration-observations">
                <div className="calibration-observation-head">
                    <span>Range ({imperial ? 'yd' : 'm'})</span>
                    <span>Velocity ({imperial ? 'ft/s' : 'm/s'})</span>
                    <span>1-sigma ({imperial ? 'ft/s' : 'm/s'})</span>
                    <span>Role</span>
                    <span />
                </div>
                {observations.map((observation, index) => (
                    <div className="calibration-observation-row" key={index}>
                        <input
                            aria-label={`Observation ${index + 1} range`}
                            type="number"
                            value={shown(observation.distanceM, distanceScale)}
                            onChange={(event) =>
                                updateObservation(index, {
                                    distanceM: event.currentTarget.valueAsNumber / distanceScale,
                                })
                            }
                        />
                        <input
                            aria-label={`Observation ${index + 1} velocity`}
                            type="number"
                            placeholder="measured"
                            value={shown(observation.velocityMps, velocityScale)}
                            onChange={(event) =>
                                updateObservation(index, {
                                    velocityMps: event.currentTarget.valueAsNumber / velocityScale,
                                })
                            }
                        />
                        <input
                            aria-label={`Observation ${index + 1} uncertainty`}
                            type="number"
                            min="0.01"
                            value={shown(observation.standardDeviationMps, velocityScale)}
                            onChange={(event) =>
                                updateObservation(index, {
                                    standardDeviationMps:
                                        event.currentTarget.valueAsNumber / velocityScale,
                                })
                            }
                        />
                        <select
                            aria-label={`Observation ${index + 1} role`}
                            value={observation.role}
                            onChange={(event) =>
                                updateObservation(index, {
                                    role: event.currentTarget
                                        .value as CalibrationObservation['role'],
                                })
                            }
                        >
                            <option value="calibration">Calibration</option>
                            <option value="holdout">Holdout</option>
                        </select>
                        <button
                            type="button"
                            disabled={observations.length <= 1}
                            onClick={() =>
                                setObservations((current) =>
                                    current.filter((_item, itemIndex) => itemIndex !== index),
                                )
                            }
                        >
                            Remove
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    disabled={observations.length >= 32}
                    onClick={() =>
                        setObservations((current) => [
                            ...current,
                            {
                                distanceM: Math.min(2000, (current.at(-1)?.distanceM ?? 0) + 100),
                                velocityMps: Number.NaN,
                                standardDeviationMps: current.at(-1)?.standardDeviationMps ?? 1,
                                role: 'calibration',
                            },
                        ])
                    }
                >
                    Add observation
                </button>
            </div>
            {!!validationErrors.length && (
                <div className="calibration-errors">
                    {validationErrors.map((message) => (
                        <span key={message}>{message}</span>
                    ))}
                </div>
            )}
            {error && <div className="calibration-errors">{error}</div>}
            <div className="calibration-actions">
                <button
                    type="button"
                    disabled={!busy && validationErrors.length > 0}
                    onClick={() => {
                        if (busy) controller.current?.abort();
                        else void runFit();
                    }}
                >
                    {busy ? 'Cancel fit' : 'Fit coefficients'}
                </button>
            </div>
            {result && (
                <section className="calibration-result">
                    <header>
                        <strong>{result.calibration.status.replaceAll('_', ' ')}</strong>
                        <span>
                            Calibration RMSE {result.calibration.calibrationRmseMps.toFixed(3)} m/s;
                            weighted RMSE {result.calibration.weightedRmse.toFixed(3)}
                        </span>
                        <span>
                            {result.calibration.holdoutRmseMps === null
                                ? 'No held-out error: this result is calibration only, not validation.'
                                : `Held-out RMSE ${result.calibration.holdoutRmseMps.toFixed(3)} m/s. ` +
                                  'This evaluates only the supplied holdout data.'}
                        </span>
                    </header>
                    <div className="calibration-estimates">
                        {result.calibration.estimates.map((estimate) => (
                            <span key={estimate.minimumVelocityMps}>
                                At or above {estimate.minimumVelocityMps.toFixed(1)} m/s: BC{' '}
                                {estimate.ballisticCoefficient.toFixed(6)}; 95% CI{' '}
                                {estimate.confidence95Low === null ||
                                estimate.confidence95High === null
                                    ? 'unavailable'
                                    : `${estimate.confidence95Low.toFixed(6)} to ${estimate.confidence95High.toFixed(6)}`}
                            </span>
                        ))}
                    </div>
                    <div className="calibration-residuals">
                        <table>
                            <thead>
                                <tr>
                                    <th>Range</th>
                                    <th>Measured</th>
                                    <th>Predicted</th>
                                    <th>Residual</th>
                                    <th>Residual / sigma</th>
                                    <th>Role</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.calibration.residuals.map((residual) => (
                                    <tr key={residual.distanceM}>
                                        <td>{(residual.distanceM * distanceScale).toFixed(1)}</td>
                                        <td>
                                            {(residual.measuredVelocityMps * velocityScale).toFixed(
                                                2,
                                            )}
                                        </td>
                                        <td>
                                            {(
                                                residual.predictedVelocityMps * velocityScale
                                            ).toFixed(2)}
                                        </td>
                                        <td>{(residual.residualMps * velocityScale).toFixed(2)}</td>
                                        <td>{residual.normalizedResidual.toFixed(2)}</td>
                                        <td>{residual.role}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <footer>
                        <span>
                            Engine {result.engineVersion}. Model {result.modelVersion}.
                            chi-square/dof {result.calibration.reducedChiSquare.toFixed(3)}
                        </span>
                        <div>
                            <button
                                type="button"
                                disabled={!resultRequest}
                                onClick={() =>
                                    resultRequest && void saveCalibrationCsv(result, resultRequest)
                                }
                            >
                                Export residual report
                            </button>
                            <button
                                type="button"
                                disabled={
                                    result.calibration.status !== 'converged' ||
                                    result.calibration.estimates.length === 0
                                }
                                onClick={applyFit}
                            >
                                Apply fitted BC
                            </button>
                        </div>
                    </footer>
                </section>
            )}
        </details>
    );
}
