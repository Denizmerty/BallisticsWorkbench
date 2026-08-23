import type {
    CalculationRequest,
    CustomDraft,
    CustomLoadRequest,
    Inputs,
    Result,
    UncertaintySettings,
} from '../types';
import { parseCalculationResponse } from './protocol';
import { PROTOCOL_VERSION } from '../../../shared/productIdentity';

export function customToRequest(draft: CustomDraft): CustomLoadRequest {
    const common = {
        id: draft.id,
        name: draft.name,
        firearmGroup: draft.group,
        muzzleVelocityMps: draft.mv,
        pelletCount: draft.count,
        ...(draft.group === 'rifle'
            ? {
                  bulletGeometry: {
                      lengthInches: draft.length,
                      diameterInches: draft.diameter,
                      twistInches: draft.twist,
                  },
              }
            : {}),
    };
    if (draft.drag === 'Sphere') {
        return {
            ...common,
            drag: {
                kind: 'sphere',
                diameterM: draft.sphereMm / 1000,
                materialDensityKgM3: draft.density,
            },
        };
    }
    if (draft.drag === 'MachCd') {
        return {
            ...common,
            massKg: draft.massG / 1000,
            drag: {
                kind: 'tabulatedCd',
                referenceDiameterM: draft.machCdDiameterMm / 1000,
                points: draft.machCdPoints,
            },
        };
    }
    return {
        ...common,
        massKg: draft.massG / 1000,
        drag: {
            kind: 'referenceBc',
            curve: draft.drag,
            ...(draft.bcMode === 'velocityBands'
                ? { velocityBands: draft.bcBands }
                : { ballisticCoefficient: draft.bc }),
        },
    };
}

export function createCalculationRequest(
    inputs: Inputs,
    customLoads: CustomDraft[],
    requestId: string,
    uncertainty?: UncertaintySettings,
): CalculationRequest {
    return {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        scenario: {
            displayDistanceM: inputs.distanceM,
            solutionHorizonM: 2000,
            vitalZoneM: inputs.vitalZoneM,
            geometry: {
                ...(Math.abs(inputs.targetElevationM) > 1e-12
                    ? { targetElevationM: inputs.targetElevationM }
                    : { targetInclinationDeg: inputs.targetInclinationDeg }),
            },
            atmosphere: {
                temperatureC: inputs.temperatureC,
                stationPressureHpa: inputs.pressureHpa,
                relativeHumidityPercent: inputs.humidityPercent,
                headwindMps: inputs.headwindMps,
                crosswindMps: inputs.crosswindMps,
                geometricAltitudeM: inputs.geometricAltitudeM,
                altitudeDependent: inputs.altitudeDependentAtmosphere,
                useLocalGravity: inputs.useLocalGravity,
                coriolisEnabled: inputs.coriolisEnabled,
                latitudeDeg: inputs.latitudeDeg,
                azimuthDeg: inputs.azimuthDeg,
                windLayers: inputs.windLayers,
                windProvenance: inputs.windProvenance,
            },
            firearms: {
                shotgun: {
                    sightHeightM: inputs.shotgunSightM,
                    zeroRangeM: inputs.shotgunZeroM,
                    muzzleVelocityMultiplier: inputs.shotgunMvMultiplier,
                    ...(inputs.shotgunTemperatureVelocityProfile.length >= 2
                        ? {
                              temperatureVelocityProfile: inputs.shotgunTemperatureVelocityProfile,
                              temperatureVelocitySource: inputs.shotgunTemperatureVelocitySource,
                          }
                        : {}),
                },
                rifle: {
                    sightHeightM: inputs.rifleSightM,
                    zeroRangeM: inputs.rifleZeroM,
                    muzzleVelocityMultiplier: inputs.rifleMvMultiplier,
                    twistInches: inputs.rifleTwistInches,
                    twistDirection: inputs.twistDirection,
                    ...(inputs.rifleTemperatureVelocityProfile.length >= 2
                        ? {
                              temperatureVelocityProfile: inputs.rifleTemperatureVelocityProfile,
                              temperatureVelocitySource: inputs.rifleTemperatureVelocitySource,
                          }
                        : {}),
                },
            },
            ...(uncertainty?.enabled
                ? {
                      uncertainty: {
                          method: uncertainty.method,
                          sampleCount: uncertainty.sampleCount,
                          seed: uncertainty.seed,
                          correlations: uncertainty.correlations,
                          shotgunMuzzleVelocityStandardDeviationMps:
                              uncertainty.shotgunMuzzleVelocityStandardDeviationMps,
                          rifleMuzzleVelocityStandardDeviationMps:
                              uncertainty.rifleMuzzleVelocityStandardDeviationMps,
                          dragRelativeStandardDeviation: uncertainty.dragRelativeStandardDeviation,
                          temperatureStandardDeviationC: uncertainty.temperatureStandardDeviationC,
                          stationPressureStandardDeviationHpa:
                              uncertainty.stationPressureStandardDeviationHpa,
                          headwindStandardDeviationMps: uncertainty.headwindStandardDeviationMps,
                          crosswindStandardDeviationMps: uncertainty.crosswindStandardDeviationMps,
                          shotgunZeroRangeStandardDeviationM:
                              uncertainty.shotgunZeroRangeStandardDeviationM,
                          rifleZeroRangeStandardDeviationM:
                              uncertainty.rifleZeroRangeStandardDeviationM,
                      },
                  }
                : {}),
            ...(inputs.buckshotPattern.enabled
                ? {
                      buckshotPattern: {
                          loadId: inputs.buckshotPattern.loadId,
                          choke: inputs.buckshotPattern.choke,
                          deformationClass: inputs.buckshotPattern.deformationClass,
                          pelletVelocityStandardDeviationMps:
                              inputs.buckshotPattern.pelletVelocityStandardDeviationMps,
                          targetRangeM: inputs.buckshotPattern.targetRangeM,
                          minimumPelletCount: inputs.buckshotPattern.minimumPelletCount,
                          target: inputs.buckshotPattern.target,
                          observations: inputs.buckshotPattern.observations,
                      },
                  }
                : {}),
        },
        customLoads: customLoads.map(customToRequest),
    };
}

export async function calculate(
    request: CalculationRequest,
    signal?: AbortSignal,
): Promise<Result> {
    if (signal?.aborted) throw new DOMException('Calculation cancelled', 'AbortError');
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
    return parseCalculationResponse(raw, request.requestId);
}

export async function calculateAll(
    inputs: Inputs,
    customLoads: CustomDraft[],
    requestId = 'calculation',
    signal?: AbortSignal,
    uncertainty?: UncertaintySettings,
): Promise<Result> {
    return calculate(createCalculationRequest(inputs, customLoads, requestId, uncertainty), signal);
}
