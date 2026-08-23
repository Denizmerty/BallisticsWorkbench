import type { CustomDraft, Inputs, UncertaintySettings } from '../types';

type NumericInputKey = {
    [Key in keyof Inputs]: Inputs[Key] extends number ? Key : never;
}[keyof Inputs];
type Bound = { key: NumericInputKey; min: number; max: number; label: string };

// Canonical SI bounds shared by the whole-form validator and the per-field
// validator so both always agree on limits and messages.
const INPUT_BOUNDS: Bound[] = [
    { key: 'distanceM', min: 0, max: 2000, label: 'Range (m)' },
    { key: 'temperatureC', min: -60, max: 60, label: 'Temperature (°C)' },
    { key: 'pressureHpa', min: 500, max: 1100, label: 'Station pressure (hPa)' },
    { key: 'humidityPercent', min: 0, max: 100, label: 'Humidity (%)' },
    { key: 'headwindMps', min: -100, max: 100, label: 'Headwind (m/s)' },
    { key: 'crosswindMps', min: -100, max: 100, label: 'Crosswind (m/s)' },
    { key: 'latitudeDeg', min: -90, max: 90, label: 'Latitude (degrees)' },
    { key: 'azimuthDeg', min: -360, max: 360, label: 'Shot azimuth (degrees)' },
    {
        key: 'targetInclinationDeg',
        min: -60,
        max: 60,
        label: 'Target inclination (degrees)',
    },
    { key: 'targetElevationM', min: -1732, max: 1732, label: 'Target elevation (m)' },
    { key: 'vitalZoneM', min: 0.01, max: 2, label: 'Vital zone (m)' },
    { key: 'shotgunSightM', min: 0, max: 0.25, label: 'Shotgun sight height (m)' },
    { key: 'rifleSightM', min: 0, max: 0.25, label: 'Rifle sight height (m)' },
    { key: 'shotgunZeroM', min: 5, max: 1000, label: 'Shotgun zero range (m)' },
    { key: 'rifleZeroM', min: 5, max: 1000, label: 'Rifle zero range (m)' },
    { key: 'shotgunMvMultiplier', min: 0.75, max: 1.25, label: 'Shotgun velocity multiplier' },
    { key: 'rifleMvMultiplier', min: 0.75, max: 1.25, label: 'Rifle velocity multiplier' },
    { key: 'rifleTwistInches', min: 5, max: 30, label: 'Rifle twist (in/turn)' },
];

const PRESSURE_SOURCE_BOUNDS: Record<Inputs['pressureSource'], Bound[]> = {
    stationPressure: [],
    pressureAltitude: [
        { key: 'pressureAltitudeM', min: -700, max: 5575, label: 'Pressure altitude (m)' },
    ],
    altimeterSetting: [
        { key: 'geometricAltitudeM', min: -500, max: 6000, label: 'Field elevation (m MSL)' },
        { key: 'altimeterSettingHpa', min: 800, max: 1100, label: 'Altimeter setting (hPa)' },
    ],
};

const activeBounds = (value: Inputs) => [
    ...INPUT_BOUNDS,
    ...(PRESSURE_SOURCE_BOUNDS[value.pressureSource] ?? []),
];

const message = ({ min, max, label }: Bound) => `${label} must be between ${min} and ${max}.`;

const violated = (value: Inputs, bound: Bound) => {
    const n = value[bound.key] as number;
    return !Number.isFinite(n) || n < bound.min || n > bound.max;
};

