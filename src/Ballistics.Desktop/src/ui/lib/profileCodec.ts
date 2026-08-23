import type { CustomDraft, Inputs, UncertaintySettings } from '../types';
import { defaultDragDataMetadata } from './dragData';
import { uncertaintyFieldErrors, validateCustomLoad, validateInputs } from './validation';
import {
    ProfileDocumentError,
    type AmmunitionProfileData,
    type CombinedScenarioProfileData,
    type EnvironmentProfileData,
    type FirearmProfileData,
    type NamedProfile,
    type QuarantinedProfile,
} from './profileTypes';

export const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const profileId = () => {
    const token =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `profile:${token}`;
};

const quarantineId = () => {
    const token =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `quarantine:${token}`;
};

export const isoNow = () => new Date().toISOString();
export const clone = <T>(value: T): T => structuredClone(value);
export const normalizedName = (value: string) => value.trim().toLocaleLowerCase();

export const exactKeys = (
    value: Record<string, unknown>,
    expected: readonly string[],
    path: string,
) => {
    const allowed = new Set(expected);
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    const missing = expected.filter((key) => !(key in value));
    if (unexpected.length || missing.length) {
        const detail = [
            ...(missing.length ? [`missing ${missing.join(', ')}`] : []),
            ...(unexpected.length ? [`unknown ${unexpected.join(', ')}`] : []),
        ].join(', ');
        throw new ProfileDocumentError(`${path} has an invalid shape (${detail}).`);
    }
};

const stringValue = (value: unknown, path: string, maximum: number) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
        throw new ProfileDocumentError(
            `${path} must be a string between 1 and ${maximum} characters.`,
        );
    }
    return value;
};

const finiteNumber = (value: unknown, path: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ProfileDocumentError(`${path} must be a finite number.`);
    }
    return value;
};

const booleanValue = (value: unknown, path: string) => {
    if (typeof value !== 'boolean') {
        throw new ProfileDocumentError(`${path} must be a boolean.`);
    }
    return value;
};

const optionalSourceText = (value: unknown, path: string) => {
    if (typeof value !== 'string' || value.length > 240) {
        throw new ProfileDocumentError(`${path} must be a string of at most 240 characters.`);
    }
    return value;
};

const decodeWindLayers = (value: unknown, path: string): Inputs['windLayers'] => {
    if (!Array.isArray(value) || value.length > 16) {
        throw new ProfileDocumentError(`${path} must contain at most 16 wind layers.`);
    }
    return value.map((entry, index) => {
        const itemPath = `${path}[${index}]`;
        if (!object(entry)) throw new ProfileDocumentError(`${itemPath} must be an object.`);
        const allowed = [
            'axis',
            'startM',
            'endM',
            'startHeadwindMps',
            'endHeadwindMps',
            'startCrosswindMps',
            'endCrosswindMps',
            ...(Object.hasOwn(entry, 'source') ? ['source'] : []),
        ];
        exactKeys(entry, allowed, itemPath);
        if (entry.axis !== 'height' && entry.axis !== 'downrange') {
            throw new ProfileDocumentError(`${itemPath}.axis is unsupported.`);
        }
        const axis: 'height' | 'downrange' = entry.axis;
        const layer = {
            axis,
            startM: finiteNumber(entry.startM, `${itemPath}.startM`),
            endM: finiteNumber(entry.endM, `${itemPath}.endM`),
            startHeadwindMps: finiteNumber(entry.startHeadwindMps, `${itemPath}.startHeadwindMps`),
            endHeadwindMps: finiteNumber(entry.endHeadwindMps, `${itemPath}.endHeadwindMps`),
            startCrosswindMps: finiteNumber(
                entry.startCrosswindMps,
                `${itemPath}.startCrosswindMps`,
            ),
            endCrosswindMps: finiteNumber(entry.endCrosswindMps, `${itemPath}.endCrosswindMps`),
            ...(Object.hasOwn(entry, 'source')
                ? { source: optionalSourceText(entry.source, `${itemPath}.source`) }
                : {}),
        };
        if (layer.endM <= layer.startM) {
            throw new ProfileDocumentError(`${itemPath}.endM must exceed startM.`);
        }
        return layer;
    });
};

