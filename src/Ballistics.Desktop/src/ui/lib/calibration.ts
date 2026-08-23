import type {
    CalibrationObservation,
    CalibrationRequest,
    CalibrationResult,
    CustomDraft,
    ErrorResult,
    Inputs,
    ValidationIssue,
} from '../types';
import { PROTOCOL_VERSION } from '../../../shared/productIdentity';

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
const nullableFinite = (value: unknown) => value === null || finite(value);

export function validateCalibrationObservations(
    observations: CalibrationObservation[],
    parameterCount: number,
) {
    const errors: string[] = [];
    if (observations.length < 1 || observations.length > 32)
        errors.push('Provide between 1 and 32 velocity observations.');
    observations.forEach((observation, index) => {
        if (
            !finite(observation.distanceM) ||
            observation.distanceM <= 0 ||
            observation.distanceM > 2000
        )
            errors.push(
                `Observation ${index + 1} distance must be greater than 0 and at most 2000 m.`,
            );
        if (
            index > 0 &&
            finite(observation.distanceM) &&
            observation.distanceM <= observations[index - 1].distanceM
        )
            errors.push('Observation distances must be strictly increasing.');
        if (
            !finite(observation.velocityMps) ||
            observation.velocityMps < 1 ||
            observation.velocityMps > 2000
        )
            errors.push(`Observation ${index + 1} velocity must be between 1 and 2000 m/s.`);
        if (
            !finite(observation.standardDeviationMps) ||
            observation.standardDeviationMps < 0.01 ||
            observation.standardDeviationMps > 200
        )
            errors.push(`Observation ${index + 1} uncertainty must be between 0.01 and 200 m/s.`);
    });
    const calibrationCount = observations.filter((item) => item.role === 'calibration').length;
    if (calibrationCount < parameterCount)
        errors.push('Provide at least as many calibration observations as fitted coefficients.');
    return [...new Set(errors)];
}

export function createCalibrationRequest(
    inputs: Inputs,
    draft: CustomDraft,
    observations: CalibrationObservation[],
    fitKind: 'constant' | 'velocityBands',
    minimumVelocitiesMps: number[],
    requestId: string,
): CalibrationRequest {
    if (draft.drag !== 'G1' && draft.drag !== 'G7')
        throw new Error('Reference-BC calibration supports only G1 and G7 projectiles.');
    const initialBallisticCoefficient =
        draft.bcMode === 'velocityBands'
            ? (draft.bcBands.at(-1)?.ballisticCoefficient ?? draft.bc)
            : draft.bc;
    return {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        operation: 'calibrateReferenceBc',
        atmosphere: {
            temperatureC: inputs.temperatureC,
            stationPressureHpa: inputs.pressureHpa,
            relativeHumidityPercent: inputs.humidityPercent,
            headwindMps: inputs.headwindMps,
            crosswindMps: inputs.crosswindMps,
        },
        projectile: {
            curve: draft.drag,
            massKg: draft.massG / 1000,
            muzzleVelocityMps: draft.mv,
            initialBallisticCoefficient,
        },
        fit:
            fitKind === 'velocityBands'
                ? { kind: 'velocityBands', minimumVelocitiesMps }
                : { kind: 'constant' },
        observations,
    };
}

function issue(value: unknown): value is ValidationIssue {
    return (
        object(value) &&
        typeof value.code === 'string' &&
        typeof value.field === 'string' &&
        typeof value.message === 'string' &&
        (value.severity === 'warning' || value.severity === 'error')
    );
}

function errorEnvelope(value: unknown): value is ErrorResult {
    return (
        object(value) &&
        value.protocolVersion === PROTOCOL_VERSION &&
        typeof value.engineVersion === 'string' &&
        typeof value.modelVersion === 'string' &&
        typeof value.requestId === 'string' &&
        value.ok === false &&
        Array.isArray(value.issues) &&
        value.issues.every(issue)
    );
}

function estimate(value: unknown) {
    return (
        object(value) &&
        finite(value.minimumVelocityMps) &&
        value.minimumVelocityMps >= 0 &&
        finite(value.ballisticCoefficient) &&
        value.ballisticCoefficient >= 0.005 &&
        value.ballisticCoefficient <= 2 &&
        nullableFinite(value.confidence95Low) &&
        nullableFinite(value.confidence95High) &&
        (value.confidence95Low === null) === (value.confidence95High === null) &&
        (value.confidence95Low === null || value.confidence95Low <= value.ballisticCoefficient) &&
        (value.confidence95High === null || value.confidence95High >= value.ballisticCoefficient)
    );
}

