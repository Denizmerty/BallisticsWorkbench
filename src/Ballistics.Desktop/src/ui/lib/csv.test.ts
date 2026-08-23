import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, MODEL_VERSION, PROTOCOL_VERSION } from '../../../shared/productIdentity';
import type { Inputs, Load, Point, Result } from '../types';
import { buildCsv } from './csv';
import { defaultUncertaintySettings } from './persistence';
import { defaultInputs } from './workbenchDefaults';

const point = (distanceM: number, speedMps: number): Point => ({
    distanceM,
    speedMps,
    airspeedMps: speedMps,
    energyJ: 0.5 * 0.01 * speedMps * speedMps,
    momentumKgms: 0.01 * speedMps,
    timeS: distanceM / speedMps,
    dropM: distanceM * distanceM * 1e-5,
    pathM: -(distanceM * distanceM * 1e-5) - 0.04 + (0.14 * distanceM) / 100,
    holdoverRad:
        distanceM > 0
            ? Math.atan2(distanceM * distanceM * 1e-5 + 0.04 - (0.14 * distanceM) / 100, distanceM)
            : 0,
    mach: speedMps / 340,
    spinDriftM: distanceM * 1e-4,
    windDriftM: distanceM * 5e-4,
});

const rifle: Load = {
    id: 'builtin:rifle',
    name: 'Rifle load',
    shortName: 'Rifle',
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
    points: [point(0, 800), point(50, 700), point(100, 620)],
};

const inputs: Inputs = {
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

const result: Result = {
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: ENGINE_VERSION,
    modelVersion: MODEL_VERSION,
    requestId: 'csv-test',
    ok: true,
    issues: [],
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
        geometricAltitudeM: 1500,
        localGravity: false,
        coriolis: false,
        latitudeDeg: 45,
        azimuthDeg: 0,
        windLayerCount: 0,
    },
    loads: [rifle],
};

