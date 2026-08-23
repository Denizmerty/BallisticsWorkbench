# Changelog

All notable changes to Ballistics Workbench are recorded in this file.

## Unreleased

- Added protocol-v2 advanced shot scenarios with inclined targets, optional ICAO lapse behavior,
  WGS84 local gravity, Coriolis acceleration, height/downrange wind layers, and source-labelled
  temperature/muzzle-velocity profiles. The native model, renderer, profiles, CSV export, batch
  runner, independent flight matrix, and strict protocol tests share the same conventions.
- Added seeded Monte Carlo trajectory uncertainty with bounded correlations, positive-semidefinite
  matrix validation, reproducible sampling, percentile bands, partial-coverage status, profiles,
  exports, renderer controls, and native/protocol tests. The first-order method remains available.
- Added an opt-in empirical buckshot D90 model with weighted calibration, physically separate
  holdout residuals, uncertainty, extrapolation status, circle/rectangle target integration, and a
  complete pellet-count probability distribution. It is available through the native core,
  protocol, profiles, UI, CSV, and documented measurement workflow without bundled assumed data.
- Replaced the fixed-gamma sound-speed approximation with the Cramer 1993 moist-air equation and
  added published sound-speed cases. Atmosphere responses now report evidence-backed density,
  sound-speed, and viscosity domain flags. One generated formula owner supplies C++ and TypeScript
  pressure-altitude, altimeter/station-pressure, and density-altitude conversions.
- Added x64 Linux AppImage and tar.gz packaging, packaged Xvfb smoke coverage, release-manifest
  classification, and CI/release artifacts alongside Windows and universal macOS. Benchmark
  history now records cross-run trends, while native retention/storage and serialized-sample counts
  expose the event-grid and process-boundary costs.
- Added an isolated parameterized native test framework, advanced-scenario CTest target, generated
  protocol structural field ownership, schema-validated batch execution, and deterministic packaged
  profile/drag-data file-dialog smoke paths.
- Added a strict version 1 drag-data interchange for constant/banded G1/G7 BC definitions and
  Mach–Cd curves. Bounded sandboxed import/export retains canonical units, source URL/citation,
  license, optional source checksum, declared domain, and a verified canonical payload SHA-256.
  Settings schema 9 and profile-interchange schema 2 persist that metadata. Older settings and
  version-1 profiles migrate to explicit user-entered provenance defaults. Added public schema,
  identity drift, renderer codec/UI, Electron boundary, migration, exact-size, and tamper tests.

- Replaced the native all-fields projectile/drag bag with composed projectile-definition,
  ammunition, firearm, and provenance owners plus mutually exclusive reference-BC, tabulated
  Mach-Cd, and sphere variants. Constant and velocity-banded BC definitions are mutually exclusive,
  custom twist is firearm-owned, and the parser constructs the active variant directly. Migrated
  the solver, calibration, diagnostics, response compatibility serialization, built-in catalog,
  independent validation/convergence matrices, benchmarks, and legacy CLI without numerical or
  protocol drift. Added a native property CTest covering 9,000 generated valid load definitions and
  targeted invalid variant boundaries.
- Reorganized the largest implementation files around explicit responsibility boundaries. The
  former 2,300-line native core now has dedicated trajectory-analysis, calibration, uncertainty/
  spin, and projectile-validation/catalog translation units alongside the integration/drag module.
  CLI `main.cpp` fell from roughly 820 lines to 40, with separate input, legacy-flag, protocol, and
  response modules. The renderer extracted its complete input sidebar and range/comparison tables,
  reducing `App.tsx` from 1,882 to about 1,150 lines. Profile public types and strict decoding are
  separate from workflow operations, and the 1,600-line stylesheet is divided into ordered
  foundation, shell, results, dialogs, and theme/responsive modules. Added six input-sidebar render
  tests while preserving the existing protocol, numerical, profile, build, and package contracts.