const decodeTemperatureVelocityProfile = (
    value: unknown,
    path: string,
): Inputs['rifleTemperatureVelocityProfile'] => {
    if (!Array.isArray(value) || (value.length !== 0 && (value.length < 2 || value.length > 12))) {
        throw new ProfileDocumentError(`${path} must be empty or contain 2 to 12 points.`);
    }
    const points = value.map((entry, index) => {
        const itemPath = `${path}[${index}]`;
        if (!object(entry)) throw new ProfileDocumentError(`${itemPath} must be an object.`);
        exactKeys(entry, ['temperatureC', 'multiplier'], itemPath);
        return {
            temperatureC: finiteNumber(entry.temperatureC, `${itemPath}.temperatureC`),
            multiplier: finiteNumber(entry.multiplier, `${itemPath}.multiplier`),
        };
    });
    points.forEach((point, index) => {
        if (
            point.temperatureC < -60 ||
            point.temperatureC > 60 ||
            point.multiplier < 0.75 ||
            point.multiplier > 1.25 ||
            (index > 0 && point.temperatureC <= points[index - 1].temperatureC)
        ) {
            throw new ProfileDocumentError(`${path}[${index}] is outside the declared domain.`);
        }
    });
    return points;
};

const decodeBuckshotPattern = (value: unknown, path: string): Inputs['buckshotPattern'] => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(
        value,
        [
            'enabled',
            'loadId',
            'choke',
            'deformationClass',
            'pelletVelocityStandardDeviationMps',
            'targetRangeM',
            'minimumPelletCount',
            'target',
            'observations',
        ],
        path,
    );
    const chokes = new Set(['cylinder', 'improvedCylinder', 'modified', 'full', 'custom']);
    const deformationClasses = new Set([
        'softLead',
        'hardenedLead',
        'plated',
        'buffered',
        'unknown',
    ]);
    if (typeof value.loadId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.loadId)) {
        throw new ProfileDocumentError(`${path}.loadId is invalid.`);
    }
    if (typeof value.choke !== 'string' || !chokes.has(value.choke)) {
        throw new ProfileDocumentError(`${path}.choke is unsupported.`);
    }
    if (
        typeof value.deformationClass !== 'string' ||
        !deformationClasses.has(value.deformationClass)
    ) {
        throw new ProfileDocumentError(`${path}.deformationClass is unsupported.`);
    }
    if (!object(value.target)) {
        throw new ProfileDocumentError(`${path}.target must be an object.`);
    }
    exactKeys(
        value.target,
        ['shape', 'widthM', 'heightM', 'centerHorizontalM', 'centerVerticalM'],
        `${path}.target`,
    );
    if (value.target.shape !== 'circle' && value.target.shape !== 'rectangle') {
        throw new ProfileDocumentError(`${path}.target.shape is unsupported.`);
    }
    if (!Array.isArray(value.observations) || value.observations.length > 64) {
        throw new ProfileDocumentError(`${path}.observations must contain at most 64 items.`);
    }
    const observations = value.observations.map((entry, index) => {
        const itemPath = `${path}.observations[${index}]`;
        if (!object(entry)) throw new ProfileDocumentError(`${itemPath} must be an object.`);
        exactKeys(
            entry,
            ['rangeM', 'diameter90M', 'standardUncertaintyM', 'shellCount', 'role'],
            itemPath,
        );
        if (entry.role !== 'calibration' && entry.role !== 'holdout') {
            throw new ProfileDocumentError(`${itemPath}.role is unsupported.`);
        }
        return {
            rangeM: finiteNumber(entry.rangeM, `${itemPath}.rangeM`),
            diameter90M: finiteNumber(entry.diameter90M, `${itemPath}.diameter90M`),
            standardUncertaintyM: finiteNumber(
                entry.standardUncertaintyM,
                `${itemPath}.standardUncertaintyM`,
            ),
            shellCount: finiteNumber(entry.shellCount, `${itemPath}.shellCount`),
            role: entry.role as 'calibration' | 'holdout',
        };
    });
    return {
        enabled: booleanValue(value.enabled, `${path}.enabled`),
        loadId: value.loadId,
        choke: value.choke as Inputs['buckshotPattern']['choke'],
        deformationClass: value.deformationClass as Inputs['buckshotPattern']['deformationClass'],
        pelletVelocityStandardDeviationMps: finiteNumber(
            value.pelletVelocityStandardDeviationMps,
            `${path}.pelletVelocityStandardDeviationMps`,
        ),
        targetRangeM: finiteNumber(value.targetRangeM, `${path}.targetRangeM`),
        minimumPelletCount: finiteNumber(value.minimumPelletCount, `${path}.minimumPelletCount`),
        target: {
            shape: value.target.shape,
            widthM: finiteNumber(value.target.widthM, `${path}.target.widthM`),
            heightM: finiteNumber(value.target.heightM, `${path}.target.heightM`),
            centerHorizontalM: finiteNumber(
                value.target.centerHorizontalM,
                `${path}.target.centerHorizontalM`,
            ),
            centerVerticalM: finiteNumber(
                value.target.centerVerticalM,
                `${path}.target.centerVerticalM`,
            ),
        },
        observations,
    };
};

