import { describe, expect, it } from 'vitest';
import type { Load } from '../types';
import { dragDescription, firearmLabel, projectileLabel } from './labels';

const load = (overrides: Partial<Load> = {}): Load =>
    ({
        id: 'builtin:test',
        name: 'Test',
        shortName: 'Test',
        dragModel: 'G1',
        firearmGroup: 'rifle',
        massKg: 0.01,
        muzzleVelocityMps: 800,
        ballisticCoefficient: 0.4,
        ballisticCoefficientBands: [],
        dragReferenceDiameterM: 0,
        machCdPoints: [],
        bcKind: 'test',
        sphereDiameterM: 0,
        materialDensityKgM3: 0,
        pelletCount: 1,
        source: 'builtIn',
        requestedDistanceM: 100,
        coveredDistanceM: 100,
        trajectoryStatus: 'complete',
        solutionHorizonM: 2000,
        solverDiagnostics: {
            mode: 'adaptive_time',
            attemptedSteps: 100,
            acceptedSteps: 95,
            rejectedSteps: 5,
            minimumAcceptedTimeStepS: 0.0001,
            maximumAcceptedTimeStepS: 0.05,
            finalTimeStepS: 0.01,
            maximumErrorNorm: 1.2,
        },
        dragValidity: {
            status: 'not_declared',
            supportedMachMin: null,
            supportedMachMax: null,
            supportedReynoldsMin: null,
            supportedReynoldsMax: null,
            observedMachMin: null,
            observedMachMax: null,
            observedReynoldsMin: null,
            observedReynoldsMax: null,
        },
        mpbrStatus: 'complete',
        zeroM: 0,
        mpbrM: 0,
        sightHeightM: 0.04,
        sightZeroM: 100,
        boreElevationRad: 0.001,
        zeroErrorM: 0,
        zeroingStatus: 'complete',
        dropAtSightZeroM: 0,
        spinDriftStatus: 'available',
        effectiveTwistInches: 10,
        gyroscopicStability: 1.5,
        points: [],
        ...overrides,
    }) as Load;

describe('labels', () => {
    it('names the firearm group', () => {
        expect(firearmLabel(load({ firearmGroup: 'rifle' }))).toBe('Rifle');
        expect(firearmLabel(load({ firearmGroup: 'shotgun' }))).toBe('Shotgun');
    });

    it('describes single vs multi-pellet payloads', () => {
        expect(projectileLabel(load({ pelletCount: 1 }))).toBe('projectile');
        expect(projectileLabel(load({ pelletCount: 9 }))).toBe('pellet');
    });

    it('identifies velocity-banded reference drag', () => {
        expect(
            dragDescription(
                load({
                    ballisticCoefficientBands: [
                        { minimumVelocityMps: 0, ballisticCoefficient: 0.4 },
                        { minimumVelocityMps: 500, ballisticCoefficient: 0.45 },
                    ],
                }),
            ),
        ).toBe('G1 banded reference');
    });

    it('describes the drag model', () => {
        expect(dragDescription(load({ dragModel: 'G7' }))).toBe('G7 reference');
        expect(dragDescription(load({ dragModel: 'MachCd' }))).toBe('tabulated Mach–Cd');
        expect(dragDescription(load({ dragModel: 'Sphere' }))).toBe('Reynolds–Mach sphere');
    });
});
