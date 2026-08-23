import type {
    MachCdPoint,
    BuckshotPatternRequest,
    ProtocolRequest,
    TemperatureVelocityPointRequest,
    UncertaintyRequest,
    WindLayerRequest,
} from '../../shared/protocol';

export type * from '../../shared/protocol';

export type PressureSource = 'stationPressure' | 'pressureAltitude' | 'altimeterSetting';

export type Inputs = {
    distanceM: number;
    temperatureC: number;
    pressureHpa: number;
    pressureSource: PressureSource;
    pressureAltitudeM: number;
    geometricAltitudeM: number;
    altimeterSettingHpa: number;
    humidityPercent: number;
    headwindMps: number;
    crosswindMps: number;
    altitudeDependentAtmosphere: boolean;
    useLocalGravity: boolean;
    coriolisEnabled: boolean;
    latitudeDeg: number;
    azimuthDeg: number;
    targetInclinationDeg: number;
    targetElevationM: number;
    windLayers: WindLayerRequest[];
    windProvenance: string;
    vitalZoneM: number;
    shotgunSightM: number;
    rifleSightM: number;
    shotgunZeroM: number;
    rifleZeroM: number;
    shotgunMvMultiplier: number;
    rifleMvMultiplier: number;
    rifleTwistInches: number;
    twistDirection: number;
    shotgunTemperatureVelocityProfile: TemperatureVelocityPointRequest[];
    rifleTemperatureVelocityProfile: TemperatureVelocityPointRequest[];
    shotgunTemperatureVelocitySource: string;
    rifleTemperatureVelocitySource: string;
    buckshotPattern: BuckshotPatternRequest & { enabled: boolean };
};

export type UncertaintySettings = UncertaintyRequest & {
    enabled: boolean;
};

export type UnitSystem = 'metric' | 'imperial';

export type Metric =
    | 'speedMps'
    | 'energyJ'
    | 'payloadEnergy'
    | 'momentumKgms'
    | 'payloadMomentum'
    | 'dropM'
    | 'timeS'
    | 'spinDriftM'
    | 'windDriftM'
    | 'windageM'
    | 'sightPathM'
    | 'holdoverMoa';

export type DragDataMetadata = {
    citation: string;
    sourceUrl: string;
    license: string;
    sourceChecksumSha256: string;
    domainMinimum: number | null;
    domainMaximum: number | null;
};

export type CustomDraft = {
    id: string;
    name: string;
    drag: 'G1' | 'G7' | 'MachCd' | 'Sphere';
    group: 'rifle' | 'shotgun';
    massG: number;
    mv: number;
    bc: number;
    bcMode: 'constant' | 'velocityBands';
    bcBands: Array<{ minimumVelocityMps: number; ballisticCoefficient: number }>;
    machCdDiameterMm: number;
    machCdPoints: MachCdPoint[];
    dragDataMetadata: DragDataMetadata;
    sphereMm: number;
    density: number;
    count: number;
    length: number;
    diameter: number;
    twist: number;
};

declare global {
    interface Window {
        ballistics?: {
            calculate(request: ProtocolRequest): Promise<unknown>;
            cancelCalculation(requestId: string): void;
            saveCsv(content: string, defaultName: string): Promise<boolean>;
            saveProfiles(content: string, defaultName: string): Promise<boolean>;
            openProfiles(): Promise<{ content: string; fileName: string } | null>;
            saveDragData(content: string, defaultName: string): Promise<boolean>;
            openDragData(): Promise<{ content: string; fileName: string } | null>;
            onAddCustom(callback: () => void): () => void;
            onExportCsv(callback: () => void): () => void;
            onExportProfiles(callback: () => void): () => void;
            onImportProfiles(callback: () => void): () => void;
            onOpenHelp(callback: () => void): () => void;
            onOpenProfiles(callback: () => void): () => void;
            onResetAtmosphere(callback: () => void): () => void;
            onToggleTheme(callback: () => void): () => void;
            onToggleUnits(callback: () => void): () => void;
        };
    }
}
