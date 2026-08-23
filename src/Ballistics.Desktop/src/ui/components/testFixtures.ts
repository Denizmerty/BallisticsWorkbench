import { ENGINE_VERSION, MODEL_VERSION, PROTOCOL_VERSION } from '../../../shared/productIdentity';
import type { Inputs, Load, Point, Result, UncertaintyPoint } from '../types';
import { defaultInputs } from '../lib/workbenchDefaults';

export const fixtureInputs: Inputs = {
    ...defaultInputs,
    distanceM: 100,
    temperatureC: 15,
    pressureHpa: 1013.25,
    pressureSource: 'stationPressure',
    pressureAltitudeM: 0,
    geometricAltitudeM: 0,
    altimeterSettingHpa: 1013.25,
    humidityPercent: 50,
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

export function fixturePoint(distanceM: number, speedMps = 700): Point {
    const dropM = distanceM * distanceM * 1e-5;
    const pathM = -dropM - 0.04 + (0.14 * distanceM) / 100;
    return {
        distanceM,
        speedMps,
        airspeedMps: speedMps,
        energyJ: 0.5 * 0.01 * speedMps * speedMps,
        momentumKgms: 0.01 * speedMps,
        timeS: distanceM / speedMps,
        dropM,
        pathM,
        holdoverRad: distanceM > 0 ? Math.atan2(-pathM, distanceM) : 0,
        mach: speedMps / 340,
        spinDriftM: distanceM * 1e-4,
        windDriftM: distanceM * 5e-4,
        cd: 0.3,
        referenceCd: 0.3,
        reynolds: 250_000,
    };
}

export function fixtureUncertaintyPoint(distanceM: number): UncertaintyPoint {
    return {
        distanceM,
        available: true,
        speedStandardDeviationMps: 2,
        energyStandardDeviationJ: 10,
        momentumStandardDeviationKgms: 0.02,
        timeStandardDeviationS: 0.001,
        dropStandardDeviationM: 0.002,
        pathStandardDeviationM: 0.003,
        holdoverStandardDeviationRad: 0.00003,
        windDriftStandardDeviationM: 0.004,
    };
}

export function fixtureLoad(overrides: Partial<Load> = {}): Load {
    return {
        id: 'builtin:fixture-rifle',
        name: 'Fixture rifle load',
        shortName: 'Fixture',
        dragModel: 'G1',
        firearmGroup: 'rifle',
        massKg: 0.01,
        muzzleVelocityMps: 800,
        ballisticCoefficient: 0.475,
        ballisticCoefficientBands: [],
        dragReferenceDiameterM: 0,
        machCdPoints: [],
        bcKind: 'manufacturer G1 BC',
        sphereDiameterM: 0,
        materialDensityKgM3: 0,
        pelletCount: 1,
        source: 'builtIn',
        requestedDistanceM: 100,
        coveredDistanceM: 100,
        trajectoryStatus: 'complete',
        solutionHorizonM: 500,
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
            status: 'within_domain',
            supportedMachMin: 0.2,
            supportedMachMax: 3,
            supportedReynoldsMin: null,
            supportedReynoldsMax: null,
            observedMachMin: 1.8,
            observedMachMax: 2.4,
            observedReynoldsMin: null,
            observedReynoldsMax: null,
        },
        mpbrStatus: 'complete',
        zeroM: 100,
        mpbrM: 240,
        sightHeightM: 0.04,
        sightZeroM: 100,
        boreElevationRad: 0.001,
        zeroErrorM: 0,
        zeroingStatus: 'complete',
        dropAtSightZeroM: 0.1,
        spinDriftStatus: 'available',
        effectiveTwistInches: 10,
        gyroscopicStability: 1.5,
        trajectoryEvents: {
            analyzedDistanceM: 500,
            zeroCrossingsStatus: 'complete',
            nearZeroM: 25,
            farZeroM: 100,
            maximumOrdinateStatus: 'complete',
            maximumOrdinateDistanceM: 60,
            maximumOrdinatePathM: 0.03,
            supersonicRangeStatus: 'complete',
            supersonicRangeM: 350,
            groundIntersectionStatus: 'complete',
            groundIntersectionM: 420,
            machCrossings: [
                { mach: 1.2, distanceM: 300, direction: 'decelerating' },
                { mach: 1, distanceM: 350, direction: 'decelerating' },
                { mach: 0.8, distanceM: 400, direction: 'decelerating' },
            ],
        },
        uncertainty: null,
        buckshotPattern: null,
        points: [fixturePoint(0, 800), fixturePoint(50, 700), fixturePoint(100, 620)],
        ...overrides,
    };
}

export function fixtureResult(
    loads: Load[] = [fixtureLoad()],
    issues: Result['issues'] = [],
): Result {
    return {
        protocolVersion: PROTOCOL_VERSION,
        engineVersion: ENGINE_VERSION,
        modelVersion: MODEL_VERSION,
        requestId: 'component-fixture',
        ok: true,
        issues,
        atmosphere: {
            densityKgM3: 1.221,
            speedOfSoundMps: 340.3,
            viscosityPaS: 1.79e-5,
            densityModel: 'ideal_moist_air_mixture',
            speedOfSoundModel: 'cramer_1993_400_ppm_co2',
            viscosityModel: 'sutherland_110_333_k',
            densityWithinDeclaredDomain: true,
            soundSpeedWithinDeclaredDomain: true,
            viscosityWithinDeclaredDomain: true,
            altitudeBehavior: 'homogeneous_at_firing_point',
        },
        scenarioModel: {
            targetInclinationRad: 0,
            geometricAltitudeM: 0,
            localGravity: false,
            coriolis: false,
            latitudeDeg: 45,
            azimuthDeg: 0,
            windLayerCount: 0,
        },
        loads,
    };
}