- Reduced the renderer application shell from 2,538 to about 1,900 lines by extracting the custom
  projectile dialog, toolbar, and pure nine-mode status view model. Added 31 focused rendering and
  view-model tests covering drag variants, validation/accessibility states, toolbar availability,
  metric/imperial diagnostics, atmosphere coverage, windage, holdover, events, drag validity, and
  MPBR. Added a deterministic native protocol mutation/property CTest that exercises a targeted
  malformed corpus plus 12,000 generated inputs, verifies exception-free parsing and acceptance/
  rejection invariants, and validates every structured error envelope. All canonical and sanitizer
  presets run it.
- Consolidated application, engine, model, protocol, profile-interchange, settings, and byte-limit
  declarations under one schema-backed product metadata authority. CMake now configures the native
  identity header directly from it, Electron and renderer share protocol DTOs/generated constants,
  and deterministic drift tests protect package, schema, fixture, validation, CI, and release
  consumers.

- Made CMake the sole authoritative native build graph and retired the duplicated Visual Studio
  solution/project definitions. Added aligned MSVC, GCC, Clang, universal macOS, and Clang
  ASan+UBSan configure/build/test presets, target-scoped C++20 and warnings-as-errors policy, a
  canonical `cmake --install` runtime/license stage consumed by Electron, cross-platform native and
  formatting orchestrators with Windows wrappers, strict stage/preset tests, and CI sanitizer
  coverage. Icon assets are excluded from code formatting and remain user-managed.
- Added a tag-driven Windows/macOS release pipeline with immutable-tag/version verification,
  native and packaged smoke gates, credential-aware Authenticode and Developer ID/notarization,
  automatic pre-release classification for unsigned builds, SHA-256 checksums, a CycloneDX SBOM,
  dependency-license inventory, and a strict release manifest tying artifacts to the source commit,
  engine/model/protocol/profile identities, platform toolchains, and every validation-data checksum.
  CI now has a separate high-severity dependency audit and supply-chain artifact job. Weekly grouped
  Dependabot updates and an Electron security-update policy are documented.
- Added named environment, rifle/shotgun firearm, built-in/custom ammunition, and combined-scenario
  profiles. Settings schema 8 persists them. A strict version 1 SI JSON interchange format supports
  bounded Electron open/save, explicit rename/replace/skip conflict policies, legacy settings
  migration, selective or complete export, and recoverable quarantine for malformed sibling or
  stored entries. The new profile manager and menu/keyboard paths are backed by schema, round-trip,
  migration, conflict, capacity, application, persistence, and Electron boundary tests.
- Added schema-backed, source-controlled effective-BC fit definitions for White Blackout HV,
  BlackShock, and Federal Power-Shok SP, plus a cross-platform generator that exercises the real
  native JSON calibration protocol and produces machine-readable residuals and deterministic
  documentation. Re-running those fits advanced model identity to `2026.08.8` and set the built-in
  G1 BCs to `0.054624734`, `0.070983794`, and `0.312322241`, respectively. Just-determined fits are
  accepted with an `insufficient_information` status, zero residual degrees of freedom, and no
  confidence interval. They cannot be presented as validation evidence.
- Added a deterministic 13-trajectory independent fixed-time RK4 flight matrix covering cold/dense
  and hot/thin atmospheres, three-dimensional wind and launch geometry, G1/G7/tabulated/sphere drag,
  every built-in load, sight zeroing, and MPBR. A dedicated native CTest target emits a strict
  schema-backed compiler/model-identified residual report on GCC, Clang, and MSVC. The current MSVC
  aggregate remains within 0.5 mm position, 0.005 m/s velocity, and 15 microseconds.
- Tightened the production adaptive-solver tolerances by one decade and advanced model identity to
  `2026.08.7` after a new cold/dense/headwind matrix demonstrated that the former defaults missed
  the proposed position/time budget. A schema-defined cross-compiler report now records analytical
  maximum-step refinement plus four 41-range production/half/tenth/reference tables. Current MSVC
  maxima versus a 1,000× tighter/25× smaller-step reference are approximately 0.065 mm,
  0.000613 m/s, and 1.18 microseconds. Added 3D rotation/reflection, conservation/dissipation, and
  independent brute-force MPBR tests, and made calibration recognize a parameter step below
  numerical resolution as convergence.
- Added a closed-form constant-Cd, one-dimensional deceleration test for the production adaptive
  integrator. It verifies velocity and time against exact range-domain solutions at 100 m, 300 m,
  and 500 m, using a documented reference-only gravity switch whose application default remains
  enabled. Failure diagnostics now include full-precision differences.
