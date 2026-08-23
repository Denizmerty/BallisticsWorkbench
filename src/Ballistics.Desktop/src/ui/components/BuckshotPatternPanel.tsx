import type { Dispatch, SetStateAction } from 'react';
import type { Inputs, Load, PatternObservationRequest } from '../types';
import { Field } from './Field';

type Props = {
    inputs: Inputs;
    imperial: boolean;
    shotgunLoads: Pick<Load, 'id' | 'shortName' | 'pelletCount'>[];
    setInputs: Dispatch<SetStateAction<Inputs>>;
};

export function BuckshotPatternPanel({ inputs, imperial, shotgunLoads, setInputs }: Props) {
    const pattern = inputs.buckshotPattern;
    const distance = (metres: number) => (imperial ? metres / 0.3048 : metres);
    const fromDistance = (value: number) => (imperial ? value * 0.3048 : value);
    const update = (changes: Partial<Inputs['buckshotPattern']>) =>
        setInputs((current) => ({
            ...current,
            buckshotPattern: { ...current.buckshotPattern, ...changes },
        }));
    const updateTarget = (changes: Partial<Inputs['buckshotPattern']['target']>) =>
        update({ target: { ...pattern.target, ...changes } });
    const updateObservation = (index: number, changes: Partial<PatternObservationRequest>) =>
        update({
            observations: pattern.observations.map((observation, observationIndex) =>
                observationIndex === index ? { ...observation, ...changes } : observation,
            ),
        });
    const addObservation = () => {
        if (pattern.observations.length >= 64) return;
        const calibrationCount = pattern.observations.filter(
            (observation) => observation.role === 'calibration',
        ).length;
        update({
            observations: [
                ...pattern.observations,
                {
                    rangeM: 0,
                    diameter90M: 0,
                    standardUncertaintyM: 0,
                    shellCount: 1,
                    role: calibrationCount < 2 ? 'calibration' : 'holdout',
                },
            ],
        });
    };

    return (
        <div className="groupbox buckshot-pattern-inputs">
            <details open={pattern.enabled}>
                <summary className="section-title">
                    <span>Empirical buckshot pattern</span>
                    <small>{pattern.enabled ? 'Active' : 'Optional'}</small>
                </summary>
                <label className="advanced-checkbox">
                    <input
                        type="checkbox"
                        checked={pattern.enabled}
                        onChange={(event) => update({ enabled: event.target.checked })}
                    />
                    Fit measured D90 patterns and estimate pellet-count probability
                </label>
                {pattern.enabled ? (
                    <>
                        <p className="advanced-note">
                            Enter measurements for this exact load, choke, pellet construction, and
                            velocity spread. At least one physically separate holdout is mandatory.
                        </p>
                        <div className="fields">
                            <label className="field wide">
                                <span>Shotgun load</span>
                                <select
                                    value={pattern.loadId}
                                    onChange={(event) => update({ loadId: event.target.value })}
                                >
                                    {shotgunLoads.length ? (
                                        shotgunLoads.map((load) => (
                                            <option key={load.id} value={load.id}>
                                                {load.shortName} ({load.pelletCount} pellets)
                                            </option>
                                        ))
                                    ) : (
                                        <option value={pattern.loadId}>{pattern.loadId}</option>
                                    )}
                                </select>
                            </label>
                            <label className="field">
                                <span>Choke</span>
                                <select
                                    value={pattern.choke}
                                    onChange={(event) =>
                                        update({
                                            choke: event.target.value as typeof pattern.choke,
                                        })
                                    }
                                >
                                    <option value="cylinder">Cylinder</option>
                                    <option value="improvedCylinder">Improved cylinder</option>
                                    <option value="modified">Modified</option>
                                    <option value="full">Full</option>
                                    <option value="custom">Custom/measured</option>
                                </select>
                            </label>
                            <label className="field">
                                <span>Pellet condition</span>
                                <select
                                    value={pattern.deformationClass}
                                    onChange={(event) =>
                                        update({
                                            deformationClass: event.target
                                                .value as typeof pattern.deformationClass,
                                        })
                                    }
                                >
                                    <option value="softLead">Soft lead</option>
                                    <option value="hardenedLead">Hardened lead</option>
                                    <option value="plated">Plated</option>
                                    <option value="buffered">Buffered payload</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>
                            <Field
                                label="Pellet velocity SD"
                                value={pattern.pelletVelocityStandardDeviationMps}
                                unit="m/s"
                                onChange={(value) =>
                                    update({ pelletVelocityStandardDeviationMps: value })
                                }
                            />
                            <Field
                                label="Pattern target range"
                                value={distance(pattern.targetRangeM)}
                                unit={imperial ? 'ft' : 'm'}
                                onChange={(value) => update({ targetRangeM: fromDistance(value) })}
                            />
                            <Field
                                label="Minimum pellet count"
                                value={pattern.minimumPelletCount}
                                unit="pellets"
                                onChange={(value) => update({ minimumPelletCount: value })}
                            />
                            <label className="field">
                                <span>Target region</span>
                                <select
                                    value={pattern.target.shape}
                                    onChange={(event) =>
                                        updateTarget({
                                            shape: event.target
                                                .value as typeof pattern.target.shape,
                                        })
                                    }
                                >
                                    <option value="circle">Circle</option>
                                    <option value="rectangle">Rectangle</option>
                                </select>
                            </label>
                            <Field
                                label={
                                    pattern.target.shape === 'circle' ? 'Target diameter' : 'Width'
                                }
                                value={distance(pattern.target.widthM)}
                                unit={imperial ? 'ft' : 'm'}
                                onChange={(value) => updateTarget({ widthM: fromDistance(value) })}
                            />
                            {pattern.target.shape === 'rectangle' ? (
                                <Field
                                    label="Height"
                                    value={distance(pattern.target.heightM)}
                                    unit={imperial ? 'ft' : 'm'}
                                    onChange={(value) =>
                                        updateTarget({ heightM: fromDistance(value) })
                                    }
                                />
                            ) : null}
                            <Field
                                label="Horizontal offset"
                                value={distance(pattern.target.centerHorizontalM)}
                                unit={imperial ? 'ft' : 'm'}
                                onChange={(value) =>
                                    updateTarget({ centerHorizontalM: fromDistance(value) })
                                }
                            />
                            <Field
                                label="Vertical offset"
                                value={distance(pattern.target.centerVerticalM)}
                                unit={imperial ? 'ft' : 'm'}
                                onChange={(value) =>
                                    updateTarget({ centerVerticalM: fromDistance(value) })
                                }
                            />
                        </div>
                        <div className="advanced-model-editor pattern-observations">
                            <div className="advanced-model-heading">
                                <strong>D90 observations</strong>
                                <button
                                    type="button"
                                    onClick={addObservation}
                                    disabled={pattern.observations.length >= 64}
                                >
                                    Add observation
                                </button>
                            </div>
                            {pattern.observations.map((observation, index) => (
                                <div className="pattern-observation-card" key={`pattern-${index}`}>
                                    <div className="fields">
                                        <Field
                                            label="Range"
                                            value={distance(observation.rangeM)}
                                            unit={imperial ? 'ft' : 'm'}
                                            onChange={(value) =>
                                                updateObservation(index, {
                                                    rangeM: fromDistance(value),
                                                })
                                            }
                                        />
                                        <Field
                                            label="D90 diameter"
                                            value={distance(observation.diameter90M)}
                                            unit={imperial ? 'ft' : 'm'}
                                            onChange={(value) =>
                                                updateObservation(index, {
                                                    diameter90M: fromDistance(value),
                                                })
                                            }
                                        />
                                        <Field
                                            label="Diameter SD"
                                            value={distance(observation.standardUncertaintyM)}
                                            unit={imperial ? 'ft' : 'm'}
                                            onChange={(value) =>
                                                updateObservation(index, {
                                                    standardUncertaintyM: fromDistance(value),
                                                })
                                            }
                                        />
                                        <Field
                                            label="Shell count"
                                            value={observation.shellCount}
                                            unit="shells"
                                            onChange={(value) =>
                                                updateObservation(index, { shellCount: value })
                                            }
                                        />
                                        <label className="field">
                                            <span>Evidence role</span>
                                            <select
                                                value={observation.role}
                                                onChange={(event) =>
                                                    updateObservation(index, {
                                                        role: event.target
                                                            .value as PatternObservationRequest['role'],
                                                    })
                                                }
                                            >
                                                <option value="calibration">Calibration</option>
                                                <option value="holdout">Holdout</option>
                                            </select>
                                        </label>
                                    </div>
                                    <button
                                        className="advanced-remove"
                                        type="button"
                                        onClick={() =>
                                            update({
                                                observations: pattern.observations.filter(
                                                    (_, observationIndex) =>
                                                        observationIndex !== index,
                                                ),
                                            })
                                        }
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                        <p className="uncertainty-note">
                            D90 is the diameter containing 90% of impacts. The fitted model assumes
                            isotropic independent pellet impacts. It does not infer pellet wakes or
                            swarm aerodynamics.
                        </p>
                    </>
                ) : null}
            </details>
        </div>
    );
}
