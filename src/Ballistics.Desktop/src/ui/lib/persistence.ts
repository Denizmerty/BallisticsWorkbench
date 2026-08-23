import type { CustomDraft, Inputs, UncertaintySettings } from '../types';
import { defaultDragDataMetadata } from './dragData';
import type { NamedProfile, QuarantinedProfile } from './profiles';
import {
    decodeNamedProfile,
    makeQuarantine,
    MAX_NAMED_PROFILES,
    MAX_QUARANTINED_PROFILES,
} from './profiles';
import { validateCustomLoad } from './validation';
import { SETTINGS_SCHEMA_VERSION } from '../../../shared/productIdentity';

const SETTINGS_KEY = 'bw.settings';
const LEGACY_INPUTS_KEY = 'bw.inputs';
const LEGACY_CUSTOM_LOADS_KEY = 'bw.customLoads';

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export type PersistedSettings = {
    schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
    inputs: Inputs;
    customLoads: CustomDraft[];
    uncertainty: UncertaintySettings;
    profiles: NamedProfile[];
    quarantinedProfiles: QuarantinedProfile[];
};

export const defaultUncertaintySettings: UncertaintySettings = {
    enabled: false,
    method: 'firstOrder',
    sampleCount: 1000,
    seed: 1113017667,
    correlations: [],
    shotgunMuzzleVelocityStandardDeviationMps: 3,
    rifleMuzzleVelocityStandardDeviationMps: 3,
    dragRelativeStandardDeviation: 0.03,
    temperatureStandardDeviationC: 1,
    stationPressureStandardDeviationHpa: 2,
    headwindStandardDeviationMps: 1,
    crosswindStandardDeviationMps: 1,
    shotgunZeroRangeStandardDeviationM: 1,
    rifleZeroRangeStandardDeviationM: 1,
};

const uncertaintyBounds: Array<{
    key: Exclude<
        keyof UncertaintySettings,
        'enabled' | 'method' | 'sampleCount' | 'seed' | 'correlations'
    >;
    maximum: number;
}> = [
    { key: 'shotgunMuzzleVelocityStandardDeviationMps', maximum: 200 },
    { key: 'rifleMuzzleVelocityStandardDeviationMps', maximum: 200 },
    { key: 'dragRelativeStandardDeviation', maximum: 1 },
    { key: 'temperatureStandardDeviationC', maximum: 30 },
    { key: 'stationPressureStandardDeviationHpa', maximum: 200 },
    { key: 'headwindStandardDeviationMps', maximum: 50 },
    { key: 'crosswindStandardDeviationMps', maximum: 50 },
    { key: 'shotgunZeroRangeStandardDeviationM', maximum: 200 },
    { key: 'rifleZeroRangeStandardDeviationM', maximum: 200 },
];

const numericInputKeys = [
    'distanceM',
    'temperatureC',
    'pressureHpa',
    'pressureAltitudeM',
    'geometricAltitudeM',
    'altimeterSettingHpa',
    'humidityPercent',
    'headwindMps',
    'crosswindMps',
    'latitudeDeg',
    'azimuthDeg',
    'targetInclinationDeg',
    'targetElevationM',
    'vitalZoneM',
    'shotgunSightM',
    'rifleSightM',
    'shotgunZeroM',
    'rifleZeroM',
    'shotgunMvMultiplier',
    'rifleMvMultiplier',
    'rifleTwistInches',
    'twistDirection',
] as const;

const booleanInputKeys = [
    'altitudeDependentAtmosphere',
    'useLocalGravity',
    'coriolisEnabled',
] as const;