- Moved elevation holdover into the native core with exact `atan2(-path, distance)` semantics,
  advanced the model identity to `2026.08.6`, and added native first-order angular uncertainty.
  Protocol/runtime validation, charts, summaries, range tables, and CSV exports now consume native
  radians and only perform MOA/mil unit conversion. CSV also exports angular uncertainty intervals.
- Replaced both fixed 70-step Collins sphere-correction Bezier inversions with safeguarded Newton
  iteration, bracket enforcement, and a deterministic bisection fallback. A dense native test
  preserves the former correlation within `2e-13` absolute Cd across 11,709 Mach/Reynolds cases.
  one same-machine report-only MSVC run reduced the transonic-sphere 500 m median from 3.9050 ms to
  2.0057 ms (approximately 48.6%) without changing the numerical guard at displayed precision.
- Replaced the ambiguous synchronized pressure/altitude controls with mutually exclusive measured
  station-pressure, ICAO pressure-altitude, and altimeter-setting plus field-elevation modes. The
  UI now shows resolved station pressure, pressure altitude, and derived density altitude. Settings
  migrate to schema version 7. Native results and CSV exports identify the ideal-mixture density,
  fixed-gamma sound-speed, Sutherland-viscosity, and homogeneous firing-point-atmosphere models.
- Expanded atmosphere conformance with an independently generated eight-temperature NACA Report
  1135 Sutherland-viscosity dataset covering the complete -60–60 C application temperature range
  and three zero-frequency humid-air sound-speed rows from Gavioso et al. (2025), including their
  published uncertainties. The aggregate native report records current MSVC maximum differences of
  approximately 0.0361% for viscosity and 0.0820% for the three-case sound-speed matrix.
- Added a deterministic CIPM-2007 moist-air density reference generator, a checksummed nine-case
  source dataset within the published 15–27 C and 600–1,100 hPa domain, and a native per-sample
  residual report. The current ideal-mixture production model stays below a declared 0.1% density
  difference threshold, with a current MSVC maximum of approximately 0.0452%. Sound speed,
  viscosity, and the wider input domain remain separate work.
- Added checksummed source transcriptions for the B&P White Blackout HV and BlackShock values used
  by the built-in fits. The report identifies the exact 2018 Hunting Spot/B&P-test-bench table and
  the secondary White Blackout 50 m attribution, preserves that the table was calculated rather
  than raw chronograph data, and reports both loads as fitted-to-same-table calibration evidence.
- Added checksummed numerical transcriptions and durable primary-source metadata for Hornady 80971,
  Federal 308A, Winchester X123RS15, and Winchester XB1200/nominal buckshot diameters. Native tests
  now emit a separate manufacturer-table residual report, retain assumed-atmosphere and
  fitted-to-same-table labels, and keep the absence of manufacturer-controlled B&P source copies
  explicit.
- Added a documented validation-artifact layout with JSON schemas for sources, scenarios, fits,
  and reports, a six-load provenance/evidence inventory, checksummed GNU Ballistics G1 segment
  data, and automated checksum/reproducibility checks. Native tests now exercise every G1 segment
  and both sides of every boundary.
- Added an independent fixed-distance RK4 G7 reference path backed by the separately transcribed
  py-ballisticcalc v2.2.10 table. Source-controlled supersonic, transonic, and subsonic scenarios
  check Cd, acceleration, velocity, time, and vertical position, while CI uploads per-compiler
  maximum-residual reports.
- Added a report-only native benchmark executable covering six built-ins at 100/500/2,000 m, nine
  loads at 2,000 m, transonic sphere flight, strong wind, native MPBR, G7 calibration, and
  three-input uncertainty. CI records median/p95 timings without brittle pass/fail thresholds.
- Normalized source formatting across every code family. Long renderer status expressions were
  decomposed into named fragments, and the formatting scripts now cover all root Markdown and both
  Vite configuration files.
