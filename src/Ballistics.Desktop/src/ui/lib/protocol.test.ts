import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, MODEL_VERSION, PROTOCOL_VERSION } from '../../../shared/productIdentity';
import type { CustomDraft, Inputs, Load, UncertaintySettings } from '../types';
import { createCalculationRequest } from './calculate';
import { CalculationProtocolError, parseCalculationResponse } from './protocol';
import { defaultInputs } from './workbenchDefaults';

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

const uncertainty: UncertaintySettings = {
    enabled: true,
    method: 'firstOrder',
    sampleCount: 1000,
    seed: 1113017667,
    correlations: [],
    shotgunMuzzleVelocityStandardDeviationMps: 2,
    rifleMuzzleVelocityStandardDeviationMps: 3,
    dragRelativeStandardDeviation: 0.03,
    temperatureStandardDeviationC: 1,
    stationPressureStandardDeviationHpa: 2,
    headwindStandardDeviationMps: 0.5,
    crosswindStandardDeviationMps: 1,
    shotgunZeroRangeStandardDeviationM: 1,
    rifleZeroRangeStandardDeviationM: 1.5,
};

const reference: CustomDraft = {
    id: 'custom:g7',
    name: 'Unicode G7 – Çalışma',
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
        { mach: 1.2, dragCoefficient: 0.4 },
        { mach: 3, dragCoefficient: 0.24 },
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

const sphere: CustomDraft = {
    ...reference,
    id: 'custom:sphere',
    name: 'Sphere',
    drag: 'Sphere',
    group: 'shotgun',
    count: 9,
};

const machCd: CustomDraft = {
    ...reference,
    id: 'custom:mach-cd',
    name: 'Mach–Cd curve',
    drag: 'MachCd',
};

const resultLoad = (index: number): Load => ({
    id: `builtin:${index}`,
    name: `Load ${index}`,
    shortName: `Load ${index}`,
    dragModel: 'G1',
    firearmGroup: 'rifle',
    source: 'builtIn',
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
    mpbrM: 250,
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
        supersonicRangeStatus: 'horizon_limited',
        supersonicRangeM: null,
        groundIntersectionStatus: 'complete',
        groundIntersectionM: 420,
        machCrossings: [],
    },
    uncertainty: null,
    buckshotPattern: null,
    points: [
        {
            distanceM: 0,
            speedMps: 800,
            airspeedMps: 800,
            energyJ: 3200,
            momentumKgms: 8,
            timeS: 0,
            dropM: 0,
            pathM: -0.04,
            holdoverRad: 0,
            mach: 2.35,
            spinDriftM: 0,
            windDriftM: 0,
        },
        {
            distanceM: 100,
            speedMps: 700,
            airspeedMps: 700,
            energyJ: 2450,
            momentumKgms: 7,
            timeS: 0.13,
            dropM: 0.1,
            pathM: 0,
            holdoverRad: 0,
            mach: 2.05,
            spinDriftM: 0.01,
            windDriftM: 0,
        },
    ],
});