export function validateInputs(value: Inputs) {
    const errors = activeBounds(value)
        .filter((bound) => violated(value, bound))
        .map(message);
    if (Math.abs(value.targetInclinationDeg) > 1e-12 && Math.abs(value.targetElevationM) > 1e-12) {
        errors.push('Specify target inclination or target elevation, not both.');
    }
    if (Math.abs(value.targetElevationM) > 1e-12 && value.distanceM <= 0) {
        errors.push('Target elevation requires a positive range.');
    }
    if (value.windLayers.length > 16) errors.push('At most 16 wind layers are supported.');
    value.windLayers.forEach((layer, index) => {
        const values = [
            layer.startM,
            layer.endM,
            layer.startHeadwindMps,
            layer.endHeadwindMps,
            layer.startCrosswindMps,
            layer.endCrosswindMps,
        ];
        if (
            !values.every(Number.isFinite) ||
            layer.endM <= layer.startM ||
            Math.abs(layer.startHeadwindMps) > 100 ||
            Math.abs(layer.endHeadwindMps) > 100 ||
            Math.abs(layer.startCrosswindMps) > 100 ||
            Math.abs(layer.endCrosswindMps) > 100
        ) {
            errors.push(`Wind layer ${index + 1} has invalid bounds or wind values.`);
        }
        if ((layer.source?.length ?? 0) > 240) {
            errors.push(`Wind layer ${index + 1} source must not exceed 240 characters.`);
        }
    });
    const validateTemperatureProfile = (
        points: Inputs['rifleTemperatureVelocityProfile'],
        label: string,
    ) => {
        if (points.length !== 0 && (points.length < 2 || points.length > 12)) {
            errors.push(`${label} temperature-velocity profile must contain 2 to 12 points.`);
        }
        points.forEach((point, index) => {
            if (
                !Number.isFinite(point.temperatureC) ||
                point.temperatureC < -60 ||
                point.temperatureC > 60 ||
                !Number.isFinite(point.multiplier) ||
                point.multiplier < 0.75 ||
                point.multiplier > 1.25 ||
                (index > 0 && point.temperatureC <= points[index - 1].temperatureC)
            ) {
                errors.push(`${label} temperature-velocity point ${index + 1} is invalid.`);
            }
        });
    };
    validateTemperatureProfile(value.shotgunTemperatureVelocityProfile, 'Shotgun');
    validateTemperatureProfile(value.rifleTemperatureVelocityProfile, 'Rifle');
    if (
        value.windProvenance.length > 240 ||
        value.shotgunTemperatureVelocitySource.length > 240 ||
        value.rifleTemperatureVelocitySource.length > 240
    ) {
        errors.push('Advanced-model provenance fields must not exceed 240 characters.');
    }
    const pattern = value.buckshotPattern;
    if (pattern.enabled) {
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(pattern.loadId)) {
            errors.push('Buckshot pattern analysis requires a valid active shotgun load ID.');
        }
        const bounded = (candidate: number, minimum: number, maximum: number) =>
            Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum;
        if (!bounded(pattern.pelletVelocityStandardDeviationMps, 0, 200)) {
            errors.push('Buckshot pellet velocity SD must be between 0 and 200 m/s.');
        }
        if (!bounded(pattern.targetRangeM, 0.001, 200)) {
            errors.push('Buckshot pattern target range must be between 0.001 and 200 m.');
        }
        if (
            !Number.isInteger(pattern.minimumPelletCount) ||
            !bounded(pattern.minimumPelletCount, 1, 1000)
        ) {
            errors.push('Buckshot minimum pellet count must be an integer between 1 and 1000.');
        }
        const targetValues = [
            pattern.target.widthM,
            pattern.target.heightM,
            pattern.target.centerHorizontalM,
            pattern.target.centerVerticalM,
        ];
        if (
            !targetValues.every(Number.isFinite) ||
            !bounded(pattern.target.widthM, 0.001, 10) ||
            !bounded(pattern.target.heightM, 0.001, 10) ||
            !bounded(pattern.target.centerHorizontalM, -10, 10) ||
            !bounded(pattern.target.centerVerticalM, -10, 10)
        ) {
            errors.push('Buckshot target dimensions or offsets are outside their valid bounds.');
        }
        if (pattern.observations.length < 3 || pattern.observations.length > 64) {
            errors.push('Buckshot analysis requires between 3 and 64 pattern observations.');
        }
        let calibrationCount = 0;
        let holdoutCount = 0;
        pattern.observations.forEach((observation, index) => {
            if (observation.role === 'calibration') calibrationCount += 1;
            else holdoutCount += 1;
            if (
                !bounded(observation.rangeM, 0.001, 200) ||
                !bounded(observation.diameter90M, 0.001, 20) ||
                !bounded(observation.standardUncertaintyM, 0.000001, 5) ||
                !Number.isInteger(observation.shellCount) ||
                !bounded(observation.shellCount, 1, 1000)
            ) {
                errors.push(`Buckshot pattern observation ${index + 1} is invalid.`);
            }
        });
        if (calibrationCount < 2 || holdoutCount < 1) {
            errors.push(
                'Buckshot analysis requires at least two calibration observations and one holdout.',
            );
        }
    }
    return errors;
}

/**
 * Per-field validation used to flag the exact inputs that are out of range so
 * the sidebar can highlight each field alongside the error list.
 */
export function fieldErrors(value: Inputs): Partial<Record<keyof Inputs, string>> {
    const map: Partial<Record<keyof Inputs, string>> = {};
    for (const bound of activeBounds(value)) {
        if (violated(value, bound)) map[bound.key] = message(bound);
    }
    if (Math.abs(value.targetInclinationDeg) > 1e-12 && Math.abs(value.targetElevationM) > 1e-12) {
        map.targetInclinationDeg = 'Specify target inclination or target elevation, not both.';
        map.targetElevationM = map.targetInclinationDeg;
    }
    return map;
}

