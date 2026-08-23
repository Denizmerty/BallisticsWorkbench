import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import profileSchema from '../../../../../protocol/ballistics-profile-interchange.schema.json';
import type { CustomDraft, Inputs, Load, UncertaintySettings } from '../types';
import {
    appendCapturedProfile,
    applyNamedProfile,
    captureProfile,
    importProfileDocument,
    MAX_NAMED_PROFILES,
    profileDocumentFilename,
    profileImportMessage,
    PROFILE_SCHEMA_VERSION,
    ProfileDocumentError,
    serializeProfileDocument,
    uniqueProfileName,
} from './profiles';
import { defaultInputs } from './workbenchDefaults';

const NOW = '2026-08-18T12:00:00.000Z';

const inputs: Inputs = {
    ...defaultInputs,
    distanceM: 500,
    temperatureC: 12,
    pressureHpa: 995,
    pressureSource: 'altimeterSetting',
    pressureAltitudeM: 155,
    geometricAltitudeM: 250,
    altimeterSettingHpa: 1025,
    humidityPercent: 65,
    headwindMps: 3,
    crosswindMps: -2,
    vitalZoneM: 0.18,
    shotgunSightM: 0.03,
    rifleSightM: 0.045,
    shotgunZeroM: 60,
    rifleZeroM: 125,
    shotgunMvMultiplier: 0.98,
    rifleMvMultiplier: 1.02,
    rifleTwistInches: 9,
    twistDirection: -1,
};

const uncertainty: UncertaintySettings = {
    enabled: true,
    method: 'firstOrder',
    sampleCount: 1000,
    seed: 1113017667,
    correlations: [],
    shotgunMuzzleVelocityStandardDeviationMps: 4,
    rifleMuzzleVelocityStandardDeviationMps: 3,
    dragRelativeStandardDeviation: 0.025,
    temperatureStandardDeviationC: 2,
    stationPressureStandardDeviationHpa: 3,
    headwindStandardDeviationMps: 1.5,
    crosswindStandardDeviationMps: 1.25,
    shotgunZeroRangeStandardDeviationM: 2,
    rifleZeroRangeStandardDeviationM: 1,
};

const custom: CustomDraft = {
    id: 'custom:profile-test',
    name: 'Profile Test G7',
    drag: 'G7',
    group: 'rifle',
    massG: 10.886,
    mv: 823,
    bc: 0.475,
    bcMode: 'constant',
    bcBands: [
        { minimumVelocityMps: 0, ballisticCoefficient: 0.45 },
        { minimumVelocityMps: 600, ballisticCoefficient: 0.475 },
    ],
    machCdDiameterMm: 7.82,
    machCdPoints: [
        { mach: 0, dragCoefficient: 0.24 },
        { mach: 3, dragCoefficient: 0.22 },
    ],
    dragDataMetadata: {
        citation: 'Test data',
        sourceUrl: '',
        license: 'Test only',
        sourceChecksumSha256: '',
        domainMinimum: null,
        domainMaximum: null,
    },
    sphereMm: 8,
    density: 11340,
    count: 1,
    length: 1.2,
    diameter: 0.308,
    twist: 8,
};

const builtIn = {
    id: 'builtin:hornady-amax-168',
    shortName: 'Hornady A-MAX',
    source: 'builtIn',
} as Load;

const customResult = {
    id: custom.id,
    shortName: custom.name,
    source: 'custom',
} as Load;

const context = (selectedLoad: Load | undefined = builtIn) => ({
    inputs,
    uncertainty,
    customLoads: [custom],
    availableLoadIds: [builtIn.id, custom.id],
    selectedLoad,
    selectedLoadId: selectedLoad?.id ?? null,
    preferredUnits: 'imperial' as const,
});

const createAllKinds = () => [
    captureProfile('environment', 'Range weather', context(), 'rifle', NOW),
    captureProfile('firearm', 'Match rifle', context(), 'rifle', NOW),
    captureProfile('ammunition', 'A-MAX', context(), 'rifle', NOW),
    captureProfile('combinedScenario', 'Complete match', context(), 'rifle', NOW),
];

