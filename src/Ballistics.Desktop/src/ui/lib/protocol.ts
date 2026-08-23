import type {
    ErrorResult,
    Load,
    MonteCarloUncertaintyPoint,
    Point,
    Result,
    UncertaintyInterval,
    UncertaintyPoint,
    ValidationIssue,
} from '../types';
import { PROTOCOL_VERSION } from '../../../shared/productIdentity';

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const nullableFinite = (value: unknown): value is number | null => value === null || finite(value);

function issue(value: unknown): value is ValidationIssue {
    return (
        object(value) &&
        typeof value.code === 'string' &&
        typeof value.field === 'string' &&
        typeof value.message === 'string' &&
        (value.severity === 'warning' || value.severity === 'error')
    );
}

function solverDiagnostics(value: unknown): boolean {
    if (!object(value) || value.mode !== 'adaptive_time') return false;
    const counts = [value.attemptedSteps, value.acceptedSteps, value.rejectedSteps];
    const measurements = [
        value.minimumAcceptedTimeStepS,
        value.maximumAcceptedTimeStepS,
        value.finalTimeStepS,
        value.maximumErrorNorm,
    ];
    return (
        counts.every((count) => finite(count) && Number.isInteger(count) && count >= 0) &&
        measurements.every((measurement) => finite(measurement) && measurement >= 0) &&
        Number(value.attemptedSteps) >= Number(value.acceptedSteps) + Number(value.rejectedSteps)
    );
}

function ballisticCoefficientBands(value: unknown): boolean {
    if (!Array.isArray(value) || value.length > 16) return false;
    return value.every(
        (band, index) =>
            object(band) &&
            finite(band.minimumVelocityMps) &&
            band.minimumVelocityMps >= 0 &&
            finite(band.ballisticCoefficient) &&
            band.ballisticCoefficient > 0 &&
            band.ballisticCoefficient <= 2 &&
            (index === 0
                ? band.minimumVelocityMps === 0
                : object(value[index - 1]) &&
                  finite(value[index - 1].minimumVelocityMps) &&
                  band.minimumVelocityMps > value[index - 1].minimumVelocityMps),
    );
}

function machCdPoints(value: unknown): boolean {
    if (!Array.isArray(value) || value.length > 64) return false;
    return value.every(
        (point, index) =>
            object(point) &&
            finite(point.mach) &&
            point.mach >= 0 &&
            point.mach <= 10 &&
            finite(point.dragCoefficient) &&
            point.dragCoefficient > 0 &&
            point.dragCoefficient <= 5 &&
            (index === 0 ||
                (object(value[index - 1]) &&
                    finite(value[index - 1].mach) &&
                    point.mach > value[index - 1].mach)),
    );
}

function dragValidity(value: unknown): boolean {
    if (!object(value)) return false;
    const fields = [
        value.supportedMachMin,
        value.supportedMachMax,
        value.supportedReynoldsMin,
        value.supportedReynoldsMax,
        value.observedMachMin,
        value.observedMachMax,
        value.observedReynoldsMin,
        value.observedReynoldsMax,
    ];
    if (value.status === 'not_declared') return fields.every((field) => field === null);
    if (value.status !== 'within_domain' && value.status !== 'extrapolated') return false;
    const reynoldsFields = [
        value.supportedReynoldsMin,
        value.supportedReynoldsMax,
        value.observedReynoldsMin,
        value.observedReynoldsMax,
    ];
    const reynoldsValid =
        reynoldsFields.every((field) => field === null) ||
        (reynoldsFields.every(finite) &&
            Number(value.supportedReynoldsMin) <= Number(value.supportedReynoldsMax) &&
            Number(value.observedReynoldsMin) <= Number(value.observedReynoldsMax));
    return (
        finite(value.supportedMachMin) &&
        finite(value.supportedMachMax) &&
        finite(value.observedMachMin) &&
        finite(value.observedMachMax) &&
        Number(value.supportedMachMin) <= Number(value.supportedMachMax) &&
        Number(value.observedMachMin) <= Number(value.observedMachMax) &&
        reynoldsValid
    );
}

