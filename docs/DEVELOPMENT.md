# Development Guide

## Architecture

Ballistics Workbench is divided into four build targets:

```text
React renderer
    │ context-isolated IPC
Electron main process
    │ versioned JSON over stdin/stdout
Ballistics.Cli
    │ direct library calls
Ballistics.Core
```

`Ballistics.Core` owns the physical models, model-combination validation, and numerical integration.
`Ballistics.Cli` accepts a version 2 JSON request on standard input and returns a JSON response on
standard output. The request carries every custom load, so one child process evaluates the complete
load set without per-load process launches. The Electron main process streams the request to the
CLI, while the renderer receives a narrow API from the context-isolated preload script. Renderer
calculation generations carry request IDs. Cancellation reaches the Electron main process, which
terminates the corresponding native child process. The CLI temporarily retains strict flag parsing for manual
backward compatibility, but the desktop does not use it.

Native implementation responsibilities are split across focused translation units:

- `ballistics.cpp` contains atmosphere/drag behavior and adaptive/legacy trajectory integration.
- `trajectory_analysis.cpp` owns sight zeroing, trajectory events, MPBR, and drag-domain analysis.
- `calibration.cpp`, `uncertainty.cpp`, and `projectiles.cpp` own fitting, sensitivity/spin
  calculations, and projectile validation/catalog data respectively.
- The CLI `main.cpp` is a small orchestration boundary. Standard-input collection, legacy flag
  compatibility, strict protocol parsing, and response serialization have separate modules.

The native load model uses separate types for its major concepts. `ProjectileDefinition` owns mass,
optional bullet geometry, and one `DragDefinition`. `AmmunitionLoad` owns muzzle velocity and
payload count. `FirearmConfiguration` owns firearm compatibility and an optional custom twist.
`LoadProvenance` owns stable identity/source description. `DragDefinition` is a `std::variant` of
`ReferenceBcDrag`, `TabulatedDrag`, and `SphereDrag`, while reference BC state is itself exactly one
constant or velocity-banded definition. Switching models discards the previous model's
state structurally. Protocol responses retain their legacy compatibility fields, derived from
the active variant at serialization time.

The renderer follows the same structure. `App.tsx` coordinates application state and modal/workspace
selection. Environment/firearm/zeroing/uncertainty inputs, range tables, comparisons, toolbar,
custom-load editing, profiles, and status text live behind separate components or view-model
modules. Profile interchange separates public types, strict decoding, and workflow operations.
Portable drag-data interchange has a similarly isolated codec: `dragData.ts` owns canonical units,
strict decoding, SHA-256 payload integrity, and application to a custom-load draft, while the
custom-projectile dialog owns only editor presentation. Styles retain their original cascade order
through a five-line `styles.css` entry point importing
foundation, shell, results, dialogs, and theme/responsive modules.

The canonical protocol description is `protocol/ballistics-protocol.schema.json`. Both the C++
request parser and the TypeScript response validator reject unsupported versions, malformed shapes,
and mismatched request IDs. Errors and warnings use structured `{code, field, message, severity}`
issues. Load IDs are stable across calculation order. Built-ins use the `builtin:` namespace and
persisted user loads use `custom:`. Successful and failed responses identify both the packaged
engine version and the independently versioned numerical/model semantics.

Electron and renderer protocol DTOs are owned by `src/Ballistics.Desktop/shared/protocol.ts`.
Protocol literal types, runtime guards, schemas, fixtures, native constants, model identity, and
cross-process size ceilings derive from `config/product-metadata.json`. See
`docs/PRODUCT_IDENTITY.md`.

The renderer has no direct Node.js access. During Vite development, the development middleware
invokes the C++ CLI using the same JSON contract.

Named profile files use the separate strict
`protocol/ballistics-profile-interchange.schema.json` contract. The renderer owns semantic decoding,
migration, conflicts, and application. The Electron main process owns trusted-frame authorization,
bounded native file dialogs, envelope checks, and UTF-8 I/O. Neither profile import nor export
grants the renderer a path or general filesystem primitive.
G1/G7 BC and Mach–Cd files use the separate
`protocol/ballistics-drag-data.schema.json` contract and the same bounded, trusted-frame file
boundary. Their 1 MiB ceiling is independent from the profile-document ceiling.

## Native builds

### CMake presets and Ninja

Run:

```powershell
.\scripts\build.cmd
```

The script delegates to the cross-platform native orchestrator and `windows-msvc` preset. It locates
the newest Visual Studio C++ environment, configures CMake/Ninja, builds with warnings as errors,
runs CTest, installs the `Runtime` component into `build/stage`, and validates that stage. Linux GCC,
Linux Clang/sanitizer, and universal macOS presets are defined alongside it in `CMakePresets.json`.
Visual Studio users open the repository folder and select the preset through Visual Studio's CMake
integration. Hand-maintained `.sln`/`.vcxproj` definitions are no longer used.

