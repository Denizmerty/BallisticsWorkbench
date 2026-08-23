# Ballistics Workbench

Ballistics Workbench is a Windows, macOS, and Linux external-ballistics calculator for shotgun and .308
Winchester loads. A native C++20 library performs the numerical work, while the desktop interface is
built with React, TypeScript, and Electron.

> Ballistic results are engineering estimates. Confirm muzzle velocity with a chronograph and
> verify zero, trajectory, and safe backstops at an appropriate shooting range.

## Features

- G1 and G7 reference drag models
- Constant or velocity-banded ballistic coefficients for custom G1/G7 loads
- Weighted measured-velocity fitting for constant or banded G1/G7 BCs, with confidence intervals,
  calibration/holdout residuals, and an exportable report
- Custom tabulated Mach–Cd curves with an explicit drag reference diameter
- Portable G1/G7 BC schedules and Mach–Cd files with canonical units, source/license metadata,
  declared domains, and verified SHA-256 payload integrity
- Reynolds- and Mach-dependent drag for spherical projectiles
- Adaptive Dormand–Prince 5(4) time-domain integration with explicit event termination
- Temperature, humidity, headwind, and crosswind inputs, with explicit measured station-pressure,
  pressure-altitude, or altimeter-setting plus field-elevation pressure sources and derived density
  altitude
- Optional deterministic propagation of muzzle-velocity, BC/drag, atmosphere, wind, and zero
  uncertainty into approximate 95% trajectory confidence bands
- Seeded Monte Carlo uncertainty with input correlations and percentile trajectory bands
- Inclined targets, optional altitude-varying atmosphere, local WGS84 gravity, Coriolis
  acceleration, wind layers, and temperature-sensitive muzzle-velocity profiles
- Empirical buckshot D90 fitting with calibration/holdout residuals and target-region pellet-count
  probabilities
- Three-dimensional trajectory integration with true crosswind drift and combined windage
- Independent shotgun and rifle muzzle-velocity and sight-height profiles
- Native maximum point-blank range and optimized-zero calculations
- Sight-in zero solved as actual bore elevation, with native exact-angle bullet path/holdover and
  angular uncertainty in radians, MOA, and mil
- Native near/far zero, maximum-ordinate, Mach/transonic, supersonic-range, and ground-intersection
  event reporting with explicit horizon-limited availability
- Rifle spin-drift estimates with twist rate and direction
- Per-projectile or per-pellet values alongside complete-payload totals
- Interactive all-load charts and detailed range tables
- Sortable all-load calculator, one-click summary copy, and CSV export
- Keyboard navigation for tabs and load selection
- Metric and imperial units, light and dark themes
- Persistent custom G1, G7, Mach–Cd, and spherical loads
- Named environment, firearm, ammunition, and combined-scenario profiles with strict versioned JSON
  import/export, explicit conflict policies, legacy migration, and recoverable quarantine
- Versioned engine/model and atmosphere-model identity, plus explicit drag-domain extrapolation
  warnings
- One schema-backed product identity generates native/desktop declarations, protocol/profile/drag
  interchange versions, validation identities, and cross-process byte limits

The six built-in loads are:

| Load                              |            Projectile | Nominal muzzle velocity | Drag model |
| --------------------------------- | --------------------: | ----------------------: | ---------- |
| B&P White Blackout HV 12/70       |             28 g slug |                 575 m/s | G1         |
| B&P BlackShock 12/70              |             32 g slug |                 455 m/s | G1         |
| Winchester Super-X X123RS15 12/76 |             1 oz slug |              1,760 ft/s | G1         |
| Hornady BLACK .308 Win A-MAX      |         168 gr bullet |              2,700 ft/s | G1         |
| Federal Power-Shok .308 Win SP    |         150 gr bullet |              2,820 ft/s | G1         |
| Winchester Super-X 12/70 00 buck  | Nine 0.330 in pellets |              1,325 ft/s | Sphere     |

## Requirements

### Running the application

- Windows 10 or Windows 11, x64, or
- macOS 12 Monterey or later (Apple Silicon or Intel), or
- a current x64 Linux distribution capable of running AppImage packages

Windows NSIS, universal macOS DMG, Linux AppImage, and Linux tar.gz packages are produced from their
canonical CMake stages. Release jobs build and test each package on its host operating system.

#### macOS: first launch

The macOS build is a **universal binary** (Apple Silicon and Intel) that is **ad-hoc signed but not
notarized**, because notarization requires a paid Apple Developer membership. The app is not tied to
any single Mac and runs on any recent Mac, but because it is unnotarized, macOS Gatekeeper stops the
very first launch. Clear it once, either way:

- **Right-click** (or Control-click) `Ballistics Workbench.app` in Applications and choose **Open**,
  then confirm **Open** in the dialog, or
- run this in Terminal after copying the app to Applications:

    ```bash
    xattr -dr com.apple.quarantine "/Applications/Ballistics Workbench.app"
    ```

After the first successful launch the app opens normally from then on.

### Building from source

- Visual Studio 2026 with the **Desktop development with C++** workload
- MSVC v145 toolset
- Windows 11 SDK 10.0.26100.0
- Node.js 22 or later with npm
- CMake 3.24 or later and Ninja for command-line native builds

## Build with CMake presets

Open the repository folder in Visual Studio and select the `windows-msvc` CMake preset, or run:

```powershell
npm ci
npm run native:windows
```

The preset builds every native target with warnings as errors, runs all CTest targets, and installs
the packaging runtime into `build\stage`. Hand-maintained Visual Studio solution/project files are
not used. Visual Studio, command-line builds, CI, and packaging consume the same CMake definitions.

The desktop project restores the lockfile-pinned npm dependencies automatically when necessary.

## Command-line development

Build and test the native targets:

```powershell
.\scripts\build.cmd
```

Restore desktop dependencies and create a production build:

```powershell
npm ci
npm run build
```

Run the desktop application with live UI reload:

```powershell
npm run dev
```

The Vite development server expects `build\ballistics_cli.exe`, which is produced by
`scripts\build.cmd`.

## Create the Windows installer

Build and verify the canonical native stage, then run:

```powershell
npm run package:win
```

The NSIS installer is written to `outputs\installer\`.

For a complete release build that locates Visual Studio, compiles the native and desktop targets,
runs both test suites, and creates the installer, run:

```powershell
.\scripts\build-release.cmd
```

Add `--run` to launch the unpacked application after a successful build:

```powershell
.\scripts\build-release.cmd --run
```

## Create the macOS disk image

macOS packaging runs on a hosted macOS runner. The `macos` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) compiles the
native core with Clang as a **universal binary** (`arm64` and `x86_64`), ad-hoc signs it, builds the
universal Electron application, produces the `.dmg`, verifies both the app and the bundled engine
contain both architectures, runs the packaged numerical smoke test, exercises the real Chromium UI
through load/unit/theme/status/table/profile interactions, verifies a six-load CSV export through
preload and IPC, and uploads the disk image as a build artifact. No Apple Developer membership and
no local Mac are required.

To build it by hand on a Mac with the Xcode command-line tools and Node.js 22:

```bash
npm ci
npm run native:macos
codesign --force --sign - build/stage/bin/ballistics_cli
brew install librsvg          # one-time, for icon generation
bash scripts/make-icns.sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
```

The disk image is written to `outputs/installer/`. The build is ad-hoc signed only. See
[macOS: first launch](#macos-first-launch) for how recipients clear Gatekeeper on other Macs.

## Create the Linux packages

On an x64 Linux host with GCC, Ninja, CMake, Node.js, and AppImage build prerequisites installed:

```bash
npm ci
npm run native:linux
npm run package:linux
```

The AppImage and tar.gz packages are written to `outputs/installer/`. CI runs both the native and
packaged application checks on Linux under Xvfb before retaining the artifacts.

## Basic usage

1. Set the maximum range and atmospheric conditions.
2. Adjust the shotgun or rifle firearm profile when chronograph or sight-height data is available.
3. Select a built-in or custom load.
4. Use **Overview** to inspect all trajectories at a chosen distance.
5. Use **Range Table** for one load or **All-load Calculator** to compare every active load. Click a
   column heading in the calculator to sort by it.
6. Save reusable settings with **Profiles…** (**Ctrl+Shift+P**) and exchange them as bounded
   `.bwprofile.json` files.
7. In the custom-projectile editor, exchange a G1/G7 BC definition or Mach–Cd curve as a bounded
   `.bwdrag.json` file. Expand its metadata section to retain the source, license, source checksum,
   and declared data domain.
8. Export the current range table with **Ctrl+E** or copy the selected load's summary to the
   clipboard with **Copy summary**. Reset atmospheric inputs with **Ctrl+R**.

The repository also provides a schema-validated batch runner for repeatable scenario sets. See
[`docs/BATCH_SCENARIOS.md`](docs/BATCH_SCENARIOS.md).

Keyboard shortcuts: number keys **1**–**4** switch between Overview, Range Table, All-load
Calculator, and Help. The **arrow keys** (or **[** and **]**) cycle the selected load.

For buckshot, trajectory values describe one pellet. Payload energy and momentum are arithmetic
totals across all pellets. They do not represent the payload as one projectile.

## Repository layout

```text
CMakePresets.json             Canonical MSVC/GCC/Clang/sanitizer/universal presets
config/                      Authoritative product identity and its JSON Schema
src/
  Ballistics.Core/          Native numerical library
  Ballistics.Cli/           JSON command-line interface
  Ballistics.Desktop/       React UI and Electron host