function point(value: unknown): value is Point {
    if (!object(value)) return false;
    const distanceM = value.distanceM;
    const speedMps = value.speedMps;
    const airspeedMps = value.airspeedMps;
    const energyJ = value.energyJ;
    const momentumKgms = value.momentumKgms;
    const timeS = value.timeS;
    const dropM = value.dropM;
    const pathM = value.pathM;
    const holdoverRad = value.holdoverRad;
    const mach = value.mach;
    const windDriftM = value.windDriftM;
    return (
        finite(distanceM) &&
        finite(speedMps) &&
        finite(airspeedMps) &&
        finite(energyJ) &&
        finite(momentumKgms) &&
        finite(timeS) &&
        finite(dropM) &&
        finite(pathM) &&
        finite(holdoverRad) &&
        finite(mach) &&
        finite(windDriftM) &&
        distanceM >= 0 &&
        speedMps >= 0 &&
        airspeedMps >= 0 &&
        energyJ >= 0 &&
        momentumKgms >= 0 &&
        timeS >= 0 &&
        mach >= 0 &&
        nullableFinite(value.spinDriftM) &&
        (value.cd === undefined || finite(value.cd)) &&
        (value.referenceCd === undefined || finite(value.referenceCd)) &&
        (value.reynolds === undefined || finite(value.reynolds))
    );
}

function uncertaintyPoint(value: unknown): value is UncertaintyPoint {
    if (!object(value) || typeof value.available !== 'boolean') return false;
    const values = [
        value.distanceM,
        value.speedStandardDeviationMps,
        value.energyStandardDeviationJ,
        value.momentumStandardDeviationKgms,
        value.timeStandardDeviationS,
        value.dropStandardDeviationM,
        value.pathStandardDeviationM,
        value.holdoverStandardDeviationRad,
        value.windDriftStandardDeviationM,
    ];
    return values.every((measurement) => finite(measurement) && measurement >= 0);
}

function uncertaintyInterval(value: unknown): value is UncertaintyInterval {
    return (
        object(value) &&
        finite(value.median) &&
        finite(value.low95) &&
        finite(value.high95) &&
        value.low95 <= value.median &&
        value.median <= value.high95
    );
}

function monteCarloUncertaintyPoint(value: unknown): value is MonteCarloUncertaintyPoint {
    if (!object(value) || typeof value.available !== 'boolean') return false;
    return (
        finite(value.distanceM) &&
        value.distanceM >= 0 &&
        uncertaintyInterval(value.speedMps) &&
        uncertaintyInterval(value.energyJ) &&
        uncertaintyInterval(value.momentumKgms) &&
        uncertaintyInterval(value.timeS) &&
        uncertaintyInterval(value.dropM) &&
        uncertaintyInterval(value.pathM) &&
        uncertaintyInterval(value.holdoverRad) &&
        uncertaintyInterval(value.windDriftM)
    );
}