See `docs/BUILD_SYSTEM.md` for the preset matrix, sanitizer policy, direct commands, canonical stage
contract, packaging flow, and troubleshooting.

## Desktop builds

Install the exact dependency graph recorded in `package-lock.json`:

```powershell
npm ci
```

Available commands:

```text
npm run dev           Vite and Electron development session
npm run build         Production renderer and Electron main-process build
npm run identity:generate  Synchronize generated identity/protocol consumers after a metadata edit
npm run identity:check     Validate metadata and reject generated-consumer drift
npm run protocol:generate  Generate native and TypeScript structural field lists from the schema
npm run protocol:check     Reject generated protocol-structure drift
npm run atmosphere:generate  Generate shared atmosphere conversion formulas
npm run atmosphere:check     Reject generated atmosphere-conversion drift
npm run native:build  Native configure/build/test/install for the current platform
npm run start         Run the most recent production build
npm run package:win   Build the Windows NSIS installer
npm run package:mac   Build the macOS disk image (runs on macOS)
npm run package:linux Build Linux AppImage and tar.gz packages (runs on Linux)
npm test              Run the renderer unit tests (Vitest)
npm run format        Apply C++ and web-source formatting
npm run format:check  Verify formatting without changing files
npm run lint:native -- --build-directory build  Run the checked-in clang-tidy policy
npm run fuzz:protocol -- <paths>  Run the Clang/libFuzzer protocol target on Linux
npm run validate:artifacts  Validate checksums, schemas, links, and deterministic artifacts
npm run validation:docs  Regenerate the checked-in validation evidence inventory
npm run validation:summary  Regenerate the inventory and the complete build-report summary
npm run test:e2e:win  Exercise the already-built packaged Windows UI and CSV export
```

## Tests

The native regression executables are built as `Ballistics.Core.Tests`,
`Ballistics.Validation.Tests`, `Ballistics.Convergence.Tests`, `Ballistics.FlightMatrix.Tests`, and
`Ballistics.Protocol.Tests`. CMake registers them with CTest, together with a real CLI JSON fixture
test and compatibility checks for strict numeric, unknown-argument, and duplicate-argument
rejection. The JSON fixture verifies Unicode names, three custom loads in one request, stable IDs,
native zero/path metadata, adaptive solver diagnostics, structured version errors, and the expected
nine-result response. The fixture also enables first-order uncertainty propagation and verifies
aligned samples plus active and completed input counts. It verifies native trajectory-event
relationships including the configured far zero, maximum ordinate, ground intersection, and
horizon-limited supersonic range. The same fixture exercises a three-band G7
BC schedule, sphere-domain
validity metadata, and a five-point custom Mach–Cd curve with an explicit reference diameter.
An independent calibration fixture exercises the `calibrateReferenceBc` operation through the real
CLI, checking convergence, model identity, coefficient confidence bounds, per-point residuals, and
separate held-out error.

Core mathematical checks include vacuum constant-gravity flight and a constant-Cd horizontal
deceleration case. The latter disables gravity only in its reference configuration and compares the
production adaptive solver against exact velocity and time solutions at three ranges. Ordinary
application configurations retain gravity by default.

`Ballistics.Convergence.Tests` writes `build/validation/adaptive-convergence.json`. It contains
exact constant-Cd maximum-step refinement rows and four 41-range production/half/tenth-tolerance
tables compared with a 1,000× tighter, smaller-step reference. It enforces the 0.5 mm, 0.01 m/s,
and 10 microsecond production budgets, verifies half-tolerance changes remain below on-screen
resolution, and preserves compiler/model identity. CTest generates the report on GCC, Clang, and
MSVC before CI uploads the complete `build/validation/` artifact set.

Reference-model data and provenance live under `validation/`. Update a reference CSV and its
manifest checksum together. Table conformance tests read the checked-in data directly. Run
`npm run validate:artifacts` to check checksums, artifact registration, the six-load provenance
inventory, and deterministic regeneration of both independent scenario sets.

`Ballistics.BuiltinFit.Tests` is a CTest entry backed by
`validation/reference/run-builtin-fits.mjs`. It validates the three strict source definitions,
executes `ballistics_cli` through the versioned JSON calibration operation, validates the native
response and aggregate fit-report schema, and fails when a reproduced coefficient leaves its
declared tolerance. It writes `build/validation/builtin-effective-bc-fits.json` and a Markdown
rendering, then checks its stable summary against `docs/generated/BUILTIN_FIT_EVIDENCE.md`.
Per-platform fitted values and residuals remain in the JSON report. Install the lockfile
dependencies before configuring CMake because the runner uses the repository-pinned Ajv and
Prettier versions.

