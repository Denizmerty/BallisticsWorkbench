export type Inputs = {
  distanceM: number;
  temperatureC: number;
  pressureHpa: number;
  humidityPercent: number;
  altitudeM: number;
  headwindMps: number;
  vitalZoneM: number;
  shotgunSightM: number;
  rifleSightM: number;
  shotgunMvMultiplier: number;
  rifleMvMultiplier: number;
  rifleTwistInches: number;
  twistDirection: number;
  customName?: string;
  customDrag?: string;
  customGroup?: string;
  customMassKg?: number;
  customMuzzleVelocityMps?: number;
  customBc?: number;
  customSphereDiameterM?: number;
  customDensityKgM3?: number;
  customPelletCount?: number;
  customBulletLengthInches?: number;
  customBulletDiameterInches?: number;
  customTwistInches?: number;
};
export type Point = {
  distanceM: number;
  speedMps: number;
  energyJ: number;
  momentumKgms: number;
  timeS: number;
  dropM: number;
  mach: number;
  spinDriftM: number;
  cd?: number;
  reynolds?: number;
};
export type Load = {
  name: string;
  shortName: string;
  dragModel: string;
  firearmGroup: string;
  massKg: number;
  muzzleVelocityMps: number;
  ballisticCoefficient: number;
  bcKind: string;
  sphereDiameterM: number;
  materialDensityKgM3: number;
  pelletCount: number;
  zeroM: number;
  mpbrM: number;
  points: Point[];
};
export type Result = {
  atmosphere: { densityKgM3: number; speedOfSoundMps: number; viscosityPaS: number };
  loads: Load[];
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
  | 'spinDriftM';
export type CustomDraft = {
  name: string;
  drag: string;
  group: string;
  massG: number;
  mv: number;
  bc: number;
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
      calculate(input: Inputs): Promise<Result>;
      saveCsv(content: string, defaultName: string): Promise<boolean>;
      onAddCustom(callback: () => void): () => void;
      onExportCsv(callback: () => void): () => void;
      onOpenHelp(callback: () => void): () => void;
      onResetAtmosphere(callback: () => void): () => void;
      onToggleTheme(callback: () => void): () => void;
      onToggleUnits(callback: () => void): () => void;
    };
  }
}