export const isoTimestamp = (value: unknown, path: string) => {
    const text = stringValue(value, path, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) {
        throw new ProfileDocumentError(`${path} must be an ISO-8601 UTC timestamp.`);
    }
    return text;
};

const assertValidInputs = (inputs: Inputs, path: string) => {
    const errors = validateInputs(inputs);
    if (errors.length) throw new ProfileDocumentError(`${path}: ${errors.join(' ')}`);
};

const assertValidUncertainty = (uncertainty: UncertaintySettings, path: string) => {
    const errors = Object.values(uncertaintyFieldErrors({ ...uncertainty, enabled: true }));
    if (errors.length) throw new ProfileDocumentError(`${path}: ${errors.join(' ')}`);
};

export const inputKeys = [
    'distanceM',
    'temperatureC',
    'pressureHpa',
    'pressureSource',
    'pressureAltitudeM',
    'geometricAltitudeM',
    'altimeterSettingHpa',
    'humidityPercent',
    'headwindMps',
    'crosswindMps',
    'altitudeDependentAtmosphere',
    'useLocalGravity',
    'coriolisEnabled',
    'latitudeDeg',
    'azimuthDeg',
    'targetInclinationDeg',
    'targetElevationM',
    'windLayers',
    'windProvenance',
    'vitalZoneM',
    'shotgunSightM',
    'rifleSightM',
    'shotgunZeroM',
    'rifleZeroM',
    'shotgunMvMultiplier',
    'rifleMvMultiplier',
    'rifleTwistInches',
    'twistDirection',
    'shotgunTemperatureVelocityProfile',
    'rifleTemperatureVelocityProfile',
    'shotgunTemperatureVelocitySource',
    'rifleTemperatureVelocitySource',
    'buckshotPattern',
] as const satisfies readonly (keyof Inputs)[];

