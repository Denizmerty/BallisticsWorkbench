import type { CustomDraft, Inputs, UncertaintySettings } from '../types';
import { SETTINGS_SCHEMA_VERSION } from '../../../shared/productIdentity';
import { defaultDragDataMetadata } from './dragData';
import {
    clone,
    customLoadKeys,
    decodeCustomLoad,
    decodeInputs,
    decodeNamedProfile,
    decodeUncertainty,
    environmentKeys,
    exactKeys,
    inputKeys,
    isoNow,
    isoTimestamp,
    makeQuarantine,
    normalizedName,
    object,
    profileId,
} from './profileCodec';
import {
    MAX_NAMED_PROFILES,
    MAX_PROFILE_DOCUMENT_BYTES,
    PROFILE_FORMAT,
    PROFILE_SCHEMA_VERSION,
    ProfileDocumentError,
    type CombinedScenarioProfileData,
    type EnvironmentProfileData,
    type NamedProfile,
    type ProfileApplication,
    type ProfileCaptureContext,
    type ProfileConflictPolicy,
    type ProfileDocument,
    type ProfileImportResult,
    type ProfileImportSummary,
    type ProfileKind,
    type QuarantinedProfile,
} from './profileTypes';

export { decodeNamedProfile, makeQuarantine } from './profileCodec';
export * from './profileTypes';

const profileName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
        throw new ProfileDocumentError('Profile name must contain between 1 and 80 characters.');
    }
    return trimmed;
};

export function captureProfile(
    kind: ProfileKind,
    name: string,
    context: ProfileCaptureContext,
    firearmGroup: 'rifle' | 'shotgun' = 'rifle',
    now = isoNow(),
): NamedProfile {
    const base = { id: profileId(), name: profileName(name), createdAt: now, updatedAt: now };
    if (kind === 'environment') {
        const data = {} as EnvironmentProfileData;
        for (const key of environmentKeys) Object.assign(data, { [key]: context.inputs[key] });
        return { ...base, kind, data };
    }
    if (kind === 'firearm') {
        if (firearmGroup === 'shotgun') {
            return {
                ...base,
                kind,
                data: {
                    group: firearmGroup,
                    sightHeightM: context.inputs.shotgunSightM,
                    zeroRangeM: context.inputs.shotgunZeroM,
                    muzzleVelocityMultiplier: context.inputs.shotgunMvMultiplier,
                    temperatureVelocityProfile: clone(
                        context.inputs.shotgunTemperatureVelocityProfile,
                    ),
                    temperatureVelocitySource: context.inputs.shotgunTemperatureVelocitySource,
                },
            };
        }
        return {
            ...base,
            kind,
            data: {
                group: firearmGroup,
                sightHeightM: context.inputs.rifleSightM,
                zeroRangeM: context.inputs.rifleZeroM,
                muzzleVelocityMultiplier: context.inputs.rifleMvMultiplier,
                twistInches: context.inputs.rifleTwistInches,
                twistDirection: context.inputs.twistDirection,
                temperatureVelocityProfile: clone(context.inputs.rifleTemperatureVelocityProfile),
                temperatureVelocitySource: context.inputs.rifleTemperatureVelocitySource,
            },
        };
    }
    if (kind === 'ammunition') {
        if (!context.selectedLoad) {
            throw new ProfileDocumentError('Select an ammunition load before saving its profile.');
        }
        const custom = context.customLoads.find((load) => load.id === context.selectedLoad?.id);
        return custom
            ? { ...base, kind, data: { selection: 'custom', load: clone(custom) } }
            : { ...base, kind, data: { selection: 'builtIn', loadId: context.selectedLoad.id } };
    }
    return {
        ...base,
        kind,
        data: {
            inputs: clone(context.inputs),
            uncertainty: clone(context.uncertainty),
            customLoads: clone(context.customLoads),
            selectedLoadId: context.selectedLoadId,
            preferredUnits: context.preferredUnits,
        },
    };
}