const sourceInputKeys = [
    'windProvenance',
    'shotgunTemperatureVelocitySource',
    'rifleTemperatureVelocitySource',
] as const;

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function sanitizedInputs(value: unknown, defaults: Inputs): Inputs {
    if (!object(value)) return defaults;
    const inputs = { ...defaults };
    for (const key of numericInputKeys) {
        const candidate = value[key];
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            Object.assign(inputs, { [key]: candidate });
        }
    }
    for (const key of booleanInputKeys) {
        if (typeof value[key] === 'boolean') Object.assign(inputs, { [key]: value[key] });
    }
    for (const key of sourceInputKeys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.length <= 240) {
            Object.assign(inputs, { [key]: candidate });
        }
    }
    if (
        value.pressureSource === 'stationPressure' ||
        value.pressureSource === 'pressureAltitude' ||
        value.pressureSource === 'altimeterSetting'
    ) {
        inputs.pressureSource = value.pressureSource;
    }
    const legacyAltitude = value.altitudeM;
    if (
        typeof legacyAltitude === 'number' &&
        Number.isFinite(legacyAltitude) &&
        typeof value.pressureAltitudeM !== 'number'
    ) {
        inputs.pressureAltitudeM = legacyAltitude;
        inputs.geometricAltitudeM = legacyAltitude;
    }
    if (Array.isArray(value.windLayers)) {
        const layers = value.windLayers
            .filter(object)
            .map((layer) => ({
                axis: layer.axis,
                startM: layer.startM,
                endM: layer.endM,
                startHeadwindMps: layer.startHeadwindMps,
                endHeadwindMps: layer.endHeadwindMps,
                startCrosswindMps: layer.startCrosswindMps,
                endCrosswindMps: layer.endCrosswindMps,
                ...(typeof layer.source === 'string' ? { source: layer.source.slice(0, 240) } : {}),
            }))
            .filter(
                (layer): layer is Inputs['windLayers'][number] =>
                    (layer.axis === 'height' || layer.axis === 'downrange') &&
                    [
                        layer.startM,
                        layer.endM,
                        layer.startHeadwindMps,
                        layer.endHeadwindMps,
                        layer.startCrosswindMps,
                        layer.endCrosswindMps,
                    ].every((item) => typeof item === 'number' && Number.isFinite(item)) &&
                    Number(layer.endM) > Number(layer.startM),
            )
            .slice(0, 16);
        inputs.windLayers = layers;
    }
    const temperatureProfile = (candidate: unknown) =>
        Array.isArray(candidate)
            ? candidate
                  .filter(object)
                  .map((point) => ({
                      temperatureC: point.temperatureC,
                      multiplier: point.multiplier,
                  }))
                  .filter(
                      (point): point is { temperatureC: number; multiplier: number } =>
                          typeof point.temperatureC === 'number' &&
                          Number.isFinite(point.temperatureC) &&
                          typeof point.multiplier === 'number' &&
                          Number.isFinite(point.multiplier),
                  )
                  .slice(0, 12)
            : [];
    const shotgunProfile = temperatureProfile(value.shotgunTemperatureVelocityProfile);
    const rifleProfile = temperatureProfile(value.rifleTemperatureVelocityProfile);
    if (shotgunProfile.length === 0 || shotgunProfile.length >= 2) {
        inputs.shotgunTemperatureVelocityProfile = shotgunProfile;
    }
    if (rifleProfile.length === 0 || rifleProfile.length >= 2) {
        inputs.rifleTemperatureVelocityProfile = rifleProfile;
    }
    if (object(value.buckshotPattern)) {
        const raw = value.buckshotPattern;
        const target = object(raw.target) ? raw.target : {};
        const observations = Array.isArray(raw.observations)
            ? raw.observations
                  .filter(object)
                  .map((observation) => ({
                      rangeM: observation.rangeM,
                      diameter90M: observation.diameter90M,
                      standardUncertaintyM: observation.standardUncertaintyM,
                      shellCount: observation.shellCount,
                      role: observation.role,
                  }))
                  .filter(
                      (
                          observation,
                      ): observation is Inputs['buckshotPattern']['observations'][number] =>
                          [
                              observation.rangeM,
                              observation.diameter90M,
                              observation.standardUncertaintyM,
                              observation.shellCount,
                          ].every((item) => typeof item === 'number' && Number.isFinite(item)) &&
                          (observation.role === 'calibration' || observation.role === 'holdout'),
                  )
                  .slice(0, 64)
            : [];
        const loadId =
            typeof raw.loadId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(raw.loadId)
                ? raw.loadId
                : defaults.buckshotPattern.loadId;
        const choke = ['cylinder', 'improvedCylinder', 'modified', 'full', 'custom'].includes(
            String(raw.choke),
        )
            ? (raw.choke as Inputs['buckshotPattern']['choke'])
            : defaults.buckshotPattern.choke;
        const deformationClass = [
            'softLead',
            'hardenedLead',
            'plated',
            'buffered',
            'unknown',
        ].includes(String(raw.deformationClass))
            ? (raw.deformationClass as Inputs['buckshotPattern']['deformationClass'])
            : defaults.buckshotPattern.deformationClass;
        const numberOr = (candidate: unknown, fallback: number) =>
            typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
        const candidate: Inputs['buckshotPattern'] = {
            enabled: raw.enabled === true,
            loadId,
            choke,
            deformationClass,
            pelletVelocityStandardDeviationMps: numberOr(
                raw.pelletVelocityStandardDeviationMps,
                defaults.buckshotPattern.pelletVelocityStandardDeviationMps,
            ),
            targetRangeM: numberOr(raw.targetRangeM, defaults.buckshotPattern.targetRangeM),
            minimumPelletCount: numberOr(
                raw.minimumPelletCount,
                defaults.buckshotPattern.minimumPelletCount,
            ),
            target: {
                shape:
                    target.shape === 'circle' || target.shape === 'rectangle'
                        ? target.shape
                        : defaults.buckshotPattern.target.shape,
                widthM: numberOr(target.widthM, defaults.buckshotPattern.target.widthM),
                heightM: numberOr(target.heightM, defaults.buckshotPattern.target.heightM),
                centerHorizontalM: numberOr(
                    target.centerHorizontalM,
                    defaults.buckshotPattern.target.centerHorizontalM,
                ),
                centerVerticalM: numberOr(
                    target.centerVerticalM,
                    defaults.buckshotPattern.target.centerVerticalM,
                ),
            },
            observations,
        };
        inputs.buckshotPattern = candidate;
    }
    return inputs;
}

