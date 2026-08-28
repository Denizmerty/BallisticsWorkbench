# Release integrity and delivery

Ballistics Workbench releases are assembled by `.github/workflows/release.yml` from an immutable
version tag. The workflow builds Windows, universal macOS, and x64 Linux packages independently,
exercises the packaged application, records each platform toolchain, and assembles one checksummed
release bundle. macOS releases contain both a guided PKG installer and a drag-to-Applications DMG.

This workflow improves traceability. It does not certify the application or its scientific models.
Numerical evidence and remaining model limitations are documented in `MODEL_AND_VALIDATION.md`.

## Trigger and version contract

Pushing a tag in the form `v<major>.<minor>.<patch>` starts the release workflow. A manual dispatch
may rebuild an existing tag but does not release an arbitrary branch. The checkout is pinned to the
tag, and the recorded source commit is obtained from that checkout.

Before any platform build starts, the workflow validates the schema-backed authority in
`config/product-metadata.json`, regenerates every consumer in memory, and requires exact agreement
among:

- The `package.json` version
- Both version locations in `package-lock.json`
- The CMake-derived project/native engine version
- The requested `v<version>` tag
- The native model version and validation manifest
- The native JSON protocol version
- The profile-interchange schema version

`npm run release:verify-version -- --tag v1.0.3` performs the same check locally. A mismatch stops
the release before artifact creation.

For a legitimate version/model/protocol change, edit the authority and run
`npm run identity:generate`. Do not edit the listed consumers independently. The complete procedure
is documented in `PRODUCT_IDENTITY.md`.

## Build and publication stages

### Verification

The verification job installs exactly the committed npm lockfile, validates every registered model
artifact and checksum, checks version identity, and runs the high-severity dependency advisory gate.

### Windows

The Windows job, using the canonical `windows-msvc` preset and CMake install stage:

1. builds the CMake Release targets and runs the complete native CTest suite
2. runs renderer, Electron-boundary, and release-integrity tests
3. checks repository formatting
4. stages the CMake-built engine and creates the NSIS installer
5. launches the packaged application in numerical smoke-test mode
6. exercises the packaged Chromium UI and validates CSV export through preload/IPC
7. verifies Authenticode when signing credentials were supplied
8. records architecture, compiler, CMake, Node.js, npm, Electron, electron-builder, and signing
   state in `windows-toolchain.json`.

### macOS

The macOS job, using the canonical `macos-universal` preset and CMake install stage:

1. builds and tests a universal `arm64`/`x86_64` native engine
2. runs renderer, Electron-boundary, and release-integrity tests
3. creates the ICNS icon, universal disk image, and guided PKG installer for `/Applications`
4. checks both architectures in the application and bundled engine
5. validates the PKG payload and runs the packaged numerical and UI/CSV smoke tests
6. verifies Developer ID Application and Installer signing and submits both installers to Apple
   notarization when credentials were supplied
7. records the toolchain, signing, and notarization state in `macos-toolchain.json`.

### Linux

The Linux job, using the canonical `linux-gcc` preset and CMake install stage:

1. builds and tests the x64 native engine
2. runs renderer, Electron-boundary, and release-integrity tests
3. creates AppImage and tar.gz desktop packages
4. runs the packaged numerical and UI/CSV smoke tests under Xvfb
5. records architecture, compiler, CMake, Node.js, npm, Electron, and electron-builder versions in
   `linux-toolchain.json`.

### Assembly and publication

The final job downloads all platform outputs and creates a clean, flat release directory. Duplicate
artifact filenames, missing platform toolchain fragments, symlinks, empty input collections,
partially configured credentials, tag/version mismatches, and malformed metadata fail the job.

The completed bundle is retained as a workflow artifact and attached to a GitHub release. A release
without valid Windows Authenticode plus macOS Developer ID signing and notarization is published as
a **pre-release**. Its manifest records the actual signing state.

## Signing credentials

No credential is committed to the repository. Configure secrets in the GitHub repository or its
protected release environment.

### Windows Authenticode

| Secret                     | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `WINDOWS_CSC_LINK`         | electron-builder certificate URL, path, or base64 PKCS#12 value |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the signing certificate                            |

Both values must be present together. If configured, the installer must return a valid
`Get-AuthenticodeSignature` result or the workflow fails.

### macOS Developer ID and notarization

| Secret                             | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `MACOS_CSC_LINK`                   | Developer ID Application certificate        |
| `MACOS_CSC_KEY_PASSWORD`           | Application-certificate password            |
| `MACOS_IDENTITY`                   | Developer ID Application identity qualifier |
| `MACOS_INSTALLER_CSC_LINK`         | Developer ID Installer certificate          |
| `MACOS_INSTALLER_CSC_KEY_PASSWORD` | Installer-certificate password              |
| `MACOS_INSTALLER_IDENTITY`         | Developer ID Installer identity qualifier   |
| `APPLE_ID`                         | Apple account used by `notarytool`          |
| `APPLE_APP_SPECIFIC_PASSWORD`      | App-specific password used by `notarytool`  |
| `APPLE_TEAM_ID`                    | Apple Developer team identifier             |

