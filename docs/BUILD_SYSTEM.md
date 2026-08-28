# Canonical build system

CMake is the sole native build definition for Ballistics Workbench. Hand-maintained Visual Studio
solutions and project files have been retired. Visual Studio, command-line builds, CI, packaging,
and release jobs all use the same targets and presets.

The React/Electron application remains an npm build. Its packaging configuration consumes only the
native executable installed by CMake into the canonical staging directory.
The production desktop build also clears only the validated `dist-electron` generated-output path
before TypeScript emission, preventing obsolete entry points from leaking into a package after an
output-layout change.

## Product identity during builds

CMake reads `config/product-metadata.json` before `project()`, derives the application version, and
configures a generated native identity header in the binary directory. No engine/model/protocol
version literal is maintained in `CMakeLists.txt` or a source header.

The native Node orchestrator runs `npm run identity:check` semantics before CMake configuration.
Renderer tests/builds and release verification run the same drift gate. See
`docs/PRODUCT_IDENTITY.md` for generated consumers and the version-change procedure.

## Prerequisites

All platforms require:

- CMake 3.24 or later
- Ninja
- Node.js 22 or later and npm 10 or later
- The lockfile-pinned npm dependencies (`npm ci`)

Windows also requires a Visual Studio installation with the Desktop development with C++
workload. The build orchestrator locates the latest installation through `vswhere` and imports its
x64 developer environment without requiring a pre-opened Developer Command Prompt.

Linux GCC builds require `g++`. Linux Clang and sanitizer builds require `clang++`. macOS builds
require the Xcode command-line tools and produce a universal `arm64`/`x86_64` executable.

## Presets

`CMakePresets.json` defines matching configure, build, and test presets:

| Preset             | Host    | Compiler   | Binary directory    | Install directory         | Policy                                        |
| ------------------ | ------- | ---------- | ------------------- | ------------------------- | --------------------------------------------- |
| `windows-msvc`     | Windows | MSVC       | `build/`            | `build/stage/`            | Release, `/W4`, `/WX`                         |
| `linux-gcc`        | Linux   | GCC        | `build/`            | `build/stage/`            | Release, warnings/Werror                      |
| `linux-clang`      | Linux   | Clang      | `build/clang/`      | `build/clang-stage/`      | Release, warnings/Werror                      |
| `linux-sanitizers` | Linux   | Clang      | `build/sanitizers/` | `build/sanitizers-stage/` | RelWithDebInfo, Werror, ASan+UBSan, libFuzzer |
| `macos-universal`  | macOS   | AppleClang | `build/`            | `build/stage/`            | Universal Release, Werror                     |

Host conditions prevent accidentally configuring a platform preset on an incompatible machine.
Every preset exports `compile_commands.json` for tools that can consume it.

The default platform build is available through:

```text
npm run native:build
```

Explicit platform commands are:

```text
npm run native:windows
npm run native:linux
npm run native:macos
```

The Windows convenience wrapper remains available:

```powershell
.\scripts\build.cmd
```

It delegates to the same cross-platform Node.js orchestrator and `windows-msvc` preset. It does not
contain a second native build definition.

## Direct CMake use

The orchestrator is recommended because it verifies preset completeness, imports the MSVC developer
environment, runs tests, installs the runtime, and checks the resulting stage. Direct commands are
still standard CMake:

```bash
cmake --preset linux-gcc --fresh
cmake --build --preset linux-gcc
ctest --preset linux-gcc
cmake --install build --component Runtime
```

On Windows from a configured developer shell, replace `linux-gcc` with `windows-msvc`. On macOS use
`macos-universal`.

The orchestrator supports these options:

```text
node scripts/build/native-build.mjs [--preset NAME] [--fresh] [--skip-tests] [--skip-install]
```

- `--fresh` discards only CMake's generated configuration through CMake's supported `--fresh`
  operation. It does not recursively delete the source tree.
- `--skip-tests` supports workflows that run tests in a separate step. Release and package jobs do
  not use it.
- `--skip-install` is used by the sanitizer CI job because sanitizer binaries are not packaged.

Unknown flags and presets are rejected.

## Visual Studio

Open the repository directory in Visual Studio. The retired `.sln` file is no longer used. Visual
Studio's CMake integration discovers `CMakePresets.json`. Select `windows-msvc` to configure and
build the same targets used by CI and packaging.

The native targets are:

- `Ballistics.Core`: static numerical library
- `Ballistics.Cli`: versioned JSON bridge, emitted as `ballistics_cli`
- `Ballistics.Core.Tests`: mathematical and model regression executable
- `Ballistics.Validation.Tests`: reference/model conformance reports
- `Ballistics.Convergence.Tests`: adaptive numerical error evidence
- `Ballistics.FlightMatrix.Tests`: independent flight implementation comparison
- `Ballistics.Protocol.Tests`: strict JSON protocol/parser tests
- `Ballistics.Protocol.Fuzz`: opt-in Clang/libFuzzer protocol parser target
- `Ballistics.Benchmarks`: report-only performance workloads

Adding a native source or target must be done in `CMakeLists.txt`. Do not add a hand-maintained IDE
project as an alternative definition.

## Compiler policy

`Ballistics.BuildOptions` is an interface target linked privately by every first-party C++ target.
It establishes:

- C++20 without compiler extensions
- MSVC `/W4`, standards-conformance switches, and optional `/WX`
- GCC/Clang `-Wall`, `-Wextra`, `-Wpedantic`, shadow, format, and undefined-macro warnings
- Optional warnings-as-errors and sanitizer instrumentation

