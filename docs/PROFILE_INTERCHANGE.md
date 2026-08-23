# Profile Interchange

Ballistics Workbench can save named environment, firearm, ammunition, and combined-scenario
profiles. Profiles are persisted locally and can be exchanged as bounded, versioned JSON files.
The interchange contract is separate from the native calculation protocol. Importing a profile
changes renderer inputs, after which the ordinary version 2 calculation request is built and
validated normally.

The authoritative machine-readable contract is
[`protocol/ballistics-profile-interchange.schema.json`](../protocol/ballistics-profile-interchange.schema.json).
The current profile format is `ballistics-workbench-profile-set`, schema version `4`, and all
physical quantities are stored in SI units regardless of the interface's selected display units.

## Profile kinds

### Environment

An environment profile captures:

- temperature
- resolved station pressure
- the selected pressure-source mode
- pressure altitude
- geometric field elevation
- altimeter setting
- relative humidity
- headwind
- crosswind
- altitude-dependent-atmosphere selection
- local-gravity and Coriolis settings
- latitude and firing azimuth
- ordered wind layers and their provenance.

Applying it does not alter display distance, vital-zone geometry, firearm settings, uncertainty,
custom loads, the selected load, or display units. The inactive pressure-source fields are retained
so switching pressure modes after application remains deterministic.

### Firearm

A firearm profile targets either the shotgun or rifle group. Both groups store sight height,
sight-zero range, muzzle-velocity multiplier, temperature/multiplier profile, and the profile's
source description. A rifle profile also stores twist rate and twist direction. Applying one group
does not alter the other group, atmosphere, geometry, ammunition, uncertainty, or display units.

### Ammunition

An ammunition profile captures the selected load:

- a built-in load is stored as its stable `builtin:` identifier, or
- a custom load is stored by value, including its stable `custom:` identifier, drag model, BC
  schedule or Mach–Cd editor data, physical dimensions, muzzle velocity, firearm group, and payload
  count. Current documents also retain drag-data citation, URL, license, optional source checksum,
  and declared-domain metadata.

When a custom ammunition profile is applied, an active custom load with the same ID is replaced. If
the ID differs but the name matches case-insensitively, that same-name load is replaced while its
active stable ID is retained. Otherwise, the load is appended. Applying a fourth distinct custom
load is rejected without evicting any current load.

### Combined scenario

A combined scenario is an atomic snapshot of:

- all calculation inputs
- the complete first-order or Monte Carlo uncertainty configuration, including seed and
  correlations
- target geometry, atmosphere layers, and temperature-sensitive muzzle-velocity inputs
- an optional empirical buckshot pattern configuration and its calibration/holdout observations
- up to three custom loads
- the selected built-in or included custom load identifier
- the preferred metric or imperial presentation mode.

Applying a combined scenario replaces those values together. Theme, open tab, chart metric, and
other transient interface choices are not part of a physical scenario.

## Document envelope

A current interchange file has this top-level shape:

```json
{
    "format": "ballistics-workbench-profile-set",
    "schemaVersion": 4,
    "exportedAt": "2026-08-18T12:00:00.000Z",
    "unitConvention": "SI",
    "profiles": []
}
```

The actual schema requires between one and 64 profiles. The empty array above illustrates only the
envelope fields and is not itself importable. Unknown envelope, profile, state, drag-table, or
firearm members are rejected, which catches misspelled field names.

Every named profile contains:

- a stable `profile:` identifier
- a nonblank name of at most 80 characters
- one of the four declared kinds
- UTC creation and update timestamps
- kind-specific data.

Numeric bounds match the renderer's accepted physical-input domain. Custom loads also pass
the same semantic validator used by the editor, including payload integer rules, ordered velocity
bands, ordered Mach–Cd knots, positive coefficients, and applicable geometry bounds. A document is
limited to 1 MiB, 64 profiles, three custom loads per scenario, 16 BC bands per load, and 64 Mach–Cd
points per load.

