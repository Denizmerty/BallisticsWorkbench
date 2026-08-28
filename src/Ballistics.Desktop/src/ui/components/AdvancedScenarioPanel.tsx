import type { Dispatch, SetStateAction } from 'react';
import type { Inputs } from '../types';
import { Field } from './Field';

type Props = {
    inputs: Inputs;
    imperial: boolean;
    setInputs: Dispatch<SetStateAction<Inputs>>;
};

type TemperatureProfileKey =
    'shotgunTemperatureVelocityProfile' | 'rifleTemperatureVelocityProfile';

type TemperatureSourceKey = 'shotgunTemperatureVelocitySource' | 'rifleTemperatureVelocitySource';

function TemperatureVelocityEditor({
    label,
    profileKey,
    sourceKey,
    inputs,
    setInputs,
}: {
    label: string;
    profileKey: TemperatureProfileKey;
    sourceKey: TemperatureSourceKey;
    inputs: Inputs;
    setInputs: Dispatch<SetStateAction<Inputs>>;
}) {
    const points = inputs[profileKey];
    const updatePoint = (index: number, field: 'temperatureC' | 'multiplier', value: number) =>
        setInputs((current) => ({
            ...current,
            [profileKey]: current[profileKey].map((point, pointIndex) =>
                pointIndex === index ? { ...point, [field]: value } : point,
            ),
        }));
    const addPoint = () =>
        setInputs((current) => {
            const profile = current[profileKey];
            if (profile.length === 0) {
                return {
                    ...current,
                    [profileKey]: [
                        { temperatureC: -20, multiplier: 0.98 },
                        { temperatureC: 30, multiplier: 1.02 },
                    ],
                };
            }
            if (profile.length >= 12) return current;
            const last = profile.at(-1)!;
            return {
                ...current,
                [profileKey]: [
                    ...profile,
                    {
                        temperatureC: Math.min(60, last.temperatureC + 10),
                        multiplier: last.multiplier,
                    },
                ],
            };
        });
    const removePoint = (index: number) =>
        setInputs((current) => {
            const remaining = current[profileKey].filter((_, pointIndex) => pointIndex !== index);
            return { ...current, [profileKey]: remaining.length === 1 ? [] : remaining };
        });

    return (
        <div className="advanced-model-editor">
            <div className="advanced-model-heading">
                <strong>{label}</strong>
                <button type="button" onClick={addPoint} disabled={points.length >= 12}>
                    {points.length ? 'Add point' : 'Enable profile'}
                </button>
            </div>
            {points.map((point, index) => (
                <div className="advanced-model-row" key={`${profileKey}-${index}`}>
                    <Field
                        label="Temperature"
                        value={point.temperatureC}
                        unit="°C"
                        onChange={(value) => updatePoint(index, 'temperatureC', value)}
                    />
                    <Field
                        label="Velocity change"
                        value={(point.multiplier - 1) * 100}
                        unit="%"
                        onChange={(value) => updatePoint(index, 'multiplier', 1 + value / 100)}
                    />
                    <button
                        className="advanced-remove"
                        type="button"
                        aria-label={`Remove ${label} point ${index + 1}`}
                        onClick={() => removePoint(index)}
                    >
                        Remove
                    </button>
                </div>
            ))}
            {points.length ? (
                <label className="field wide">
                    <span>Measurement/source note</span>
                    <input
                        className="advanced-source"
                        type="text"
                        maxLength={240}
                        value={inputs[sourceKey]}
                        onChange={(event) =>
                            setInputs((current) => ({
                                ...current,
                                [sourceKey]: event.target.value,
                            }))
                        }
                    />
                </label>
            ) : null}
        </div>
    );
}