export function uniqueProfileName(profiles: NamedProfile[], kind: ProfileKind, requested: string) {
    const base = profileName(requested);
    const names = new Set(
        profiles
            .filter((profile) => profile.kind === kind)
            .map((profile) => normalizedName(profile.name)),
    );
    if (!names.has(normalizedName(base))) return base;
    for (let suffix = 2; suffix <= MAX_NAMED_PROFILES + 1; suffix += 1) {
        const ending = ` (${suffix})`;
        const candidate = `${base.slice(0, 80 - ending.length).trimEnd()}${ending}`;
        if (!names.has(normalizedName(candidate))) return candidate;
    }
    throw new ProfileDocumentError('A unique profile name could not be generated.');
}

export function appendCapturedProfile(profiles: NamedProfile[], profile: NamedProfile) {
    if (profiles.length >= MAX_NAMED_PROFILES) {
        throw new ProfileDocumentError(
            `At most ${MAX_NAMED_PROFILES} named profiles may be stored.`,
        );
    }
    return [
        ...profiles,
        { ...profile, name: uniqueProfileName(profiles, profile.kind, profile.name) },
    ];
}

export function applyNamedProfile(
    profile: NamedProfile,
    context: ProfileCaptureContext,
): ProfileApplication {
    const unchanged = (message: string): ProfileApplication => ({
        ok: false,
        inputs: context.inputs,
        uncertainty: context.uncertainty,
        customLoads: context.customLoads,
        selectedLoadId: context.selectedLoadId,
        preferredUnits: context.preferredUnits,
        message,
    });
    const result: ProfileApplication = {
        ok: true,
        inputs: clone(context.inputs),
        uncertainty: clone(context.uncertainty),
        customLoads: clone(context.customLoads),
        selectedLoadId: context.selectedLoadId,
        preferredUnits: context.preferredUnits,
        message: `Applied ${profile.name}.`,
    };
    if (profile.kind === 'environment') {
        result.inputs = { ...result.inputs, ...clone(profile.data) };
    } else if (profile.kind === 'firearm') {
        if (profile.data.group === 'shotgun') {
            result.inputs = {
                ...result.inputs,
                shotgunSightM: profile.data.sightHeightM,
                shotgunZeroM: profile.data.zeroRangeM,
                shotgunMvMultiplier: profile.data.muzzleVelocityMultiplier,
                shotgunTemperatureVelocityProfile: clone(profile.data.temperatureVelocityProfile),
                shotgunTemperatureVelocitySource: profile.data.temperatureVelocitySource,
            };
        } else {
            result.inputs = {
                ...result.inputs,
                rifleSightM: profile.data.sightHeightM,
                rifleZeroM: profile.data.zeroRangeM,
                rifleMvMultiplier: profile.data.muzzleVelocityMultiplier,
                rifleTwistInches: profile.data.twistInches,
                twistDirection: profile.data.twistDirection,
                rifleTemperatureVelocityProfile: clone(profile.data.temperatureVelocityProfile),
                rifleTemperatureVelocitySource: profile.data.temperatureVelocitySource,
            };
        }
    } else if (profile.kind === 'ammunition') {
        if (profile.data.selection === 'builtIn') {
            if (!context.availableLoadIds.includes(profile.data.loadId)) {
                return unchanged(
                    `This ammunition profile references an unavailable built-in load (${profile.data.loadId}).`,
                );
            }
            result.selectedLoadId = profile.data.loadId;
        } else {
            const imported = clone(profile.data.load);
            const sameId = result.customLoads.findIndex((load) => load.id === imported.id);
            const sameName = result.customLoads.findIndex(
                (load) => normalizedName(load.name) === normalizedName(imported.name),
            );
            const replacement = sameId >= 0 ? sameId : sameName;
            if (replacement >= 0) {
                imported.id = result.customLoads[replacement].id;
                result.customLoads[replacement] = imported;
            } else if (result.customLoads.length < 3) {
                result.customLoads.push(imported);
            } else {
                return unchanged(
                    'This ammunition profile cannot be applied because three custom loads are already active.',
                );
            }
            result.selectedLoadId = imported.id;
        }
    } else {
        if (
            profile.data.selectedLoadId?.startsWith('builtin:') &&
            !context.availableLoadIds.includes(profile.data.selectedLoadId)
        ) {
            return unchanged(
                `This scenario references an unavailable built-in load (${profile.data.selectedLoadId}).`,
            );
        }
        result.inputs = clone(profile.data.inputs);
        result.uncertainty = clone(profile.data.uncertainty);
        result.customLoads = clone(profile.data.customLoads);
        result.selectedLoadId = profile.data.selectedLoadId;
        result.preferredUnits = profile.data.preferredUnits;
    }
    return result;
}

