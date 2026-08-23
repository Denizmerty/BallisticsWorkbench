import { PROTOCOL_VERSION } from './productIdentity.js';

export type ValidationIssue = {
    code: string;
    field: string;
    message: string;
    severity: 'warning' | 'error';
};

export type ReferenceBcDragRequest = {
    kind: 'referenceBc';
    curve: 'G1' | 'G7';
} & (
    | { ballisticCoefficient: number; velocityBands?: never }
    | {
          ballisticCoefficient?: never;
          velocityBands: Array<{ minimumVelocityMps: number; ballisticCoefficient: number }>;
      }
);

export type SphereDragRequest = {
    kind: 'sphere';
    diameterM: number;
    materialDensityKgM3: number;
};

export type MachCdPoint = { mach: number; dragCoefficient: number };

export type TabulatedCdDragRequest = {
    kind: 'tabulatedCd';
    referenceDiameterM: number;
    points: MachCdPoint[];
};

export type CustomLoadRequest = {
    id: string;
    name: string;
    firearmGroup: 'rifle' | 'shotgun';
    muzzleVelocityMps: number;
    pelletCount: number;
    massKg?: number;
    drag: ReferenceBcDragRequest | TabulatedCdDragRequest | SphereDragRequest;
    bulletGeometry?: {
        lengthInches: number;
        diameterInches: number;
        twistInches: number;
    };
};

export type UncertaintyRequest = {
    method: 'firstOrder' | 'monteCarlo';
    sampleCount: number;
    seed: number;
    correlations: Array<{
        first: UncertaintyVariableRequest;
        second: UncertaintyVariableRequest;
        coefficient: number;
    }>;
    shotgunMuzzleVelocityStandardDeviationMps: number;
    rifleMuzzleVelocityStandardDeviationMps: number;
    dragRelativeStandardDeviation: number;
    temperatureStandardDeviationC: number;
    stationPressureStandardDeviationHpa: number;
    headwindStandardDeviationMps: number;
    crosswindStandardDeviationMps: number;
    shotgunZeroRangeStandardDeviationM: number;
    rifleZeroRangeStandardDeviationM: number;
};

export type UncertaintyVariableRequest =
    | 'muzzleVelocity'
    | 'drag'
    | 'temperature'
    | 'stationPressure'
    | 'headwind'
    | 'crosswind'
    | 'zeroRange';

export type WindLayerRequest = {
    axis: 'height' | 'downrange';
    startM: number;
    endM: number;
    startHeadwindMps: number;
    endHeadwindMps: number;
    startCrosswindMps: number;
    endCrosswindMps: number;
    source?: string;
};

export type TemperatureVelocityPointRequest = {
    temperatureC: number;
    multiplier: number;
};

export type PatternObservationRequest = {
    rangeM: number;
    diameter90M: number;
    standardUncertaintyM: number;
    shellCount: number;
    role: 'calibration' | 'holdout';
};

export type BuckshotPatternRequest = {
    loadId: string;
    choke: 'cylinder' | 'improvedCylinder' | 'modified' | 'full' | 'custom';
    deformationClass: 'softLead' | 'hardenedLead' | 'plated' | 'buffered' | 'unknown';
    pelletVelocityStandardDeviationMps: number;
    targetRangeM: number;
    minimumPelletCount: number;
    target: {
        shape: 'circle' | 'rectangle';
        widthM: number;
        heightM: number;
        centerHorizontalM: number;
        centerVerticalM: number;
    };
    observations: PatternObservationRequest[];
};