- Added a new application icon: a midnight-navy rounded tile carrying a white parabolic trajectory
  over arrowed x/y axes, with a copper spitzer projectile whose tip is aligned to the trajectory's
  end tangent. A hand-authored vector `assets/icon.svg` is the single source. The 1024 px PNG,
  multi-size Windows ICO, and reproducible macOS ICNS generation path are all derived from it so
  every platform shares the identical design.
- Hardened the Electron boundary with main-frame/sender authorization for every IPC action,
  bounded and shape-checked calculation/CSV payloads, production Content Security Policy headers,
  denied permission requests, blocked external navigation and popup creation, and cancellation of
  calculations owned by closed windows. The packaged smoke test now verifies a representative
  numerical result, configured zero, trajectory event, model identity, and load count.
- Added native trajectory-event analysis over the full solution horizon. Each load now reports
  near and far sight-line zeros, maximum ordinate, Mach 1.2/1.0/0.8 crossings, supersonic range,
  and ground intersection with explicit complete, horizon-limited, unavailable, or not-applicable
  states. Events are validated by the versioned protocol and appear in the overview, configurable
  status readout, copied summary, and CSV provenance.
- Added optional first-order uncertainty propagation for independent muzzle-velocity, BC/drag,
  temperature, station-pressure, headwind, crosswind, and sight-zero inputs. The native engine
  computes deterministic sensitivity derivatives, combines their one-sigma contributions by root
  sum square, and returns aligned velocity, energy, momentum, time, drop, sight-path, and wind-drift
  uncertainty. The desktop displays approximate 95% bands and half-widths and exports the inputs,
  method, status, standard deviations, and intervals to CSV.
- Added deterministic measured-velocity calibration for custom G1/G7 projectiles. The native
  weighted nonlinear least-squares fitter supports constant and fixed-threshold banded BCs,
  measurement uncertainty, calibration versus holdout roles, approximate 95% confidence intervals,
  separate calibration/holdout errors, residual inspection, fitted-BC application, and an
  engine/model-identified CSV residual report.
- Corrected the G7 reference drag table against the McCoy/BRL curve and added knot-by-knot
  conformance tests backed by a checksummed reference CSV.
- Decoupled MPBR calculation coverage from the requested display range. MPBR now carries an
  explicit completion status and no longer reports the trajectory endpoint as a numerical answer
  when its search horizon is insufficient.
- Added requested and covered distances plus trajectory termination status to native results.
  Renderer interpolation, comparison tables, charts, and CSV export no longer clamp requests past
  valid trajectory coverage, and the exact final covered point is always serialized.
- Corrected Mach, Reynolds number, and sphere drag diagnostics to use air-relative velocity while
  retaining ground speed for kinetic energy and momentum.
- Honored custom rifle twist overrides, exposed effective twist and gyroscopic stability, and made
  spin drift unavailable when the required projectile geometry is missing.
- Added generation-safe renderer calculations and native child-process cancellation so an older
  asynchronous request cannot replace newer results.
- Tightened CLI parsing to reject trailing numeric text, unknown arguments, duplicate arguments,
  and out-of-domain custom muzzle velocities.
- Added native sight-zero coverage independent of the display range, CSV formula neutralization,
  and explicit unavailable-value rendering.
- Replaced unchecked local-storage object spreading with a versioned settings envelope, legacy
  migration, runtime field filtering, and malformed custom-load rejection.
- Added the version 1 JSON calculation protocol with strict C++ parsing, discriminated custom drag
  definitions, structured validation issues, request-ID echoing, checked-in schema and fixtures,
  and renderer-side runtime response validation.
- Changed desktop calculation to send every custom load in one native request, eliminating repeated
  process launches and repeated built-in trajectory calculations.
- Added stable built-in and custom load IDs, migrated persisted custom loads to schema version 3,
  removed renderer assumptions that the first six result indexes identify built-in loads, and
  preserved custom-load selection while an updated result replaces a stale one.
- Made the C++ core validate projectile model combinations and changed development binary selection
  to prefer the canonical CMake output over potentially stale Visual Studio output.
- Replaced production distance-domain RK4 integration with adaptive time-domain Dormand–Prince
  5(4), dense range sampling, explicit distance/ground/speed/time/step/reversal termination, and
  per-trajectory convergence diagnostics. The former solver remains available only for A/B tests.
