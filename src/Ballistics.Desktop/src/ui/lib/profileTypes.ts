import type { CustomDraft, Inputs, Load, UncertaintySettings, UnitSystem } from '../types';
import { PRODUCT_LIMITS, PROFILE_INTERCHANGE_VERSION } from '../../../shared/productIdentity';

export const PROFILE_FORMAT = 'ballistics-workbench-profile-set';
export const PROFILE_SCHEMA_VERSION = PROFILE_INTERCHANGE_VERSION;
export const MAX_NAMED_PROFILES = 64;
export const MAX_PROFILE_DOCUMENT_BYTES = PRODUCT_LIMITS.profileDocumentBytes;
export const MAX_QUARANTINED_PROFILES = 20;

export type ProfileKind = 'environment' | 'firearm' | 'ammunition' | 'combinedScenario';
export type ProfileConflictPolicy = 'rename' | 'replace' | 'skip';

export type EnvironmentProfileData = Pick<
    Inputs,
    | 'temperatureC'
    | 'pressureHpa'
    | 'pressureSource'
    | 'pressureAltitudeM'
    | 'geometricAltitudeM'
    | 'altimeterSettingHpa'
    | 'humidityPercent'
    | 'headwindMps'
    | 'crosswindMps'
    | 'altitudeDependentAtmosphere'
    | 'useLocalGravity'
    | 'coriolisEnabled'
    | 'latitudeDeg'
    | 'azimuthDeg'
    | 'windLayers'
    | 'windProvenance'
>;

export type FirearmProfileData =
    | {
          group: 'shotgun';
          sightHeightM: number;
          zeroRangeM: number;
          muzzleVelocityMultiplier: number;
          temperatureVelocityProfile: Inputs['shotgunTemperatureVelocityProfile'];
          temperatureVelocitySource: string;
      }
    | {
          group: 'rifle';
          sightHeightM: number;
          zeroRangeM: number;
          muzzleVelocityMultiplier: number;
          twistInches: number;
          twistDirection: number;
          temperatureVelocityProfile: Inputs['rifleTemperatureVelocityProfile'];
          temperatureVelocitySource: string;
      };

export type AmmunitionProfileData =
    | { selection: 'builtIn'; loadId: string }
    | { selection: 'custom'; load: CustomDraft };

export type CombinedScenarioProfileData = {
    inputs: Inputs;
    uncertainty: UncertaintySettings;
    customLoads: CustomDraft[];
    selectedLoadId: string | null;
    preferredUnits: UnitSystem;
};

type NamedProfileBase = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
};

export type EnvironmentProfile = NamedProfileBase & {
    kind: 'environment';
    data: EnvironmentProfileData;
};

export type FirearmProfile = NamedProfileBase & {
    kind: 'firearm';
    data: FirearmProfileData;
};

export type AmmunitionProfile = NamedProfileBase & {
    kind: 'ammunition';
    data: AmmunitionProfileData;
};

export type CombinedScenarioProfile = NamedProfileBase & {
    kind: 'combinedScenario';
    data: CombinedScenarioProfileData;
};

export type NamedProfile =
    | EnvironmentProfile
    | FirearmProfile
    | AmmunitionProfile
    | CombinedScenarioProfile;

export type ProfileDocument = {
    format: typeof PROFILE_FORMAT;
    schemaVersion: typeof PROFILE_SCHEMA_VERSION;
    exportedAt: string;
    unitConvention: 'SI';
    profiles: NamedProfile[];
};

export type QuarantinedProfile = {
    id: string;
    sourceName: string;
    reason: string;
    importedAt: string;
    rawJson: string;
};

export type ProfileCaptureContext = {
    inputs: Inputs;
    uncertainty: UncertaintySettings;
    customLoads: CustomDraft[];
    availableLoadIds: string[];
    selectedLoad: Load | undefined;
    selectedLoadId: string | null;
    preferredUnits: UnitSystem;
};

export type ProfileApplication = {
    ok: boolean;
    inputs: Inputs;
    uncertainty: UncertaintySettings;
    customLoads: CustomDraft[];
    selectedLoadId: string | null;
    preferredUnits: UnitSystem;
    message: string;
};

export type ProfileImportSummary = {
    added: number;
    replaced: number;
    renamed: number;
    skipped: number;
    quarantined: number;
    migrated: number;
};

export type ProfileImportResult = {
    profiles: NamedProfile[];
    quarantine: QuarantinedProfile[];
    summary: ProfileImportSummary;
};

export class ProfileDocumentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProfileDocumentError';
    }
}