export type CalculationRequest = {
    protocolVersion: typeof PROTOCOL_VERSION;
    requestId: string;
    scenario: {
        displayDistanceM: number;
        solutionHorizonM: number;
        vitalZoneM: number;
        geometry?: {
            targetInclinationDeg?: number;
            targetElevationM?: number;
        };
        atmosphere: {
            temperatureC: number;
            stationPressureHpa: number;
            relativeHumidityPercent: number;
            headwindMps: number;
            crosswindMps: number;
            geometricAltitudeM?: number;
            altitudeDependent?: boolean;
            useLocalGravity?: boolean;
            coriolisEnabled?: boolean;
            latitudeDeg?: number;
            azimuthDeg?: number;
            windLayers?: WindLayerRequest[];
            windProvenance?: string;
        };
        firearms: {
            shotgun: {
                sightHeightM: number;
                zeroRangeM: number;
                muzzleVelocityMultiplier: number;
                temperatureVelocityProfile?: TemperatureVelocityPointRequest[];
                temperatureVelocitySource?: string;
            };
            rifle: {
                sightHeightM: number;
                zeroRangeM: number;
                muzzleVelocityMultiplier: number;
                twistInches: number;
                twistDirection: number;
                temperatureVelocityProfile?: TemperatureVelocityPointRequest[];
                temperatureVelocitySource?: string;
            };
        };
        uncertainty?: UncertaintyRequest;
        buckshotPattern?: BuckshotPatternRequest;
    };
    customLoads: CustomLoadRequest[];
};

export type CalibrationObservation = {
    distanceM: number;
    velocityMps: number;
    standardDeviationMps: number;
    role: 'calibration' | 'holdout';
};

export type CalibrationRequest = {
    protocolVersion: typeof PROTOCOL_VERSION;
    requestId: string;
    operation: 'calibrateReferenceBc';
    atmosphere: {
        temperatureC: number;
        stationPressureHpa: number;
        relativeHumidityPercent: number;
        headwindMps: number;
        crosswindMps: number;
    };
    projectile: {
        curve: 'G1' | 'G7';
        massKg: number;
        muzzleVelocityMps: number;
        initialBallisticCoefficient: number;
    };
    fit: { kind: 'constant' } | { kind: 'velocityBands'; minimumVelocitiesMps: number[] };
    observations: CalibrationObservation[];
};

export type ProtocolRequest = CalculationRequest | CalibrationRequest;

export type Point = {
    distanceM: number;
    speedMps: number;
    airspeedMps: number;
    energyJ: number;
    momentumKgms: number;
    timeS: number;
    dropM: number;
    pathM: number;
    holdoverRad: number;
    mach: number;
    spinDriftM: number | null;
    windDriftM: number;
    cd?: number;
    referenceCd?: number;
    reynolds?: number;
};

export type UncertaintyPoint = {
    distanceM: number;
    available: boolean;
    speedStandardDeviationMps: number;
    energyStandardDeviationJ: number;
    momentumStandardDeviationKgms: number;
    timeStandardDeviationS: number;
    dropStandardDeviationM: number;
    pathStandardDeviationM: number;
    holdoverStandardDeviationRad: number;
    windDriftStandardDeviationM: number;
};

export type FirstOrderTrajectoryUncertainty = {
    method: 'first_order_central_difference';
    confidenceLevel: 0.95;
    status: 'complete' | 'partial' | 'no_inputs' | 'baseline_unavailable';
    activeInputCount: number;
    completedInputCount: number;
    points: UncertaintyPoint[];
};

export type UncertaintyInterval = {
    median: number;
    low95: number;
    high95: number;
};

export type MonteCarloUncertaintyPoint = {
    distanceM: number;
    available: boolean;
    speedMps: UncertaintyInterval;
    energyJ: UncertaintyInterval;
    momentumKgms: UncertaintyInterval;
    timeS: UncertaintyInterval;
    dropM: UncertaintyInterval;
    pathM: UncertaintyInterval;
    holdoverRad: UncertaintyInterval;
    windDriftM: UncertaintyInterval;
};

export type MonteCarloTrajectoryUncertainty = {
    method: 'monte_carlo';
    confidenceLevel: 0.95;
    status: 'complete' | 'partial' | 'no_inputs' | 'baseline_unavailable';
    seed: number;
    requestedSampleCount: number;
    completedSampleCount: number;
    maximumSplitQuantileDelta: number;
    points: MonteCarloUncertaintyPoint[];
};