const UNCERTAINTY_BOUNDS: Array<{
    key: Exclude<
        keyof UncertaintySettings,
        'enabled' | 'method' | 'sampleCount' | 'seed' | 'correlations'
    >;
    max: number;
    label: string;
}> = [
    {
        key: 'shotgunMuzzleVelocityStandardDeviationMps',
        max: 200,
        label: 'Shotgun muzzle-velocity SD (m/s)',
    },
    {
        key: 'rifleMuzzleVelocityStandardDeviationMps',
        max: 200,
        label: 'Rifle muzzle-velocity SD (m/s)',
    },
    { key: 'dragRelativeStandardDeviation', max: 1, label: 'Relative BC/drag SD' },
    { key: 'temperatureStandardDeviationC', max: 30, label: 'Temperature SD (C)' },
    {
        key: 'stationPressureStandardDeviationHpa',
        max: 200,
        label: 'Station-pressure SD (hPa)',
    },
    { key: 'headwindStandardDeviationMps', max: 50, label: 'Headwind SD (m/s)' },
    { key: 'crosswindStandardDeviationMps', max: 50, label: 'Crosswind SD (m/s)' },
    { key: 'shotgunZeroRangeStandardDeviationM', max: 200, label: 'Shotgun zero-range SD (m)' },
    { key: 'rifleZeroRangeStandardDeviationM', max: 200, label: 'Rifle zero-range SD (m)' },
];

export function uncertaintyFieldErrors(
    value: UncertaintySettings,
): Partial<Record<keyof UncertaintySettings, string>> {
    if (!value.enabled) return {};
    const errors: Partial<Record<keyof UncertaintySettings, string>> = {};
    for (const bound of UNCERTAINTY_BOUNDS) {
        const candidate = value[bound.key];
        if (!Number.isFinite(candidate) || candidate < 0 || candidate > bound.max) {
            errors[bound.key] = `${bound.label} must be between 0 and ${bound.max}.`;
        }
    }
    if (value.method !== 'firstOrder' && value.method !== 'monteCarlo') {
        errors.method = 'Uncertainty method is unsupported.';
    }
    if (
        !Number.isInteger(value.sampleCount) ||
        value.sampleCount < 100 ||
        value.sampleCount > 10000
    ) {
        errors.sampleCount = 'Monte Carlo sample count must be between 100 and 10000.';
    }
    if (!Number.isSafeInteger(value.seed) || value.seed < 0) {
        errors.seed = 'Monte Carlo seed must be a non-negative safe integer.';
    }
    const pairs = new Set<string>();
    if (value.correlations.length > 21) {
        errors.correlations = 'At most 21 uncertainty correlations are supported.';
    }
    for (const correlation of value.correlations) {
        const pair = [correlation.first, correlation.second].sort().join(':');
        if (
            correlation.first === correlation.second ||
            !Number.isFinite(correlation.coefficient) ||
            Math.abs(correlation.coefficient) >= 1 ||
            pairs.has(pair)
        ) {
            errors.correlations =
                'Correlation pairs must be unique, use different variables, and stay between -1 and 1.';
            break;
        }
        pairs.add(pair);
    }
    return errors;
}

export function validateUncertaintySettings(value: UncertaintySettings) {
    return Object.values(uncertaintyFieldErrors(value));
}