export const decodeInputs = (value: unknown, path: string): Inputs => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(value, inputKeys, path);
    const pressureSource = value.pressureSource;
    if (
        pressureSource !== 'stationPressure' &&
        pressureSource !== 'pressureAltitude' &&
        pressureSource !== 'altimeterSetting'
    ) {
        throw new ProfileDocumentError(`${path}.pressureSource is unsupported.`);
    }
    const inputs: Inputs = {
        distanceM: finiteNumber(value.distanceM, `${path}.distanceM`),
        temperatureC: finiteNumber(value.temperatureC, `${path}.temperatureC`),
        pressureHpa: finiteNumber(value.pressureHpa, `${path}.pressureHpa`),
        pressureSource,
        pressureAltitudeM: finiteNumber(value.pressureAltitudeM, `${path}.pressureAltitudeM`),
        geometricAltitudeM: finiteNumber(value.geometricAltitudeM, `${path}.geometricAltitudeM`),
        altimeterSettingHpa: finiteNumber(value.altimeterSettingHpa, `${path}.altimeterSettingHpa`),
        humidityPercent: finiteNumber(value.humidityPercent, `${path}.humidityPercent`),
        headwindMps: finiteNumber(value.headwindMps, `${path}.headwindMps`),
        crosswindMps: finiteNumber(value.crosswindMps, `${path}.crosswindMps`),
        altitudeDependentAtmosphere: booleanValue(
            value.altitudeDependentAtmosphere,
            `${path}.altitudeDependentAtmosphere`,
        ),
        useLocalGravity: booleanValue(value.useLocalGravity, `${path}.useLocalGravity`),
        coriolisEnabled: booleanValue(value.coriolisEnabled, `${path}.coriolisEnabled`),
        latitudeDeg: finiteNumber(value.latitudeDeg, `${path}.latitudeDeg`),
        azimuthDeg: finiteNumber(value.azimuthDeg, `${path}.azimuthDeg`),
        targetInclinationDeg: finiteNumber(
            value.targetInclinationDeg,
            `${path}.targetInclinationDeg`,
        ),
        targetElevationM: finiteNumber(value.targetElevationM, `${path}.targetElevationM`),
        windLayers: decodeWindLayers(value.windLayers, `${path}.windLayers`),
        windProvenance: optionalSourceText(value.windProvenance, `${path}.windProvenance`),
        vitalZoneM: finiteNumber(value.vitalZoneM, `${path}.vitalZoneM`),
        shotgunSightM: finiteNumber(value.shotgunSightM, `${path}.shotgunSightM`),
        rifleSightM: finiteNumber(value.rifleSightM, `${path}.rifleSightM`),
        shotgunZeroM: finiteNumber(value.shotgunZeroM, `${path}.shotgunZeroM`),
        rifleZeroM: finiteNumber(value.rifleZeroM, `${path}.rifleZeroM`),
        shotgunMvMultiplier: finiteNumber(value.shotgunMvMultiplier, `${path}.shotgunMvMultiplier`),
        rifleMvMultiplier: finiteNumber(value.rifleMvMultiplier, `${path}.rifleMvMultiplier`),
        rifleTwistInches: finiteNumber(value.rifleTwistInches, `${path}.rifleTwistInches`),
        twistDirection: finiteNumber(value.twistDirection, `${path}.twistDirection`),
        shotgunTemperatureVelocityProfile: decodeTemperatureVelocityProfile(
            value.shotgunTemperatureVelocityProfile,
            `${path}.shotgunTemperatureVelocityProfile`,
        ),
        rifleTemperatureVelocityProfile: decodeTemperatureVelocityProfile(
            value.rifleTemperatureVelocityProfile,
            `${path}.rifleTemperatureVelocityProfile`,
        ),
        shotgunTemperatureVelocitySource: optionalSourceText(
            value.shotgunTemperatureVelocitySource,
            `${path}.shotgunTemperatureVelocitySource`,
        ),
        rifleTemperatureVelocitySource: optionalSourceText(
            value.rifleTemperatureVelocitySource,
            `${path}.rifleTemperatureVelocitySource`,
        ),
        buckshotPattern: decodeBuckshotPattern(value.buckshotPattern, `${path}.buckshotPattern`),
    };
    if (inputs.twistDirection !== -1 && inputs.twistDirection !== 1) {
        throw new ProfileDocumentError(`${path}.twistDirection must be -1 or 1.`);
    }
    if (
        inputs.pressureAltitudeM < -700 ||
        inputs.pressureAltitudeM > 5575 ||
        inputs.geometricAltitudeM < -500 ||
        inputs.geometricAltitudeM > 6000 ||
        inputs.altimeterSettingHpa < 800 ||
        inputs.altimeterSettingHpa > 1100
    ) {
        throw new ProfileDocumentError(`${path} contains an out-of-range pressure-source value.`);
    }
    assertValidInputs(inputs, path);
    return inputs;
};

const uncertaintyKeys = [
    'enabled',
    'method',
    'sampleCount',
    'seed',
    'correlations',
    'shotgunMuzzleVelocityStandardDeviationMps',
    'rifleMuzzleVelocityStandardDeviationMps',
    'dragRelativeStandardDeviation',
    'temperatureStandardDeviationC',
    'stationPressureStandardDeviationHpa',
    'headwindStandardDeviationMps',
    'crosswindStandardDeviationMps',
    'shotgunZeroRangeStandardDeviationM',
    'rifleZeroRangeStandardDeviationM',
] as const satisfies readonly (keyof UncertaintySettings)[];