export type TrajectoryUncertainty =
    | FirstOrderTrajectoryUncertainty
    | MonteCarloTrajectoryUncertainty;

export type TrajectoryEventStatus =
    | 'complete'
    | 'horizon_limited'
    | 'baseline_unavailable'
    | 'not_applicable';

export type MachCrossing = {
    mach: 0.8 | 1 | 1.2;
    distanceM: number;
    direction: 'accelerating' | 'decelerating';
};

export type TrajectoryEvents = {
    analyzedDistanceM: number;
    zeroCrossingsStatus: Exclude<TrajectoryEventStatus, 'not_applicable'>;
    nearZeroM: number | null;
    farZeroM: number | null;
    maximumOrdinateStatus: Exclude<TrajectoryEventStatus, 'not_applicable'>;
    maximumOrdinateDistanceM: number | null;
    maximumOrdinatePathM: number | null;
    supersonicRangeStatus: TrajectoryEventStatus;
    supersonicRangeM: number | null;
    groundIntersectionStatus: Exclude<TrajectoryEventStatus, 'not_applicable'>;
    groundIntersectionM: number | null;
    machCrossings: MachCrossing[];
};

export type BuckshotPatternResult = {
    status: 'validated_in_domain' | 'extrapolated';
    choke: BuckshotPatternRequest['choke'];
    deformationClass: BuckshotPatternRequest['deformationClass'];
    pelletVelocityStandardDeviationMps: number;
    fittedAngularDiameterRad: number;
    angularStandardUncertaintyRad: number;
    calibrationRmseM: number;
    holdoutRmseM: number;
    reducedChiSquare: number;
    calibrationRangeMinM: number;
    calibrationRangeMaxM: number;
    targetRangeM: number;
    predictedDiameter90M: number;
    predictedDiameter90Low95M: number;
    predictedDiameter90High95M: number;
    perPelletHitProbability: number;
    perPelletHitProbabilityLow95: number;
    perPelletHitProbabilityHigh95: number;
    expectedPelletCount: number;
    minimumPelletCount: number;
    probabilityAtLeastMinimum: number;
    pelletCountProbabilities: number[];
    residuals: Array<{
        rangeM: number;
        measuredDiameter90M: number;
        predictedDiameter90M: number;
        residualM: number;
        normalizedResidual: number;
        role: 'calibration' | 'holdout';
    }>;
    validityStatement: string;
};