function sanitizedUncertainty(value: unknown): UncertaintySettings {
    const result = { ...defaultUncertaintySettings };
    if (!object(value)) return result;
    if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
    if (value.method === 'firstOrder' || value.method === 'monteCarlo') {
        result.method = value.method;
    }
    if (
        typeof value.sampleCount === 'number' &&
        Number.isInteger(value.sampleCount) &&
        value.sampleCount >= 100 &&
        value.sampleCount <= 10000
    ) {
        result.sampleCount = value.sampleCount;
    }
    if (typeof value.seed === 'number' && Number.isSafeInteger(value.seed) && value.seed >= 0) {
        result.seed = value.seed;
    }
    const variables = new Set([
        'muzzleVelocity',
        'drag',
        'temperature',
        'stationPressure',
        'headwind',
        'crosswind',
        'zeroRange',
    ]);
    if (Array.isArray(value.correlations)) {
        result.correlations = value.correlations
            .filter(object)
            .map((correlation) => ({
                first: correlation.first,
                second: correlation.second,
                coefficient: correlation.coefficient,
            }))
            .filter(
                (correlation): correlation is UncertaintySettings['correlations'][number] =>
                    typeof correlation.first === 'string' &&
                    variables.has(correlation.first) &&
                    typeof correlation.second === 'string' &&
                    variables.has(correlation.second) &&
                    correlation.first !== correlation.second &&
                    typeof correlation.coefficient === 'number' &&
                    Number.isFinite(correlation.coefficient) &&
                    Math.abs(correlation.coefficient) < 1,
            )
            .slice(0, 21);
    }
    for (const { key, maximum } of uncertaintyBounds) {
        const candidate = value[key];
        if (
            typeof candidate === 'number' &&
            Number.isFinite(candidate) &&
            candidate >= 0 &&
            candidate <= maximum
        ) {
            result[key] = candidate;
        }
    }
    return result;
}

function legacyCustomId(value: unknown, index: number) {
    const source = JSON.stringify(value) ?? String(index);
    let hash = 2166136261;
    for (let offset = 0; offset < source.length; offset += 1) {
        hash ^= source.charCodeAt(offset);
        hash = Math.imul(hash, 16777619);
    }
    return `custom:legacy-${(hash >>> 0).toString(16)}-${index}`;
}

export function createCustomLoadId() {
    const value =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `custom:${value}`;
}

function sanitizedBcBands(value: unknown, fallbackBc: unknown) {
    if (Array.isArray(value)) {
        return value
            .filter(object)
            .map((band) => ({
                minimumVelocityMps: band.minimumVelocityMps,
                ballisticCoefficient: band.ballisticCoefficient,
            }))
            .filter(
                (band): band is { minimumVelocityMps: number; ballisticCoefficient: number } =>
                    typeof band.minimumVelocityMps === 'number' &&
                    Number.isFinite(band.minimumVelocityMps) &&
                    typeof band.ballisticCoefficient === 'number' &&
                    Number.isFinite(band.ballisticCoefficient),
            );
    }
    const bc = typeof fallbackBc === 'number' && Number.isFinite(fallbackBc) ? fallbackBc : 0.475;
    return [
        { minimumVelocityMps: 0, ballisticCoefficient: bc },
        { minimumVelocityMps: 400, ballisticCoefficient: bc },
    ];
}