tests/
  Ballistics.Core.Tests/    Native regression tests
  Ballistics.FlightMatrix.Tests/ Independent environment/model/geometry comparisons
  Ballistics.Protocol.Fuzz/ Coverage-guided parser corpus and libFuzzer target
  Ballistics.Protocol.Tests/ Native protocol parser tests
  Ballistics.Validation.Tests/ Source-controlled numerical conformance tests
  protocol/                 Cross-platform CLI contract fixtures
protocol/                   Versioned JSON schema
validation/                 Sources, schemas, normalized inventories, scenarios, and reports
benchmarks/                 Report-only native performance benchmark
release/                    Release-manifest contract
docs/                       Model and development documentation
scripts/                    Build, formatting, and release-integrity scripts
```

## Testing and formatting

`scripts\build.cmd` runs the complete native CTest suite after compiling, including schema-backed
independent numerical reports and a real-protocol reproduction of the three built-in effective-BC
fits. The Electron host also provides packaged numerical and UI/CSV smoke-test modes used during
release verification.

C++ follows the checked-in Google-derived `.clang-format` configuration. TypeScript, React, CSS,
JSON, and CommonJS files use Prettier.

```powershell
npm run format
npm run format:check
npm run lint:native -- --build-directory build
npm run fuzz:protocol -- <Linux sanitizer-build paths>
npm run identity:check
npm run validate:artifacts
npm run test:e2e:win
```

## Documentation

- [`docs/MODEL_AND_VALIDATION.md`](docs/MODEL_AND_VALIDATION.md) describes the numerical models,
  built-in load data, output semantics, and limitations.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) describes the application architecture and release
  workflow.
- [`docs/PROFILE_INTERCHANGE.md`](docs/PROFILE_INTERCHANGE.md) documents named profile semantics,
  schema versioning, migration, conflict handling, quarantine, and the file-security boundary.
- [`docs/DRAG_DATA_INTERCHANGE.md`](docs/DRAG_DATA_INTERCHANGE.md) documents portable BC/Mach–Cd
  payloads, units, provenance, domains, integrity checks, migration, and file-security boundaries.
- [`docs/BUCKSHOT_PATTERN.md`](docs/BUCKSHOT_PATTERN.md) documents empirical D90 inputs, the fitted
  model, holdout evidence, target-region probabilities, and its evidence limits.
- [`docs/RELEASES.md`](docs/RELEASES.md) documents tag-driven delivery, signing/notarization,
  checksums, SBOMs, toolchain manifests, dependency policy, and consumer verification.
- [`docs/BUILD_SYSTEM.md`](docs/BUILD_SYSTEM.md) documents CMake presets, compiler policy,
  sanitizers, canonical install staging, IDE use, packaging, and cross-platform formatting.
- [`docs/PRODUCT_IDENTITY.md`](docs/PRODUCT_IDENTITY.md) documents authoritative versions, generated
  consumers, shared protocol DTOs, byte limits, drift gates, and the version-change procedure.
- [`docs/generated/BUILTIN_FIT_EVIDENCE.md`](docs/generated/BUILTIN_FIT_EVIDENCE.md) is regenerated
  from the source-controlled fit definitions through the native calibration protocol.
- [`CHANGELOG.md`](CHANGELOG.md) records user-visible changes by release.
- The application includes an in-program Help page covering operation, calibration, and model
  interpretation.

## Support and contact

Ballistics Workbench is developed and maintained by Deniz Mert Yayla. For bug reports, proposed
fixes, and suggestions, email [denizmerty@gmail.com](mailto:denizmerty@gmail.com).

## License

Copyright (C) 2026 Deniz Mert Yayla.

Ballistics Workbench is free software licensed under the GNU General Public License, version 3 or
any later version. You may redistribute and modify it under those terms. See [`LICENSE`](LICENSE)
for the complete license text. The software is provided without warranty.