const validResponse = () => ({
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: ENGINE_VERSION,
    modelVersion: MODEL_VERSION,
    requestId: 'request-7',
    ok: true,
    issues: [],
    atmosphere: {
        densityKgM3: 1.221,
        speedOfSoundMps: 340.8,
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
    loads: Array.from({ length: 6 }, (_, index) => resultLoad(index)),
});

describe('calculation protocol', () => {
    it('puts every custom load in one discriminated request', () => {
        const request = createCalculationRequest(inputs, [reference, sphere, machCd], 'request-7');
        expect(request.protocolVersion).toBe(PROTOCOL_VERSION);
        expect(request.customLoads).toHaveLength(3);
        expect(request.customLoads[0]).toMatchObject({
            id: 'custom:g7',
            massKg: 0.01,
            drag: { kind: 'referenceBc', curve: 'G7', ballisticCoefficient: 0.25 },
        });
        expect(request.customLoads[1]).toMatchObject({
            id: 'custom:sphere',
            drag: { kind: 'sphere', diameterM: 0.008, materialDensityKgM3: 11340 },
        });
        expect(request.customLoads[1]).not.toHaveProperty('massKg');
        expect(request.customLoads[2]).toMatchObject({
            id: 'custom:mach-cd',
            massKg: 0.01,
            drag: {
                kind: 'tabulatedCd',
                referenceDiameterM: 0.00782,
                points: reference.machCdPoints,
            },
        });

        const banded = createCalculationRequest(
            inputs,
            [{ ...reference, bcMode: 'velocityBands' }],
            'request-banded',
        );
        expect(banded.customLoads[0].drag).toEqual({
            kind: 'referenceBc',
            curve: 'G7',
            velocityBands: reference.bcBands,
        });
        expect(banded.customLoads[0].drag).not.toHaveProperty('ballisticCoefficient');
    });

    it('omits disabled uncertainty and serializes all enabled one-sigma inputs', () => {
        expect(
            createCalculationRequest(inputs, [], 'disabled').scenario.uncertainty,
        ).toBeUndefined();
        expect(
            createCalculationRequest(inputs, [], 'enabled', uncertainty).scenario.uncertainty,
        ).toEqual({
            method: 'firstOrder',
            sampleCount: 1000,
            seed: 1113017667,
            correlations: [],
            shotgunMuzzleVelocityStandardDeviationMps: 2,
            rifleMuzzleVelocityStandardDeviationMps: 3,
            dragRelativeStandardDeviation: 0.03,
            temperatureStandardDeviationC: 1,
            stationPressureStandardDeviationHpa: 2,
            headwindStandardDeviationMps: 0.5,
            crosswindStandardDeviationMps: 1,
            shotgunZeroRangeStandardDeviationM: 1,
            rifleZeroRangeStandardDeviationM: 1.5,
        });
    });

    it('accepts a matching, coverage-consistent response', () => {
        expect(parseCalculationResponse(validResponse(), 'request-7').loads).toHaveLength(6);
    });

    it('serializes and validates an empirical buckshot-pattern analysis', () => {
        const patternInputs: Inputs = {
            ...inputs,
            buckshotPattern: {
                enabled: true,
                loadId: 'custom:sphere',
                choke: 'modified',
                deformationClass: 'plated',
                pelletVelocityStandardDeviationMps: 5,
                targetRangeM: 35,
                minimumPelletCount: 3,
                target: {
                    shape: 'circle',
                    widthM: 0.45,
                    heightM: 0.45,
                    centerHorizontalM: 0.03,
                    centerVerticalM: -0.02,
                },
                observations: [
                    {
                        rangeM: 15,
                        diameter90M: 0.18,
                        standardUncertaintyM: 0.01,
                        shellCount: 5,
                        role: 'calibration',
                    },
                    {
                        rangeM: 25,
                        diameter90M: 0.3,
                        standardUncertaintyM: 0.012,
                        shellCount: 5,
                        role: 'calibration',
                    },
                    {
                        rangeM: 35,
                        diameter90M: 0.43,
                        standardUncertaintyM: 0.015,
                        shellCount: 5,
                        role: 'holdout',
                    },
                ],
            },
        };
        expect(
            createCalculationRequest(patternInputs, [sphere], 'buckshot-pattern').scenario
                .buckshotPattern,
        ).toMatchObject({
            loadId: 'custom:sphere',
            choke: 'modified',
            target: { shape: 'circle', widthM: 0.45 },
        });

        const response = validResponse();
        const patternResult = {
            status: 'validated_in_domain' as const,
            choke: 'modified' as const,
            deformationClass: 'plated' as const,
            pelletVelocityStandardDeviationMps: 5,
            fittedAngularDiameterRad: 0.012,
            angularStandardUncertaintyRad: 0.0004,
            calibrationRmseM: 0.006,
            holdoutRmseM: 0.01,
            reducedChiSquare: 0.8,
            calibrationRangeMinM: 15,
            calibrationRangeMaxM: 25,
            targetRangeM: 20,
            predictedDiameter90M: 0.24,
            predictedDiameter90Low95M: 0.22,
            predictedDiameter90High95M: 0.26,
            perPelletHitProbability: 0.7,
            perPelletHitProbabilityLow95: 0.65,
            perPelletHitProbabilityHigh95: 0.75,
            expectedPelletCount: 6.3,
            minimumPelletCount: 3,
            probabilityAtLeastMinimum: 0.995,
            pelletCountProbabilities: [
                0.00002, 0.00041, 0.00386, 0.021, 0.0735, 0.1715, 0.2668, 0.2668, 0.1556, 0.04051,
            ],
            residuals: patternInputs.buckshotPattern.observations.map((observation) => ({
                rangeM: observation.rangeM,
                measuredDiameter90M: observation.diameter90M,
                predictedDiameter90M: observation.rangeM * 0.012,
                residualM: observation.diameter90M - observation.rangeM * 0.012,
                normalizedResidual:
                    (observation.diameter90M - observation.rangeM * 0.012) /
                    observation.standardUncertaintyM,
                role: observation.role,
            })),
            validityStatement:
                'Empirical D90 fit. Excludes pellet wakes, swarm aerodynamics, and aim error.',
        };
        response.loads[0] = {
            ...response.loads[0],
            firearmGroup: 'shotgun',
            pelletCount: 9,
            buckshotPattern: patternResult,
        };
        const total = patternResult.pelletCountProbabilities.reduce((sum, value) => sum + value, 0);
        patternResult.pelletCountProbabilities[9] += 1 - total;
        expect(
            parseCalculationResponse(response, 'request-7').loads[0].buckshotPattern?.status,
        ).toBe('validated_in_domain');

        patternResult.perPelletHitProbabilityLow95 = 0.8;
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('requires native holdover on every trajectory point', () => {
        const malformed = validResponse() as unknown as {
            loads: Array<{ points: Array<Record<string, unknown>> }>;
        };
        delete malformed.loads[0].points[0].holdoverRad;
        expect(() => parseCalculationResponse(malformed, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('requires the exact atmosphere-model identity', () => {
        const response = validResponse();
        response.atmosphere.speedOfSoundModel = 'cramer_1993_400_ppm_co2';
        expect(parseCalculationResponse(response, 'request-7').atmosphere.altitudeBehavior).toBe(
            'homogeneous_at_firing_point',
        );

        const malformed = validResponse() as unknown as {
            atmosphere: Record<string, unknown>;
        };
        malformed.atmosphere.speedOfSoundModel = 'unknown';
        expect(() => parseCalculationResponse(malformed, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('accepts aligned complete uncertainty and rejects false completeness', () => {
        const response = validResponse();
        response.loads[0].uncertainty = {
            method: 'first_order_central_difference',
            confidenceLevel: 0.95,
            status: 'complete',
            activeInputCount: 2,
            completedInputCount: 2,
            points: response.loads[0].points.map((sample) => ({
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
        };
        expect(parseCalculationResponse(response, 'request-7').loads[0].uncertainty?.status).toBe(
            'complete',
        );

        response.loads[0].uncertainty.points[1].available = false;
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('accepts aligned Monte Carlo quantiles and rejects unordered intervals', () => {
        const response = validResponse();
        const interval = (median: number) => ({
            median,
            low95: median - 1,
            high95: median + 1,
        });
        response.loads[0].uncertainty = {
            method: 'monte_carlo',
            confidenceLevel: 0.95,
            status: 'complete',
            seed: 42,
            requestedSampleCount: 100,
            completedSampleCount: 100,
            maximumSplitQuantileDelta: 0.02,
            points: response.loads[0].points.map((point) => ({
                distanceM: point.distanceM,
                available: true,
                speedMps: interval(point.speedMps),
                energyJ: interval(point.energyJ),
                momentumKgms: interval(point.momentumKgms),
                timeS: interval(point.timeS),
                dropM: interval(point.dropM),
                pathM: interval(point.pathM),
                holdoverRad: interval(point.holdoverRad),
                windDriftM: interval(point.windDriftM),
            })),
        };
        expect(parseCalculationResponse(response, 'request-7').loads[0].uncertainty?.method).toBe(
            'monte_carlo',
        );

        response.loads[0].uncertainty.points[1].speedMps.low95 =
            response.loads[0].uncertainty.points[1].speedMps.high95 + 1;
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('rejects uncertainty arrays that do not align with trajectory distances', () => {
        const response = validResponse();
        response.loads[0].uncertainty = {
            method: 'first_order_central_difference',
            confidenceLevel: 0.95,
            status: 'no_inputs',
            activeInputCount: 0,
            completedInputCount: 0,
            points: response.loads[0].points.map((sample, index) => ({
                distanceM: sample.distanceM + (index ? 1 : 0),
                available: true,
                speedStandardDeviationMps: 0,
                energyStandardDeviationJ: 0,
                momentumStandardDeviationKgms: 0,
                timeStandardDeviationS: 0,
                dropStandardDeviationM: 0,
                pathStandardDeviationM: 0,
                holdoverStandardDeviationRad: 0,
                windDriftStandardDeviationM: 0,
            })),
        };
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('accepts unavailable uncertainty while preserving the requested input count', () => {
        const response = validResponse();
        response.loads[0].uncertainty = {
            method: 'first_order_central_difference',
            confidenceLevel: 0.95,
            status: 'baseline_unavailable',
            activeInputCount: 3,
            completedInputCount: 0,
            points: response.loads[0].points.map((sample) => ({
                distanceM: sample.distanceM,
                available: false,
                speedStandardDeviationMps: 0,
                energyStandardDeviationJ: 0,
                momentumStandardDeviationKgms: 0,
                timeStandardDeviationS: 0,
                dropStandardDeviationM: 0,
                pathStandardDeviationM: 0,
                holdoverStandardDeviationRad: 0,
                windDriftStandardDeviationM: 0,
            })),
        };
        expect(parseCalculationResponse(response, 'request-7').loads[0].uncertainty).toMatchObject({
            status: 'baseline_unavailable',
            activeInputCount: 3,
            completedInputCount: 0,
        });
    });

    it('validates BC schedules and declared drag domains', () => {
        const response = validResponse();
        response.loads[0].ballisticCoefficientBands = [
            { minimumVelocityMps: 0, ballisticCoefficient: 0.2 },
            { minimumVelocityMps: 400, ballisticCoefficient: 0.25 },
        ];
        response.loads[0].dragValidity = {
            status: 'within_domain',
            supportedMachMin: 0.2,
            supportedMachMax: 1.5,
            supportedReynoldsMin: 100,
            supportedReynoldsMax: 2e6,
            observedMachMin: 0.6,
            observedMachMax: 1.2,
            observedReynoldsMin: 10000,
            observedReynoldsMax: 200000,
        };
        expect(parseCalculationResponse(response, 'request-7').loads[0].dragValidity.status).toBe(
            'within_domain',
        );

        response.loads[0].ballisticCoefficientBands.reverse();
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('keeps spin drift inside its declared stability domain', () => {
        const unstable = validResponse();
        unstable.loads[0].spinDriftStatus = 'unstable';
        unstable.loads[0].gyroscopicStability = 0.9;
        unstable.loads[0].points.forEach((point) => {
            point.spinDriftM = null;
        });
        expect(parseCalculationResponse(unstable, 'request-7').loads[0]).toMatchObject({
            spinDriftStatus: 'unstable',
            gyroscopicStability: 0.9,
        });

        unstable.loads[0].spinDriftStatus = 'available';
        expect(() => parseCalculationResponse(unstable, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('accepts tabulated Mach-Cd metadata with a Mach-only declared domain', () => {
        const response = validResponse();
        response.loads[0] = {
            ...response.loads[0],
            dragModel: 'MachCd',
            ballisticCoefficient: 0,
            dragReferenceDiameterM: 0.00782,
            machCdPoints: reference.machCdPoints,
            dragValidity: {
                status: 'within_domain',
                supportedMachMin: 0.5,
                supportedMachMax: 3,
                supportedReynoldsMin: null,
                supportedReynoldsMax: null,
                observedMachMin: 1.8,
                observedMachMax: 2.4,
                observedReynoldsMin: null,
                observedReynoldsMax: null,
            },
        };
        expect(parseCalculationResponse(response, 'request-7').loads[0].dragModel).toBe('MachCd');
        response.loads[0].machCdPoints.reverse();
        expect(() => parseCalculationResponse(response, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('validates trajectory-event relationships and explicit availability', () => {
        const missingMachCrossing = validResponse();
        missingMachCrossing.loads[0].trajectoryEvents.supersonicRangeStatus = 'complete';
        missingMachCrossing.loads[0].trajectoryEvents.supersonicRangeM = 350;
        expect(() => parseCalculationResponse(missingMachCrossing, 'request-7')).toThrow(
            'malformed result data',
        );

        const reversedZeros = validResponse();
        reversedZeros.loads[0].trajectoryEvents.nearZeroM = 125;
        expect(() => parseCalculationResponse(reversedZeros, 'request-7')).toThrow(
            'malformed result data',
        );

        const unavailable = validResponse();
        unavailable.loads[0].trajectoryEvents = {
            analyzedDistanceM: 0,
            zeroCrossingsStatus: 'baseline_unavailable',
            nearZeroM: null,
            farZeroM: null,
            maximumOrdinateStatus: 'baseline_unavailable',
            maximumOrdinateDistanceM: null,
            maximumOrdinatePathM: null,
            supersonicRangeStatus: 'baseline_unavailable',
            supersonicRangeM: null,
            groundIntersectionStatus: 'baseline_unavailable',
            groundIntersectionM: null,
            machCrossings: [],
        };
        expect(
            parseCalculationResponse(unavailable, 'request-7').loads[0].trajectoryEvents,
        ).toEqual(unavailable.loads[0].trajectoryEvents);
        unavailable.loads[0].trajectoryEvents.nearZeroM = 1;
        expect(() => parseCalculationResponse(unavailable, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('rejects mismatched request IDs and malformed endpoints', () => {
        expect(() => parseCalculationResponse(validResponse(), 'request-8')).toThrow(
            CalculationProtocolError,
        );
        const malformed = validResponse();
        malformed.loads[0].coveredDistanceM = 90;
        expect(() => parseCalculationResponse(malformed, 'request-7')).toThrow(
            'malformed result data',
        );
    });

    it('surfaces structured engine validation issues', () => {
        expect(() =>
            parseCalculationResponse(
                {
                    protocolVersion: PROTOCOL_VERSION,
                    engineVersion: ENGINE_VERSION,
                    modelVersion: MODEL_VERSION,
                    requestId: 'request-7',
                    ok: false,
                    issues: [
                        {
                            code: 'validation.range',
                            field: 'scenario.displayDistanceM',
                            message: 'Display distance is invalid.',
                            severity: 'error',
                        },
                    ],
                },
                'request-7',
            ),
        ).toThrow('Display distance is invalid.');
    });
});