export const decodeUncertainty = (value: unknown, path: string): UncertaintySettings => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(value, uncertaintyKeys, path);
    if (typeof value.enabled !== 'boolean') {
        throw new ProfileDocumentError(`${path}.enabled must be a boolean.`);
    }
    if (value.method !== 'firstOrder' && value.method !== 'monteCarlo') {
        throw new ProfileDocumentError(`${path}.method is unsupported.`);
    }
    const variableNames = [
        'muzzleVelocity',
        'drag',
        'temperature',
        'stationPressure',
        'headwind',
        'crosswind',
        'zeroRange',
    ] as const;
    const variables = new Set<string>(variableNames);
    if (!Array.isArray(value.correlations)) {
        throw new ProfileDocumentError(`${path}.correlations must be an array.`);
    }
    const correlations = value.correlations.map((entry, index) => {
        const itemPath = `${path}.correlations[${index}]`;
        if (!object(entry)) throw new ProfileDocumentError(`${itemPath} must be an object.`);
        exactKeys(entry, ['first', 'second', 'coefficient'], itemPath);
        if (
            typeof entry.first !== 'string' ||
            !variables.has(entry.first) ||
            typeof entry.second !== 'string' ||
            !variables.has(entry.second)
        ) {
            throw new ProfileDocumentError(`${itemPath} names an unsupported variable.`);
        }
        return {
            first: entry.first as UncertaintySettings['correlations'][number]['first'],
            second: entry.second as UncertaintySettings['correlations'][number]['second'],
            coefficient: finiteNumber(entry.coefficient, `${itemPath}.coefficient`),
        };
    });
    const uncertainty: UncertaintySettings = {
        enabled: value.enabled,
        method: value.method,
        sampleCount: finiteNumber(value.sampleCount, `${path}.sampleCount`),
        seed: finiteNumber(value.seed, `${path}.seed`),
        correlations,
        shotgunMuzzleVelocityStandardDeviationMps: finiteNumber(
            value.shotgunMuzzleVelocityStandardDeviationMps,
            `${path}.shotgunMuzzleVelocityStandardDeviationMps`,
        ),
        rifleMuzzleVelocityStandardDeviationMps: finiteNumber(
            value.rifleMuzzleVelocityStandardDeviationMps,
            `${path}.rifleMuzzleVelocityStandardDeviationMps`,
        ),
        dragRelativeStandardDeviation: finiteNumber(
            value.dragRelativeStandardDeviation,
            `${path}.dragRelativeStandardDeviation`,
        ),
        temperatureStandardDeviationC: finiteNumber(
            value.temperatureStandardDeviationC,
            `${path}.temperatureStandardDeviationC`,
        ),
        stationPressureStandardDeviationHpa: finiteNumber(
            value.stationPressureStandardDeviationHpa,
            `${path}.stationPressureStandardDeviationHpa`,
        ),
        headwindStandardDeviationMps: finiteNumber(
            value.headwindStandardDeviationMps,
            `${path}.headwindStandardDeviationMps`,
        ),
        crosswindStandardDeviationMps: finiteNumber(
            value.crosswindStandardDeviationMps,
            `${path}.crosswindStandardDeviationMps`,
        ),
        shotgunZeroRangeStandardDeviationM: finiteNumber(
            value.shotgunZeroRangeStandardDeviationM,
            `${path}.shotgunZeroRangeStandardDeviationM`,
        ),
        rifleZeroRangeStandardDeviationM: finiteNumber(
            value.rifleZeroRangeStandardDeviationM,
            `${path}.rifleZeroRangeStandardDeviationM`,
        ),
    };
    assertValidUncertainty(uncertainty, path);
    return uncertainty;
};

export const customLoadKeys = [
    'id',
    'name',
    'drag',
    'group',
    'massG',
    'mv',
    'bc',
    'bcMode',
    'bcBands',
    'machCdDiameterMm',
    'machCdPoints',
    'dragDataMetadata',
    'sphereMm',
    'density',
    'count',
    'length',
    'diameter',
    'twist',
] as const satisfies readonly (keyof CustomDraft)[];

const decodeDragDataMetadata = (value: unknown, path: string) => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(
        value,
        [
            'citation',
            'sourceUrl',
            'license',
            'sourceChecksumSha256',
            'domainMinimum',
            'domainMaximum',
        ],
        path,
    );
    const optionalText = (candidate: unknown, field: string, maximum: number) => {
        if (typeof candidate !== 'string' || candidate.length > maximum) {
            throw new ProfileDocumentError(
                `${path}.${field} must contain at most ${maximum} characters.`,
            );
        }
        return candidate;
    };
    const domainValue = (candidate: unknown, field: string) => {
        if (candidate === null) return null;
        const number = finiteNumber(candidate, `${path}.${field}`);
        if (number < 0 || number > 2000) {
            throw new ProfileDocumentError(`${path}.${field} is outside the supported range.`);
        }
        return number;
    };
    const sourceChecksumSha256 = optionalText(
        value.sourceChecksumSha256,
        'sourceChecksumSha256',
        64,
    ).toLowerCase();
    if (sourceChecksumSha256 && !/^[0-9a-f]{64}$/.test(sourceChecksumSha256)) {
        throw new ProfileDocumentError(`${path}.sourceChecksumSha256 must be a SHA-256 value.`);
    }
    const metadata = {
        citation: optionalText(value.citation, 'citation', 500),
        sourceUrl: optionalText(value.sourceUrl, 'sourceUrl', 2000),
        license: optionalText(value.license, 'license', 200),
        sourceChecksumSha256,
        domainMinimum: domainValue(value.domainMinimum, 'domainMinimum'),
        domainMaximum: domainValue(value.domainMaximum, 'domainMaximum'),
    };
    if (
        metadata.domainMinimum !== null &&
        metadata.domainMaximum !== null &&
        metadata.domainMinimum >= metadata.domainMaximum
    ) {
        throw new ProfileDocumentError(`${path} minimum domain must be below its maximum.`);
    }
    return metadata;
};