export type Load = {
    id: string;
    name: string;
    shortName: string;
    dragModel: 'G1' | 'G7' | 'MachCd' | 'Sphere';
    firearmGroup: 'rifle' | 'shotgun';
    massKg: number;
    muzzleVelocityMps: number;
    ballisticCoefficient: number;
    ballisticCoefficientBands: Array<{
        minimumVelocityMps: number;
        ballisticCoefficient: number;
    }>;
    dragReferenceDiameterM: number;
    machCdPoints: MachCdPoint[];
    bcKind: string;
    sphereDiameterM: number;
    materialDensityKgM3: number;
    pelletCount: number;
    source: 'builtIn' | 'custom';
    requestedDistanceM: number;
    coveredDistanceM: number;
    trajectoryStatus:
        | 'complete'
        | 'ground_impact'
        | 'minimum_forward_speed'
        | 'maximum_time'
        | 'maximum_steps'
        | 'horizontal_reversal'
        | 'non_finite_state';
    solutionHorizonM: number;
    solverDiagnostics: {
        mode: 'adaptive_time';
        attemptedSteps: number;
        acceptedSteps: number;
        rejectedSteps: number;
        minimumAcceptedTimeStepS: number;
        maximumAcceptedTimeStepS: number;
        finalTimeStepS: number;
        maximumErrorNorm: number;
    };
    dragValidity: {
        status: 'within_domain' | 'extrapolated' | 'not_declared';
        supportedMachMin: number | null;
        supportedMachMax: number | null;
        supportedReynoldsMin: number | null;
        supportedReynoldsMax: number | null;
        observedMachMin: number | null;
        observedMachMax: number | null;
        observedReynoldsMin: number | null;
        observedReynoldsMax: number | null;
    };
    mpbrStatus?: 'complete' | 'horizon_limited' | 'no_solution' | 'invalid_geometry';
    zeroM: number | null;
    mpbrM: number | null;
    sightHeightM: number;
    sightZeroM: number;
    boreElevationRad: number | null;
    zeroErrorM: number | null;
    zeroingStatus: 'complete' | 'range_unavailable' | 'no_solution' | 'invalid_geometry';
    dropAtSightZeroM: number | null;
    spinDriftStatus:
        | 'available'
        | 'not_applicable'
        | 'missing_geometry'
        | 'invalid_stability'
        | 'unstable'
        | 'outside_empirical_domain';
    effectiveTwistInches: number;
    gyroscopicStability: number | null;
    trajectoryEvents: TrajectoryEvents;
    uncertainty: TrajectoryUncertainty | null;
    buckshotPattern: BuckshotPatternResult | null;
    points: Point[];
};

export type Result = {
    protocolVersion: typeof PROTOCOL_VERSION;
    engineVersion: string;
    modelVersion: string;
    requestId: string;
    ok: true;
    issues: ValidationIssue[];
    atmosphere: {
        densityKgM3: number;
        speedOfSoundMps: number;
        viscosityPaS: number;
        densityModel: 'ideal_moist_air_mixture';
        speedOfSoundModel: 'cramer_1993_400_ppm_co2';
        viscosityModel: 'sutherland_110_333_k';
        densityWithinDeclaredDomain: boolean;
        soundSpeedWithinDeclaredDomain: boolean;
        viscosityWithinDeclaredDomain: boolean;
        altitudeBehavior: 'homogeneous_at_firing_point' | 'icao_lapse_from_firing_point';
    };
    scenarioModel: {
        targetInclinationRad: number;
        geometricAltitudeM: number;
        localGravity: boolean;
        coriolis: boolean;
        latitudeDeg: number;
        azimuthDeg: number;
        windLayerCount: number;
    };
    loads: Load[];
};

export type CalibrationEstimate = {
    minimumVelocityMps: number;
    ballisticCoefficient: number;
    confidence95Low: number | null;
    confidence95High: number | null;
};

export type CalibrationResidual = {
    distanceM: number;
    measuredVelocityMps: number;
    predictedVelocityMps: number;
    residualMps: number;
    normalizedResidual: number;
    standardDeviationMps: number;
    role: 'calibration' | 'holdout';
};

export type CalibrationResult = {
    protocolVersion: typeof PROTOCOL_VERSION;
    engineVersion: string;
    modelVersion: string;
    requestId: string;
    ok: true;
    operation: 'calibrateReferenceBc';
    issues: ValidationIssue[];
    calibration: {
        curve: 'G1' | 'G7';
        fitKind: 'constant' | 'velocityBands';
        status: 'converged' | 'maximum_iterations' | 'insufficient_information' | 'solver_failure';
        iterations: number;
        objectiveEvaluations: number;
        calibrationRmseMps: number;
        weightedRmse: number;
        holdoutRmseMps: number | null;
        reducedChiSquare: number;
        hasHoldout: boolean;
        validationClaimAvailable: boolean;
        estimates: CalibrationEstimate[];
        residuals: CalibrationResidual[];
    };
};

export type ErrorResult = {
    protocolVersion: typeof PROTOCOL_VERSION;
    engineVersion: string;
    modelVersion: string;
    requestId: string;
    ok: false;
    issues: ValidationIssue[];
};