`Ballistics.Validation.Tests` compares the production solver with the source-controlled
fixed-distance RK4 G7 reference and writes `build/validation/g7-independent-residuals.json`.
`Ballistics.FlightMatrix.Tests` compares the adaptive solver with a separate fixed-time RK4
implementation across 13 environment, wind, geometry, drag-model, and built-in-load trajectories,
then checks independent sight-zero and MPBR solutions. It writes
`build/validation/flight-matrix-residuals.json`, which conforms to the registered flight-matrix
report schema and carries compiler/model identity. The checked-in scenario artifact is regenerated
deterministically by `validation/reference/generate-flight-matrix.mjs` and validated by
`npm run validate:artifacts`.

Protocol robustness has two complementary layers. `Ballistics.Protocol.Mutation.Tests` repeats a
fixed 12,000-case mutation schedule on every native platform, while `Ballistics.Protocol.Fuzz`
uses Clang coverage feedback under ASan+UBSan in Linux CI. The latter starts from the committed
calculation, calibration, and drag-variant corpus in `tests/Ballistics.Protocol.Fuzz`, checks parser
acceptance/error-envelope invariants, and retains plus minimizes any discovered crash input.

`ballistics_benchmarks` is report-only and writes a machine-readable timing baseline:

```powershell
.\build\ballistics_benchmarks.exe --iterations 5 --output build\validation\benchmark.json
```

The benchmark warms each case once, then records median/p95 wall time, platform, compiler, hardware
concurrency, per-iteration accepted/rejected integration steps, dense retained sample count and
estimated storage, and the projected public-response sample count after bounded decimation. The
full-calculation case covers all nine loads at 2,000 m including MPBR, zeroing, event analysis, and
drag diagnostics. The recorded counts expose the cost of the 0.25 m event-analysis grid and confirm
that each trajectory is reduced to roughly 500 samples at the process boundary. The
cross-platform `performance:assess` command adds CPU/memory identity, measures real cold-process
request/serialization latency, enforces the checked-in host-class p95 interaction budget, and
records whether process overhead justifies a persistent worker. CI uploads both reports.

Renderer logic that does not depend on the DOM is covered by a Vitest suite under
`src/Ballistics.Desktop/src/ui`. This includes unit conversions, trajectory interpolation, input
and custom-load validation, protocol construction/runtime validation, CSV assembly, and the
atmosphere helper. Run it with `npm test`. The atmosphere suite pins the TypeScript
pressure-altitude helper to reference values produced by the C++ core and catches any drift between
the two implementations. It also tests altimeter-setting reduction, inverse
recovery, density-altitude derivation, pressure-source-specific validation, and schema-version 11
persistence migration.
The extracted toolbar and custom-projectile dialog have server-rendered component tests for unit,
theme, drag-variant, validation, accessibility, and action-availability states. The pure status
view model is tested across all nine modes, partial coverage, unavailable diagnostics, trajectory
events, and both unit systems. Packaged tests then exercise real Chromium pointer, selection, focus,
keyboard-shortcut, dialog, table, theme, unit, and status workflows. The same run exports CSV through
the preload/IPC boundary and verifies its UTF-8 BOM, size, and six-load structure.
Calibration tests also pin SI request generation, observation-information rules, runtime
response validation, holdout-claim consistency, and the auditable residual CSV columns.
Profile tests compile the checked-in Draft 2020-12 interchange schema and cover all four profile
kinds, selective and atomic application, built-in/custom ammunition, conflict policies, stable IDs,
capacity limits, strict round trips, legacy settings-envelope migration, malformed sibling
quarantine, recovery metadata, and migration from portable versions 1–3. Persistence tests cover
settings 2–11 migration, drag-provenance defaults, and quarantine of invalid stored entries.
Drag-data tests compile the checked-in schema and cover banded BC/Mach–Cd round trips, source/domain
metadata, payload checksums, tampering, strict shapes, local-identity preservation, and exact byte
limits. Electron tests independently enforce profile and drag-data filenames, envelopes, and 1 MiB
size bounds.
Uncertainty tests cover bounded request parsing, local native sensitivities, root-sum-square
combination, no-input behavior, response alignment/status invariants, renderer interpolation,
persistence migration, input validation, and auditable CSV columns.
Trajectory-event tests cover native Hermite roots, event ordering, configured-zero recovery,
Mach/supersonic consistency, short-horizon availability, protocol invariants, and CSV provenance.
`Ballistics.Protocol.Mutation.Tests` adds a deterministic targeted corpus and 12,000 generated
mutations. It checks that bounded arbitrary input never escapes the parser as an exception, accepted
requests satisfy protocol/identifier/collection invariants, rejected requests carry structured
errors, oversize input is rejected at the boundary, and every generated error envelope remains
bounded valid JSON. The target runs through every CTest preset, including the sanitizer preset.
Electron boundary tests cover calculation-envelope discrimination, cyclic/oversized request
rejection, CSV/profile/drag-data size limits, safe export filenames, current/legacy/quarantine
profile envelopes, drag-data envelopes, and unsupported-version rejection. The host also
registered application's main frame, denies permissions/popups/external navigation, and applies a
restrictive CSP to packaged file responses.