function trajectoryUncertainty(value: unknown, points: Point[]): boolean {
    if (value === null) return true;
    if (object(value) && value.method === 'monte_carlo') {
        if (
            value.confidenceLevel !== 0.95 ||
            !['complete', 'partial', 'no_inputs', 'baseline_unavailable'].includes(
                String(value.status),
            ) ||
            !Number.isSafeInteger(value.seed) ||
            Number(value.seed) < 0 ||
            !Number.isInteger(value.requestedSampleCount) ||
            Number(value.requestedSampleCount) < 100 ||
            Number(value.requestedSampleCount) > 10000 ||
            !Number.isInteger(value.completedSampleCount) ||
            Number(value.completedSampleCount) < 0 ||
            Number(value.completedSampleCount) > Number(value.requestedSampleCount) ||
            !finite(value.maximumSplitQuantileDelta) ||
            value.maximumSplitQuantileDelta < 0 ||
            !Array.isArray(value.points) ||
            value.points.length !== points.length ||
            !value.points.every(monteCarloUncertaintyPoint)
        ) {
            return false;
        }
        const samples = value.points as MonteCarloUncertaintyPoint[];
        if (
            !samples.every(
                (sample, index) => Math.abs(sample.distanceM - points[index].distanceM) <= 1e-7,
            )
        ) {
            return false;
        }
        const completed = Number(value.completedSampleCount);
        const requested = Number(value.requestedSampleCount);
        const allAvailable = samples.every((sample) => sample.available);
        const noneAvailable = samples.every((sample) => !sample.available);
        if (value.status === 'complete' || value.status === 'no_inputs') {
            return completed === requested && allAvailable;
        }
        if (value.status === 'baseline_unavailable') return completed === 0 && noneAvailable;
        return completed > 0 && completed < requested;
    }
    if (
        !object(value) ||
        value.method !== 'first_order_central_difference' ||
        value.confidenceLevel !== 0.95 ||
        !['complete', 'partial', 'no_inputs', 'baseline_unavailable'].includes(
            String(value.status),
        ) ||
        !finite(value.activeInputCount) ||
        !Number.isInteger(value.activeInputCount) ||
        value.activeInputCount < 0 ||
        value.activeInputCount > 7 ||
        !finite(value.completedInputCount) ||
        !Number.isInteger(value.completedInputCount) ||
        value.completedInputCount < 0 ||
        value.completedInputCount > value.activeInputCount ||
        !Array.isArray(value.points) ||
        value.points.length !== points.length ||
        !value.points.every(uncertaintyPoint)
    ) {
        return false;
    }

    const uncertaintyPoints = value.points as UncertaintyPoint[];
    if (
        !uncertaintyPoints.every(
            (sample, index) => Math.abs(sample.distanceM - points[index].distanceM) <= 1e-7,
        )
    ) {
        return false;
    }

    const allAvailable = uncertaintyPoints.every((sample) => sample.available);
    const noneAvailable = uncertaintyPoints.every((sample) => !sample.available);
    if (value.status === 'complete') {
        return (
            value.activeInputCount > 0 &&
            value.completedInputCount === value.activeInputCount &&
            allAvailable
        );
    }
    if (value.status === 'no_inputs') {
        return value.activeInputCount === 0 && value.completedInputCount === 0 && allAvailable;
    }
    if (value.status === 'baseline_unavailable') {
        return value.completedInputCount === 0 && noneAvailable;
    }
    return (
        value.activeInputCount > 0 &&
        (value.completedInputCount < value.activeInputCount || !allAvailable)
    );
}