export const decodeCustomLoad = (value: unknown, path: string): CustomDraft => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    const legacy = value.dragDataMetadata === undefined;
    exactKeys(
        value,
        legacy ? customLoadKeys.filter((key) => key !== 'dragDataMetadata') : customLoadKeys,
        path,
    );
    const id = stringValue(value.id, `${path}.id`, 128);
    if (!id.startsWith('custom:')) throw new ProfileDocumentError(`${path}.id must use custom:.`);
    const drag = value.drag;
    if (drag !== 'G1' && drag !== 'G7' && drag !== 'MachCd' && drag !== 'Sphere') {
        throw new ProfileDocumentError(`${path}.drag is unsupported.`);
    }
    const group = value.group;
    if (group !== 'rifle' && group !== 'shotgun') {
        throw new ProfileDocumentError(`${path}.group is unsupported.`);
    }
    const bcMode = value.bcMode;
    if (bcMode !== 'constant' && bcMode !== 'velocityBands') {
        throw new ProfileDocumentError(`${path}.bcMode is unsupported.`);
    }
    if (!Array.isArray(value.bcBands) || !Array.isArray(value.machCdPoints)) {
        throw new ProfileDocumentError(`${path} drag tables must be arrays.`);
    }
    if (
        value.bcBands.length < 2 ||
        value.bcBands.length > 16 ||
        value.machCdPoints.length < 2 ||
        value.machCdPoints.length > 64
    ) {
        throw new ProfileDocumentError(
            `${path} must retain 2–16 BC bands and 2–64 Mach–Cd editor points.`,
        );
    }
    const load: CustomDraft = {
        id,
        name: stringValue(value.name, `${path}.name`, 80).trim(),
        drag,
        group,
        massG: finiteNumber(value.massG, `${path}.massG`),
        mv: finiteNumber(value.mv, `${path}.mv`),
        bc: finiteNumber(value.bc, `${path}.bc`),
        bcMode,
        bcBands: value.bcBands.map((entry, index) => {
            if (!object(entry))
                throw new ProfileDocumentError(`${path}.bcBands[${index}] is invalid.`);
            exactKeys(
                entry,
                ['minimumVelocityMps', 'ballisticCoefficient'],
                `${path}.bcBands[${index}]`,
            );
            return {
                minimumVelocityMps: finiteNumber(
                    entry.minimumVelocityMps,
                    `${path}.bcBands[${index}].minimumVelocityMps`,
                ),
                ballisticCoefficient: finiteNumber(
                    entry.ballisticCoefficient,
                    `${path}.bcBands[${index}].ballisticCoefficient`,
                ),
            };
        }),
        machCdDiameterMm: finiteNumber(value.machCdDiameterMm, `${path}.machCdDiameterMm`),
        machCdPoints: value.machCdPoints.map((entry, index) => {
            if (!object(entry)) {
                throw new ProfileDocumentError(`${path}.machCdPoints[${index}] is invalid.`);
            }
            exactKeys(entry, ['mach', 'dragCoefficient'], `${path}.machCdPoints[${index}]`);
            return {
                mach: finiteNumber(entry.mach, `${path}.machCdPoints[${index}].mach`),
                dragCoefficient: finiteNumber(
                    entry.dragCoefficient,
                    `${path}.machCdPoints[${index}].dragCoefficient`,
                ),
            };
        }),
        dragDataMetadata: legacy
            ? defaultDragDataMetadata()
            : decodeDragDataMetadata(value.dragDataMetadata, `${path}.dragDataMetadata`),
        sphereMm: finiteNumber(value.sphereMm, `${path}.sphereMm`),
        density: finiteNumber(value.density, `${path}.density`),
        count: finiteNumber(value.count, `${path}.count`),
        length: finiteNumber(value.length, `${path}.length`),
        diameter: finiteNumber(value.diameter, `${path}.diameter`),
        twist: finiteNumber(value.twist, `${path}.twist`),
    };
    const errors = validateCustomLoad(load);
    if (errors.length) throw new ProfileDocumentError(`${path}: ${errors.join(' ')}`);
    return load;
};

