import type { Dispatch, SetStateAction } from 'react';
import type { Inputs, Load, PressureSource, UncertaintySettings } from '../types';
import {
    altimeterSettingToStationPressure,
    altitudeToPressure,
    pressureToAltitude,
    stationPressureToAltimeterSetting,
} from '../lib/atmosphere';
import {
    fieldErrors,
    uncertaintyFieldErrors,
    validateInputs,
    validateUncertaintySettings,
} from '../lib/validation';
import { IN_TO_M, MPS_TO_FPS, M_TO_YD } from '../lib/units';
import { Field } from './Field';
import { AdvancedScenarioPanel } from './AdvancedScenarioPanel';
import { UncertaintyMethodPanel } from './UncertaintyMethodPanel';
import { BuckshotPatternPanel } from './BuckshotPatternPanel';

type Props = {
    inputs: Inputs;
    uncertainty: UncertaintySettings;
    imperial: boolean;
    densityAltitudeM: number | null;
    shotgunLoads: Pick<Load, 'id' | 'shortName' | 'pelletCount'>[];
    setInputs: Dispatch<SetStateAction<Inputs>>;
    setUncertainty: Dispatch<SetStateAction<UncertaintySettings>>;
    onResetAtmosphere: () => void;
    onResetAll: () => void;
};