function trajectoryEvents(value: unknown, solutionHorizonM: number): boolean {
    if (!object(value) || !finite(value.analyzedDistanceM) || value.analyzedDistanceM < 0) {
        return false;
    }
    const analyzedDistanceM = value.analyzedDistanceM;
    if (analyzedDistanceM > solutionHorizonM + 1e-7) return false;
    const statuses = ['complete', 'horizon_limited', 'baseline_unavailable'];
    if (
        !statuses.includes(String(value.zeroCrossingsStatus)) ||
        !statuses.includes(String(value.maximumOrdinateStatus)) ||
        ![...statuses, 'not_applicable'].includes(String(value.supersonicRangeStatus)) ||
        !statuses.includes(String(value.groundIntersectionStatus))
    ) {
        return false;
    }
    const optionalDistance = (measurement: unknown) =>
        measurement === null ||
        (finite(measurement) && measurement >= 0 && measurement <= analyzedDistanceM + 1e-7);
    if (
        !optionalDistance(value.nearZeroM) ||
        !optionalDistance(value.farZeroM) ||
        !optionalDistance(value.maximumOrdinateDistanceM) ||
        !nullableFinite(value.maximumOrdinatePathM) ||
        !optionalDistance(value.supersonicRangeM) ||
        !optionalDistance(value.groundIntersectionM) ||
        !Array.isArray(value.machCrossings) ||
        value.machCrossings.length > 32
    ) {
        return false;
    }
    const crossings = value.machCrossings;
    if (
        !crossings.every(
            (crossing, index) =>
                object(crossing) &&
                [0.8, 1, 1.2].includes(Number(crossing.mach)) &&
                finite(crossing.distanceM) &&
                crossing.distanceM >= 0 &&
                crossing.distanceM <= Number(value.analyzedDistanceM) + 1e-7 &&
                (crossing.direction === 'accelerating' || crossing.direction === 'decelerating') &&
                (index === 0 ||
                    (object(crossings[index - 1]) &&
                        finite(crossings[index - 1].distanceM) &&
                        crossing.distanceM >= crossings[index - 1].distanceM)),
        )
    ) {
        return false;
    }

    const zeroComplete = value.zeroCrossingsStatus === 'complete';
    if (
        zeroComplete !== (finite(value.nearZeroM) && finite(value.farZeroM)) ||
        (zeroComplete && Number(value.nearZeroM) >= Number(value.farZeroM))
    ) {
        return false;
    }
    const ordinateComplete = value.maximumOrdinateStatus === 'complete';
    if (
        ordinateComplete !==
        (finite(value.maximumOrdinateDistanceM) && finite(value.maximumOrdinatePathM))
    ) {
        return false;
    }
    const supersonicComplete = value.supersonicRangeStatus === 'complete';
    if (supersonicComplete !== finite(value.supersonicRangeM)) return false;
    if (
        supersonicComplete &&
        !crossings.some(
            (crossing) =>
                object(crossing) &&
                crossing.mach === 1 &&
                crossing.direction === 'decelerating' &&
                Math.abs(Number(crossing.distanceM) - Number(value.supersonicRangeM)) <= 1e-7,
        )
    ) {
        return false;
    }
    const groundComplete = value.groundIntersectionStatus === 'complete';
    if (groundComplete !== finite(value.groundIntersectionM)) return false;

    const baselineUnavailable = value.zeroCrossingsStatus === 'baseline_unavailable';
    if (
        baselineUnavailable !== (value.maximumOrdinateStatus === 'baseline_unavailable') ||
        baselineUnavailable !== (value.supersonicRangeStatus === 'baseline_unavailable') ||
        baselineUnavailable !== (value.groundIntersectionStatus === 'baseline_unavailable') ||
        (baselineUnavailable && crossings.length > 0) ||
        (baselineUnavailable &&
            [
                value.nearZeroM,
                value.farZeroM,
                value.maximumOrdinateDistanceM,
                value.maximumOrdinatePathM,
                value.supersonicRangeM,
                value.groundIntersectionM,
            ].some((measurement) => measurement !== null))
    ) {
        return false;
    }
    return true;
}