describe('named profile capture and application', () => {
    it('captures all four profile kinds without presentation-unit conversion', () => {
        const [environment, firearm, ammunition, scenario] = createAllKinds();
        expect(environment.kind).toBe('environment');
        if (environment.kind !== 'environment') throw new Error('wrong profile kind');
        expect(environment.data).toEqual({
            temperatureC: 12,
            pressureHpa: 995,
            pressureSource: 'altimeterSetting',
            pressureAltitudeM: 155,
            geometricAltitudeM: 250,
            altimeterSettingHpa: 1025,
            humidityPercent: 65,
            headwindMps: 3,
            crosswindMps: -2,
            altitudeDependentAtmosphere: false,
            useLocalGravity: false,
            coriolisEnabled: false,
            latitudeDeg: 45,
            azimuthDeg: 0,
            windLayers: [],
            windProvenance: '',
        });
        expect(firearm.kind).toBe('firearm');
        if (firearm.kind !== 'firearm' || firearm.data.group !== 'rifle') {
            throw new Error('wrong firearm profile kind');
        }
        expect(firearm.data.twistDirection).toBe(-1);
        expect(ammunition.kind === 'ammunition' && ammunition.data).toEqual({
            selection: 'builtIn',
            loadId: builtIn.id,
        });
        expect(scenario.kind === 'combinedScenario' && scenario.data.preferredUnits).toBe(
            'imperial',
        );
    });

    it('captures and restores custom ammunition by value', () => {
        const profile = captureProfile(
            'ammunition',
            'Custom G7',
            context(customResult),
            'rifle',
            NOW,
        );
        if (profile.kind !== 'ammunition' || profile.data.selection !== 'custom') {
            throw new Error('wrong ammunition profile');
        }
        expect(profile.data.load).toEqual(custom);
        const applied = applyNamedProfile(profile, { ...context(), customLoads: [] });
        expect(applied.ok).toBe(true);
        expect(applied.customLoads).toEqual([custom]);
        expect(applied.selectedLoadId).toBe(custom.id);
    });

    it('replaces same-name custom ammunition while retaining the active stable ID', () => {
        const updated = { ...custom, id: 'custom:from-profile', mv: 850 };
        const profile = captureProfile(
            'ammunition',
            'Updated custom',
            {
                ...context(customResult),
                customLoads: [updated],
                selectedLoad: { ...customResult, id: updated.id },
            },
            'rifle',
            NOW,
        );
        const active = { ...custom, id: 'custom:active-id' };
        const applied = applyNamedProfile(profile, { ...context(), customLoads: [active] });
        expect(applied.ok).toBe(true);
        expect(applied.customLoads[0].id).toBe(active.id);
        expect(applied.customLoads[0].mv).toBe(850);
        expect(applied.selectedLoadId).toBe(active.id);
    });

    it('does not evict an active custom load when applying a fourth ammunition profile', () => {
        const profile = captureProfile(
            'ammunition',
            'Fourth',
            {
                ...context(customResult),
                customLoads: [{ ...custom, id: 'custom:fourth', name: 'Fourth' }],
                selectedLoad: { ...customResult, id: 'custom:fourth' },
            },
            'rifle',
            NOW,
        );
        const active = [1, 2, 3].map((index) => ({
            ...custom,
            id: `custom:active-${index}`,
            name: `Active ${index}`,
        }));
        const applied = applyNamedProfile(profile, { ...context(), customLoads: active });
        expect(applied.ok).toBe(false);
        expect(applied.customLoads).toEqual(active);
        expect(applied.message).toContain('three custom loads');
    });

    it('applies environment and firearm profiles without overwriting unrelated state', () => {
        const environment = captureProfile('environment', 'Weather', context(), 'rifle', NOW);
        const firearm = captureProfile('firearm', 'Rifle', context(), 'rifle', NOW);
        const changed = {
            ...context(),
            inputs: {
                ...inputs,
                distanceM: 1000,
                temperatureC: 30,
                rifleZeroM: 50,
                shotgunZeroM: 75,
            },
        };
        const weatherApplied = applyNamedProfile(environment, changed);
        expect(weatherApplied.inputs.temperatureC).toBe(inputs.temperatureC);
        expect(weatherApplied.inputs.distanceM).toBe(1000);
        expect(weatherApplied.inputs.rifleZeroM).toBe(50);
        const firearmApplied = applyNamedProfile(firearm, changed);
        expect(firearmApplied.inputs.rifleZeroM).toBe(inputs.rifleZeroM);
        expect(firearmApplied.inputs.shotgunZeroM).toBe(75);
        expect(firearmApplied.inputs.temperatureC).toBe(30);
    });

    it('restores a combined scenario atomically, including units and selection', () => {
        const scenario = captureProfile('combinedScenario', 'Match', context(), 'rifle', NOW);
        const applied = applyNamedProfile(scenario, {
            ...context(undefined),
            inputs: { ...inputs, distanceM: 10 },
            uncertainty: { ...uncertainty, enabled: false },
            customLoads: [],
            preferredUnits: 'metric',
        });
        expect(applied.ok).toBe(true);
        expect(applied.inputs).toEqual(inputs);
        expect(applied.uncertainty).toEqual(uncertainty);
        expect(applied.customLoads).toEqual([custom]);
        expect(applied.selectedLoadId).toBe(builtIn.id);
        expect(applied.preferredUnits).toBe('imperial');
    });

    it('refuses unavailable built-in ammunition without partially changing state', () => {
        const ammunition = captureProfile('ammunition', 'A-MAX', context(), 'rifle', NOW);
        const scenario = captureProfile('combinedScenario', 'Match', context(), 'rifle', NOW);
        const unavailable = { ...context(undefined), availableLoadIds: [] };
        const ammunitionResult = applyNamedProfile(ammunition, unavailable);
        const scenarioResult = applyNamedProfile(scenario, unavailable);
        expect(ammunitionResult.ok).toBe(false);
        expect(scenarioResult.ok).toBe(false);
        expect(ammunitionResult.message).toContain('unavailable built-in load');
        expect(scenarioResult.message).toContain('unavailable built-in load');
        expect(ammunitionResult.inputs).toBe(unavailable.inputs);
        expect(scenarioResult.customLoads).toBe(unavailable.customLoads);
    });

    it('creates deterministic duplicate-name suffixes and enforces the profile cap', () => {
        const first = captureProfile('environment', 'Weather', context(), 'rifle', NOW);
        const second = captureProfile('environment', 'weather', context(), 'rifle', NOW);
        const profiles = appendCapturedProfile(appendCapturedProfile([], first), second);
        expect(profiles.map((profile) => profile.name)).toEqual(['Weather', 'weather (2)']);
        expect(uniqueProfileName(profiles, 'firearm', 'Weather')).toBe('Weather');
        const full = Array.from({ length: MAX_NAMED_PROFILES }, (_, index) => ({
            ...first,
            id: `profile:${index}`,
            name: `Weather ${index}`,
        }));
        expect(() => appendCapturedProfile(full, second)).toThrow('At most 64');
    });
});