## Import conflicts

The import dialog requires one explicit conflict policy. A conflict means either the stable profile
ID already exists or another profile of the same kind has the same case-insensitive name.

- **Keep both** assigns the imported profile a new stable ID and a deterministic `(2)`, `(3)`, …
  name suffix.
- **Replace existing** replaces the conflicting profile's data while retaining its local stable ID
  and original creation time. The update timestamp records the import time.
- **Skip imported conflict** leaves the existing profile unchanged and reports the skipped count.

Imports report added, renamed, replaced, skipped, quarantined, and migrated counts separately.
Creating a local duplicate uses the same deterministic name-suffix behavior. The local collection
never exceeds 64 profiles.

## Migration

The current importer recognizes profile-interchange versions 1 through 3 and former
persisted-settings envelopes. A version-1 portable profile receives explicit `User-entered data` /
`Unspecified` drag provenance with an undeclared domain. Later missing fields receive the historical
defaults for advanced environment, uncertainty method, correlations, temperature-sensitive muzzle
velocity, and buckshot pattern analysis. A valid legacy settings envelope is converted to one named
combined-scenario profile called `Imported legacy settings`.

Pre-version-3 custom loads receive deterministic stable IDs. Pre-version-4 scalar BC loads receive
constant-BC editor data, and pre-Mach–Cd-editor loads receive the former default curve and reference
diameter. The former single altitude field is migrated to both stored altitude representations
without changing the pressure-source interpretation. The migrated state is decoded again through
the current profile contract, so legacy recognition never bypasses current validation.

Settings persistence is schema version 11. Loading versions 2–10 migrates each known field and
supplies defaults for capabilities introduced after that version. It also initializes absent named
profile and quarantine collections.

Supported older documents report a migrated count. Unsupported interchange schema versions are
rejected at the envelope boundary. They are not
treated as current documents with ignored fields.

## Quarantine and recovery

Malformed individual entries do not prevent valid sibling profiles from importing. Each invalid
entry is excluded from application and placed in a bounded quarantine with:

- its source name when available
- the precise validation diagnostic
- the import timestamp
- up to 16 KiB of its original JSON representation.

The application retains the newest 20 quarantine records. The profile manager can export a
quarantine recovery envelope containing the diagnostic and original JSON text before the user
clears it. Recovery envelopes are diagnostic files and cannot be applied to a calculation.
Malformed profiles discovered while loading local settings enter the same quarantine, where the
user can inspect them.

## Desktop file boundary

The sandboxed renderer never receives direct filesystem access. The context-isolated preload
exposes only bounded open/save operations. The Electron main process:

- accepts IPC only from the registered application main frame
- uses native open/save dialogs
- reads at most 1 MiB plus one detection byte
- validates the filename and top-level envelope before returning content
- rejects unsupported formats and over-limit files
- writes UTF-8 only after validating the export envelope and filename.

Normal files use `.bwprofile.json`. Plain `.json` is accepted for migration. Quarantine recovery
uses `.quarantine.json`. Path separators, control characters, and reserved filename characters are
not accepted in suggested export names.

## Verification

The automated suite covers:

- all four capture and application paths
- selective application without unrelated-state loss
- atomic combined-scenario restoration
- built-in and custom ammunition behavior
- the three-custom-load refusal path
- schema-valid serialization and byte-for-byte logical round trips
- all three conflict policies
- deterministic duplicate naming and collection limits
- settings schema 2-to-11 and portable profile versions 1-to-4 migration
- legacy settings-envelope import
- invalid sibling quarantine and JSON recovery metadata
- unknown fields, unsupported versions, invalid timestamps, invalid JSON, and oversize documents
  and
- Electron filename, envelope, and size guards.

Run `npm test`, `npm run build`, `npm run format:check`, and `npm run validate:artifacts` after
changing the profile contract. A schema change requires an explicit schema-version decision and a
documented migration. An older version's accepted semantics must stay unchanged without a version
update.