- Replaced post-hoc sight rotation with native bore-elevation solves for configured zeros and MPBR.
  The protocol now carries native sight path, bore angle, zero residual, zeroing status, and solver
  diagnostics. Analytical vacuum, tight-reference convergence, event, zero-error, legacy A/B, and
  sampling-invariance tests cover the new engine.
- Added constant-or-velocity-banded BC schedules for custom G1/G7 loads, with strict ordering,
  complete low-speed coverage, exact transition semantics, protocol/runtime validation, UI editing,
  persistence schema version 4 migration, and CSV provenance.
- Added engine/model version identity to every protocol response and export. Sphere results now
  declare the current correlation's Mach/Reynolds support box, report observed ranges, and emit a
  structured warning whenever the displayed trajectory requires extrapolation.
- Added custom tabulated Mach–Cd drag with 2–64 strictly ordered points, linear interpolation,
  explicit frontal reference diameter, persistence schema version 5, UI editing, protocol/runtime
  validation, and CSV provenance. Endpoint Cd clamping outside the supplied Mach domain is visible
  through structured extrapolation warnings.
- Unified explicit-Cd acceleration through the physical drag equation. G1 is now converted to an
  equivalent reference Cd without changing its legacy numerical semantics, while G7, sphere, and
  custom Mach–Cd models share the same force-law implementation.

## 1.0.2 - 2026-08-08

- Licensed Ballistics Workbench under the GNU General Public License, version 3 or later, and added
  author and support contact details to the application Help page and README.

## 1.0.1 - 2026-08-08

- Reworked the desktop interface into a compact engineering layout with clearer grouping, a
  configurable status strip, responsive controls, aligned field rows, readable numeric inputs,
  safer long-name wrapping, and complete light and dark themes.
- Added a sight-in zero and holdover solution. New shotgun and rifle zero-range inputs place the
  trajectory relative to the line of sight, giving bullet path (above/below sight line) and the
  elevation come-up in both MOA and mil. These appear in the overview cards, range table, all-load
  chart (sight-path and holdover metrics), a new Holdover status mode, and CSV export. The geometry
  uses the same small-angle superposition as the maximum-point-blank-range routine and is covered
  by unit tests. The sight-in zero is distinct from the optimal zero reported for MPBR.
- Added crosswind wind drift. The trajectory solver now integrates a full three-dimensional
  velocity state, so a crosswind input produces lateral drift from the air-relative drag. Wind
  drift, spin drift, and combined total windage appear in the
  overview cards, range table, all-load chart, status readout, and CSV export, with a new
  crosswind atmospheric input. With no crosswind, results are identical to the previous
  vertical-plane trajectory (verified against the native regression suite).
- Grouped thousands separators across every on-screen figure so energies, velocities, and
  Reynolds numbers read cleanly. Non-finite values now render as `N/A`.
- Added per-field validation highlighting: out-of-range inputs turn their own field red with a
  tooltip, alongside the existing error summary.
- Made the All-load calculator sortable. Click any column heading to sort ascending or descending.
- Added a **Copy summary** action that places the selected load's values at the reference distance
  on the clipboard.
- Added keyboard navigation: number keys `1`–`4` switch tabs and the arrow keys (or `[` / `]`)
  cycle the selected load. The active tab is now remembered between sessions.
- Refined the trajectory chart with a subtle shaded area under the selected load and grouped axis
  labels, and completed the dark theme for alert boxes, scrollbars, and chart hints.
- Added `scripts\build-release.cmd` for one-command Release x64 compilation, native and renderer
  tests, NSIS installer packaging, and optional launch of the unpacked application.

## 1.0.0 - 2026-08-06

- Added a C++20 numerical core with G1, G7, and Reynolds–Mach sphere drag models.
- Added six built-in shotgun and .308 Winchester loads.
- Added atmosphere, firearm-profile, maximum point-blank range, and spin-drift calculations.
- Added the React and Electron desktop interface with metric and imperial units.
- Added interactive all-load charts, range tables, payload totals, custom loads, and CSV export.
- Added native regression tests and renderer unit tests, Visual Studio and CMake builds,
  cross-platform continuous integration, and Windows installer packaging.