function sanitizedMachCdPoints(value: unknown) {
    if (Array.isArray(value)) {
        return value
            .filter(object)
            .map((point) => ({ mach: point.mach, dragCoefficient: point.dragCoefficient }))
            .filter(
                (point): point is { mach: number; dragCoefficient: number } =>
                    typeof point.mach === 'number' &&
                    Number.isFinite(point.mach) &&
                    typeof point.dragCoefficient === 'number' &&
                    Number.isFinite(point.dragCoefficient),
            );
    }
    return [
        { mach: 0, dragCoefficient: 0.24 },
        { mach: 0.8, dragCoefficient: 0.25 },
        { mach: 1, dragCoefficient: 0.42 },
        { mach: 1.2, dragCoefficient: 0.36 },
        { mach: 2, dragCoefficient: 0.27 },
        { mach: 3, dragCoefficient: 0.22 },
    ];
}

function sanitizedDragDataMetadata(value: unknown) {
    const defaults = defaultDragDataMetadata();
    if (!object(value)) return defaults;
    const boundedText = (candidate: unknown, fallback: string, maximum: number) =>
        typeof candidate === 'string' ? candidate.slice(0, maximum) : fallback;
    const domainValue = (candidate: unknown) =>
        candidate === null ||
        (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0)
            ? candidate
            : null;
    return {
        citation: boundedText(value.citation, defaults.citation, 500),
        sourceUrl: boundedText(value.sourceUrl, defaults.sourceUrl, 2000),
        license: boundedText(value.license, defaults.license, 200),
        sourceChecksumSha256:
            typeof value.sourceChecksumSha256 === 'string' &&
            /^(?:[0-9a-f]{64})?$/i.test(value.sourceChecksumSha256)
                ? value.sourceChecksumSha256.toLowerCase()
                : '',
        domainMinimum: domainValue(value.domainMinimum),
        domainMaximum: domainValue(value.domainMaximum),
    };
}

function sanitizedCustomLoad(value: unknown, index: number): CustomDraft | undefined {
    if (!object(value)) return undefined;
    const raw = value as Partial<CustomDraft>;
    const candidate: Partial<CustomDraft> = {
        id:
            typeof raw.id === 'string' && raw.id.startsWith('custom:') && raw.id.length <= 128
                ? raw.id
                : legacyCustomId(value, index),
        name: raw.name,
        drag: raw.drag,
        group: raw.group,
        massG: raw.massG,
        mv: raw.mv,
        bc: raw.bc,
        bcMode: raw.bcMode === 'velocityBands' ? 'velocityBands' : 'constant',
        bcBands: sanitizedBcBands(raw.bcBands, raw.bc),
        machCdDiameterMm:
            typeof raw.machCdDiameterMm === 'number' && Number.isFinite(raw.machCdDiameterMm)
                ? raw.machCdDiameterMm
                : 7.82,
        machCdPoints: sanitizedMachCdPoints(raw.machCdPoints),
        dragDataMetadata: sanitizedDragDataMetadata(raw.dragDataMetadata),
        sphereMm: raw.sphereMm,
        density: raw.density,
        count: raw.count,
        length: raw.length,
        diameter: raw.diameter,
        twist: raw.twist,
    };
    const numeric = [
        candidate.massG,
        candidate.mv,
        candidate.bc,
        candidate.sphereMm,
        candidate.density,
        candidate.count,
        candidate.length,
        candidate.diameter,
        candidate.twist,
        candidate.machCdDiameterMm,
    ];
    const valid =
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        (candidate.bcMode === 'constant' || candidate.bcMode === 'velocityBands') &&
        (candidate.drag === 'G1' ||
            candidate.drag === 'G7' ||
            candidate.drag === 'MachCd' ||
            candidate.drag === 'Sphere') &&
        (candidate.group === 'rifle' || candidate.group === 'shotgun') &&
        numeric.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
        validateCustomLoad(candidate as CustomDraft).length === 0;
    return valid ? (candidate as CustomDraft) : undefined;
}

const sanitizedCustomLoads = (value: unknown) =>
    Array.isArray(value)
        ? value
              .map(sanitizedCustomLoad)
              .filter((item): item is CustomDraft => item !== undefined)
              .filter(
                  (item, index, values) =>
                      values.findIndex((other) => other.id === item.id) === index,
              )
              .slice(0, 3)
        : [];

