import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, MODEL_VERSION, PROTOCOL_VERSION } from '../../../shared/productIdentity';
import type { CalibrationObservation, CalibrationResult, CustomDraft, Inputs } from '../types';
import {
    buildCalibrationCsv,
    CalibrationProtocolError,
    createCalibrationRequest,
    parseCalibrationResponse,
    validateCalibrationObservations,
} from './calibration';
import { defaultInputs } from './workbenchDefaults';

const inputs: Inputs = {
    ...defaultInputs,
    distanceM: 500,
    temperatureC: 12,
    pressureHpa: 995,
    humidityPercent: 60,
    pressureSource: 'stationPressure',
    pressureAltitudeM: 0,
    geometricAltitudeM: 0,
    altimeterSettingHpa: 1013.25,
    headwindMps: 2,
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

const draft: CustomDraft = {
    id: 'custom:calibration',
    name: 'Calibration load',
    drag: 'G7',
    group: 'rifle',
    massG: 10.9,
    mv: 820,
    bc: 0.35,
    bcMode: 'constant',
    bcBands: [
        { minimumVelocityMps: 0, ballisticCoefficient: 0.3 },
        { minimumVelocityMps: 700, ballisticCoefficient: 0.4 },
    ],
    machCdDiameterMm: 7.82,
    machCdPoints: [],
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

const observations: CalibrationObservation[] = [
    { distanceM: 100, velocityMps: 750, standardDeviationMps: 1, role: 'calibration' },
    { distanceM: 200, velocityMps: 690, standardDeviationMps: 1, role: 'calibration' },
    { distanceM: 300, velocityMps: 635, standardDeviationMps: 1, role: 'holdout' },
];

const response: CalibrationResult = {
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: ENGINE_VERSION,
    modelVersion: MODEL_VERSION,
    requestId: 'fit-1',
    ok: true,
    operation: 'calibrateReferenceBc',
    issues: [],
    calibration: {
        curve: 'G7',
        fitKind: 'constant',
        status: 'converged',
        iterations: 4,
        objectiveEvaluations: 14,
        calibrationRmseMps: 0.2,
        weightedRmse: 0.2,
        holdoutRmseMps: 0.4,
        reducedChiSquare: 0.08,
        hasHoldout: true,
        validationClaimAvailable: true,
        estimates: [
            {
                minimumVelocityMps: 0,
                ballisticCoefficient: 0.42,
                confidence95Low: 0.4,
                confidence95High: 0.44,
            },
        ],
        residuals: [
            {
                distanceM: 100,
                measuredVelocityMps: 750,
                predictedVelocityMps: 750.1,
                residualMps: 0.1,
                normalizedResidual: 0.1,
                standardDeviationMps: 1,
                role: 'calibration',
            },
            {
                distanceM: 300,
                measuredVelocityMps: 635,
                predictedVelocityMps: 635.4,
                residualMps: 0.4,
                normalizedResidual: 0.4,
                standardDeviationMps: 1,
                role: 'holdout',
            },
        ],
    },
};

describe('reference-BC calibration protocol', () => {
    it('generates a strict SI request with uncertainty and roles', () => {
        const request = createCalibrationRequest(
            inputs,
            draft,
            observations,
            'constant',
            [],
            'fit-1',
        );
        expect(request.operation).toBe('calibrateReferenceBc');
        expect(request.projectile).toEqual({
            curve: 'G7',
            massKg: 0.0109,
            muzzleVelocityMps: 820,
            initialBallisticCoefficient: 0.35,
        });
        expect(request.atmosphere.stationPressureHpa).toBe(995);
        expect(request.observations.at(-1)?.role).toBe('holdout');
    });

    it('accepts just-determined fits and rejects fewer observations than coefficients', () => {
        expect(validateCalibrationObservations(observations, 1)).toEqual([]);
        expect(
            validateCalibrationObservations(
                [
                    {
                        distanceM: 100,
                        velocityMps: 750,
                        standardDeviationMps: 1,
                        role: 'calibration',
                    },
                ],
                1,
            ),
        ).toEqual([]);
        expect(validateCalibrationObservations(observations, 3)).toContain(
            'Provide at least as many calibration observations as fitted coefficients.',
        );
        expect(
            validateCalibrationObservations([observations[1], observations[0], observations[2]], 1),
        ).toContain('Observation distances must be strictly increasing.');
    });

    it('parses a one-point calibration-only fit without a confidence interval', () => {
        const justDetermined = {
            ...response,
            calibration: {
                ...response.calibration,
                status: 'insufficient_information',
                calibrationRmseMps: 0,
                weightedRmse: 0,
                holdoutRmseMps: null,
                reducedChiSquare: 0,
                hasHoldout: false,
                validationClaimAvailable: false,
                estimates: [
                    {
                        minimumVelocityMps: 0,
                        ballisticCoefficient: 0.071,
                        confidence95Low: null,
                        confidence95High: null,
                    },
                ],
                residuals: [
                    {
                        distanceM: 33,
                        measuredVelocityMps: 373,
                        predictedVelocityMps: 373,
                        residualMps: 0,
                        normalizedResidual: 0,
                        standardDeviationMps: 1,
                        role: 'calibration',
                    },
                ],
            },
        };
        expect(parseCalibrationResponse(justDetermined, 'fit-1')).toEqual(justDetermined);
    });

    it('accepts a consistent fit and rejects inconsistent validation claims', () => {
        expect(parseCalibrationResponse(response, 'fit-1')).toEqual(response);
        expect(() =>
            parseCalibrationResponse(
                {
                    ...response,
                    calibration: { ...response.calibration, validationClaimAvailable: false },
                },
                'fit-1',
            ),
        ).toThrow(CalibrationProtocolError);
    });

    it('keeps native solver failures parseable without pretending residuals exist', () => {
        const failed = {
            ...response,
            calibration: {
                ...response.calibration,
                status: 'solver_failure',
                calibrationRmseMps: 0,
                weightedRmse: 0,
                holdoutRmseMps: null,
                reducedChiSquare: 0,
                validationClaimAvailable: false,
                estimates: [],
                residuals: [],
            },
        };
        expect(parseCalibrationResponse(failed, 'fit-1')).toEqual(failed);
    });

    it('exports estimates, confidence bounds, uncertainty, and held-out residuals', () => {
        const request = createCalibrationRequest(
            inputs,
            draft,
            observations,
            'constant',
            [],
            'fit-1',
        );
        const csv = buildCalibrationCsv(response, request);
        expect(csv).toContain('"estimate"');
        expect(csv).toContain('"0.42"');
        expect(csv).toContain('"standardDeviationMps"');
        expect(csv).toContain('"holdout"');
        expect(csv).toContain(`"${MODEL_VERSION}"`);
    });
});