describe('profile interchange', () => {
    it('serializes current profiles that satisfy the checked-in JSON Schema', () => {
        const text = serializeProfileDocument(createAllKinds(), inputs, NOW);
        const document = JSON.parse(text);
        const ajv = new Ajv2020({ allErrors: true, strict: true });
        const validate = ajv.compile(profileSchema);
        expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
        expect(document.unitConvention).toBe('SI');
        expect(document.profiles).toHaveLength(4);
    });

    it('round-trips a document without changing profile content', () => {
        const original = createAllKinds();
        const imported = importProfileDocument(
            serializeProfileDocument(original, inputs, NOW),
            [],
            inputs,
            'rename',
            NOW,
        );
        expect(imported.profiles).toEqual(original);
        expect(imported.summary).toEqual({
            added: 4,
            replaced: 0,
            renamed: 0,
            skipped: 0,
            quarantined: 0,
            migrated: 0,
        });
        expect(imported.quarantine).toEqual([]);
    });

    it('supports rename, replace, and skip conflict policies', () => {
        const existing = captureProfile('environment', 'Weather', context(), 'rifle', NOW);
        if (existing.kind !== 'environment') throw new Error('wrong profile kind');
        const incoming = { ...existing, data: { ...existing.data, temperatureC: -10 } };
        const text = serializeProfileDocument([incoming], inputs, NOW);
        const renamed = importProfileDocument(text, [existing], inputs, 'rename', NOW);
        expect(renamed.profiles.map((profile) => profile.name)).toEqual(['Weather', 'Weather (2)']);
        expect(renamed.summary.renamed).toBe(1);
        const replaced = importProfileDocument(text, [existing], inputs, 'replace', NOW);
        expect(replaced.profiles).toHaveLength(1);
        expect(replaced.profiles[0].data).toEqual(incoming.data);
        expect(replaced.profiles[0].id).toBe(existing.id);
        expect(replaced.summary.replaced).toBe(1);
        const skipped = importProfileDocument(text, [existing], inputs, 'skip', NOW);
        expect(skipped.profiles).toEqual([existing]);
        expect(skipped.summary.skipped).toBe(1);
    });

    it('quarantines malformed entries while importing valid siblings', () => {
        const [valid] = createAllKinds();
        const malformed = { ...valid, id: 'invalid-id', data: { unexpected: true } };
        const root = JSON.parse(serializeProfileDocument([valid], inputs, NOW));
        root.profiles.push(malformed);
        const imported = importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW);
        expect(imported.profiles).toEqual([valid]);
        expect(imported.quarantine).toHaveLength(1);
        expect(imported.quarantine[0].sourceName).toBe(valid.name);
        expect(imported.quarantine[0].reason).toContain('profile:');
        expect(imported.quarantine[0].rawJson).toContain('invalid-id');
        expect(profileImportMessage(imported.summary)).toContain('1 quarantined');
    });

    it('migrates a version-7 persisted settings envelope into a combined scenario', () => {
        const legacy = JSON.stringify({
            schemaVersion: 7,
            inputs,
            customLoads: [custom],
            uncertainty,
        });
        const imported = importProfileDocument(legacy, [], inputs, 'rename', NOW);
        expect(imported.summary.migrated).toBe(1);
        expect(imported.profiles).toHaveLength(1);
        expect(imported.profiles[0].kind).toBe('combinedScenario');
        if (imported.profiles[0].kind !== 'combinedScenario') throw new Error('wrong profile kind');
        expect(imported.profiles[0].data.inputs).toEqual(inputs);
        expect(imported.profiles[0].data.customLoads).toEqual([custom]);
    });

    it('migrates version-2 settings fields and legacy custom-load shapes', () => {
        const {
            pressureSource,
            pressureAltitudeM,
            geometricAltitudeM,
            altimeterSettingHpa,
            ...oldInputs
        } = inputs;
        const {
            id,
            bcMode,
            bcBands,
            machCdDiameterMm,
            machCdPoints,
            dragDataMetadata,
            ...oldCustom
        } = custom;
        const legacy = JSON.stringify({
            schemaVersion: 2,
            inputs: { ...oldInputs, altitudeM: 800 },
            customLoads: [oldCustom],
        });
        const imported = importProfileDocument(legacy, [], inputs, 'rename', NOW);
        expect(imported.summary.migrated).toBe(1);
        expect(imported.profiles).toHaveLength(1);
        const [profile] = imported.profiles;
        if (profile.kind !== 'combinedScenario') throw new Error('wrong profile kind');
        expect(profile.data.inputs.pressureSource).toBe(inputs.pressureSource);
        expect(profile.data.inputs.pressureAltitudeM).toBe(800);
        expect(profile.data.inputs.geometricAltitudeM).toBe(800);
        expect(profile.data.inputs.altimeterSettingHpa).toBe(inputs.altimeterSettingHpa);
        expect(profile.data.uncertainty.enabled).toBe(false);
        expect(profile.data.customLoads[0].id).toMatch(/^custom:legacy-/);
        expect(profile.data.customLoads[0].bcMode).toBe('constant');
        expect(profile.data.customLoads[0].bcBands).toEqual([
            { minimumVelocityMps: 0, ballisticCoefficient: custom.bc },
            { minimumVelocityMps: 400, ballisticCoefficient: custom.bc },
        ]);
        expect(profile.data.customLoads[0].machCdDiameterMm).toBe(7.82);
        expect(profile.data.customLoads[0].machCdPoints).toHaveLength(6);
        expect(profile.data.customLoads[0].dragDataMetadata.citation).toBe('User-entered data');
    });

    it('migrates version-1 portable profiles and supplies drag-data provenance defaults', () => {
        const scenario = captureProfile(
            'combinedScenario',
            'Legacy match',
            context(),
            'rifle',
            NOW,
        );
        const root = JSON.parse(serializeProfileDocument([scenario], inputs, NOW));
        root.schemaVersion = 1;
        delete root.profiles[0].data.customLoads[0].dragDataMetadata;

        const imported = importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW);

        expect(imported.summary.migrated).toBe(1);
        expect(imported.summary.quarantined).toBe(0);
        expect(imported.profiles).toHaveLength(1);
        const [profile] = imported.profiles;
        if (profile.kind !== 'combinedScenario') throw new Error('wrong profile kind');
        expect(profile.data.customLoads[0].dragDataMetadata).toEqual({
            citation: 'User-entered data',
            sourceUrl: '',
            license: 'Unspecified',
            sourceChecksumSha256: '',
            domainMinimum: null,
            domainMaximum: null,
        });
    });

    it('rejects unknown envelopes, unsupported versions, invalid JSON, and oversize input', () => {
        expect(() => importProfileDocument('{', [], inputs, 'rename', NOW)).toThrow(
            'not valid JSON',
        );
        expect(() =>
            importProfileDocument(JSON.stringify({ schemaVersion: 1 }), [], inputs, 'rename', NOW),
        ).toThrow('unsupported');
        const root = JSON.parse(serializeProfileDocument(createAllKinds(), inputs, NOW));
        root.schemaVersion = PROFILE_SCHEMA_VERSION + 1;
        expect(() =>
            importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW),
        ).toThrow('unsupported');
        expect(() =>
            importProfileDocument(' '.repeat(1024 * 1024 + 1), [], inputs, 'rename', NOW),
        ).toThrow('1 MiB');
    });

    it('rejects unknown fields, invalid timestamps, and out-of-domain values', () => {
        const root = JSON.parse(serializeProfileDocument(createAllKinds(), inputs, NOW));
        root.extra = true;
        expect(() =>
            importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW),
        ).toThrow('unknown extra');
        delete root.extra;
        root.exportedAt = 'tomorrow';
        expect(() =>
            importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW),
        ).toThrow('ISO-8601');
        root.exportedAt = NOW;
        root.profiles[0].data.temperatureC = 200;
        const quarantined = importProfileDocument(JSON.stringify(root), [], inputs, 'rename', NOW);
        expect(quarantined.summary.quarantined).toBe(1);
    });

    it('generates a portable, date-stamped filename', () => {
        expect(profileDocumentFilename(new Date(NOW))).toBe(
            'ballistics-profiles-2026-08-18.bwprofile.json',
        );
        expect(() => serializeProfileDocument([], inputs, NOW)).toThrow(ProfileDocumentError);
    });
});