export const environmentKeys = [
    'temperatureC',
    'pressureHpa',
    'pressureSource',
    'pressureAltitudeM',
    'geometricAltitudeM',
    'altimeterSettingHpa',
    'humidityPercent',
    'headwindMps',
    'crosswindMps',
    'altitudeDependentAtmosphere',
    'useLocalGravity',
    'coriolisEnabled',
    'latitudeDeg',
    'azimuthDeg',
    'windLayers',
    'windProvenance',
] as const satisfies readonly (keyof EnvironmentProfileData)[];

const decodeEnvironmentData = (
    value: unknown,
    path: string,
    defaults: Inputs,
): EnvironmentProfileData => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(value, environmentKeys, path);
    const full = decodeInputs({ ...defaults, ...value }, path);
    const data = {} as EnvironmentProfileData;
    for (const key of environmentKeys) Object.assign(data, { [key]: full[key] });
    return data;
};

const decodeFirearmData = (value: unknown, path: string): FirearmProfileData => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    const group = value.group;
    if (group === 'shotgun') {
        exactKeys(
            value,
            [
                'group',
                'sightHeightM',
                'zeroRangeM',
                'muzzleVelocityMultiplier',
                'temperatureVelocityProfile',
                'temperatureVelocitySource',
            ],
            path,
        );
        const data: FirearmProfileData = {
            group,
            sightHeightM: finiteNumber(value.sightHeightM, `${path}.sightHeightM`),
            zeroRangeM: finiteNumber(value.zeroRangeM, `${path}.zeroRangeM`),
            muzzleVelocityMultiplier: finiteNumber(
                value.muzzleVelocityMultiplier,
                `${path}.muzzleVelocityMultiplier`,
            ),
            temperatureVelocityProfile: decodeTemperatureVelocityProfile(
                value.temperatureVelocityProfile,
                `${path}.temperatureVelocityProfile`,
            ),
            temperatureVelocitySource: optionalSourceText(
                value.temperatureVelocitySource,
                `${path}.temperatureVelocitySource`,
            ),
        };
        if (
            data.sightHeightM < 0 ||
            data.sightHeightM > 0.25 ||
            data.zeroRangeM < 5 ||
            data.zeroRangeM > 1000 ||
            data.muzzleVelocityMultiplier < 0.75 ||
            data.muzzleVelocityMultiplier > 1.25
        ) {
            throw new ProfileDocumentError(`${path} contains an out-of-range shotgun value.`);
        }
        return data;
    }
    if (group === 'rifle') {
        exactKeys(
            value,
            [
                'group',
                'sightHeightM',
                'zeroRangeM',
                'muzzleVelocityMultiplier',
                'twistInches',
                'twistDirection',
                'temperatureVelocityProfile',
                'temperatureVelocitySource',
            ],
            path,
        );
        const data: FirearmProfileData = {
            group,
            sightHeightM: finiteNumber(value.sightHeightM, `${path}.sightHeightM`),
            zeroRangeM: finiteNumber(value.zeroRangeM, `${path}.zeroRangeM`),
            muzzleVelocityMultiplier: finiteNumber(
                value.muzzleVelocityMultiplier,
                `${path}.muzzleVelocityMultiplier`,
            ),
            twistInches: finiteNumber(value.twistInches, `${path}.twistInches`),
            twistDirection: finiteNumber(value.twistDirection, `${path}.twistDirection`),
            temperatureVelocityProfile: decodeTemperatureVelocityProfile(
                value.temperatureVelocityProfile,
                `${path}.temperatureVelocityProfile`,
            ),
            temperatureVelocitySource: optionalSourceText(
                value.temperatureVelocitySource,
                `${path}.temperatureVelocitySource`,
            ),
        };
        if (
            data.sightHeightM < 0 ||
            data.sightHeightM > 0.25 ||
            data.zeroRangeM < 5 ||
            data.zeroRangeM > 1000 ||
            data.muzzleVelocityMultiplier < 0.75 ||
            data.muzzleVelocityMultiplier > 1.25 ||
            data.twistInches < 5 ||
            data.twistInches > 30 ||
            (data.twistDirection !== -1 && data.twistDirection !== 1)
        ) {
            throw new ProfileDocumentError(`${path} contains an out-of-range rifle value.`);
        }
        return data;
    }
    throw new ProfileDocumentError(`${path}.group is unsupported.`);
};

