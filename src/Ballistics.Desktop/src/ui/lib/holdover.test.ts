import { describe, expect, it } from 'vitest';
import type { Load, Point } from '../types';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathM } from './holdover';

// A parabola-like bore drop that grows with distance, enough to exercise the geometry.
const point = (distanceM: number): Point => ({
    distanceM,
    speedMps: 800 - distanceM,
    airspeedMps: 800 - distanceM,
    energyJ: 0,
    momentumKgms: 0,
    timeS: distanceM / 800,
    dropM: distanceM * distanceM * 1e-5,
    pathM: -(distanceM * distanceM * 1e-5) - 0.05 + (0.45 * distanceM) / 200,
    holdoverRad:
        distanceM > 0
            ? Math.atan2(distanceM * distanceM * 1e-5 + 0.05 - (0.45 * distanceM) / 200, distanceM)
            : 0,
    mach: 0,
    spinDriftM: 0,
    windDriftM: 0,
});

const rifle: Load = {
    id: 'builtin:rifle',
    name: 'Rifle',
    shortName: 'Rifle',
    dragModel: 'G1',
    firearmGroup: 'rifle',
    massKg: 0.01,
    muzzleVelocityMps: 800,
    ballisticCoefficient: 0.475,
    ballisticCoefficientBands: [],
    dragReferenceDiameterM: 0,
    machCdPoints: [],
    bcKind: '',
    sphereDiameterM: 0,
    materialDensityKgM3: 0,
    pelletCount: 1,
    source: 'builtIn',
    requestedDistanceM: 400,
    coveredDistanceM: 400,
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
    zeroM: 200,
    mpbrM: 240,
    sightHeightM: 0.05,
    sightZeroM: 200,
    boreElevationRad: 0.001,
    zeroErrorM: 0,
    zeroingStatus: 'complete',
    dropAtSightZeroM: 0.4,
    spinDriftStatus: 'available',
    effectiveTwistInches: 10,
    gyroscopicStability: 1.5,
    trajectoryEvents: {
        analyzedDistanceM: 400,
        zeroCrossingsStatus: 'complete',
        nearZeroM: 25,
        farZeroM: 200,
        maximumOrdinateStatus: 'complete',
        maximumOrdinateDistanceM: 112,
        maximumOrdinatePathM: 0.08,
        supersonicRangeStatus: 'horizon_limited',
        supersonicRangeM: null,
        groundIntersectionStatus: 'horizon_limited',
        groundIntersectionM: null,
        machCrossings: [],
    },
    uncertainty: null,
    buckshotPattern: null,
    points: Array.from({ length: 41 }, (_, i) => point(i * 10)),
};

const geom = sightGeometry(
    rifle,
    { shotgunSightM: 0.025, rifleSightM: 0.05 },
    { shotgunZeroM: 50, rifleZeroM: 200 },
);

describe('sightGeometry', () => {
    it('selects the rifle profile sight height and zero', () => {
        expect(geom.sightHeightM).toBe(0.05);
        expect(geom.zeroM).toBe(200);
        expect(geom.dropAtZeroM).toBeCloseTo(200 * 200 * 1e-5, 10);
    });
});

describe('sightPathM', () => {
    it('is one sight-height below the line of sight at the muzzle', () => {
        expect(sightPathM(0, 0, geom)).toBeCloseTo(-0.05, 12);
    });

    it('crosses the line of sight at the zero range', () => {
        expect(sightPathM(geom.dropAtZeroM, 200, geom)).toBeCloseTo(0, 12);
    });

    it('is below the line of sight past a modest zero', () => {
        // At 400 m the bullet has fallen well below the 200 m sight line.
        expect(sightPathM(point(400).dropM, 400, geom)).toBeLessThan(0);
    });

    it('falls back to negative bore drop when no zero is set', () => {
        const noZero = { ...geom, zeroM: 0 };
        expect(sightPathM(0.3, 250, noZero)).toBeCloseTo(-0.3, 12);
    });
});

describe('holdover', () => {
    it('requires holding up (positive) when the bullet is below the line of sight', () => {
        const path = sightPathM(point(400).dropM, 400, geom);
        const holdoverRad = Math.atan2(-path, 400);
        expect(holdoverMoa(holdoverRad)).toBeGreaterThan(0);
        expect(holdoverMil(holdoverRad)).toBeGreaterThan(0);
    });

    it('relates MOA and MIL by the constant 3.43775 MOA per mil', () => {
        const holdoverRad = Math.atan2(0.5, 300);
        expect(holdoverMoa(holdoverRad) / holdoverMil(holdoverRad)).toBeCloseTo(3.437746770785, 6);
    });

    it('converts a zero native angle to zero holdover', () => {
        expect(holdoverMoa(0)).toBe(0);
    });
});
