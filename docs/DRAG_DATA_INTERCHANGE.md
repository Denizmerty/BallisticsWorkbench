# Drag-data interchange

Ballistics Workbench can exchange the drag portion of a custom projectile independently from its
mass, muzzle velocity, firearm assignment, payload count, and stable load identity. A portable file
therefore carries a G1/G7 ballistic-coefficient definition or Mach–Cd table, not a complete firing
scenario.

The authoritative machine-readable contract is
[`protocol/ballistics-drag-data.schema.json`](../protocol/ballistics-drag-data.schema.json). The
current format is `ballistics-workbench-drag-data`, schema version 1. Documents are UTF-8 JSON and
are limited to 1 MiB.

## Supported payloads

A document contains exactly one of these drag definitions:

- a constant G1 or G7 reference ballistic coefficient
- a G1 or G7 schedule with 2–16 strictly increasing velocity bands, beginning at 0 m/s
- a Mach–Cd curve with an explicit reference diameter and 2–64 strictly increasing Mach points.

Sphere drag is calculated from projectile diameter, density, Mach number, and Reynolds number. It
is not a tabulated drag-data payload and cannot be exported through this contract. A
drag-data document may still be imported while editing a sphere load. Doing so changes that load to
the imported G1, G7, or Mach–Cd model.

Import changes only the active drag definition and its metadata. It retains the local
custom load's `custom:` ID, name, projectile mass, muzzle velocity, firearm group, payload count,
and optional rifle geometry.

## Units

Every document declares and must use these canonical units:

| Quantity                        | Serialized unit |
| ------------------------------- | --------------- |
| Velocity and BC-band thresholds | `m/s`           |
| Mach–Cd reference diameter      | `m`             |
| Mach number                     | dimensionless   |
| Drag coefficient                | dimensionless   |
| G1/G7 ballistic coefficient     | `lb/in^2`       |

The interface may display other units, but serialization and checksum calculation always use this
canonical representation. Import rejects a document that substitutes display units or omits a unit
declaration.

## Provenance metadata

The `source` object records:

- a citation or description of where the data came from
- an optional HTTP or HTTPS source URL
- the source's license or usage terms
- an optional lowercase SHA-256 checksum of the external source artifact.

User-entered data defaults to the explicit citation `User-entered data` and license `Unspecified`.
These defaults identify an evidence gap. They do not claim that the values were independently
measured or licensed for redistribution. A source checksum identifies the referenced source file,
while the separate payload checksum protects the normalized numerical payload in the interchange
document.

## Declared domain

The optional declared domain records the interval over which the producer considers the data
supported. G1/G7 definitions declare velocity in m/s, and Mach–Cd definitions declare Mach number.
Either endpoint may be `null` when it is not known.

When both endpoints are present, the minimum must be below the maximum. A Mach–Cd declared domain
must also stay within its first and last table knots. This distinction matters because the solver
can clamp to an endpoint outside a tabulated curve while still warning that the result is outside
the declared evidence domain.

## Payload integrity

`payloadChecksumSha256` is the lowercase SHA-256 digest of a canonical JSON serialization of these
three fields, in order:

1. `units`
2. `declaredDomain`
3. `drag`.

The exporter computes the digest after conversion to canonical units. The importer validates the
complete structure and numeric constraints, recomputes the digest, and refuses a mismatch before
applying any values.

The digest detects accidental corruption or modification. It is not a digital signature and does
not authenticate the publisher. Authenticity still depends on obtaining the file and any cited
source through a trusted channel.

## Example envelope

```json
{
    "format": "ballistics-workbench-drag-data",
    "schemaVersion": 1,
    "exportedAt": "2026-08-23T12:00:00.000Z",
    "name": "Example G7 schedule",
    "units": {
        "velocity": "m/s",
        "referenceDiameter": "m",
        "mach": "dimensionless",
        "dragCoefficient": "dimensionless",
        "ballisticCoefficient": "lb/in^2"
    },
    "source": {
        "citation": "Example technical sheet",
        "url": "https://example.invalid/technical-sheet",
        "license": "Used with permission",
        "checksumSha256": null
    },
    "declaredDomain": {
        "variable": "velocity",
        "minimum": 0,
        "maximum": 1000,
        "unit": "m/s"
    },
    "drag": {
        "kind": "referenceBc",
        "curve": "G7",
        "representation": "velocityBands",
        "velocityBands": [
            { "minimumVelocityMps": 0, "ballisticCoefficient": 0.37 },
            { "minimumVelocityMps": 450, "ballisticCoefficient": 0.41 },
            { "minimumVelocityMps": 800, "ballisticCoefficient": 0.45 }
        ]
    },
    "payloadChecksumSha256": "<64 lowercase hexadecimal digits>"
}
```

The placeholder checksum makes this explanatory example non-importable. A real exported file
contains the computed digest.

## Security boundary

The sandboxed renderer has no path or general filesystem access. It asks the context-isolated
preload bridge for one drag-data open or save operation. The Electron main process then:

- authorizes the request only from the registered application main frame
- uses a native single-file open or save dialog
- reads at most 1 MiB plus one oversize-detection byte
- rejects path separators, control characters, and reserved characters in suggested filenames
- checks the top-level format, current version, required objects, and checksum shape
- returns file content, never a filesystem capability, to the renderer for strict semantic and
  checksum validation.

Normal files use `.bwdrag.json`. Plain `.json` is also accepted. The renderer does not apply a
partially decoded document: every structural, semantic, domain, unit, and checksum check must pass.

## Persistence and profiles

Source and domain metadata are stored with each custom load in settings schema version 11. Profile
interchange schema version 4 includes the same metadata, so custom-ammunition and combined-scenario
profiles preserve it. Loading older settings or importing a version-1 portable profile supplies
the explicit user-entered/unspecified defaults and reports the profile migration.

## Verification

Automated coverage includes:

- JSON Schema validation of generated documents and the schema's generated version identity
- constant, banded-BC, and Mach–Cd serialization and decoding
- preservation of local projectile identity when applying imported drag data
- canonical checksum verification and tamper rejection
- unit, source, unknown-field, ordering, coefficient, and declared-domain rejection
- exact and over-limit UTF-8 byte boundaries and safe Unicode filenames
- legacy settings and portable-profile metadata migration
- desktop IPC envelope and filename guards.

Run `npm test`, `npm run build`, `npm run format:check`, and the native test preset after changing
the contract. Change `dragDataInterchangeVersion` in `config/product-metadata.json` only when the
portable contract requires a new version, then run `npm run identity:generate`.