function buckshotPattern(value: unknown, pelletCount: number): boolean {
    if (value === null) return true;
    if (
        !object(value) ||
        !['validated_in_domain', 'extrapolated'].includes(String(value.status)) ||
        !['cylinder', 'improvedCylinder', 'modified', 'full', 'custom'].includes(
            String(value.choke),
        ) ||
        !['softLead', 'hardenedLead', 'plated', 'buffered', 'unknown'].includes(
            String(value.deformationClass),
        ) ||
        typeof value.validityStatement !== 'string' ||
        value.validityStatement.length === 0 ||
        !Array.isArray(value.pelletCountProbabilities) ||
        value.pelletCountProbabilities.length !== pelletCount + 1 ||
        !Array.isArray(value.residuals) ||
        value.residuals.length < 3 ||
        value.residuals.length > 64
    ) {
        return false;
    }
    const nonnegative = [
        value.pelletVelocityStandardDeviationMps,
        value.angularStandardUncertaintyRad,
        value.calibrationRmseM,
        value.holdoutRmseM,
        value.reducedChiSquare,
        value.expectedPelletCount,
    ];
    const positive = [
        value.fittedAngularDiameterRad,
        value.calibrationRangeMinM,
        value.calibrationRangeMaxM,
        value.targetRangeM,
        value.predictedDiameter90M,
        value.predictedDiameter90Low95M,
        value.predictedDiameter90High95M,
    ];
    const probabilities = [
        value.perPelletHitProbability,
        value.perPelletHitProbabilityLow95,
        value.perPelletHitProbabilityHigh95,
        value.probabilityAtLeastMinimum,
        ...value.pelletCountProbabilities,
    ];
    if (
        !nonnegative.every((item) => finite(item) && item >= 0) ||
        !positive.every((item) => finite(item) && item > 0) ||
        !probabilities.every((item) => finite(item) && item >= 0 && item <= 1) ||
        !Number.isInteger(value.minimumPelletCount) ||
        Number(value.minimumPelletCount) < 1 ||
        Number(value.minimumPelletCount) > pelletCount ||
        Number(value.calibrationRangeMinM) > Number(value.calibrationRangeMaxM) ||
        Number(value.predictedDiameter90Low95M) > Number(value.predictedDiameter90M) ||
        Number(value.predictedDiameter90M) > Number(value.predictedDiameter90High95M) ||
        Number(value.perPelletHitProbabilityLow95) > Number(value.perPelletHitProbability) ||
        Number(value.perPelletHitProbability) > Number(value.perPelletHitProbabilityHigh95) ||
        Math.abs(
            value.pelletCountProbabilities.reduce(
                (total: number, probability: unknown) => total + Number(probability),
                0,
            ) - 1,
        ) > 1e-8
    ) {
        return false;
    }
    if (
        !value.residuals.every(
            (residual) =>
                object(residual) &&
                finite(residual.rangeM) &&
                residual.rangeM > 0 &&
                finite(residual.measuredDiameter90M) &&
                residual.measuredDiameter90M > 0 &&
                finite(residual.predictedDiameter90M) &&
                residual.predictedDiameter90M > 0 &&
                finite(residual.residualM) &&
                finite(residual.normalizedResidual) &&
                (residual.role === 'calibration' || residual.role === 'holdout'),
        ) ||
        !value.residuals.some((residual) => object(residual) && residual.role === 'holdout')
    ) {
        return false;
    }
    return true;
}