Canonical platform presets enable warnings-as-errors. A warning introduced on MSVC, GCC, Clang, or
AppleClang fails the matching CI job. Unsupported warning flags also fail the AppleClang job.
Warning suppressions must be narrow, justified, and target/source-specific. Do not disable a
warning globally for one occurrence.

## Sanitizers

`linux-sanitizers` builds every native target with Clang AddressSanitizer and
UndefinedBehaviorSanitizer and then runs the complete native CTest suite:

```bash
node scripts/build/native-build.mjs --preset linux-sanitizers --fresh --skip-install
```

CI sets strict ASan/UBSan runtime options, including leak detection and immediate failure on
undefined behavior. The same preset builds `Ballistics.Protocol.Fuzz`, which runs against the
committed calculation, calibration, and drag-variant corpus with a JSON protocol dictionary. The
runner uses a bounded 60-second CI budget. A crash is retained, automatically passed through
libFuzzer's crash minimizer, and uploaded by the CI failure path.

To repeat the fuzz run after building `linux-sanitizers`:

```bash
npm run fuzz:protocol -- \
  --executable build/sanitizers/Ballistics.Protocol.Fuzz \
  --corpus tests/Ballistics.Protocol.Fuzz/corpus \
  --dictionary tests/Ballistics.Protocol.Fuzz/protocol.dict \
  --artifacts build/fuzz-artifacts \
  --seconds 60
```

Sanitizer and fuzzer output are correctness gates, not performance baselines. Release packages
never contain their runtimes.

## Canonical runtime staging

The `Runtime` install component contains exactly the native executable and its GPL license:

```text
build/stage/
  bin/
    ballistics_cli.exe        Windows
    ballistics_cli            macOS/Linux
  share/licenses/BallisticsWorkbench/
    LICENSE
```

`scripts/build/verify-native-stage.mjs` rejects a missing or implausibly small executable/license.
Electron packaging consumes `build/stage/bin/ballistics_cli[.exe]`. It never copies a Visual Studio,
ad hoc, or stale developer output.

Run the stage check directly with:

```text
npm run native:verify-stage -- --platform windows
npm run native:verify-stage -- --platform macos
npm run native:verify-stage -- --platform linux
```

`npm run package:win`, `npm run package:mac`, and `npm run package:linux` perform this check before
building the renderer or starting electron-builder. Packaging stops early when the native runtime
is stale or missing.

## Desktop packaging

Windows:

```powershell
npm ci
npm run native:windows
npm run package:win
```

macOS:

```bash
npm ci
npm run native:macos
codesign --force --sign - build/stage/bin/ballistics_cli
bash scripts/make-icns.sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
```

The macOS command creates both a universal DMG and a guided PKG installer that installs the app into
`/Applications`. The tag-driven release workflow can sign the app and PKG with their respective
Developer ID certificates and notarize both deliverables.

Linux:

```bash
npm ci
npm run native:linux
npm run package:linux
```

The Linux command creates x64 AppImage and tar.gz packages from the same tested runtime stage.

The local Windows all-in-one wrapper performs identity verification, native configure/build/test/
install, renderer tests/build, and staged installer creation:

```powershell
.\scripts\build-release.cmd
```

## Formatting

Formatting is also orchestrated by a cross-platform Node.js entry point:

```text
npm run format
npm run format:check
```

It discovers first-party C/C++ files under `src`, `tests`, and `benchmarks`, runs the repository
clang-format policy in bounded command batches, and invokes the lockfile-pinned Prettier binary over
web, protocol, validation, release, documentation, and workflow sources. Windows `.cmd` wrappers
remain for convenience but contain no duplicated discovery logic.

`npm run lint:native -- --build-directory <preset-build-directory>` runs the checked-in
`.clang-tidy` analyzer policy against all production core, CLI, and benchmark translation units.
The Windows CI job treats analyzer findings as errors after generating `compile_commands.json`.

The formatting command excludes application icon assets. They are user-supplied files and code
quality commands must leave them unchanged.

## CI matrix

CI calls the presets directly:

- Linux validates the `linux-gcc` preset and produces GCC numerical/benchmark reports.
- Linux also stages the native runtime, builds AppImage and tar.gz desktop packages, runs the
  packaged smoke path under Xvfb, and uploads both package forms.
- Windows validates `windows-msvc`, clang-tidy, the canonical install stage, the NSIS package, and
  both packaged numerical and UI/CSV smoke tests.
- macOS validates `macos-universal`, both executable architectures, disk-image packaging, and both
  packaged smoke paths.
- A dedicated Linux job validates the `linux-sanitizers` Clang ASan+UBSan preset and runs the
  coverage-guided protocol parser target with failure-corpus retention/minimization.

The tag-driven release workflow uses the same Windows, macOS, and Linux presets and stage paths as
pull-request CI.

## Troubleshooting

### A preset is hidden or unavailable

Presets have host conditions. `windows-msvc` appears only on Windows. `macos-universal` appears only
on macOS. Linux compiler and sanitizer presets appear only on Linux. List available host presets
with:

```text
cmake --list-presets
```

### Windows cannot locate MSVC

Install the Desktop development with C++ workload and Ninja in Visual Studio Installer. The
orchestrator requires `vswhere.exe` and `Launch-VsDevShell.ps1` from a normal Visual Studio
installation.

### Packaging says the canonical stage is missing

Run the appropriate `npm run native:<platform>` command. Copying an executable into the stage by
hand is not a supported substitute because it bypasses compiler, test, warning, and install gates.

### Sanitizer configuration fails

Confirm `clang++` is installed and selected by the preset. The sanitizer option rejects unsupported
compilers so an uninstrumented build cannot proceed.