export function AdvancedScenarioPanel({ inputs, imperial, setInputs }: Props) {
    const metres = (value: number) => (imperial ? value / 0.3048 : value);
    const fromDisplayedMetres = (value: number) => (imperial ? value * 0.3048 : value);
    const setNumber =
        <Key extends keyof Inputs>(key: Key) =>
        (value: number) =>
            setInputs((current) => ({ ...current, [key]: value }));
    const setBoolean =
        <Key extends keyof Inputs>(key: Key) =>
        (checked: boolean) =>
            setInputs((current) => ({ ...current, [key]: checked }));
    const updateLayer = (
        index: number,
        field: keyof Inputs['windLayers'][number],
        value: string | number,
    ) =>
        setInputs((current) => ({
            ...current,
            windLayers: current.windLayers.map((layer, layerIndex) =>
                layerIndex === index ? { ...layer, [field]: value } : layer,
            ),
        }));
    const addLayer = () =>
        setInputs((current) =>
            current.windLayers.length >= 16
                ? current
                : {
                      ...current,
                      windLayers: [
                          ...current.windLayers,
                          {
                              axis: 'downrange',
                              startM: current.windLayers.at(-1)?.endM ?? 0,
                              endM: (current.windLayers.at(-1)?.endM ?? 0) + 100,
                              startHeadwindMps: current.headwindMps,
                              endHeadwindMps: current.headwindMps,
                              startCrosswindMps: current.crosswindMps,
                              endCrosswindMps: current.crosswindMps,
                          },
                      ],
                  },
        );

    return (
        <div className="groupbox advanced-scenario">
            <details>
                <summary className="section-title">
                    <span>Advanced environment and geometry</span>
                    <small>
                        {inputs.windLayers.length ||
                        inputs.coriolisEnabled ||
                        inputs.altitudeDependentAtmosphere
                            ? 'Active'
                            : 'Optional'}
                    </small>
                </summary>
                <div className="advanced-toggle-grid">
                    <label>
                        <input
                            type="checkbox"
                            checked={inputs.altitudeDependentAtmosphere}
                            onChange={(event) =>
                                setBoolean('altitudeDependentAtmosphere')(event.target.checked)
                            }
                        />
                        Atmosphere changes with projectile height
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={inputs.useLocalGravity}
                            onChange={(event) =>
                                setBoolean('useLocalGravity')(event.target.checked)
                            }
                        />
                        WGS-84 local gravity
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={inputs.coriolisEnabled}
                            onChange={(event) =>
                                setBoolean('coriolisEnabled')(event.target.checked)
                            }
                        />
                        Coriolis acceleration
                    </label>
                </div>
                <div className="fields">
                    <Field
                        label="Target inclination"
                        value={inputs.targetInclinationDeg}
                        unit="°"
                        onChange={(value) =>
                            setInputs((current) => ({
                                ...current,
                                targetInclinationDeg: value,
                                ...(Math.abs(value) > 1e-12 ? { targetElevationM: 0 } : {}),
                            }))
                        }
                    />
                    <Field
                        label="Target elevation"
                        value={metres(inputs.targetElevationM)}
                        unit={imperial ? 'ft' : 'm'}
                        onChange={(value) => {
                            const targetElevationM = fromDisplayedMetres(value);
                            setInputs((current) => ({
                                ...current,
                                targetElevationM,
                                ...(Math.abs(targetElevationM) > 1e-12
                                    ? { targetInclinationDeg: 0 }
                                    : {}),
                            }));
                        }}
                    />
                    <Field
                        label="Latitude"
                        value={inputs.latitudeDeg}
                        unit="°"
                        onChange={setNumber('latitudeDeg')}
                    />
                    <Field
                        label="Shot azimuth"
                        value={inputs.azimuthDeg}
                        unit="° true"
                        onChange={setNumber('azimuthDeg')}
                    />
                </div>

                <div className="advanced-model-editor">
                    <div className="advanced-model-heading">
                        <strong>Wind layers</strong>
                        <button
                            type="button"
                            onClick={addLayer}
                            disabled={inputs.windLayers.length >= 16}
                        >
                            Add layer
                        </button>
                    </div>
                    {inputs.windLayers.map((layer, index) => (
                        <div className="wind-layer-card" key={`wind-layer-${index}`}>
                            <div className="advanced-model-heading">
                                <label className="field">
                                    <span>Layer {index + 1} axis</span>
                                    <select
                                        value={layer.axis}
                                        onChange={(event) =>
                                            updateLayer(index, 'axis', event.target.value)
                                        }
                                    >
                                        <option value="downrange">Downrange</option>
                                        <option value="height">Height</option>
                                    </select>
                                </label>
                                <button
                                    className="advanced-remove"
                                    type="button"
                                    onClick={() =>
                                        setInputs((current) => ({
                                            ...current,
                                            windLayers: current.windLayers.filter(
                                                (_, layerIndex) => layerIndex !== index,
                                            ),
                                        }))
                                    }
                                >
                                    Remove
                                </button>
                            </div>
                            <div className="fields">
                                <Field
                                    label="Start"
                                    value={metres(layer.startM)}
                                    unit={imperial ? 'ft' : 'm'}
                                    onChange={(value) =>
                                        updateLayer(index, 'startM', fromDisplayedMetres(value))
                                    }
                                />
                                <Field
                                    label="End"
                                    value={metres(layer.endM)}
                                    unit={imperial ? 'ft' : 'm'}
                                    onChange={(value) =>
                                        updateLayer(index, 'endM', fromDisplayedMetres(value))
                                    }
                                />
                                <Field
                                    label="Start headwind"
                                    value={layer.startHeadwindMps}
                                    unit="m/s"
                                    onChange={(value) =>
                                        updateLayer(index, 'startHeadwindMps', value)
                                    }
                                />
                                <Field
                                    label="End headwind"
                                    value={layer.endHeadwindMps}
                                    unit="m/s"
                                    onChange={(value) =>
                                        updateLayer(index, 'endHeadwindMps', value)
                                    }
                                />
                                <Field
                                    label="Start crosswind"
                                    value={layer.startCrosswindMps}
                                    unit="m/s"
                                    onChange={(value) =>
                                        updateLayer(index, 'startCrosswindMps', value)
                                    }
                                />
                                <Field
                                    label="End crosswind"
                                    value={layer.endCrosswindMps}
                                    unit="m/s"
                                    onChange={(value) =>
                                        updateLayer(index, 'endCrosswindMps', value)
                                    }
                                />
                            </div>
                        </div>
                    ))}
                    {inputs.windLayers.length ? (
                        <label className="field wide">
                            <span>Wind measurement/source note</span>
                            <input
                                className="advanced-source"
                                type="text"
                                maxLength={240}
                                value={inputs.windProvenance}
                                onChange={(event) =>
                                    setInputs((current) => ({
                                        ...current,
                                        windProvenance: event.target.value,
                                    }))
                                }
                            />
                        </label>
                    ) : null}
                </div>

                <TemperatureVelocityEditor
                    label="Shotgun temperature/velocity"
                    profileKey="shotgunTemperatureVelocityProfile"
                    sourceKey="shotgunTemperatureVelocitySource"
                    inputs={inputs}
                    setInputs={setInputs}
                />
                <TemperatureVelocityEditor
                    label="Rifle temperature/velocity"
                    profileKey="rifleTemperatureVelocityProfile"
                    sourceKey="rifleTemperatureVelocitySource"
                    inputs={inputs}
                    setInputs={setInputs}
                />
            </details>
        </div>
    );
}