function load(value: unknown): value is Load {
    if (!object(value)) return false;
    const points = value.points;
    const requestedDistanceM = value.requestedDistanceM;
    const coveredDistanceM = value.coveredDistanceM;
    const massKg = value.massKg;
    const muzzleVelocityMps = value.muzzleVelocityMps;
    const ballisticCoefficient = value.ballisticCoefficient;
    const dragReferenceDiameterM = value.dragReferenceDiameterM;
    const sphereDiameterM = value.sphereDiameterM;
    const materialDensityKgM3 = value.materialDensityKgM3;
    const pelletCount = value.pelletCount;
    const solutionHorizonM = value.solutionHorizonM;
    const sightHeightM = value.sightHeightM;
    const sightZeroM = value.sightZeroM;
    const effectiveTwistInches = value.effectiveTwistInches;
    if (!Array.isArray(points) || !points.every(point)) return false;
    const strings = [
        value.id,
        value.name,
        value.shortName,
        value.dragModel,
        value.firearmGroup,
        value.bcKind,
    ];
    if (
        !strings.every((item) => typeof item === 'string') ||
        !finite(massKg) ||
        !finite(muzzleVelocityMps) ||
        !finite(ballisticCoefficient) ||
        !ballisticCoefficientBands(value.ballisticCoefficientBands) ||
        !finite(dragReferenceDiameterM) ||
        dragReferenceDiameterM < 0 ||
        !machCdPoints(value.machCdPoints) ||
        !finite(sphereDiameterM) ||
        !finite(materialDensityKgM3) ||
        !finite(pelletCount) ||
        !finite(requestedDistanceM) ||
        !finite(coveredDistanceM) ||
        !finite(solutionHorizonM) ||
        !solverDiagnostics(value.solverDiagnostics) ||
        !dragValidity(value.dragValidity) ||
        !finite(sightHeightM) ||
        !finite(sightZeroM) ||
        !finite(effectiveTwistInches) ||
        !nullableFinite(value.zeroM) ||
        !nullableFinite(value.mpbrM) ||
        !nullableFinite(value.dropAtSightZeroM) ||
        !nullableFinite(value.boreElevationRad) ||
        !nullableFinite(value.zeroErrorM) ||
        !nullableFinite(value.gyroscopicStability) ||
        !trajectoryEvents(value.trajectoryEvents, solutionHorizonM) ||
        !trajectoryUncertainty(value.uncertainty, points) ||
        !buckshotPattern(value.buckshotPattern, Number(pelletCount)) ||
        !['G1', 'G7', 'MachCd', 'Sphere'].includes(String(value.dragModel)) ||
        !['rifle', 'shotgun'].includes(String(value.firearmGroup)) ||
        (value.source !== 'builtIn' && value.source !== 'custom') ||
        ![
            'complete',
            'ground_impact',
            'minimum_forward_speed',
            'maximum_time',
            'maximum_steps',
            'horizontal_reversal',
            'non_finite_state',
        ].includes(String(value.trajectoryStatus)) ||
        !['complete', 'horizon_limited', 'no_solution', 'invalid_geometry'].includes(
            String(value.mpbrStatus),
        ) ||
        !['complete', 'range_unavailable', 'no_solution', 'invalid_geometry'].includes(
            String(value.zeroingStatus),
        ) ||
        ![
            'available',
            'not_applicable',
            'missing_geometry',
            'invalid_stability',
            'unstable',
            'outside_empirical_domain',
        ].includes(String(value.spinDriftStatus)) ||
        massKg <= 0 ||
        muzzleVelocityMps <= 0 ||
        !Number.isInteger(pelletCount) ||
        pelletCount < 1 ||
        (value.source === 'builtIn' && !String(value.id).startsWith('builtin:')) ||
        (value.source === 'custom' && !String(value.id).startsWith('custom:'))
    ) {
        return false;
    }
    const curvePoints = value.machCdPoints as unknown[];
    const coefficientBands = value.ballisticCoefficientBands as unknown[];
    if (
        (value.dragModel === 'MachCd' &&
            (dragReferenceDiameterM <= 0 ||
                curvePoints.length < 2 ||
                ballisticCoefficient !== 0 ||
                coefficientBands.length !== 0)) ||
        (value.dragModel !== 'MachCd' &&
            (dragReferenceDiameterM !== 0 || curvePoints.length !== 0)) ||
        (value.dragModel === 'Sphere' &&
            (ballisticCoefficient !== 0 || coefficientBands.length !== 0)) ||
        ((value.dragModel === 'G1' || value.dragModel === 'G7') && ballisticCoefficient <= 0)
    ) {
        return false;
    }
    if (value.buckshotPattern !== null && value.firearmGroup !== 'shotgun') {
        return false;
    }
    const stability = value.gyroscopicStability;
    const spinAvailable = value.spinDriftStatus === 'available';
    const spinUnavailableWithEstimate =
        (value.spinDriftStatus === 'unstable' &&
            finite(stability) &&
            stability > 0 &&
            stability < 1) ||
        (value.spinDriftStatus === 'outside_empirical_domain' &&
            finite(stability) &&
            stability > 3.5);
    if (
        (spinAvailable && (!finite(stability) || stability < 1 || stability > 3.5)) ||
        (!spinAvailable && !spinUnavailableWithEstimate && stability !== null) ||
        (!spinAvailable && points.some((sample) => sample.spinDriftM !== null))
    ) {
        return false;
    }
    if (
        !finite(requestedDistanceM) ||
        !finite(coveredDistanceM) ||
        requestedDistanceM < 0 ||
        coveredDistanceM < 0 ||
        points.length === 0 ||
        coveredDistanceM > requestedDistanceM + 1e-7 ||
        Math.abs(points[0].distanceM) > 1e-7 ||
        Math.abs(points.at(-1)!.distanceM - coveredDistanceM) > 1e-7
    ) {
        return false;
    }
    return points.every(
        (sample, index) =>
            sample.distanceM <= coveredDistanceM + 1e-7 &&
            (index === 0 || sample.distanceM > points[index - 1].distanceM),
    );
}

