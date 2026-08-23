# Security policy

## Supported versions

Ballistics Workbench is pre-production software. Security fixes are applied to the latest release
line and the default branch. Older installers are not maintained once a newer release is published.
Users should install complete application updates. Replacing only the bundled native engine can
leave the desktop and protocol versions out of sync.

## Reporting a vulnerability

Do not disclose an exploitable vulnerability in a public issue. Use GitHub's **Report a
vulnerability** private advisory form for this repository. Include the affected version and
platform, reproduction steps, impact, and any suggested mitigation. Limit firearm and personal
information to details needed to reproduce the software defect.

The maintainer will acknowledge a complete report within seven days when reasonably possible.
Timelines depend on severity, reproducibility, and signing/notarization access. Coordinated public
disclosure should wait until an update or mitigation is available.

## Dependency and Electron update policy

- Dependabot checks npm and GitHub Actions dependencies weekly. Lockfile changes must pass the full
  native, renderer, Electron-boundary, artifact-validation, packaging, and smoke-test matrix.
- CI performs a separate `npm audit` gate at high severity and generates a CycloneDX SBOM plus a
  machine-readable third-party license inventory from the committed lockfile.
- Critical Electron/Chromium security releases are reviewed as soon as practical, with a target of
  seven days. High-severity releases are targeted within fourteen days. Lower-severity and routine
  runtime updates may follow the normal dependency cycle.
- Electron major-version upgrades require packaged smoke tests and review of context isolation,
  sandboxing, navigation, permission, preload, IPC, CSP, file-dialog, and child-process boundaries.
- Automated dependency pull requests are never auto-merged. Manual review still covers upstream
  release notes, transitive packages, licenses, and build scripts.

## Release integrity

Tag-driven releases verify that package, lockfile, CMake, native engine, model, protocol, and profile
interchange identities agree. Each release contains SHA-256 checksums, a CycloneDX SBOM, a dependency
license inventory, and a release manifest tying binaries to the source commit, validation-data
checksums, and platform toolchains.

When signing credentials are configured, Windows installers must have a valid Authenticode
signature and macOS disk images must contain a Developer ID-signed application and pass Apple
notarization before the release is considered production-signed. Builds without both credential
sets are published only as pre-releases and are identified as unsigned or partially signed in the
release manifest.