describe('buildCsv', () => {
    it('starts with a UTF-8 BOM so Excel reads it as UTF-8', () => {
        expect(buildCsv(result, inputs, 50, false).startsWith('﻿')).toBe(true);
    });

    it('uses CRLF line endings', () => {
        expect(buildCsv(result, inputs, 50, false)).toContain('\r\n');
    });

    it('emits one data row per load per distance step', () => {
        const dataRows = buildCsv(result, inputs, 50, false)
            .split('\r\n')
            .filter((line) => line.startsWith('"0.0"') || /^"(50|100)\.0"/.test(line));
        // distances 0, 50, 100 → three rows for the single load
        expect(dataRows).toHaveLength(3);
    });

    it('quotes fields and escapes embedded quotes', () => {
        const quoted: Result = {
            ...result,
            loads: [{ ...rifle, name: 'Load "special"' }],
        };
        expect(buildCsv(quoted, inputs, 100, false)).toContain('"Load ""special"""');
    });

    it('switches units and headers in imperial mode', () => {
        const csv = buildCsv(result, inputs, 50, true);
        expect(csv).toContain('Distance (yd)');
        expect(csv).toContain('Velocity (ft/s)');
    });

    it('labels metric headers in metric mode', () => {
        const csv = buildCsv(result, inputs, 50, false);
        expect(csv).toContain('Distance (m)');
        expect(csv).toContain('Velocity (m/s)');
    });

    it('includes wind drift, total windage, and the crosswind atmosphere line', () => {
        const csv = buildCsv(result, { ...inputs, crosswindMps: 4 }, 50, false);
        expect(csv).toContain('Wind drift (cm)');
        expect(csv).toContain('Total windage (cm)');
        expect(csv).toContain('crosswind=4.000 m/s');
    });

    it('exports unambiguous pressure semantics and atmosphere-model provenance', () => {
        const csv = buildCsv(
            result,
            {
                ...inputs,
                pressureSource: 'altimeterSetting',
                pressureHpa: 845.4724690949225,
                pressureAltitudeM: 1500.927,
                geometricAltitudeM: 1500,
                altimeterSettingHpa: 1013.25,
            },
            100,
            false,
        );
        expect(csv).toContain('pressure source=altimeterSetting');
        expect(csv).toContain('resolved station pressure=845.472 hPa');
        expect(csv).toContain('field elevation=1500.000 m');
        expect(csv).toContain('altimeter setting=1013.250 hPa');
        expect(csv).toContain('density altitude=');
        expect(csv).toContain('density model=ideal_moist_air_mixture');
        expect(csv).toContain('speed-of-sound model=cramer_1993_400_ppm_co2');
        expect(csv).toContain('altitude behavior=homogeneous_at_firing_point');
    });

    it('includes sight path, holdover columns, and the zeroing metadata', () => {
        const csv = buildCsv(result, { ...inputs, rifleZeroM: 200 }, 50, false);
        expect(csv).toContain('Sight path (cm)');
        expect(csv).toContain('Holdover (MOA)');
        expect(csv).toContain('Holdover (mil)');
        expect(csv).toContain('rifle zero=200.000 m');
    });

    it('exports model identity and velocity-banded BC provenance', () => {
        const banded: Result = {
            ...result,
            loads: [
                {
                    ...rifle,
                    ballisticCoefficientBands: [
                        { minimumVelocityMps: 0, ballisticCoefficient: 0.4 },
                        { minimumVelocityMps: 500, ballisticCoefficient: 0.475 },
                    ],
                },
            ],
        };
        const csv = buildCsv(banded, inputs, 100, false);
        expect(csv).toContain(`engine=${ENGINE_VERSION}`);
        expect(csv).toContain(`model=${MODEL_VERSION}`);
        expect(csv).toContain('0.000:0.400000|500.000:0.475000');
    });

    it('exports trajectory-event values, statuses, and Mach crossings', () => {
        const csv = buildCsv(result, inputs, 100, false);
        expect(csv).toContain('# Trajectory events');
        expect(csv).toContain('near zero=25.000000 m');
        expect(csv).toContain('maximum ordinate path=0.030000 m');
        expect(csv).toContain('supersonic range status=complete');
        expect(csv).toContain('1.0:350.000000:decelerating');
        expect(csv).toContain('ground intersection=420.000000 m');
    });

    it('exports tabulated Mach-Cd geometry and curve provenance', () => {
        const tabulated: Result = {
            ...result,
            loads: [
                {
                    ...rifle,
                    dragModel: 'MachCd',
                    ballisticCoefficient: 0,
                    dragReferenceDiameterM: 0.00782,
                    machCdPoints: [
                        { mach: 0.5, dragCoefficient: 0.25 },
                        { mach: 3, dragCoefficient: 0.22 },
                    ],
                },
            ],
        };
        const csv = buildCsv(tabulated, inputs, 100, false);
        expect(csv).toContain('7.82000');
        expect(csv).toContain('0.50000:0.250000|3.00000:0.220000');
    });

    it('exports auditable uncertainty inputs, status, SDs, and 95% half-widths', () => {
        const uncertain: Result = {
            ...result,
            loads: [
                {
                    ...rifle,
                    uncertainty: {
                        method: 'first_order_central_difference',
                        confidenceLevel: 0.95,
                        status: 'complete',
                        activeInputCount: 2,
                        completedInputCount: 2,
                        points: rifle.points.map((sample) => ({
                            distanceM: sample.distanceM,
                            available: true,
                            speedStandardDeviationMps: 3,
                            energyStandardDeviationJ: 20,
                            momentumStandardDeviationKgms: 0.03,
                            timeStandardDeviationS: 0.001,
                            dropStandardDeviationM: 0.002,
                            pathStandardDeviationM: 0.003,
                            holdoverStandardDeviationRad: 0.00003,
                            windDriftStandardDeviationM: 0.001,
                        })),
                    },
                },
            ],
        };
        const csv = buildCsv(uncertain, inputs, 100, false, {
            ...defaultUncertaintySettings,
            enabled: true,
        });
        expect(csv).toContain('# Uncertainty inputs (independent 1-sigma)');
        expect(csv).toContain('method=first_order_central_difference');
        expect(csv).toContain('Velocity SD (m/s)');
        expect(csv).toContain('Velocity 95% half-width (m/s)');
        expect(csv).toContain('Holdover SD (MOA)');
        expect(csv).toContain('Holdover 95% half-width (mil)');
        expect(csv).toContain('"complete","3.000000","5.879892"');
    });

    it('exports the complete empirical buckshot fit and probability evidence', () => {
        const pattern: Result = {
            ...result,
            loads: [
                {
                    ...rifle,
                    name: 'Measured 00 buck',
                    firearmGroup: 'shotgun',
                    pelletCount: 9,
                    buckshotPattern: {
                        status: 'validated_in_domain',
                        choke: 'modified',
                        deformationClass: 'plated',
                        pelletVelocityStandardDeviationMps: 5,
                        fittedAngularDiameterRad: 0.012,
                        angularStandardUncertaintyRad: 0.0004,
                        calibrationRmseM: 0.006,
                        holdoutRmseM: 0.01,
                        reducedChiSquare: 0.8,
                        calibrationRangeMinM: 15,
                        calibrationRangeMaxM: 40,
                        targetRangeM: 25,
                        predictedDiameter90M: 0.3,
                        predictedDiameter90Low95M: 0.28,
                        predictedDiameter90High95M: 0.32,
                        perPelletHitProbability: 0.7,
                        perPelletHitProbabilityLow95: 0.65,
                        perPelletHitProbabilityHigh95: 0.75,
                        expectedPelletCount: 6.3,
                        minimumPelletCount: 3,
                        probabilityAtLeastMinimum: 0.995,
                        pelletCountProbabilities: [
                            0.000019683, 0.000413343, 0.003857868, 0.021003948, 0.073513816,
                            0.171532238, 0.266827924, 0.266827924, 0.155649622, 0.040353634,
                        ],
                        residuals: [
                            {
                                rangeM: 15,
                                measuredDiameter90M: 0.18,
                                predictedDiameter90M: 0.18,
                                residualM: 0,
                                normalizedResidual: 0,
                                role: 'calibration',
                            },
                            {
                                rangeM: 35,
                                measuredDiameter90M: 0.43,
                                predictedDiameter90M: 0.42,
                                residualM: -0.01,
                                normalizedResidual: -0.6666667,
                                role: 'holdout',
                            },
                        ],
                        validityStatement: 'Measured D90 fit for this load and choke.',
                    },
                },
            ],
        };

        const csv = buildCsv(pattern, inputs, 100, false);
        expect(csv).toContain('# Empirical buckshot pattern');
        expect(csv).toContain('status=validated_in_domain');
        expect(csv).toContain('holdout RMSE=0.010000 m');
        expect(csv).toContain('probability at least 3=0.99500000');
        expect(csv).toContain('pellet-count PMF=0:0.00001968|1:0.00041334');
        expect(csv).toContain('holdout:35.000000:0.430000:0.420000:-0.010000');
    });
});
