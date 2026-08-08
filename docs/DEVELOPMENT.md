# Development Guide

## Architecture

Ballistics Workbench is divided into four build targets:

```text
React renderer
    │ context-isolated IPC
Electron main process
    │ JSON over stdout
Ballistics.Cli
    │ direct library calls
Ballistics.Core
```

`Ballistics.Core` owns the physical models and numerical integration. `Ballistics.Cli` validates
input arguments and serializes calculation results as JSON. The Electron main process invokes the
CLI with `execFile`, while the renderer receives a narrow API from the context-isolated preload
script.

The renderer has no direct Node.js access. It may also run through Vite during development; the
development middleware invokes the C++ CLI using the same argument contract.

## Native builds

### Visual Studio

Open `BallisticsWorkbench.sln`, select `Debug | x64` or `Release | x64`, and build the solution.
Shared compiler settings are defined in `Directory.Build.props`.

### CMake and Ninja

Run:

```powershell
.\scripts\build.cmd
```

The script locates the newest Visual Studio installation containing the C++ toolchain, configures
CMake with Ninja, builds the native targets, and runs CTest.

## Desktop builds

Install the exact dependency graph recorded in `package-lock.json`:

```powershell
npm ci
```

Available commands:

```text
npm run dev           Vite and Electron development session
npm run build         Production renderer and Electron main-process build
npm run start         Run the most recent production build
npm run package:win   Build the Windows NSIS installer
npm run package:mac   Build the macOS disk image (runs on macOS)
npm test              Run the renderer unit tests (Vitest)
npm run format        Apply C++ and web-source formatting
npm run format:check  Verify formatting without changing files
```

The Visual Studio desktop project calls `scripts\build-desktop.cmd`, which restores missing npm
dependencies before building.

## Tests

The native regression executable is built as `Ballistics.Core.Tests`. CMake registers it with
CTest, and Visual Studio places it under the selected configuration's output directory.

Renderer logic that does not depend on the DOM — unit conversions, trajectory interpolation, input
and custom-load validation, CSV assembly, and the atmosphere helper — is covered by a Vitest suite
under `src/Ballistics.Desktop/src/ui`. Run it with `npm test`. The atmosphere suite pins the
TypeScript altitude/pressure helper to reference values produced by the C++ core so the two
implementations cannot silently diverge.

The Electron main process accepts `--smoke-test`. In a packaged application this verifies that the
bundled native executable starts and returns all built-in loads.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests. A Linux job builds and tests the
native core under GCC and runs the renderer type-check, unit tests, and web build; a Windows job
additionally checks formatting, runs the MSVC native build, builds the NSIS installer, launches the
packaged app with `--smoke-test`, and uploads the installer as the `windows-installer` artifact. The
native core is portable ISO C++20, so the Linux job gives fast, cross-compiler validation of the
numerical models.

The Windows job builds the native engine with CMake and Ninja, which writes `ballistics_cli.exe`
under `build/`; a staging step copies it to `x64/Release/`, where the packaging configuration expects
it, before running `npm run package:win`. The local `scripts\build-release.cmd` flow, which uses
MSBuild to produce that path directly, is unaffected.

A macOS job builds and tests the core under Clang, ad-hoc signs the native CLI, generates the app
icon, and produces the `.dmg` disk image. It then launches the packaged application with
`--smoke-test` to confirm the bundled C++ engine starts and returns every built-in load on macOS,
and uploads the disk image as a build artifact. The macOS build is ad-hoc signed but not notarized:
`mac.identity` is `null` and `CSC_IDENTITY_AUTO_DISCOVERY` is `false`, so no Apple Developer
certificate is involved. Ad-hoc signing is free and is the minimum required for the app to launch on
Apple Silicon; recipients clear Gatekeeper once on first launch (right-click → Open, or by removing
the quarantine attribute).

## Release checklist

1. Update the version in `package.json`, `package-lock.json`, and `CMakeLists.txt`.
2. Run `npm ci`.
3. Run `npm run format:check`.
4. Run `npm test`.
5. Build `Release | x64` in Visual Studio and run `Ballistics.Core.Tests.exe`.
6. Run `npm run build`.
7. Run `npm run package:win`.
8. Run the packaged executable with `--smoke-test`.
9. Download the `macos-dmg` artifact from the `macos` CI job for the same commit; the job has
   already smoke-tested it on macOS.
10. Tag the release as `v<version>`.

Generated files, dependencies, installers, IDE state, and local settings are excluded through
`.gitignore`.