const decodeAmmunitionData = (value: unknown, path: string): AmmunitionProfileData => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    if (value.selection === 'builtIn') {
        exactKeys(value, ['selection', 'loadId'], path);
        const loadId = stringValue(value.loadId, `${path}.loadId`, 128);
        if (!loadId.startsWith('builtin:')) {
            throw new ProfileDocumentError(`${path}.loadId must use builtin:.`);
        }
        return { selection: 'builtIn', loadId };
    }
    if (value.selection === 'custom') {
        exactKeys(value, ['selection', 'load'], path);
        return { selection: 'custom', load: decodeCustomLoad(value.load, `${path}.load`) };
    }
    throw new ProfileDocumentError(`${path}.selection is unsupported.`);
};

const decodeCombinedData = (
    value: unknown,
    path: string,
    defaults: Inputs,
): CombinedScenarioProfileData => {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(
        value,
        ['inputs', 'uncertainty', 'customLoads', 'selectedLoadId', 'preferredUnits'],
        path,
    );
    if (!Array.isArray(value.customLoads) || value.customLoads.length > 3) {
        throw new ProfileDocumentError(`${path}.customLoads must contain at most 3 entries.`);
    }
    if (value.preferredUnits !== 'metric' && value.preferredUnits !== 'imperial') {
        throw new ProfileDocumentError(`${path}.preferredUnits is unsupported.`);
    }
    if (value.selectedLoadId !== null && typeof value.selectedLoadId !== 'string') {
        throw new ProfileDocumentError(`${path}.selectedLoadId must be a string or null.`);
    }
    const customLoads = value.customLoads.map((entry, index) =>
        decodeCustomLoad(entry, `${path}.customLoads[${index}]`),
    );
    if (new Set(customLoads.map((load) => load.id)).size !== customLoads.length) {
        throw new ProfileDocumentError(`${path}.customLoads contains duplicate IDs.`);
    }
    const selectedLoadId = value.selectedLoadId;
    if (
        selectedLoadId !== null &&
        !selectedLoadId.startsWith('builtin:') &&
        !customLoads.some((load) => load.id === selectedLoadId)
    ) {
        throw new ProfileDocumentError(
            `${path}.selectedLoadId does not identify an included load.`,
        );
    }
    return {
        inputs: decodeInputs(value.inputs, `${path}.inputs`),
        uncertainty: decodeUncertainty(value.uncertainty, `${path}.uncertainty`),
        customLoads,
        selectedLoadId,
        preferredUnits: value.preferredUnits,
    };
};

export function decodeNamedProfile(value: unknown, path: string, defaults: Inputs): NamedProfile {
    if (!object(value)) throw new ProfileDocumentError(`${path} must be an object.`);
    exactKeys(value, ['id', 'name', 'kind', 'createdAt', 'updatedAt', 'data'], path);
    const id = stringValue(value.id, `${path}.id`, 128);
    if (!id.startsWith('profile:')) throw new ProfileDocumentError(`${path}.id must use profile:.`);
    const name = stringValue(value.name, `${path}.name`, 80).trim();
    if (!name) throw new ProfileDocumentError(`${path}.name cannot contain only whitespace.`);
    const base = {
        id,
        name,
        createdAt: isoTimestamp(value.createdAt, `${path}.createdAt`),
        updatedAt: isoTimestamp(value.updatedAt, `${path}.updatedAt`),
    };
    if (value.kind === 'environment') {
        return {
            ...base,
            kind: value.kind,
            data: decodeEnvironmentData(value.data, `${path}.data`, defaults),
        };
    }
    if (value.kind === 'firearm') {
        return { ...base, kind: value.kind, data: decodeFirearmData(value.data, `${path}.data`) };
    }
    if (value.kind === 'ammunition') {
        return {
            ...base,
            kind: value.kind,
            data: decodeAmmunitionData(value.data, `${path}.data`),
        };
    }
    if (value.kind === 'combinedScenario') {
        return {
            ...base,
            kind: value.kind,
            data: decodeCombinedData(value.data, `${path}.data`, defaults),
        };
    }
    throw new ProfileDocumentError(`${path}.kind is unsupported.`);
}

export function makeQuarantine(
    value: unknown,
    reason: string,
    importedAt = isoNow(),
): QuarantinedProfile {
    let rawJson: string;
    try {
        rawJson = JSON.stringify(value, null, 2);
    } catch {
        rawJson = String(value);
    }
    if (rawJson.length > 16_384) rawJson = `${rawJson.slice(0, 16_384)}\n… [truncated]`;
    const sourceName =
        object(value) && typeof value.name === 'string' && value.name.trim()
            ? value.name.trim().slice(0, 80)
            : 'Unnamed profile';
    return {
        id: quarantineId(),
        sourceName,
        reason: reason.slice(0, 1000),
        importedAt,
        rawJson,
    };
}
