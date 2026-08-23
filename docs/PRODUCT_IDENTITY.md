# Product identity and protocol ownership

Ballistics Workbench has one authoritative identity document:
`config/product-metadata.json`. Application, engine, model, protocol, profile-interchange,
drag-data-interchange, settings, and cross-process byte-limit declarations must be changed there
first.

The metadata document is validated by `config/product-metadata.schema.json`. Unknown fields,
malformed semantic/model versions, non-positive schema versions, incomplete limits, and implausibly
small byte limits are rejected.

## Authoritative fields

| Field                        | Meaning                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `applicationVersion`         | Desktop package, release tag, CMake project, and native engine version |
| `modelVersion`               | Numerical/model behavior and validation-artifact identity              |
| `protocolVersion`            | Native stdin/stdout request and response contract                      |
| `profileInterchangeVersion`  | Portable named-profile JSON contract                                   |
| `dragDataInterchangeVersion` | Portable G1/G7 BC and Mach–Cd JSON contract                            |
| `settingsSchemaVersion`      | Local renderer persistence/migration contract                          |
| `limits`                     | Calculation, response, profile, drag-data, and CSV byte ceilings       |

The engine uses the application version. It is derived from that value and cannot be edited
separately. The model version remains independent because model or data semantics can change
without a protocol change.

## Generated and derived consumers

Run:

```text
npm run identity:generate
```

The deterministic generator synchronizes:

- Root npm package and lockfile versions
- Every protocol-version declaration and the versioned ID/title in the protocol JSON Schema
- The profile-interchange JSON Schema version
- The drag-data-interchange JSON Schema version
- Valid and unsupported-version native protocol fixtures
- Validation manifest, built-in inventory, flight matrix, and fit-definition model identities
- `src/Ballistics.Desktop/shared/productIdentity.ts` for Electron and renderer code

The generator formats JSON consumers with the lockfile-pinned Prettier implementation before
comparison or writing. Re-running it without changing metadata is idempotent.

CMake reads the metadata JSON at configure time. It sets the project version and configures
`build/generated/ballistics/product_identity.hpp`. Every first-party target receives that generated
include path through `Ballistics.BuildOptions`. The core and protocol cannot compile with an
independently maintained engine, model, protocol, or request-limit literal.

## Drift gate

Run:

```text
npm run identity:check
```

The check validates the metadata against its JSON Schema, independently applies stricter semantic
checks, renders every generated consumer in memory, and fails with the exact stale paths if any
consumer differs.

The gate runs before:

- Renderer and Electron tests
- Production web builds
- Native configure, build, and test orchestration
- Local release builds
- CI builds
- Release-tag verification and asset assembly

A stale generated consumer stops the build before it can produce an installer with mismatched
package, native, protocol, or validation identities.

## Shared TypeScript protocol DTOs

`src/Ballistics.Desktop/shared/protocol.ts` is the TypeScript owner for calculation/calibration
requests, success/error responses, load results, trajectory events, uncertainty results, and drag
request variants. It is imported by the renderer through the compatibility exports in
`src/Ballistics.Desktop/src/ui/types.ts`, and it is available to the Electron boundary without
copying DTO declarations.

Protocol-version fields use `typeof PROTOCOL_VERSION`, so changing the authoritative protocol
version changes the TypeScript literal type. Runtime Electron and renderer guards compare against
the same generated constant. JSON Schema contract tests verify that every schema declaration and
checked-in request fixture agrees with the metadata version.

Runtime response validation remains handwritten because it checks semantics and relationships that
basic structural typing cannot express. A future generator may own the structural portion while the
current semantic checks stay in place.

## Byte-limit ownership

Cross-process/file limits are contract values stored beside the
versions. Current consumers include:

- Native maximum request size
- Electron request serialization and engine-output collection
- Vite development middleware request/output collection
- Electron and renderer profile and drag-data import/export boundaries
- Electron CSV export

Human-readable errors still describe the current MiB values. If a limit changes to a value that no
longer matches those descriptions, update the messages in the same change.

## Version-change procedure

1. Edit only the appropriate fields in `config/product-metadata.json`.
2. Run `npm run identity:generate`.
3. Review every generated diff. A model-version change must correspond to a real model/data change
   and updated validation evidence. Generation cannot supply missing scientific evidence.
4. Update human-facing release notes and model documentation where the new identity matters.
5. Run `npm test`, the native preset, artifact validation, and packaging smoke tests.
6. Run `npm run identity:check` once more before committing or tagging.

Do not manually repair an individual generated consumer. It will either be overwritten on the next
generation or rejected as drift.

## Other version numbers

The following numbers are not product identities and are not generated from this document:

- Validation artifact schema versions
- Release-manifest and SBOM schema versions
- Profile quarantine-envelope version
- Numerical report schema versions
- Historical version strings in the changelog and documentation

Those values describe their own file formats or historical releases. They should change only when
their corresponding contract changes.