const parse = (value: string | null): unknown => {
    if (!value) return undefined;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
};

function sanitizedQuarantine(value: unknown): QuarantinedProfile[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(object)
        .map((entry) => ({
            id:
                typeof entry.id === 'string' && entry.id.startsWith('quarantine:')
                    ? entry.id.slice(0, 128)
                    : `quarantine:stored-${Math.random().toString(36).slice(2)}`,
            sourceName:
                typeof entry.sourceName === 'string' && entry.sourceName.trim()
                    ? entry.sourceName.trim().slice(0, 80)
                    : 'Unnamed profile',
            reason:
                typeof entry.reason === 'string' && entry.reason.trim()
                    ? entry.reason.trim().slice(0, 1000)
                    : 'No diagnostic was stored.',
            importedAt:
                typeof entry.importedAt === 'string'
                    ? entry.importedAt.slice(0, 40)
                    : new Date().toISOString(),
            rawJson:
                typeof entry.rawJson === 'string' ? entry.rawJson.slice(0, 16_500) : String(entry),
        }))
        .slice(-MAX_QUARANTINED_PROFILES);
}

function sanitizedProfiles(
    value: unknown,
    defaults: Inputs,
    existingQuarantine: QuarantinedProfile[],
) {
    const profiles: NamedProfile[] = [];
    const quarantine = [...existingQuarantine];
    if (!Array.isArray(value)) return { profiles, quarantine };
    value.slice(0, MAX_NAMED_PROFILES).forEach((entry, index) => {
        try {
            const profile = decodeNamedProfile(entry, `settings.profiles[${index}]`, defaults);
            if (
                profiles.some(
                    (other) =>
                        other.id === profile.id ||
                        (other.kind === profile.kind &&
                            other.name.trim().toLocaleLowerCase() ===
                                profile.name.trim().toLocaleLowerCase()),
                )
            ) {
                quarantine.push(
                    makeQuarantine(entry, 'Stored profile has a duplicate ID or name.'),
                );
            } else {
                profiles.push(profile);
            }
        } catch (error) {
            quarantine.push(
                makeQuarantine(
                    entry,
                    error instanceof Error ? error.message : 'Stored profile failed validation.',
                ),
            );
        }
    });
    return { profiles, quarantine: quarantine.slice(-MAX_QUARANTINED_PROFILES) };
}

export function loadPersistedSettings(
    defaults: Inputs,
    storage: StorageAccess = window.localStorage,
): PersistedSettings {
    const current = parse(storage.getItem(SETTINGS_KEY));
    if (
        object(current) &&
        Number.isInteger(current.schemaVersion) &&
        Number(current.schemaVersion) >= 2 &&
        Number(current.schemaVersion) <= SETTINGS_SCHEMA_VERSION
    ) {
        const inputs = sanitizedInputs(current.inputs, defaults);
        const storedQuarantine = sanitizedQuarantine(current.quarantinedProfiles);
        const profileState = sanitizedProfiles(current.profiles, inputs, storedQuarantine);
        return {
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            inputs,
            customLoads: sanitizedCustomLoads(current.customLoads),
            uncertainty: sanitizedUncertainty(current.uncertainty),
            profiles: profileState.profiles,
            quarantinedProfiles: profileState.quarantine,
        };
    }

    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        inputs: sanitizedInputs(parse(storage.getItem(LEGACY_INPUTS_KEY)), defaults),
        customLoads: sanitizedCustomLoads(parse(storage.getItem(LEGACY_CUSTOM_LOADS_KEY))),
        uncertainty: { ...defaultUncertaintySettings },
        profiles: [],
        quarantinedProfiles: [],
    };
}

export function savePersistedSettings(
    inputs: Inputs,
    customLoads: CustomDraft[],
    uncertainty: UncertaintySettings = defaultUncertaintySettings,
    storage: StorageAccess = window.localStorage,
    profiles: NamedProfile[] = [],
    quarantinedProfiles: QuarantinedProfile[] = [],
) {
    const safeInputs = sanitizedInputs(inputs, inputs);
    const profileState = sanitizedProfiles(
        profiles,
        safeInputs,
        sanitizedQuarantine(quarantinedProfiles),
    );
    const settings: PersistedSettings = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        inputs: safeInputs,
        customLoads: sanitizedCustomLoads(customLoads),
        uncertainty: sanitizedUncertainty(uncertainty),
        profiles: profileState.profiles,
        quarantinedProfiles: profileState.quarantine,
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
