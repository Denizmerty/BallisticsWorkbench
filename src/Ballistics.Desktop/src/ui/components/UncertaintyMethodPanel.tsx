import type { Dispatch, SetStateAction } from 'react';
import type { UncertaintySettings, UncertaintyVariableRequest } from '../types';
import { Field } from './Field';

const VARIABLES: Array<{ value: UncertaintyVariableRequest; label: string }> = [
    { value: 'muzzleVelocity', label: 'Muzzle velocity' },
    { value: 'drag', label: 'BC / drag scale' },
    { value: 'temperature', label: 'Temperature' },
    { value: 'stationPressure', label: 'Station pressure' },
    { value: 'headwind', label: 'Headwind' },
    { value: 'crosswind', label: 'Crosswind' },
    { value: 'zeroRange', label: 'Zero range' },
];

type Props = {
    uncertainty: UncertaintySettings;
    errors: Partial<Record<keyof UncertaintySettings, string>>;
    setUncertainty: Dispatch<SetStateAction<UncertaintySettings>>;
};

export function UncertaintyMethodPanel({ uncertainty, errors, setUncertainty }: Props) {
    const updateCorrelation = (
        index: number,
        key: 'first' | 'second' | 'coefficient',
        value: string | number,
    ) =>
        setUncertainty((current) => ({
            ...current,
            correlations: current.correlations.map((entry, entryIndex) =>
                entryIndex === index ? { ...entry, [key]: value } : entry,
            ),
        }));
    const addCorrelation = () =>
        setUncertainty((current) =>
            current.correlations.length >= 21
                ? current
                : {
                      ...current,
                      correlations: [
                          ...current.correlations,
                          { first: 'muzzleVelocity', second: 'drag', coefficient: 0 },
                      ],
                  },
        );
    const removeCorrelation = (index: number) =>
        setUncertainty((current) => ({
            ...current,
            correlations: current.correlations.filter((_, entryIndex) => entryIndex !== index),
        }));

    return (
        <div className="uncertainty-method-panel">
            <label className="field wide">
                <span>Propagation method</span>
                <select
                    value={uncertainty.method}
                    onChange={(event) =>
                        setUncertainty((current) => ({
                            ...current,
                            method: event.target.value as UncertaintySettings['method'],
                        }))
                    }
                >
                    <option value="firstOrder">First-order finite difference</option>
                    <option value="monteCarlo">Monte Carlo sampling</option>
                </select>
            </label>
            {uncertainty.method === 'monteCarlo' ? (
                <>
                    <div className="fields">
                        <Field
                            label="Samples"
                            value={uncertainty.sampleCount}
                            unit="runs"
                            error={errors.sampleCount}
                            onChange={(sampleCount) =>
                                setUncertainty((current) => ({
                                    ...current,
                                    sampleCount: Math.round(sampleCount),
                                }))
                            }
                        />
                        <Field
                            label="Random seed"
                            value={uncertainty.seed}
                            unit="integer"
                            error={errors.seed}
                            onChange={(seed) =>
                                setUncertainty((current) => ({
                                    ...current,
                                    seed: Math.max(0, Math.round(seed)),
                                }))
                            }
                        />
                    </div>
                    <div className="advanced-model-editor">
                        <div className="advanced-model-heading">
                            <strong>Input correlations</strong>
                            <button
                                type="button"
                                onClick={addCorrelation}
                                disabled={uncertainty.correlations.length >= 21}
                            >
                                Add correlation
                            </button>
                        </div>
                        {uncertainty.correlations.map((correlation, index) => (
                            <div className="uncertainty-correlation-row" key={index}>
                                <select
                                    aria-label={`Correlation ${index + 1} first variable`}
                                    value={correlation.first}
                                    onChange={(event) =>
                                        updateCorrelation(index, 'first', event.target.value)
                                    }
                                >
                                    {VARIABLES.map((variable) => (
                                        <option key={variable.value} value={variable.value}>
                                            {variable.label}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label={`Correlation ${index + 1} second variable`}
                                    value={correlation.second}
                                    onChange={(event) =>
                                        updateCorrelation(index, 'second', event.target.value)
                                    }
                                >
                                    {VARIABLES.map((variable) => (
                                        <option key={variable.value} value={variable.value}>
                                            {variable.label}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    aria-label={`Correlation ${index + 1} coefficient`}
                                    type="number"
                                    min="-0.99"
                                    max="0.99"
                                    step="0.05"
                                    value={correlation.coefficient}
                                    onChange={(event) =>
                                        updateCorrelation(
                                            index,
                                            'coefficient',
                                            Number(event.target.value),
                                        )
                                    }
                                />
                                <button
                                    className="advanced-remove"
                                    type="button"
                                    aria-label={`Remove correlation ${index + 1}`}
                                    onClick={() => removeCorrelation(index)}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        {errors.correlations ? (
                            <span className="field-error">{errors.correlations}</span>
                        ) : null}
                    </div>
                </>
            ) : null}
        </div>
    );
}