function envelope(value: unknown): value is Result | ErrorResult {
    return (
        object(value) &&
        value.protocolVersion === PROTOCOL_VERSION &&
        typeof value.engineVersion === 'string' &&
        value.engineVersion.length > 0 &&
        typeof value.modelVersion === 'string' &&
        value.modelVersion.length > 0 &&
        typeof value.requestId === 'string' &&
        typeof value.ok === 'boolean' &&
        Array.isArray(value.issues) &&
        value.issues.every(issue)
    );
}

export class CalculationProtocolError extends Error {
    constructor(
        message: string,
        readonly issues: ValidationIssue[] = [],
    ) {
        super(message);
        this.name = 'CalculationProtocolError';
    }
}

export function parseCalculationResponse(value: unknown, expectedRequestId: string): Result {
    if (!envelope(value)) {
        throw new CalculationProtocolError('The ballistics engine returned a malformed response.');
    }
    if (value.requestId !== expectedRequestId) {
        throw new CalculationProtocolError(
            `The ballistics engine returned request ${value.requestId || '(empty)'}. Expected ${expectedRequestId}.`,
        );
    }
    if (!value.ok) {
        const message =
            value.issues.map((problem) => problem.message).join(' ') || 'Calculation failed.';
        throw new CalculationProtocolError(message, value.issues);
    }
    if (
        !object(value.atmosphere) ||
        !finite(value.atmosphere.densityKgM3) ||
        !finite(value.atmosphere.speedOfSoundMps) ||
        !finite(value.atmosphere.viscosityPaS) ||
        value.atmosphere.densityModel !== 'ideal_moist_air_mixture' ||
        value.atmosphere.speedOfSoundModel !== 'cramer_1993_400_ppm_co2' ||
        value.atmosphere.viscosityModel !== 'sutherland_110_333_k' ||
        typeof value.atmosphere.densityWithinDeclaredDomain !== 'boolean' ||
        typeof value.atmosphere.soundSpeedWithinDeclaredDomain !== 'boolean' ||
        typeof value.atmosphere.viscosityWithinDeclaredDomain !== 'boolean' ||
        (value.atmosphere.altitudeBehavior !== 'homogeneous_at_firing_point' &&
            value.atmosphere.altitudeBehavior !== 'icao_lapse_from_firing_point') ||
        !object(value.scenarioModel) ||
        !finite(value.scenarioModel.targetInclinationRad) ||
        !finite(value.scenarioModel.geometricAltitudeM) ||
        typeof value.scenarioModel.localGravity !== 'boolean' ||
        typeof value.scenarioModel.coriolis !== 'boolean' ||
        !finite(value.scenarioModel.latitudeDeg) ||
        !finite(value.scenarioModel.azimuthDeg) ||
        !Number.isInteger(value.scenarioModel.windLayerCount) ||
        value.scenarioModel.windLayerCount < 0 ||
        value.scenarioModel.windLayerCount > 16 ||
        !Array.isArray(value.loads) ||
        value.loads.length < 6 ||
        !value.loads.every(load)
    ) {
        throw new CalculationProtocolError('The ballistics engine returned malformed result data.');
    }
    const ids = new Set(value.loads.map((item) => item.id));
    if (ids.size !== value.loads.length || [...ids].some((id) => !id)) {
        throw new CalculationProtocolError(
            'The ballistics engine returned duplicate or empty load IDs.',
        );
    }
    return value as Result;
}