export function validateCustomLoad(draft: CustomDraft) {
    const errors: string[] = [];
    const within = (value: number, min: number, max: number, label: string) => {
        if (!Number.isFinite(value) || value < min || value > max) {
            errors.push(`${label} must be between ${min} and ${max}.`);
        }
    };

    if (!draft.name.trim()) {
        errors.push('Name is required.');
    }
    within(draft.mv, 1, 2000, 'Muzzle velocity (m/s)');
    within(draft.count, 1, 1000, 'Payload count');
    if (!Number.isInteger(draft.count)) {
        errors.push('Payload count must be a whole number.');
    }

    if (draft.drag === 'Sphere') {
        within(draft.sphereMm, 1, 50, 'Sphere diameter (mm)');
        within(draft.density, 500, 25000, 'Material density (kg/m³)');
    } else {
        const metadata = draft.dragDataMetadata;
        if (metadata.citation.length > 500) {
            errors.push('Drag-data source citation must contain at most 500 characters.');
        }
        if (
            metadata.sourceUrl.length > 2000 ||
            (metadata.sourceUrl !== '' && !/^https?:\/\//.test(metadata.sourceUrl))
        ) {
            errors.push('Drag-data source URL must be empty or use HTTP/HTTPS.');
        }
        if (metadata.license.length > 200) {
            errors.push('Drag-data license must contain at most 200 characters.');
        }
        if (
            metadata.sourceChecksumSha256 !== '' &&
            !/^[0-9a-f]{64}$/i.test(metadata.sourceChecksumSha256)
        ) {
            errors.push('Drag-data source checksum must be an empty or 64-digit SHA-256 value.');
        }
        const domainLimit = draft.drag === 'MachCd' ? 10 : 2000;
        const validateDomain = (value: number | null, label: string) => {
            if (value !== null && (!Number.isFinite(value) || value < 0 || value > domainLimit)) {
                errors.push(`${label} must be empty or between 0 and ${domainLimit}.`);
            }
        };
        validateDomain(metadata.domainMinimum, 'Drag-data domain minimum');
        validateDomain(metadata.domainMaximum, 'Drag-data domain maximum');
        if (
            metadata.domainMinimum !== null &&
            metadata.domainMaximum !== null &&
            metadata.domainMinimum >= metadata.domainMaximum
        ) {
            errors.push('Drag-data domain minimum must be below its maximum.');
        }

        if (!Number.isFinite(draft.massG) || draft.massG <= 0) {
            errors.push('Projectile mass must be positive.');
        }
        if (draft.drag === 'MachCd') {
            within(draft.machCdDiameterMm, 1, 50, 'Drag reference diameter (mm)');
            if (draft.machCdPoints.length < 2 || draft.machCdPoints.length > 64) {
                errors.push('A tabulated Mach–Cd curve must contain between 2 and 64 points.');
            }
            draft.machCdPoints.forEach((point, index) => {
                if (!Number.isFinite(point.mach) || point.mach < 0 || point.mach > 10) {
                    errors.push(`Mach–Cd point ${index + 1} Mach must be between 0 and 10.`);
                }
                if (
                    !Number.isFinite(point.dragCoefficient) ||
                    point.dragCoefficient <= 0 ||
                    point.dragCoefficient > 5
                ) {
                    errors.push(`Mach–Cd point ${index + 1} Cd must be positive and at most 5.`);
                }
                if (index > 0 && point.mach <= draft.machCdPoints[index - 1].mach) {
                    errors.push('Mach–Cd point Mach values must be strictly increasing.');
                }
            });
            if (
                draft.machCdPoints.length >= 2 &&
                ((metadata.domainMinimum !== null &&
                    metadata.domainMinimum < draft.machCdPoints[0].mach) ||
                    (metadata.domainMaximum !== null &&
                        metadata.domainMaximum > draft.machCdPoints.at(-1)!.mach))
            ) {
                errors.push('Declared Mach domain must remain inside the tabulated Mach range.');
            }
        } else if (draft.bcMode === 'constant') {
            if (!Number.isFinite(draft.bc) || draft.bc <= 0 || draft.bc > 2) {
                errors.push('Ballistic coefficient must be positive and at most 2.');
            }
        } else {
            if (draft.bcBands.length < 2 || draft.bcBands.length > 16) {
                errors.push('A velocity-banded BC schedule must contain between 2 and 16 bands.');
            }
            draft.bcBands.forEach((band, index) => {
                if (
                    !Number.isFinite(band.minimumVelocityMps) ||
                    band.minimumVelocityMps < 0 ||
                    band.minimumVelocityMps > 2000
                ) {
                    errors.push(`BC band ${index + 1} velocity must be between 0 and 2000 m/s.`);
                }
                if (
                    !Number.isFinite(band.ballisticCoefficient) ||
                    band.ballisticCoefficient <= 0 ||
                    band.ballisticCoefficient > 2
                ) {
                    errors.push(`BC band ${index + 1} coefficient must be positive and at most 2.`);
                }
                if (index === 0 && band.minimumVelocityMps !== 0) {
                    errors.push('The first BC band must begin at 0 m/s.');
                }
                if (
                    index > 0 &&
                    band.minimumVelocityMps <= draft.bcBands[index - 1].minimumVelocityMps
                ) {
                    errors.push('BC band velocities must be strictly increasing.');
                }
            });
        }
    }

    if (draft.group === 'rifle') {
        if (
            !Number.isFinite(draft.length) ||
            !Number.isFinite(draft.diameter) ||
            !Number.isFinite(draft.twist) ||
            draft.length < 0 ||
            draft.diameter < 0 ||
            draft.twist < 0
        ) {
            errors.push('Optional rifle dimensions cannot be negative.');
        }
    }
    return errors;
}