const conflictIndex = (profiles: NamedProfile[], incoming: NamedProfile) => {
    const id = profiles.findIndex((profile) => profile.id === incoming.id);
    if (id >= 0) return id;
    return profiles.findIndex(
        (profile) =>
            profile.kind === incoming.kind &&
            normalizedName(profile.name) === normalizedName(incoming.name),
    );
};

const emptySummary = (): ProfileImportSummary => ({
    added: 0,
    replaced: 0,
    renamed: 0,
    skipped: 0,
    quarantined: 0,
    migrated: 0,
});

const legacyUncertaintyDefaults: UncertaintySettings = {
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

const legacyUncertaintyBounds: Array<{
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

const legacyInputs = (value: unknown, defaults: Inputs): Inputs => {
    if (!object(value)) throw new ProfileDocumentError('legacy.inputs must be an object.');
    const migrated = { ...defaults };
    for (const key of inputKeys) {
        if (key === 'pressureSource') continue;
        const candidate = value[key];
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            Object.assign(migrated, { [key]: candidate });
        }
    }
    if (
        value.pressureSource === 'stationPressure' ||
        value.pressureSource === 'pressureAltitude' ||
        value.pressureSource === 'altimeterSetting'
    ) {
        migrated.pressureSource = value.pressureSource;
    }
    if (
        typeof value.altitudeM === 'number' &&
        Number.isFinite(value.altitudeM) &&
        typeof value.pressureAltitudeM !== 'number'
    ) {
        migrated.pressureAltitudeM = value.altitudeM;
        migrated.geometricAltitudeM = value.altitudeM;
    }
    return decodeInputs(migrated, 'legacy.inputs');
};

const legacyUncertainty = (value: unknown): UncertaintySettings => {
    const migrated = { ...legacyUncertaintyDefaults };
    if (!object(value)) return migrated;
    if (typeof value.enabled === 'boolean') migrated.enabled = value.enabled;
    for (const { key, maximum } of legacyUncertaintyBounds) {
        const candidate = value[key];
        if (
            typeof candidate === 'number' &&
            Number.isFinite(candidate) &&
            candidate >= 0 &&
            candidate <= maximum
        ) {
            migrated[key] = candidate;
        }
    }
    return decodeUncertainty(migrated, 'legacy.uncertainty');
};

const legacyCustomId = (value: unknown, index: number) => {
    const source = JSON.stringify(value) ?? String(index);
    let hash = 2166136261;
    for (let offset = 0; offset < source.length; offset += 1) {
        hash ^= source.charCodeAt(offset);
        hash = Math.imul(hash, 16777619);
    }
    return `custom:legacy-${(hash >>> 0).toString(16)}-${index}`;
};

const legacyCustomLoad = (value: unknown, index: number): CustomDraft => {
    if (!object(value)) {
        throw new ProfileDocumentError(`legacy.customLoads[${index}] must be an object.`);
    }
    const bc = typeof value.bc === 'number' && Number.isFinite(value.bc) ? value.bc : 0.475;
    const candidate: Record<string, unknown> = {
        ...value,
        id:
            typeof value.id === 'string' && value.id.startsWith('custom:') && value.id.length <= 128
                ? value.id
                : legacyCustomId(value, index),
        bcMode: value.bcMode === 'velocityBands' ? 'velocityBands' : 'constant',
        bcBands: Array.isArray(value.bcBands)
            ? value.bcBands
            : [
                  { minimumVelocityMps: 0, ballisticCoefficient: bc },
                  { minimumVelocityMps: 400, ballisticCoefficient: bc },
              ],
        machCdDiameterMm:
            typeof value.machCdDiameterMm === 'number' && Number.isFinite(value.machCdDiameterMm)
                ? value.machCdDiameterMm
                : 7.82,
        machCdPoints: Array.isArray(value.machCdPoints)
            ? value.machCdPoints
            : [
                  { mach: 0, dragCoefficient: 0.24 },
                  { mach: 0.8, dragCoefficient: 0.25 },
                  { mach: 1, dragCoefficient: 0.42 },
                  { mach: 1.2, dragCoefficient: 0.36 },
                  { mach: 2, dragCoefficient: 0.27 },
                  { mach: 3, dragCoefficient: 0.22 },
              ],
        dragDataMetadata: object(value.dragDataMetadata)
            ? value.dragDataMetadata
            : defaultDragDataMetadata(),
    };
    const current = Object.fromEntries(customLoadKeys.map((key) => [key, candidate[key]]));
    return decodeCustomLoad(current, `legacy.customLoads[${index}]`);
};

const decodeLegacySettingsProfile = (
    value: Record<string, unknown>,
    defaults: Inputs,
    now: string,
): NamedProfile => {
    if (
        typeof value.schemaVersion !== 'number' ||
        value.schemaVersion < 2 ||
        value.schemaVersion >= SETTINGS_SCHEMA_VERSION ||
        !('inputs' in value)
    ) {
        throw new ProfileDocumentError(
            'The profile document format or schema version is unsupported.',
        );
    }
    const inputs = legacyInputs(value.inputs, defaults);
    const customValues = Array.isArray(value.customLoads) ? value.customLoads : [];
    if (customValues.length > 3) {
        throw new ProfileDocumentError('legacy.customLoads contains more than 3 entries.');
    }
    const customLoads = customValues.map(legacyCustomLoad);
    const uncertainty = legacyUncertainty(value.uncertainty);
    const data: CombinedScenarioProfileData = {
        inputs,
        customLoads,
        uncertainty,
        selectedLoadId: null,
        preferredUnits: 'metric',
    };
    // Decode again through the current contract so a migration can never bypass current validation.
    return decodeNamedProfile(
        {
            id: profileId(),
            name: 'Imported legacy settings',
            kind: 'combinedScenario',
            createdAt: now,
            updatedAt: now,
            data,
        },
        'legacyProfile',
        defaults,
    );
};

const migratePortableProfile = (value: unknown, defaults: Inputs): unknown => {
    if (!object(value) || !object(value.data)) return value;
    const migrated = clone(value);
    if (!object(migrated.data)) return migrated;
    if (migrated.kind === 'combinedScenario' && object(migrated.data.inputs)) {
        migrated.data.inputs = { ...clone(defaults), ...migrated.data.inputs };
        if (object(migrated.data.uncertainty)) {
            migrated.data.uncertainty = {
                method: 'firstOrder',
                sampleCount: 1000,
                seed: 1113017667,
                correlations: [],
                ...migrated.data.uncertainty,
            };
        }
    } else if (migrated.kind === 'environment') {
        const environmentDefaults = Object.fromEntries(
            environmentKeys.map((key) => [key, clone(defaults[key])]),
        );
        migrated.data = { ...environmentDefaults, ...migrated.data };
    } else if (migrated.kind === 'firearm') {
        migrated.data = {
            ...migrated.data,
            temperatureVelocityProfile: [],
            temperatureVelocitySource: '',
        };
    }
    return migrated;
};

export function importProfileDocument(
    text: string,
    existingProfiles: NamedProfile[],
    defaults: Inputs,
    policy: ProfileConflictPolicy,
    now = isoNow(),
): ProfileImportResult {
    if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_DOCUMENT_BYTES) {
        throw new ProfileDocumentError('Profile document exceeds the 1 MiB limit.');
    }
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        throw new ProfileDocumentError('Profile document is not valid JSON.');
    }
    if (!object(root)) throw new ProfileDocumentError('Profile document must contain an object.');

    const summary = emptySummary();
    let rawProfiles: unknown[];
    if (root.format === PROFILE_FORMAT) {
        exactKeys(
            root,
            ['format', 'schemaVersion', 'exportedAt', 'unitConvention', 'profiles'],
            'document',
        );
        const portableSchemaVersion = root.schemaVersion;
        if (
            !Number.isInteger(portableSchemaVersion) ||
            Number(portableSchemaVersion) < 1 ||
            Number(portableSchemaVersion) > PROFILE_SCHEMA_VERSION
        ) {
            throw new ProfileDocumentError(
                `Profile schema version ${String(root.schemaVersion)} is unsupported. Expected ${PROFILE_SCHEMA_VERSION}.`,
            );
        }
        isoTimestamp(root.exportedAt, 'document.exportedAt');
        if (root.unitConvention !== 'SI') {
            throw new ProfileDocumentError('Profile document must use the SI unit convention.');
        }
        if (
            !Array.isArray(root.profiles) ||
            root.profiles.length < 1 ||
            root.profiles.length > 64
        ) {
            throw new ProfileDocumentError(
                'Profile document must contain between 1 and 64 profiles.',
            );
        }
        rawProfiles =
            portableSchemaVersion === PROFILE_SCHEMA_VERSION
                ? root.profiles
                : root.profiles.map((profile) => migratePortableProfile(profile, defaults));
        if (portableSchemaVersion !== PROFILE_SCHEMA_VERSION) {
            summary.migrated = root.profiles.length;
        }
    } else {
        rawProfiles = [decodeLegacySettingsProfile(root, defaults, now)];
        summary.migrated = 1;
    }

    const profiles = clone(existingProfiles);
    const quarantine: QuarantinedProfile[] = [];
    rawProfiles.forEach((raw, index) => {
        let incoming: NamedProfile;
        try {
            incoming = decodeNamedProfile(raw, `document.profiles[${index}]`, defaults);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'Profile failed validation.';
            quarantine.push(makeQuarantine(raw, reason, now));
            summary.quarantined += 1;
            return;
        }
        const conflict = conflictIndex(profiles, incoming);
        if (conflict < 0) {
            if (profiles.length >= MAX_NAMED_PROFILES) {
                quarantine.push(
                    makeQuarantine(
                        raw,
                        `The ${MAX_NAMED_PROFILES}-profile storage limit was reached.`,
                        now,
                    ),
                );
                summary.quarantined += 1;
            } else {
                profiles.push(incoming);
                summary.added += 1;
            }
            return;
        }
        if (policy === 'skip') {
            summary.skipped += 1;
            return;
        }
        if (policy === 'replace') {
            profiles[conflict] = {
                ...incoming,
                id: profiles[conflict].id,
                createdAt: profiles[conflict].createdAt,
                updatedAt: now,
            } as NamedProfile;
            summary.replaced += 1;
            return;
        }
        if (profiles.length >= MAX_NAMED_PROFILES) {
            quarantine.push(
                makeQuarantine(
                    raw,
                    `The ${MAX_NAMED_PROFILES}-profile storage limit was reached.`,
                    now,
                ),
            );
            summary.quarantined += 1;
            return;
        }
        profiles.push({
            ...incoming,
            id: profileId(),
            name: uniqueProfileName(profiles, incoming.kind, incoming.name),
            createdAt: now,
            updatedAt: now,
        } as NamedProfile);
        summary.renamed += 1;
    });
    return { profiles, quarantine, summary };
}