The three application-certificate values, three installer-certificate values, and three
notarization values are separate complete groups. Partial groups fail immediately. Application and
installer certificate groups must be enabled together, and notarization cannot be enabled without
both. The workflow waits for Apple's result, staples tickets to both installers, and validates the
staples before publication.

## Published integrity artifacts

Every release includes the application packages and the following support files:

| File                                                                         | Purpose                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `SHA256SUMS.txt`                                                             | SHA-256 for every package and support file except the checksum file     |
| `release-manifest.json`                                                      | Source, identity, model-data, toolchain, artifact, and signing metadata |
| `ballistics-workbench-<version>.cdx.json`                                    | CycloneDX SBOM generated from the committed npm lockfile                |
| `THIRD-PARTY-LICENSES.json`                                                  | Sorted dependency/license inventory derived from the SBOM               |
| Windows `.exe`, universal macOS `.pkg` and `.dmg`, Linux AppImage and tar.gz | Platform packages                                                       |

The release-manifest contract is
`release/release-manifest.schema.json` (JSON Schema Draft 2020-12). The manifest records:

- Tag, full source commit, repository, ref, generation time, and application version
- Engine, numerical-model, native-protocol, and profile-interchange identities
- The package-lock and validation-manifest SHA-256 values
- Every registered validation dataset's ID, path, and source-controlled checksum
- Package filename, size, SHA-256, platform, kind, signing state, and notarization state
- Each platform's compiler/tool versions and architecture
- SBOM, license-inventory, and checksum-file identities

Release metadata is generated from checked-in inputs. CycloneDX's random serial number and timestamp
are normalized to the tagged commit and release generation time. Signed packages are not expected to
be bit-for-bit reproducible because signing, notarization, disk-image, and upstream Electron tooling
may embed timestamps. The manifest records traceability and integrity. It does not claim that signed
binaries are reproducible.

## Local supply-chain checks

Generate the same lockfile-derived SBOM and license report without building installers:

```powershell
npm run release:supply-chain -- `
  --output build/supply-chain `
  --commit 0123456789abcdef0123456789abcdef01234567 `
  --generated-at 2026-08-18T12:00:00.000Z
```

For an assembled release directory, validate the manifest schema and every listed checksum:

```powershell
npm run release:verify-assets -- --directory outputs/release
```

Consumers on Windows can verify one downloaded installer directly:

```powershell
Get-FileHash -Algorithm SHA256 '.\Ballistics-Workbench-1.0.3-Setup.exe'
Get-AuthenticodeSignature '.\Ballistics-Workbench-1.0.3-Setup.exe'
```

On macOS or Linux, verify all downloaded release files from a directory containing
`SHA256SUMS.txt`:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

macOS users can also inspect the notarization ticket and application signature after
mounting the disk image:

```bash
xcrun stapler validate Ballistics-Workbench-1.0.3-universal.dmg
codesign --verify --deep --strict --verbose=2 '/Volumes/Ballistics Workbench/Ballistics Workbench.app'
```

Verify the guided installer directly with:

```bash
xcrun stapler validate Ballistics-Workbench-1.0.3-universal-Installer.pkg
pkgutil --check-signature Ballistics-Workbench-1.0.3-universal-Installer.pkg
```

## Dependency maintenance

Dependabot checks npm and GitHub Actions weekly. Minor and patch npm updates are grouped by runtime
or development role. Major upgrades stay separate for focused review. The ordinary CI workflow has
a dedicated supply-chain job that:

- Verifies version synchronization
- Runs `npm audit --audit-level=high`
- Generates the CycloneDX SBOM and license inventory
- Retains both reports as a workflow artifact

The response targets and Electron-specific review requirements are defined in `SECURITY.md`.
Automated pull requests are never auto-merged.

## Release checklist

1. Review the changelog and model-validity documentation.
2. Update `package.json`, `package-lock.json`, `CMakeLists.txt`, and the native engine version.
3. Update the model version only when the numerical model or built-in definitions changed, and
   regenerate every model artifact that carries that identity.
4. Run `npm ci`, `npm run format:check`, `npm run validate:artifacts`, `npm test`, and
   `npm run build`.
5. Run the CMake Release build, complete CTest suite, full native benchmark, interaction-budget
   assessment, clang-tidy gate, and aggregate validation-summary generator.
6. Run `npm run release:verify-version -- --tag v<version>`.
7. Commit the reviewed release state and push the exact `v<version>` tag.
8. Confirm all verification, Windows, macOS, Linux, and publication jobs passed.
9. Download the published bundle and independently validate `SHA256SUMS.txt`.
10. Inspect `release-manifest.json` for the expected commit, toolchains, reference checksums,
    signing status, and notarization status.
11. Confirm unsigned or partially signed output is marked as a pre-release.
12. Promote/document the release only after the expected signing and validation evidence exists.