function residual(value: unknown) {
    return (
        object(value) &&
        finite(value.distanceM) &&
        value.distanceM > 0 &&
        finite(value.measuredVelocityMps) &&
        finite(value.predictedVelocityMps) &&
        finite(value.residualMps) &&
        finite(value.normalizedResidual) &&
        finite(value.standardDeviationMps) &&
        value.standardDeviationMps >= 0.01 &&
        (value.role === 'calibration' || value.role === 'holdout')
    );
}

export class CalibrationProtocolError extends Error {
    constructor(
        message: string,
        readonly issues: ValidationIssue[] = [],
    ) {
        super(message);
        this.name = 'CalibrationProtocolError';
    }
}

export function parseCalibrationResponse(
    value: unknown,
    expectedRequestId: string,
): CalibrationResult {
    if (errorEnvelope(value)) {
        if (value.requestId !== expectedRequestId)
            throw new CalibrationProtocolError(
                'The calibration engine returned a mismatched request ID.',
            );
        throw new CalibrationProtocolError(
            value.issues.map((problem) => problem.message).join(' ') || 'Calibration failed.',
            value.issues,
        );
    }
    if (
        !object(value) ||
        value.protocolVersion !== PROTOCOL_VERSION ||
        typeof value.engineVersion !== 'string' ||
        !value.engineVersion ||
        typeof value.modelVersion !== 'string' ||
        !value.modelVersion ||
        value.requestId !== expectedRequestId ||
        value.ok !== true ||
        value.operation !== 'calibrateReferenceBc' ||
        !Array.isArray(value.issues) ||
        !value.issues.every(issue) ||
        !object(value.calibration)
    ) {
        throw new CalibrationProtocolError('The calibration engine returned a malformed response.');
    }
    const fit = value.calibration;
    if (
        (fit.curve !== 'G1' && fit.curve !== 'G7') ||
        (fit.fitKind !== 'constant' && fit.fitKind !== 'velocityBands') ||
        !['converged', 'maximum_iterations', 'insufficient_information', 'solver_failure'].includes(
            String(fit.status),
        ) ||
        !finite(fit.iterations) ||
        !Number.isInteger(fit.iterations) ||
        fit.iterations < 0 ||
        !finite(fit.objectiveEvaluations) ||
        !Number.isInteger(fit.objectiveEvaluations) ||
        fit.objectiveEvaluations < 0 ||
        !finite(fit.calibrationRmseMps) ||
        fit.calibrationRmseMps < 0 ||
        !finite(fit.weightedRmse) ||
        fit.weightedRmse < 0 ||
        !nullableFinite(fit.holdoutRmseMps) ||
        (finite(fit.holdoutRmseMps) && fit.holdoutRmseMps < 0) ||
        !finite(fit.reducedChiSquare) ||
        fit.reducedChiSquare < 0 ||
        typeof fit.hasHoldout !== 'boolean' ||
        typeof fit.validationClaimAvailable !== 'boolean' ||
        !Array.isArray(fit.estimates) ||
        fit.estimates.length > 4 ||
        !fit.estimates.every(estimate) ||
        !Array.isArray(fit.residuals) ||
        fit.residuals.length > 32 ||
        (fit.status !== 'solver_failure' && fit.residuals.length < 1) ||
        (fit.status === 'solver_failure' &&
            (fit.residuals.length !== 0 ||
                fit.estimates.length !== 0 ||
                fit.holdoutRmseMps !== null)) ||
        !fit.residuals.every(residual)
    ) {
        throw new CalibrationProtocolError('The calibration engine returned malformed fit data.');
    }
    const residuals = fit.residuals as Array<Record<string, unknown>>;
    const estimates = fit.estimates as Array<Record<string, unknown>>;
    if (
        fit.status !== 'solver_failure' &&
        ((fit.fitKind === 'constant' && estimates.length !== 1) ||
            (fit.fitKind === 'velocityBands' && (estimates.length < 2 || estimates.length > 4)) ||
            estimates[0]?.minimumVelocityMps !== 0 ||
            estimates.some(
                (item, index) =>
                    index > 0 &&
                    Number(item.minimumVelocityMps) <=
                        Number(estimates[index - 1].minimumVelocityMps),
            ))
    ) {
        throw new CalibrationProtocolError(
            'The calibration engine returned inconsistent coefficient estimates.',
        );
    }
    if (
        residuals.some(
            (item, index) =>
                index > 0 && Number(item.distanceM) <= Number(residuals[index - 1].distanceM),
        )
    ) {
        throw new CalibrationProtocolError(
            'The calibration engine returned unordered calibration residuals.',
        );
    }
    const hasHoldout = residuals.some((item) => item.role === 'holdout');
    if (
        fit.status !== 'solver_failure' &&
        (fit.hasHoldout !== hasHoldout || hasHoldout !== (fit.holdoutRmseMps !== null))
    ) {
        throw new CalibrationProtocolError(
            'The calibration engine returned inconsistent holdout status.',
        );
    }
    if (fit.validationClaimAvailable !== (fit.hasHoldout && fit.status === 'converged')) {
        throw new CalibrationProtocolError(
            'The calibration engine returned inconsistent holdout status.',
        );
    }
    return value as CalibrationResult;
}