export function serializeProfileDocument(
    profiles: NamedProfile[],
    defaults: Inputs,
    exportedAt = isoNow(),
) {
    if (profiles.length < 1 || profiles.length > MAX_NAMED_PROFILES) {
        throw new ProfileDocumentError('Select between 1 and 64 profiles to export.');
    }
    const validated = profiles.map((profile, index) =>
        decodeNamedProfile(profile, `profiles[${index}]`, defaults),
    );
    const document: ProfileDocument = {
        format: PROFILE_FORMAT,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        exportedAt: isoTimestamp(exportedAt, 'exportedAt'),
        unitConvention: 'SI',
        profiles: validated,
    };
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_DOCUMENT_BYTES) {
        throw new ProfileDocumentError('Profile document exceeds the 1 MiB export limit.');
    }
    return text;
}

export function profileDocumentFilename(date = new Date()) {
    return `ballistics-profiles-${date.toISOString().slice(0, 10)}.bwprofile.json`;
}

export function profileKindLabel(kind: ProfileKind) {
    if (kind === 'combinedScenario') return 'Combined scenario';
    return `${kind[0].toUpperCase()}${kind.slice(1)}`;
}

export function profileImportMessage(summary: ProfileImportSummary) {
    const parts = [
        summary.added ? `${summary.added} added` : '',
        summary.replaced ? `${summary.replaced} replaced` : '',
        summary.renamed ? `${summary.renamed} renamed` : '',
        summary.skipped ? `${summary.skipped} skipped` : '',
        summary.quarantined ? `${summary.quarantined} quarantined` : '',
        summary.migrated ? `${summary.migrated} legacy envelope migrated` : '',
    ].filter(Boolean);
    return parts.length
        ? `Profile import: ${parts.join(', ')}.`
        : 'Profile import made no changes.';
}