export function InputSidebar({
    inputs,
    uncertainty,
    imperial,
    densityAltitudeM,
    shotgunLoads,
    setInputs,
    setUncertainty,
    onResetAtmosphere,
    onResetAll,
}: Props) {
    const fieldErrs = fieldErrors(inputs);
    const uncertaintyFieldErrs = uncertaintyFieldErrors(uncertainty);
    const validationErrors = validateInputs(inputs);
    const uncertaintyErrors = validateUncertaintySettings(uncertainty);
    const resolvedPressureAltitudeM = pressureToAltitude(inputs.pressureHpa);
    const dist = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const drop = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
    const set =
        <Key extends keyof Inputs>(key: Key) =>
        (value: number) =>
            setInputs((current) => ({ ...current, [key]: value }));
    const setPressureSource = (pressureSource: PressureSource) =>
        setInputs((current) => {
            const pressureAltitudeM = pressureToAltitude(current.pressureHpa);
            if (pressureSource === 'pressureAltitude') {
                return { ...current, pressureSource, pressureAltitudeM };
            }
            if (pressureSource === 'altimeterSetting') {
                return {
                    ...current,
                    pressureSource,
                    pressureAltitudeM,
                    altimeterSettingHpa: stationPressureToAltimeterSetting(
                        current.pressureHpa,
                        current.geometricAltitudeM,
                    ),
                };
            }
            return { ...current, pressureSource, pressureAltitudeM };
        });
    const setUncertaintyValue =
        <Key extends Exclude<keyof UncertaintySettings, 'enabled'>>(key: Key) =>
        (value: number) =>
            setUncertainty((current) => ({ ...current, [key]: value }));

    return (
        <aside>
            <div className="groupbox">
                <div className="section-title">
                    <span>Environment</span>
                    <small>{imperial ? 'US' : 'SI'}</small>
                </div>
                <div className="fields">
                    <Field
                        label="Range"
                        value={dist(inputs.distanceM)}
                        unit={imperial ? 'yd' : 'm'}
                        error={fieldErrs.distanceM}
                        wide
                        onChange={(v) => set('distanceM')(imperial ? v / M_TO_YD : v)}
                    />
                    <Field
                        label="Temperature"
                        value={imperial ? (inputs.temperatureC * 9) / 5 + 32 : inputs.temperatureC}
                        unit={imperial ? '°F' : '°C'}
                        error={fieldErrs.temperatureC}
                        onChange={(v) => set('temperatureC')(imperial ? ((v - 32) * 5) / 9 : v)}
                    />
                    <label className="field wide">
                        <span>Pressure source</span>
                        <select
                            value={inputs.pressureSource}
                            onChange={(event) =>
                                setPressureSource(event.target.value as PressureSource)
                            }
                        >
                            <option value="stationPressure">Measured station pressure</option>
                            <option value="pressureAltitude">Pressure altitude (ISA)</option>
                            <option value="altimeterSetting">
                                Altimeter setting + field elevation
                            </option>
                        </select>
                    </label>
                    {inputs.pressureSource === 'stationPressure' ? (
                        <Field
                            label="Station pressure"
                            value={imperial ? inputs.pressureHpa / 33.8639 : inputs.pressureHpa}
                            unit={imperial ? 'inHg' : 'hPa'}
                            error={fieldErrs.pressureHpa}
                            wide
                            onChange={(v) => {
                                const pressureHpa = imperial ? v * 33.8639 : v;
                                setInputs((current) => ({
                                    ...current,
                                    pressureHpa,
                                    pressureAltitudeM: pressureToAltitude(pressureHpa),
                                }));
                            }}
                        />
                    ) : null}
                    {inputs.pressureSource === 'pressureAltitude' ? (
                        <Field
                            label="Pressure altitude"
                            value={
                                imperial
                                    ? inputs.pressureAltitudeM / 0.3048
                                    : inputs.pressureAltitudeM
                            }
                            unit={imperial ? 'ft' : 'm'}
                            error={fieldErrs.pressureAltitudeM ?? fieldErrs.pressureHpa}
                            wide
                            onChange={(v) => {
                                const pressureAltitudeM = imperial ? v * 0.3048 : v;
                                setInputs((current) => ({
                                    ...current,
                                    pressureAltitudeM,
                                    pressureHpa: altitudeToPressure(pressureAltitudeM),
                                }));
                            }}
                        />
                    ) : null}
                    {inputs.pressureSource === 'altimeterSetting' ? (
                        <>
                            <Field
                                label="Field elevation"
                                value={
                                    imperial
                                        ? inputs.geometricAltitudeM / 0.3048
                                        : inputs.geometricAltitudeM
                                }
                                unit={imperial ? 'ft MSL' : 'm MSL'}
                                error={fieldErrs.geometricAltitudeM}
                                onChange={(v) => {
                                    const geometricAltitudeM = imperial ? v * 0.3048 : v;
                                    setInputs((current) => {
                                        const pressureHpa = altimeterSettingToStationPressure(
                                            current.altimeterSettingHpa,
                                            geometricAltitudeM,
                                        );
                                        return {
                                            ...current,
                                            geometricAltitudeM,
                                            pressureHpa,
                                            pressureAltitudeM: pressureToAltitude(pressureHpa),
                                        };
                                    });
                                }}
                            />
                            <Field
                                label="Altimeter setting"
                                value={
                                    imperial
                                        ? inputs.altimeterSettingHpa / 33.8639
                                        : inputs.altimeterSettingHpa
                                }
                                unit={imperial ? 'inHg' : 'hPa'}
                                error={fieldErrs.altimeterSettingHpa ?? fieldErrs.pressureHpa}
                                onChange={(v) => {
                                    const altimeterSettingHpa = imperial ? v * 33.8639 : v;
                                    setInputs((current) => {
                                        const pressureHpa = altimeterSettingToStationPressure(
                                            altimeterSettingHpa,
                                            current.geometricAltitudeM,
                                        );
                                        return {
                                            ...current,
                                            altimeterSettingHpa,
                                            pressureHpa,
                                            pressureAltitudeM: pressureToAltitude(pressureHpa),
                                        };
                                    });
                                }}
                            />
                        </>
                    ) : null}
                    <div
                        className={`atmosphere-resolution${fieldErrs.pressureHpa ? ' invalid' : ''}`}
                    >
                        <span>
                            Resolved station pressure:{' '}
                            <b>
                                {imperial
                                    ? `${(inputs.pressureHpa / 33.8639).toFixed(3)} inHg`
                                    : `${inputs.pressureHpa.toFixed(2)} hPa`}
                            </b>
                        </span>
                        <span>
                            Pressure altitude:{' '}
                            <b>
                                {imperial
                                    ? `${(resolvedPressureAltitudeM / 0.3048).toFixed(0)} ft`
                                    : `${resolvedPressureAltitudeM.toFixed(0)} m`}
                            </b>
                        </span>
                        <span>
                            Density altitude:{' '}
                            <b>
                                {densityAltitudeM === null
                                    ? 'N/A'
                                    : imperial
                                      ? `${(densityAltitudeM / 0.3048).toFixed(0)} ft`
                                      : `${densityAltitudeM.toFixed(0)} m`}
                            </b>
                        </span>
                    </div>
                    <Field
                        label="Humidity"
                        value={inputs.humidityPercent}
                        unit="%"
                        error={fieldErrs.humidityPercent}
                        onChange={set('humidityPercent')}
                    />
                    <Field
                        label="Headwind"
                        value={imperial ? inputs.headwindMps / 0.44704 : inputs.headwindMps}
                        unit={imperial ? 'mph' : 'm/s'}
                        error={fieldErrs.headwindMps}
                        onChange={(v) => set('headwindMps')(imperial ? v * 0.44704 : v)}
                    />
                    <Field
                        label="Crosswind (→ right)"
                        value={imperial ? inputs.crosswindMps / 0.44704 : inputs.crosswindMps}
                        unit={imperial ? 'mph' : 'm/s'}
                        error={fieldErrs.crosswindMps}
                        onChange={(v) => set('crosswindMps')(imperial ? v * 0.44704 : v)}
                    />
                </div>
                <label className="range-control">
                    <span>Integration range</span>
                    <input
                        type="range"
                        min="0"
                        max={imperial ? 2000 * M_TO_YD : 2000}
                        step="1"
                        value={dist(inputs.distanceM)}
                        onChange={(event) =>
                            set('distanceM')(
                                imperial
                                    ? Number(event.target.value) / M_TO_YD
                                    : Number(event.target.value),
                            )
                        }
                    />
                </label>
            </div>
            <AdvancedScenarioPanel inputs={inputs} imperial={imperial} setInputs={setInputs} />
            <BuckshotPatternPanel
                inputs={inputs}
                imperial={imperial}
                shotgunLoads={shotgunLoads}
                setInputs={setInputs}
            />
            <div className="groupbox">
                <div className="section-title">
                    <span>Firearm profile</span>
                </div>
                <div className="fields">
                    <Field
                        label="Shotgun MV correction"
                        value={(inputs.shotgunMvMultiplier - 1) * 100}
                        unit="%"
                        error={fieldErrs.shotgunMvMultiplier}
                        onChange={(v) => set('shotgunMvMultiplier')(1 + v / 100)}
                    />
                    <Field
                        label="Rifle MV correction"
                        value={(inputs.rifleMvMultiplier - 1) * 100}
                        unit="%"
                        error={fieldErrs.rifleMvMultiplier}
                        onChange={(v) => set('rifleMvMultiplier')(1 + v / 100)}
                    />
                    <Field
                        label="Rifle twist"
                        value={inputs.rifleTwistInches}
                        unit="in/turn"
                        error={fieldErrs.rifleTwistInches}
                        onChange={set('rifleTwistInches')}
                    />
                    <label className="field">
                        <span>Twist direction</span>
                        <select
                            value={inputs.twistDirection}
                            onChange={(e) => set('twistDirection')(Number(e.target.value))}
                        >
                            <option value={1}>Right-hand</option>
                            <option value={-1}>Left-hand</option>
                        </select>
                    </label>
                </div>
            </div>
            <div className="groupbox">
                <div className="section-title">
                    <span>Zeroing</span>
                </div>
                <div className="fields">
                    <Field
                        label="Vital zone"
                        value={drop(inputs.vitalZoneM)}
                        unit={imperial ? 'in' : 'cm'}
                        error={fieldErrs.vitalZoneM}
                        wide
                        onChange={(v) => set('vitalZoneM')(imperial ? v * IN_TO_M : v / 100)}
                    />
                    <Field
                        label="Shotgun sight"
                        value={drop(inputs.shotgunSightM)}
                        unit={imperial ? 'in' : 'cm'}
                        error={fieldErrs.shotgunSightM}
                        onChange={(v) => set('shotgunSightM')(imperial ? v * IN_TO_M : v / 100)}
                    />
                    <Field
                        label="Rifle sight"
                        value={drop(inputs.rifleSightM)}
                        unit={imperial ? 'in' : 'cm'}
                        error={fieldErrs.rifleSightM}
                        onChange={(v) => set('rifleSightM')(imperial ? v * IN_TO_M : v / 100)}
                    />
                    <Field
                        label="Shotgun zero"
                        value={dist(inputs.shotgunZeroM)}
                        unit={imperial ? 'yd' : 'm'}
                        error={fieldErrs.shotgunZeroM}
                        onChange={(v) => set('shotgunZeroM')(imperial ? v / M_TO_YD : v)}
                    />
                    <Field
                        label="Rifle zero"
                        value={dist(inputs.rifleZeroM)}
                        unit={imperial ? 'yd' : 'm'}
                        error={fieldErrs.rifleZeroM}
                        onChange={(v) => set('rifleZeroM')(imperial ? v / M_TO_YD : v)}
                    />
                </div>
            </div>
            <div className="groupbox uncertainty-inputs">
                <div className="section-title">
                    <span>Uncertainty bands</span>
                    <label className="uncertainty-toggle">
                        <input
                            type="checkbox"
                            checked={uncertainty.enabled}
                            onChange={(event) =>
                                setUncertainty((current) => ({
                                    ...current,
                                    enabled: event.target.checked,
                                }))
                            }
                        />
                        {uncertainty.enabled ? 'On' : 'Off'}
                    </label>
                </div>
                {uncertainty.enabled && (
                    <>
                        <UncertaintyMethodPanel
                            uncertainty={uncertainty}
                            errors={uncertaintyFieldErrs}
                            setUncertainty={setUncertainty}
                        />
                        <div className="fields">
                            <Field
                                label="Shotgun MV SD"
                                value={
                                    uncertainty.shotgunMuzzleVelocityStandardDeviationMps *
                                    (imperial ? MPS_TO_FPS : 1)
                                }
                                unit={imperial ? 'ft/s' : 'm/s'}
                                error={
                                    uncertaintyFieldErrs.shotgunMuzzleVelocityStandardDeviationMps
                                }
                                onChange={(value) =>
                                    setUncertaintyValue(
                                        'shotgunMuzzleVelocityStandardDeviationMps',
                                    )(value / (imperial ? MPS_TO_FPS : 1))
                                }
                            />
                            <Field
                                label="Rifle MV SD"
                                value={
                                    uncertainty.rifleMuzzleVelocityStandardDeviationMps *
                                    (imperial ? MPS_TO_FPS : 1)
                                }
                                unit={imperial ? 'ft/s' : 'm/s'}
                                error={uncertaintyFieldErrs.rifleMuzzleVelocityStandardDeviationMps}
                                onChange={(value) =>
                                    setUncertaintyValue('rifleMuzzleVelocityStandardDeviationMps')(
                                        value / (imperial ? MPS_TO_FPS : 1),
                                    )
                                }
                            />
                            <Field
                                label="BC / drag SD"
                                value={uncertainty.dragRelativeStandardDeviation * 100}
                                unit="%"
                                error={uncertaintyFieldErrs.dragRelativeStandardDeviation}
                                onChange={(value) =>
                                    setUncertaintyValue('dragRelativeStandardDeviation')(
                                        value / 100,
                                    )
                                }
                            />
                            <Field
                                label="Temperature SD"
                                value={
                                    uncertainty.temperatureStandardDeviationC *
                                    (imperial ? 9 / 5 : 1)
                                }
                                unit={imperial ? '°F' : '°C'}
                                error={uncertaintyFieldErrs.temperatureStandardDeviationC}
                                onChange={(value) =>
                                    setUncertaintyValue('temperatureStandardDeviationC')(
                                        value / (imperial ? 9 / 5 : 1),
                                    )
                                }
                            />
                            <Field
                                label="Pressure SD"
                                value={
                                    uncertainty.stationPressureStandardDeviationHpa /
                                    (imperial ? 33.8639 : 1)
                                }
                                unit={imperial ? 'inHg' : 'hPa'}
                                error={uncertaintyFieldErrs.stationPressureStandardDeviationHpa}
                                onChange={(value) =>
                                    setUncertaintyValue('stationPressureStandardDeviationHpa')(
                                        value * (imperial ? 33.8639 : 1),
                                    )
                                }
                            />
                            <Field
                                label="Headwind SD"
                                value={
                                    uncertainty.headwindStandardDeviationMps /
                                    (imperial ? 0.44704 : 1)
                                }
                                unit={imperial ? 'mph' : 'm/s'}
                                error={uncertaintyFieldErrs.headwindStandardDeviationMps}
                                onChange={(value) =>
                                    setUncertaintyValue('headwindStandardDeviationMps')(
                                        value * (imperial ? 0.44704 : 1),
                                    )
                                }
                            />
                            <Field
                                label="Crosswind SD"
                                value={
                                    uncertainty.crosswindStandardDeviationMps /
                                    (imperial ? 0.44704 : 1)
                                }
                                unit={imperial ? 'mph' : 'm/s'}
                                error={uncertaintyFieldErrs.crosswindStandardDeviationMps}
                                onChange={(value) =>
                                    setUncertaintyValue('crosswindStandardDeviationMps')(
                                        value * (imperial ? 0.44704 : 1),
                                    )
                                }
                            />
                            <Field
                                label="Shotgun zero SD"
                                value={
                                    uncertainty.shotgunZeroRangeStandardDeviationM *
                                    (imperial ? M_TO_YD : 1)
                                }
                                unit={imperial ? 'yd' : 'm'}
                                error={uncertaintyFieldErrs.shotgunZeroRangeStandardDeviationM}
                                onChange={(value) =>
                                    setUncertaintyValue('shotgunZeroRangeStandardDeviationM')(
                                        value / (imperial ? M_TO_YD : 1),
                                    )
                                }
                            />
                            <Field
                                label="Rifle zero SD"
                                value={
                                    uncertainty.rifleZeroRangeStandardDeviationM *
                                    (imperial ? M_TO_YD : 1)
                                }
                                unit={imperial ? 'yd' : 'm'}
                                error={uncertaintyFieldErrs.rifleZeroRangeStandardDeviationM}
                                onChange={(value) =>
                                    setUncertaintyValue('rifleZeroRangeStandardDeviationM')(
                                        value / (imperial ? M_TO_YD : 1),
                                    )
                                }
                            />
                        </div>
                        <p className="uncertainty-note">
                            Inputs are one-sigma values. First-order mode uses independent central
                            differences. Monte Carlo mode supports the correlation pairs above and
                            reports empirical 2.5%, median, and 97.5% quantiles. BC SD applies to
                            G1/G7. Drag-scale SD applies to sphere and Mach–Cd.
                        </p>
                    </>
                )}
            </div>
            {validationErrors.length + uncertaintyErrors.length > 0 && (
                <div className="validation-summary">
                    {[...validationErrors, ...uncertaintyErrors].map((message) => (
                        <span key={message}>{message}</span>
                    ))}
                </div>
            )}
            <div className="reset-actions">
                <button className="reset-profile" onClick={onResetAtmosphere}>
                    Reset atmosphere
                </button>
                <button className="reset-profile" onClick={onResetAll}>
                    Reset all
                </button>
            </div>
        </aside>
    );
}
