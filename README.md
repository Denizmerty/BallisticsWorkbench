# Ballistics Workbench

Ballistics Workbench is a Windows external-ballistics calculator for shotgun and .308 Winchester
loads. A native C++20 library performs the numerical work, while the desktop interface is built
with React, TypeScript, and Electron.

> Ballistic results are engineering estimates. Confirm muzzle velocity with a chronograph and
> verify zero, trajectory, and safe backstops at an appropriate shooting range.

## Features

- G1 and G7 reference drag models
- Reynolds- and Mach-dependent drag for spherical projectiles
- Fourth-order Runge–Kutta trajectory integration
- Temperature, station pressure, humidity, altitude, headwind, and crosswind inputs
- Three-dimensional trajectory integration with true crosswind drift and combined windage
- Independent shotgun and rifle muzzle-velocity and sight-height profiles
- Maximum point-blank range and optimized zero calculations
- Sight-in zero with bullet path and elevation holdover in MOA and mil
- Rifle spin-drift estimates with twist rate and direction
- Per-projectile or per-pellet values alongside complete-payload totals
- Interactive all-load charts and detailed range tables
- Sortable all-load calculator, one-click summary copy, and CSV export
- Keyboard navigation for tabs and load selection
- Metric and imperial units, light and dark themes
- Persistent custom G1, G7, and spherical loads

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

- Windows 10 or Windows 11, x64

Installers are produced from the `Release | x64` configuration and are available on the
repository's Releases page.

### Building from source

- Visual Studio 2026 with the **Desktop development with C++** workload
- MSVC v145 toolset
- Windows 11 SDK 10.0.26100.0
- Node.js 22 or later with npm
- CMake 3.24 or later and Ninja for command-line native builds

## Build with Visual Studio

1. Open `BallisticsWorkbench.sln`.
2. Select `Release | x64`.
3. Build the solution.
4. Set `Ballistics.Desktop` as the startup project to run the desktop application.

The solution contains four projects:

- `Ballistics.Core` — C++20 static library
- `Ballistics.Cli` — native JSON command-line bridge used by Electron
- `Ballistics.Desktop` — React/Electron application build
- `Ballistics.Core.Tests` — native numerical regression tests

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

Build the solution in `Release | x64` first so that `x64\Release\ballistics_cli.exe` is current,
then run:

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

## Basic usage

1. Set the maximum range and atmospheric conditions.
2. Adjust the shotgun or rifle firearm profile when chronograph or sight-height data is available.
3. Select a built-in or custom load.
4. Use **Overview** to inspect all trajectories at a chosen distance.
5. Use **Range Table** for one load or **All-load Calculator** to compare every active load; click a
   column heading in the calculator to sort by it.
6. Export the current range table with **Ctrl+E** or copy the selected load's summary to the
   clipboard with **Copy summary**. Reset atmospheric inputs with **Ctrl+R**.

Keyboard shortcuts: number keys **1**–**4** switch between Overview, Range Table, All-load
Calculator, and Help; the **arrow keys** (or **[** and **]**) cycle the selected load.

For buckshot, trajectory values describe one pellet. Payload energy and momentum are arithmetic
totals across all pellets; they do not represent the payload as one projectile.

## Repository layout

```text
BallisticsWorkbench.sln
src/
  Ballistics.Core/          Native numerical library
  Ballistics.Cli/           JSON command-line interface
  Ballistics.Desktop/       React UI and Electron host
tests/
  Ballistics.Core.Tests/    Native regression tests
docs/                       Model and development documentation
scripts/                    Build and formatting scripts
```

## Testing and formatting

`scripts\build.cmd` runs the native CTest suite after compiling. The Electron host also provides a
packaged-engine smoke-test mode used during release verification.

C++ follows the checked-in Google-derived `.clang-format` configuration. TypeScript, React, CSS,
JSON, and CommonJS files use Prettier.

```powershell
npm run format
npm run format:check
```

## Documentation

- [`docs/MODEL_AND_VALIDATION.md`](docs/MODEL_AND_VALIDATION.md) describes the numerical models,
  built-in load data, output semantics, and limitations.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) describes the application architecture and release
  workflow.
- [`CHANGELOG.md`](CHANGELOG.md) records user-visible changes by release.
- The application includes an in-program Help page covering operation, calibration, and model
  interpretation.

## License

This project is not licensed for redistribution. All rights are reserved.
