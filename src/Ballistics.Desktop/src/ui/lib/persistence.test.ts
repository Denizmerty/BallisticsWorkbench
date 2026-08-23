import { describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA_VERSION } from '../../../shared/productIdentity';
import type { CustomDraft, Inputs } from '../types';
import {
    defaultUncertaintySettings,
    loadPersistedSettings,
    savePersistedSettings,
} from './persistence';
import { captureProfile } from './profiles';
import { defaultInputs } from './workbenchDefaults';

const defaults: Inputs = {
    ...defaultInputs,
    distanceM: 100,
    temperatureC: 15,
    pressureHpa: 1013.25,
    humidityPercent: 50,
    pressureSource: 'stationPressure',
    pressureAltitudeM: 0,
    geometricAltitudeM: 0,
    altimeterSettingHpa: 1013.25,
    headwindMps: 0,
    crosswindMps: 0,
    vitalZoneM: 0.15,
    shotgunSightM: 0.025,
    rifleSightM: 0.04,
    shotgunZeroM: 50,
    rifleZeroM: 100,
    shotgunMvMultiplier: 1,
    rifleMvMultiplier: 1,
    rifleTwistInches: 10,
    twistDirection: 1,
};

const custom: CustomDraft = {
    id: 'custom:test',
    name: 'Test',
    drag: 'G7',
    group: 'rifle',
    massG: 10,
    mv: 800,
    bc: 0.25,
    bcMode: 'constant',
    bcBands: [
        { minimumVelocityMps: 0, ballisticCoefficient: 0.2 },
        { minimumVelocityMps: 400, ballisticCoefficient: 0.25 },
    ],
    machCdDiameterMm: 7.82,
    machCdPoints: [
        { mach: 0.5, dragCoefficient: 0.25 },
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

class MemoryStorage {
    values = new Map<string, string>();
    getItem(key: string) {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        this.values.set(key, value);
    }
}

describe('persisted settings', () => {
    it('uses defaults when storage is empty', () => {
        const loaded = loadPersistedSettings(defaults, new MemoryStorage());
        expect(loaded).toEqual({
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            inputs: defaults,
            customLoads: [],
            uncertainty: defaultUncertaintySettings,
            profiles: [],
            quarantinedProfiles: [],
        });
    });

    it('migrates valid legacy values and ignores arbitrary fields', () => {
        const storage = new MemoryStorage();
        storage.setItem('bw.inputs', JSON.stringify({ distanceM: 500, injected: 'ignored' }));
        storage.setItem('bw.customLoads', JSON.stringify([custom, { name: 'malformed' }]));
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.inputs.distanceM).toBe(500);
        expect((loaded.inputs as unknown as Record<string, unknown>).injected).toBeUndefined();
        expect(loaded.customLoads).toEqual([custom]);
    });

    it('writes and reads the versioned envelope', () => {
        const storage = new MemoryStorage();
        const uncertainty = {
            ...defaultUncertaintySettings,
            enabled: true,
            headwindStandardDeviationMps: 4,
        };
        savePersistedSettings({ ...defaults, distanceM: 750 }, [custom], uncertainty, storage);
        const raw = JSON.parse(storage.getItem('bw.settings')!);
        expect(raw.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(loadPersistedSettings(defaults, storage).inputs.distanceM).toBe(750);
        expect(loadPersistedSettings(defaults, storage).customLoads).toEqual([custom]);
        expect(loadPersistedSettings(defaults, storage).uncertainty).toEqual(uncertainty);
    });

    it('migrates version 2 custom loads to stable IDs', () => {
        const storage = new MemoryStorage();
        const { id, ...versionTwoCustom } = custom;
        storage.setItem(
            'bw.settings',
            JSON.stringify({ schemaVersion: 2, inputs: defaults, customLoads: [versionTwoCustom] }),
        );
        const first = loadPersistedSettings(defaults, storage);
        const second = loadPersistedSettings(defaults, storage);
        expect(first.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(first.customLoads[0].id).toMatch(/^custom:legacy-/);
        expect(second.customLoads[0].id).toBe(first.customLoads[0].id);
    });

    it('migrates version 3 scalar BC loads to the version 4 drag shape', () => {
        const storage = new MemoryStorage();
        const { bcMode, bcBands, ...versionThreeCustom } = custom;
        storage.setItem(
            'bw.settings',
            JSON.stringify({
                schemaVersion: 3,
                inputs: defaults,
                customLoads: [versionThreeCustom],
            }),
        );
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(loaded.customLoads[0].bcMode).toBe('constant');
        expect(loaded.customLoads[0].bcBands).toEqual([
            { minimumVelocityMps: 0, ballisticCoefficient: custom.bc },
            { minimumVelocityMps: 400, ballisticCoefficient: custom.bc },
        ]);
    });

    it('migrates version 4 loads with default Mach-Cd editor data', () => {
        const storage = new MemoryStorage();
        const { machCdDiameterMm, machCdPoints, ...versionFourCustom } = custom;
        storage.setItem(
            'bw.settings',
            JSON.stringify({
                schemaVersion: 4,
                inputs: defaults,
                customLoads: [versionFourCustom],
            }),
        );
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(loaded.customLoads[0].machCdDiameterMm).toBe(7.82);
        expect(loaded.customLoads[0].machCdPoints.length).toBeGreaterThanOrEqual(2);
    });

    it('sanitizes out-of-range uncertainty values during migration', () => {
        const storage = new MemoryStorage();
        storage.setItem(
            'bw.settings',
            JSON.stringify({
                schemaVersion: 6,
                inputs: defaults,
                customLoads: [],
                uncertainty: {
                    ...defaultUncertaintySettings,
                    enabled: true,
                    dragRelativeStandardDeviation: -1,
                    crosswindStandardDeviationMps: 4,
                },
            }),
        );
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.uncertainty.enabled).toBe(true);
        expect(loaded.uncertainty.dragRelativeStandardDeviation).toBe(
            defaultUncertaintySettings.dragRelativeStandardDeviation,
        );
        expect(loaded.uncertainty.crosswindStandardDeviationMps).toBe(4);
    });

    it('migrates the legacy altitude field without changing its resolved station pressure', () => {
        const storage = new MemoryStorage();
        const {
            pressureSource,
            pressureAltitudeM,
            geometricAltitudeM,
            altimeterSettingHpa,
            ...legacyInputs
        } = defaults;
        storage.setItem(
            'bw.settings',
            JSON.stringify({
                schemaVersion: 6,
                inputs: { ...legacyInputs, altitudeM: 1250 },
                customLoads: [],
                uncertainty: defaultUncertaintySettings,
            }),
        );
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(loaded.inputs.pressureSource).toBe('stationPressure');
        expect(loaded.inputs.pressureHpa).toBe(defaults.pressureHpa);
        expect(loaded.inputs.pressureAltitudeM).toBe(1250);
        expect(loaded.inputs.geometricAltitudeM).toBe(1250);
    });

    it('persists named profiles and quarantines malformed stored entries', () => {
        const storage = new MemoryStorage();
        const profile = captureProfile(
            'environment',
            'Range day',
            {
                inputs: defaults,
                uncertainty: defaultUncertaintySettings,
                customLoads: [custom],
                availableLoadIds: [custom.id],
                selectedLoad: undefined,
                selectedLoadId: null,
                preferredUnits: 'metric',
            },
            'rifle',
            '2026-08-18T12:00:00.000Z',
        );
        savePersistedSettings(
            defaults,
            [custom],
            defaultUncertaintySettings,
            storage,
            [profile],
            [],
        );
        const saved = JSON.parse(storage.getItem('bw.settings')!);
        saved.profiles.push({ ...profile, id: 'not-a-profile-id' });
        storage.setItem('bw.settings', JSON.stringify(saved));
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.profiles).toEqual([profile]);
        expect(loaded.quarantinedProfiles).toHaveLength(1);
        expect(loaded.quarantinedProfiles[0].sourceName).toBe('Range day');
        expect(loaded.quarantinedProfiles[0].reason).toContain('profile:');
    });

    it('migrates version 7 settings with no profile collection to the current version', () => {
        const storage = new MemoryStorage();
        storage.setItem(
            'bw.settings',
            JSON.stringify({
                schemaVersion: 7,
                inputs: defaults,
                customLoads: [{ ...custom, dragDataMetadata: undefined }],
                uncertainty: defaultUncertaintySettings,
            }),
        );
        const loaded = loadPersistedSettings(defaults, storage);
        expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(loaded.profiles).toEqual([]);
        expect(loaded.quarantinedProfiles).toEqual([]);
        expect(loaded.customLoads[0].dragDataMetadata).toEqual({
            citation: 'User-entered data',
            sourceUrl: '',
            license: 'Unspecified',
            sourceChecksumSha256: '',
            domainMinimum: null,
            domainMaximum: null,
        });
    });
});