The Electron main process accepts `--smoke-test`. In a packaged application this verifies that the
bundled native executable starts, identifies the expected model, returns all built-in loads, and
reproduces a pinned Hornady 100 m velocity, sight zero, and native trajectory event.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests. Every platform restores the pinned npm
dependencies before configuring CMake so schema-backed native tests have their JavaScript runtime.
A separate supply-chain job verifies synchronized application/engine/model/protocol/profile/drag
identities, runs the high-severity npm advisory gate, and uploads a lockfile-derived CycloneDX SBOM
plus third-party license inventory.
A Linux job builds and tests the native core under GCC and runs the renderer type-check, unit tests,
and web build. A Windows job
also checks formatting and clang-tidy, runs the MSVC native build, builds the NSIS installer,
launches both packaged smoke modes, and uploads the installer as the `windows-installer` artifact.
All three native jobs validate source evidence, generate independent numerical residuals, enforce
the interaction budget, generate one aggregate Markdown summary directly from the reports, and
upload compiler-specific evidence artifacts. The native core is portable ISO C++20, so the Linux
job gives fast, cross-compiler validation of the numerical models.

The Windows job builds through `windows-msvc` and CMake installs the exact tested engine into
`build/stage/bin`, where packaging consumes it. The local `scripts\build-release.cmd` uses the same
preset and stage. There is no separate MSBuild graph.

A dedicated Linux sanitizer job builds every native target with the `linux-sanitizers` Clang preset,
warnings as errors, AddressSanitizer, and UndefinedBehaviorSanitizer, then runs the complete CTest
suite under strict runtime options.

A macOS job builds and tests the core under Clang as a universal binary (`arm64` and `x86_64`),
ad-hoc signs the native CLI, generates the app icon, and produces a universal `.dmg` disk image that
runs on both Apple Silicon and Intel Macs. It verifies with `lipo` that the packaged app executable
and the bundled engine both contain the two architectures, then launches the packaged application
with `--smoke-test` to confirm the bundled C++ engine starts and returns every built-in load on
macOS, and uploads the disk image as a build artifact. The runner is Apple Silicon, so the smoke
test exercises the `arm64` slice. The `lipo` check guards the `x86_64` (Intel) slice, which the
runner cannot execute. The macOS build is ad-hoc signed and has no notarization:
`mac.identity` is `null` and `CSC_IDENTITY_AUTO_DISCOVERY` is `false`, so no Apple Developer
certificate is involved in ordinary CI. Ad-hoc signing is free and is the minimum required for the app to launch on
Apple Silicon. Recipients clear Gatekeeper once on first launch (right-click → Open, or by removing
the quarantine attribute).

`.github/workflows/release.yml` is a separate immutable-tag delivery path. It repeats the relevant
native, renderer, package, architecture, and smoke gates. It applies Authenticode and Developer ID/
notarization when complete credential groups are configured, then assembles SHA-256 checksums, a
CycloneDX SBOM, dependency-license inventory, and schema-checked release manifest. Unsigned or
partially signed builds are published only as pre-releases. See `docs/RELEASES.md` for the exact
credential contract, manifest fields, verification commands, and consumer-facing integrity limits.

## Release checklist

1. Update the version in `package.json`, `package-lock.json`, `CMakeLists.txt`, and the native engine
   declaration.
2. Run `npm ci`.
3. Run `npm run format:check`.
4. Run `npm run validate:artifacts`.
5. Run `npm test`.
6. Run the appropriate canonical native preset, which builds, tests, installs, and validates the
   runtime stage.
7. Generate the native benchmark, run `performance:assess`, and retain both JSON reports.
8. Run `npm run build`.
9. Run `npm run package:win`.
10. Run the packaged executable with `--smoke-test`, then run `npm run test:e2e:win`.
11. Download the `macos-dmg` artifact from the `macos` CI job for the same commit. The job has
    already smoke-tested it on macOS.
12. Download and inspect the GCC, MSVC, and Clang validation artifacts.
13. Run `npm run release:verify-version -- --tag v<version>`.
14. Tag the reviewed commit as `v<version>` and let the release workflow assemble and publish the
    checksummed bundle.
15. Verify `SHA256SUMS.txt` and inspect `release-manifest.json` for the expected source commit,
    versions, reference-data checksums, toolchains, signing, and notarization status.

Generated files, dependencies, installers, IDE state, and local settings are excluded through
`.gitignore`.
