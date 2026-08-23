import { describe, expect, it } from 'vitest';
import type { CustomDraft, Inputs, UncertaintySettings } from '../types';
import {
    fieldErrors,
    uncertaintyFieldErrors,
    validateCustomLoad,
    validateInputs,
    validateUncertaintySettings,
} from './validation';
import { defaultUncertaintySettings } from './persistence';
import { defaultInputs } from './workbenchDefaults';

const validInputs: Inputs = {
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

const validDraft: CustomDraft = {
    id: 'custom:valid',
    name: 'Test load',
    drag: 'G1',
    group: 'rifle',
    massG: 10.886,
    mv: 823,
    bc: 0.475,
    bcMode: 'constant',
    bcBands: [
        { minimumVelocityMps: 0, ballisticCoefficient: 0.4 },
        { minimumVelocityMps: 400, ballisticCoefficient: 0.475 },
    ],
    machCdDiameterMm: 7.82,
    machCdPoints: [
        { mach: 0.5, dragCoefficient: 0.25 },
        { mach: 1.2, dragCoefficient: 0.4 },
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
    sphereMm: 8.382,
    density: 11340,
    count: 1,
    length: 1.1,
    diameter: 0.308,
    twist: 0,
};

describe('validateInputs', () => {
    it('accepts a valid input set', () => {
        expect(validateInputs(validInputs)).toEqual([]);
    });

    it('rejects out-of-range values with a labelled message', () => {
        const errors = validateInputs({ ...validInputs, temperatureC: 999 });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Temperature');
    });

    it('rejects non-finite values', () => {
        expect(validateInputs({ ...validInputs, pressureHpa: NaN })).toHaveLength(1);
    });

    it('reports every violated field', () => {
        const errors = validateInputs({ ...validInputs, humidityPercent: 200, headwindMps: 500 });
        expect(errors).toHaveLength(2);
    });

    it('validates only the entered fields for the selected pressure source', () => {
        expect(
            fieldErrors({
                ...validInputs,
                pressureSource: 'pressureAltitude',
                pressureAltitudeM: 6000,
                altimeterSettingHpa: 2000,
            }),
        ).toHaveProperty('pressureAltitudeM');
        expect(
            fieldErrors({
                ...validInputs,
                pressureSource: 'altimeterSetting',
                geometricAltitudeM: 7000,
                altimeterSettingHpa: 2000,
                pressureAltitudeM: 6000,
            }),
        ).toMatchObject({
            geometricAltitudeM: expect.any(String),
            altimeterSettingHpa: expect.any(String),
        });
    });

    it('requires a calibration/holdout split for enabled buckshot analysis', () => {
        const enabled = {
            ...validInputs,
            buckshotPattern: {
                ...validInputs.buckshotPattern,
                enabled: true,
                loadId: 'builtin:xb1200-00',
                observations: [
                    {
                        rangeM: 10,
                        diameter90M: 0.12,
                        standardUncertaintyM: 0.01,
                        shellCount: 3,
                        role: 'calibration' as const,
                    },
                    {
                        rangeM: 20,
                        diameter90M: 0.24,
                        standardUncertaintyM: 0.01,
                        shellCount: 3,
                        role: 'calibration' as const,
                    },
                    {
                        rangeM: 30,
                        diameter90M: 0.37,
                        standardUncertaintyM: 0.015,
                        shellCount: 3,
                        role: 'holdout' as const,
                    },
                ],
            },
        };
        expect(validateInputs(enabled)).toEqual([]);
        expect(
            validateInputs({
                ...enabled,
                buckshotPattern: {
                    ...enabled.buckshotPattern,
                    observations: enabled.buckshotPattern.observations.map((observation) => ({
                        ...observation,
                        role: 'calibration' as const,
                    })),
                },
            }),
        ).toContain(
            'Buckshot analysis requires at least two calibration observations and one holdout.',
        );
    });
});

describe('fieldErrors', () => {
    it('returns no entries for a valid input set', () => {
        expect(fieldErrors(validInputs)).toEqual({});
    });

    it('keys messages by the exact offending field', () => {
        const errors = fieldErrors({ ...validInputs, humidityPercent: 200, rifleTwistInches: 1 });
        expect(Object.keys(errors).sort()).toEqual(['humidityPercent', 'rifleTwistInches']);
        expect(errors.humidityPercent).toContain('Humidity');
    });

    it('agrees with validateInputs on the number of violations', () => {
        const broken = { ...validInputs, temperatureC: 999, pressureHpa: NaN };
        expect(Object.keys(fieldErrors(broken))).toHaveLength(validateInputs(broken).length);
    });
});

describe('uncertainty validation', () => {
    it('ignores stored values while propagation is disabled', () => {
        const disabled: UncertaintySettings = {
            ...defaultUncertaintySettings,
            enabled: false,
            dragRelativeStandardDeviation: Number.NaN,
        };
        expect(validateUncertaintySettings(disabled)).toEqual([]);
    });

    it('reports exact enabled fields outside bounded non-negative ranges', () => {
        const invalid: UncertaintySettings = {
            ...defaultUncertaintySettings,
            enabled: true,
            rifleMuzzleVelocityStandardDeviationMps: 201,
            temperatureStandardDeviationC: -1,
        };
        expect(Object.keys(uncertaintyFieldErrors(invalid)).sort()).toEqual([
            'rifleMuzzleVelocityStandardDeviationMps',
            'temperatureStandardDeviationC',
        ]);
        expect(validateUncertaintySettings(invalid)).toHaveLength(2);
    });
});

describe('validateCustomLoad', () => {
    it('accepts a valid rifle G1 draft', () => {
        expect(validateCustomLoad(validDraft)).toEqual([]);
    });

    it('requires a name', () => {
        expect(validateCustomLoad({ ...validDraft, name: '   ' })).toContain('Name is required.');
    });

    it('requires a positive muzzle velocity', () => {
        expect(validateCustomLoad({ ...validDraft, mv: 0 })).toContain(
            'Muzzle velocity (m/s) must be between 1 and 2000.',
        );
    });

    it('requires an integer payload count', () => {
        expect(validateCustomLoad({ ...validDraft, count: 2.5 })).toContain(
            'Payload count must be a whole number.',
        );
    });

    it('validates BC bounds for non-sphere drag models', () => {
        expect(validateCustomLoad({ ...validDraft, bc: 3 })).toContain(
            'Ballistic coefficient must be positive and at most 2.',
        );
    });

    it('validates ordered, fully covered velocity-banded BC schedules', () => {
        expect(validateCustomLoad({ ...validDraft, bcMode: 'velocityBands' })).toEqual([]);
        expect(
            validateCustomLoad({
                ...validDraft,
                bcMode: 'velocityBands',
                bcBands: [
                    { minimumVelocityMps: 100, ballisticCoefficient: 0.4 },
                    { minimumVelocityMps: 50, ballisticCoefficient: 0.5 },
                ],
            }),
        ).toEqual(
            expect.arrayContaining([
                'The first BC band must begin at 0 m/s.',
                'BC band velocities must be strictly increasing.',
            ]),
        );
    });

    it('validates the geometry required by sphere drag', () => {
        const errors = validateCustomLoad({ ...validDraft, drag: 'Sphere', sphereMm: 0, bc: 99 });
        expect(errors.some((e) => e.includes('Sphere diameter'))).toBe(true);
        expect(errors.some((e) => e.includes('Ballistic coefficient'))).toBe(false);
    });

    it('validates ordered tabulated Mach-Cd curves and reference diameter', () => {
        expect(validateCustomLoad({ ...validDraft, drag: 'MachCd' })).toEqual([]);
        const errors = validateCustomLoad({
            ...validDraft,
            drag: 'MachCd',
            machCdDiameterMm: 0,
            machCdPoints: [
                { mach: 1, dragCoefficient: 0.4 },
                { mach: 0.8, dragCoefficient: 6 },
            ],
        });
        expect(errors).toEqual(
            expect.arrayContaining([
                'Drag reference diameter (mm) must be between 1 and 50.',
                'Mach–Cd point 2 Cd must be positive and at most 5.',
                'Mach–Cd point Mach values must be strictly increasing.',
            ]),
        );
    });

    it('rejects negative rifle dimensions', () => {
        expect(validateCustomLoad({ ...validDraft, diameter: -1 })).toContain(
            'Optional rifle dimensions cannot be negative.',
        );
    });

    it('ignores rifle dimensions for shotgun drafts', () => {
        expect(validateCustomLoad({ ...validDraft, group: 'shotgun', diameter: -1 })).toEqual([]);
    });
});