export async function calibrateReferenceBc(
    request: CalibrationRequest,
    signal?: AbortSignal,
): Promise<CalibrationResult> {
    if (signal?.aborted) throw new DOMException('Calibration cancelled', 'AbortError');
    let raw: unknown;
    if (window.ballistics) {
        const cancel = () => window.ballistics?.cancelCalculation(request.requestId);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            raw = await window.ballistics.calculate(request);
        } finally {
            signal?.removeEventListener('abort', cancel);
        }
    } else {
        const response = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
        });
        raw = await response.json();
    }
    const result = parseCalibrationResponse(raw, request.requestId);
    const expectedFitKind = request.fit.kind;
    const echoedObservations = result.calibration.residuals;
    const sameNumber = (first: number, second: number) =>
        Math.abs(first - second) <= 1e-12 * Math.max(1, Math.abs(first), Math.abs(second));
    const observationsMatch =
        result.calibration.status === 'solver_failure' ||
        (echoedObservations.length === request.observations.length &&
            echoedObservations.every((residual, index) => {
                const source = request.observations[index];
                return (
                    sameNumber(residual.distanceM, source.distanceM) &&
                    sameNumber(residual.measuredVelocityMps, source.velocityMps) &&
                    sameNumber(residual.standardDeviationMps, source.standardDeviationMps) &&
                    residual.role === source.role
                );
            }));
    if (
        result.calibration.curve !== request.projectile.curve ||
        result.calibration.fitKind !== expectedFitKind ||
        !observationsMatch
    ) {
        throw new CalibrationProtocolError(
            'The calibration engine returned data for a different calibration request.',
        );
    }
    return result;
}

export function buildCalibrationCsv(result: CalibrationResult, request: CalibrationRequest) {
    const headers = [
        'recordType',
        'engineVersion',
        'modelVersion',
        'curve',
        'fitKind',
        'status',
        'temperatureC',
        'stationPressureHpa',
        'relativeHumidityPercent',
        'headwindMps',
        'crosswindMps',
        'massKg',
        'muzzleVelocityMps',
        'minimumVelocityMps',
        'ballisticCoefficient',
        'confidence95Low',
        'confidence95High',
        'distanceM',
        'measuredVelocityMps',
        'predictedVelocityMps',
        'residualMps',
        'normalizedResidual',
        'standardDeviationMps',
        'role',
    ];
    const common = [
        result.engineVersion,
        result.modelVersion,
        result.calibration.curve,
        result.calibration.fitKind,
        result.calibration.status,
        request.atmosphere.temperatureC,
        request.atmosphere.stationPressureHpa,
        request.atmosphere.relativeHumidityPercent,
        request.atmosphere.headwindMps,
        request.atmosphere.crosswindMps,
        request.projectile.massKg,
        request.projectile.muzzleVelocityMps,
    ];
    const rows: Array<Array<string | number | null>> = [headers];
    result.calibration.estimates.forEach((item) =>
        rows.push([
            'estimate',
            ...common,
            item.minimumVelocityMps,
            item.ballisticCoefficient,
            item.confidence95Low,
            item.confidence95High,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
        ]),
    );
    result.calibration.residuals.forEach((item) =>
        rows.push([
            'residual',
            ...common,
            '',
            '',
            '',
            '',
            item.distanceM,
            item.measuredVelocityMps,
            item.predictedVelocityMps,
            item.residualMps,
            item.normalizedResidual,
            item.standardDeviationMps,
            item.role,
        ]),
    );
    return (
        '\ufeff' +
        rows
            .map((row) =>
                row.map((field) => `"${String(field ?? '').replaceAll('"', '""')}"`).join(','),
            )
            .join('\r\n')
    );
}

export async function saveCalibrationCsv(result: CalibrationResult, request: CalibrationRequest) {
    const content = buildCalibrationCsv(result, request);
    if (window.ballistics) {
        await window.ballistics.saveCsv(content, 'ballistics_calibration_report.csv');
        return;
    }
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    anchor.download = 'ballistics_calibration_report.csv';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
}
