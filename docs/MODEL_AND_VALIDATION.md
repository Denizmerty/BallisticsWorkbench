# Model and Validation

## Scope

Ballistics Workbench calculates point-mass external trajectories for G1, G7, and spherical
projectiles. It reports velocity, energy, momentum, flight time, vertical displacement, Mach
number, maximum point-blank range, optimized zero, integrated crosswind drift, and an empirical
rifle spin-drift estimate, along with the combined total windage. Given a sight-in zero it also
reports the bullet path relative to the line of sight and the elevation holdover in MOA and mil.

The engine integrates each trajectory numerically. It does not interpolate a precomputed range
card.

## Domain and protocol validation

The C++ core validates projectile identity, mass, muzzle velocity, payload count, drag-model
parameters, and mutually exclusive sphere/reference-BC/tabulated-Cd fields before integration. The desktop sends
one versioned JSON request containing the scenario and all custom loads. Custom drag input is a
discriminated `referenceBc`, `tabulatedCd`, or `sphere` object, so incompatible mass, geometry,
curve, and ballistic-coefficient fields are rejected when combined incorrectly.

Protocol failures are returned as structured issues with stable codes, field paths, messages, and
error/warning severity. The renderer independently validates the response envelope, request ID,
load IDs, finite numerical fields, increasing sample distances, coverage, and exact final endpoint
before results can reach the UI. The canonical version 2 schema is stored in
`protocol/ballistics-protocol.schema.json`.

## Validation evidence repository

`validation/README.md` defines separate locations and evidence levels for source facts,
SI-normalized inventories, independent scenarios, fitting inputs, and generated residual reports.
Twelve Draft 2020-12 schemas cover sources, scenarios, fit definitions and reports, general
residual reports, manufacturer tables, atmosphere, convergence, the expanded flight matrix, native
benchmarks, and full interaction performance.
`npm run validate:artifacts` checks registered SHA-256 values, required manufacturer metadata,
cross-links from the six-load inventory, the three built-in fit definitions, G1 source structure,
the required G7 flight regimes, all seven expanded-matrix categories and six built-ins, and
byte-for-byte regeneration of both independent scenario artifacts, the generated fit evidence, and
the complete source-owned [`VALIDATION_EVIDENCE.md`](generated/VALIDATION_EVIDENCE.md) inventory.
The eight-report register in the manifest drives a second aggregate summary under
`build/validation/VALIDATION_SUMMARY.md`. CI generates and uploads that summary with the underlying
JSON reports. Run-specific values in this guide are kept in those generated documents.

`validation/normalized/builtin-loads.json` records the implemented values, present evidence level,
linked source datasets, and unresolved provenance gaps for every built-in load. The manifest now
durably identifies and checksums numerical transcriptions from primary manufacturer publications
for Winchester X123RS15, Hornady 80971, Federal 308A, and Winchester XB1200/00-buck nominal
diameter. It also captures the exact White Blackout HV and BlackShock values from a 2018 Hunting
Spot report of a B&P test-bench study and the White Blackout 50 m value that Caccia Magazine
attributes to B&P. Those B&P records are classified as manufacturer-attributed secondary
publications because no manufacturer-controlled copy was located. The inventory states missing
document archives, lot/barrel details, atmosphere, measurement method, rounding, and uncertainty
as unresolved gaps. It also keeps calibration data separate from validation evidence.

The native validation target regenerates a machine-readable manufacturer conformance report under
the build directory. It compares velocities for all five G1 built-ins, retains every source ID and
its qualification, and distinguishes manufacturer-published coefficients from coefficients fitted
to the same table. The primary manufacturer tables use a 0.5% relative acceptance limit. The two
B&P loads use 1% because the implementation treats the published V1 value as launch velocity and
the source omits its calculation atmosphere. All comparisons use an assumed ICAO-like
standard atmosphere of 15 C, 1013.25 hPa, 0% relative humidity, and no wind. The generated run
summary reports each load's maximum residual, tolerance, parameter status, source qualification,
and pass state. The B&P report describes the velocity table as calculated. The B&P loads and
Federal remain calibration-only. These checks establish publication-table conformance. They
provide no independent empirical accuracy evidence.

The source-controlled definitions in `validation/fitting` reproduce the effective BCs for White
Blackout HV, BlackShock, and Federal through the real native protocol. CTest writes a strict fit
report and regenerates [`BUILTIN_FIT_EVIDENCE.md`](generated/BUILTIN_FIT_EVIDENCE.md). All inputs are
calibration observations from the same publication tables and none is a physically separate
holdout. The artifact demonstrates coefficient reproducibility, with no claim of predictive
validity.

## Atmosphere

The atmosphere model derives moist-air density, dynamic viscosity, and local speed of sound from:

- temperature
- station pressure
- relative humidity
- headwind or tailwind, and crosswind.

The desktop exposes three mutually exclusive pressure sources:

- measured station pressure, meaning the actual pressure at the firing point
- pressure altitude, converted through the ICAO standard-troposphere relationship
- aviation altimeter setting plus geometric field elevation, reduced to station pressure with the
  NOAA/NWS station-pressure equation. Altimeter setting is not mean-sea-level pressure.

Every source resolves to station pressure before the native calculation request is created. The UI
shows that resolved pressure and its standard-atmosphere pressure altitude. It also derives density
altitude from the calculated moist-air density. Density altitude is a result, not a second pressure
input. Geometric altitude is used only to reduce an altimeter setting. The native trajectory model
uses one homogeneous atmosphere evaluated at the firing point and does not change air properties
with projectile elevation. See the [NWS pressure definitions](https://www.weather.gov/bou/pressure_definitions)
and [NWS station-pressure formula](https://www.weather.gov/media/epz/wxcalc/stationPressure.pdf)
for the operational distinction and reduction equation.

Each successful protocol result and CSV export identifies the implemented density
(`ideal_moist_air_mixture`), sound-speed (`cramer_1993_400_ppm_co2`), and viscosity
(`sutherland_110_333_k`) models. It also identifies whether altitude behavior is
`homogeneous_at_firing_point` or `icao_lapse_from_firing_point`. Both wind components are applied
through air-relative projectile velocity.

Atmosphere properties have a source-controlled conformance baseline, and the native suite emits all
per-case results to `build/validation/atmosphere-conformance-residuals.json`:

- Density uses an independent CIPM-2007 generator with nine cases spanning 15–27 C, 600–1,100 hPa,
  and 0–100% relative humidity at a carbon-dioxide mole fraction of 0.0004.
- Dynamic viscosity uses an independent implementation of NACA Report 1135 equation A3 at eight
  temperatures covering the complete -60–60 C application range.
- Sound speed uses four rows transcribed from Gavioso et al. (2025) at 0–50 C, 1,013.25 hPa,
  40–80% relative humidity, and carbon-dioxide mole fraction 0.000368. The first three rows are at
  zero frequency. The 50 C row retains its published 10 kHz frequency and is an explicit
  extrapolation case. All four published standard uncertainties are retained.

The generated run summary records each property model, declared comparison domain, sample count,
maximum relative residual, tolerance, and pass state. Each density and viscosity reference stays
inside its source's stated formula domain. The sound-speed result covers only the four directly
published cases.

These results quantify the current approximations. Production density does not implement
CIPM-2007. Its saturation-vapor-pressure approximation and omission of the CIPM compressibility
factor remain explicit model differences. Production sound speed implements the complete Cramer
1993 polynomial at 400 ppm carbon dioxide. It is checked against the independently published
Gavioso values. The reference calculation does not reuse the Cramer equation.

The machine-readable validity flags use the evidence-backed ranges. Density is source-qualified
only from 15–27 C and 600–1,100 hPa. Sound speed is source-qualified only from 0–30 C and
750–1,020 hPa. Viscosity is qualified from -60–60 C. The application accepts a wider atmosphere
input range and still computes finite values there, but marks those results outside the applicable
declared domain. Humidity, gas composition, and acoustic frequency coverage remain bounded by the
source evidence described above.

## Drag models

### G1

The G1 implementation uses the piecewise Ingalls/Mayevski retardation law. The built-in shotgun
slugs and .308 Winchester loads use G1 ballistic coefficients. A custom reference load may use one
constant BC or an ordered velocity-banded schedule. The first band begins at 0 m/s. At each force
evaluation the active band is the one with the greatest minimum velocity not exceeding current
airspeed. Thresholds are exact and right-continuous. The retardation law is converted to
an equivalent standard-projectile reference Cd and evaluated through the shared physical force
equation. This algebraically preserves the previous G1 trajectory semantics.

The 39 effective GNU Ballistics coefficient/exponent bands are checked in as
`validation/sources/g1-gnu-ballistics.csv`. The native validation suite evaluates an interior point
in every segment and both sides of every nonzero boundary, including the exact right-continuous
selection convention used by the engine.

### G7

The G7 implementation uses a Mach-indexed reference drag-coefficient table with linear
interpolation. The canonical transcription and its source metadata are stored in
`validation/sources/g7-mccoy.csv` and `validation/manifest.json`. The native conformance suite
checks every table knot. G7 is available for custom projectiles. None of the built-in loads uses
it.

An independent reference generator uses a separately transcribed py-ballisticcalc v2.2.10 G7
table and a fixed-distance classical RK4 state formulation. The production solver uses an adaptive
time-domain integrator. The reference checks Cd and physical acceleration at Mach 0.9, 1.0, 1.2,
2.0, and 3.0, then compares source-controlled supersonic, transonic, and subsonic trajectories. The
generated run summary records the maximum velocity, time, and position residuals for every regime.

Those scenarios establish numerical conformance for standard sea-level, no-wind reference cases.
They do not independently validate real projectile BCs, nonstandard atmospheres, wind behavior, or
the G7 model's empirical suitability for a particular bullet.

### Expanded independent flight matrix

A second reference generator integrates `[x, y, z, vx, vy, vz]` with a fixed-time, 20-microsecond
classical RK4 method. It shares neither production integration path. It separately reads the GNU G1
bands and py-ballisticcalc G7 table, implements physical tabulated-Cd drag, and evaluates the
Morrison/Collins sphere correction with an 80-step bisection inversion. The production code uses a
safeguarded Newton method. The reference uses the declared moist-air density, fixed-gamma sound-speed, and
Sutherland-viscosity equations through an independent JavaScript transcription.

The source-controlled matrix contains 13 five-range trajectories: cold/dense strong headwind,
hot/thin tailwind, opposed azimuth/crosswind, steep downward fire, low-velocity subsonic G7,
transonic tabulated Cd, a sphere case, and all six built-in loads. Separate cases solve a 100 m
sight zero by bisection and a 20 cm vital-zone MPBR by a dense elevation/grid search. A dedicated
native target emits `build/validation/flight-matrix-residuals.json` on GCC, Clang, and MSVC.

The generated run summary records aggregate and per-scenario position, velocity, and time residuals
plus the sight-zero and MPBR case results. The JSON report retains the full residual set, including
ground speed, airspeed, Mach, and drag coefficient.

This matrix validates an independent implementation of the declared formulas and their
combination. It contains no raw projectile-flight evidence and does not establish BC suitability,
real-atmosphere model error, or the empirical accuracy of the smooth-sphere correlation.

### Custom tabulated Mach–Cd

A custom projectile may provide 2–64 strictly increasing Mach knots, a positive Cd at every knot,
its mass, and an explicit drag reference diameter. Cd is linearly interpolated between adjacent
knots so every supplied value is preserved exactly and the transonic peak cannot overshoot as it
could under an unconstrained cubic spline. The acceleration magnitude is

```text
a_drag = density × Cd × frontal_area × airspeed² / (2 × projectile_mass)
frontal_area = π × reference_diameter² / 4
```

The first and last knots define the curve's declared Mach domain. Outside that domain the nearest
endpoint Cd is held constant so the trajectory remains inspectable. The load is marked
`extrapolated` and a structured warning states that endpoint clamping occurred. The model declares
no Reynolds support range. Instantaneous Reynolds number is diagnostic only. Curve provenance is
supplied by the user and is exported with the load data.

### Sphere

Spherical projectiles use Morrison's Reynolds-dependent smooth-sphere drag correlation with a
Collins transonic correction fitted to Miller–Bailey sphere-drag data. Drag coefficient and
Reynolds number are reported for spherical loads at each range point.

The Collins correction's two monotone cubic-Bezier x inversions use safeguarded Newton iteration
with a maintained bracket and deterministic full-precision bisection fallback. A native regression
test compares 11,709 Mach/Reynolds combinations against the former 70-step bisection implementation
and limits the maximum absolute Cd difference to `2e-13`. The canonical benchmark report includes
the transonic-sphere workload. Timing is report-only and does not quantify physical model accuracy.

The current combined correlation declares support over Mach 0.2–1.5 and Reynolds number
100–2,000,000. The engine continues calculating outside that box so partial and long-range results
remain inspectable. It marks the load `extrapolated`, returns both supported and observed ranges,
and emits a structured warning. These bounds describe the implemented fit. Real pellets may not
behave as ideal smooth spheres throughout the box.

The built-in 00-buck load models an isolated 0.330-inch pure-lead pellet. Pellet deformation,
pellet-to-pellet interaction, buffering, and pattern spread are outside the model.

Every response and CSV export includes an engine version and a separately advanced model version.
The latter identifies numerical/model semantics independently of the desktop package version.

## Measured-velocity BC calibration

Custom G1 and G7 projectiles can fit either one constant ballistic coefficient or two to four
coefficients associated with fixed, strictly increasing velocity-band thresholds. The input is a
strictly increasing series of range/velocity observations. Every observation carries a one-sigma
velocity uncertainty and is marked `calibration` or `holdout`.

The native fitter minimizes the weighted calibration-only objective

```text
sum(((predicted_velocity - measured_velocity) / velocity_standard_deviation)^2)
```

using a deterministic Levenberg-Marquardt iteration with central numerical derivatives. It fits
logarithmic BC parameters, constraining each coefficient to 0.005-2.0. Holdout observations never
enter the objective or derivatives. The number of calibration points must be at least the number of
fitted coefficients. A just-determined fit is allowed so a published one-point decay value can be
reproduced. Such a fit has zero residual degrees of freedom, returns `insufficient_information`, and
omits confidence bounds. A singular information matrix also returns no confidence interval.

The response reports every measured and predicted velocity, raw and normalized residual,
uncertainty, and role. Calibration RMSE, weighted RMSE, and held-out RMSE are separate values. The
desktop can export all inputs, fitted values, confidence bounds, residuals, engine version, and
model version as a reproducible SI CSV report before applying the coefficients to the custom load.

Approximate 95% confidence intervals come from the inverse final weighted Jacobian normal matrix on
the log-BC scale. The variance multiplier is at least one and increases with reduced chi-square, so
underestimated measurement scatter does not artificially narrow the reported interval. These are
local, model-conditional intervals: they do not cover systematic chronograph error, range error,
atmosphere error, muzzle-velocity error, drag-model mismatch, or correlated observations.

A converged fit without a holdout is labelled calibration-only. With holdout points, the tool may
report held-out error for that supplied dataset. This still does not establish validity for other
projectiles, lots, barrels, atmosphere, or velocity regimes. Velocity decay is preferred to
long-range drop for drag fitting because drop also confounds zero, sight geometry, wind, range, and
shooter error.

## Trajectory uncertainty

The optional uncertainty calculation accepts independent one-sigma standard deviations for each
firearm profile's muzzle velocity and sight-zero range, plus relative BC/drag, temperature, station
pressure, headwind, and crosswind. A zero value disables that contribution. For G1/G7 loads the
relative drag input is interpreted as relative BC uncertainty. For sphere and custom Mach-Cd loads
it is a multiplicative drag-scale uncertainty.

The engine estimates local sensitivities with bounded central finite differences and combines the
independent contributions by root sum square:

```text
sigma_output = sqrt(sum((d(output) / d(input) * sigma_input)^2))
95% half-width = 1.9599639845 * sigma_output
```

Muzzle-velocity, drag, atmosphere, and wind perturbations retain the nominally solved bore angle:
they describe variation between shots after the firearm has been zeroed. Zero-range uncertainty is
different. Each perturbation solves a new bore elevation at the perturbed zero range. Ordinary
ammunition or weather variation keeps the nominal bore angle and is not removed by re-zeroing.

Results are aligned exactly with the baseline trajectory and include standard deviations for
ground speed, energy, momentum, flight time, drop, sight-relative path, and integrated wind drift.
The response reports active and successfully completed input counts plus `complete`, `partial`,
`no_inputs`, or `baseline_unavailable` status. The desktop draws and labels a confidence band only
for a complete result. Partial derivatives remain diagnosable in the protocol without being shown
as a complete interval. Spin-drift uncertainty is not currently propagated, so no band is shown
for spin drift or combined windage.

The first-order method is deterministic and local. It assumes independent inputs and is most useful
when the response is close to linear over the entered uncertainty range. It does not cover
drag-model-form error or projectile-to-projectile shape variation.

The Monte Carlo method draws a seeded multivariate normal sample set. It supports bounded pairwise
correlations, validates the correlation matrix as positive semidefinite, and reports percentile
bands aligned with the baseline output ranges. The same seed and inputs reproduce the same sample
sequence. Invalid physical samples and trajectories that do not cover an output point are tracked
through the method status and completed-sample count. Monte Carlo handles correlation and local
nonlinearity, but its percentiles are still conditional on the selected input distributions and
point-mass model.

CSV export records the method, seed, sample count, correlations, entered one-sigma values, result
status, and interval values so either calculation remains auditable.

## Trajectory integration

The production engine advances Cartesian position and velocity directly in time with an adaptive
Dormand–Prince 5(4) method. The embedded fourth-order estimate controls accepted step size. Dense
Hermite interpolation places samples and range events at exact downrange coordinates. The state is
three-dimensional, so gravity, aerodynamic deceleration, and wind are evaluated together within
each step. Kinetic energy and momentum are derived from the integrated velocity. The former
distance-domain RK4 implementation remains callable only for validation A/B tests.

Model version `2026.08.11` retains relative, absolute-position, and absolute-velocity tolerances of
`1e-9`, `1e-9 m`, and `1e-8 m/s`. Those defaults replaced the former one-decade-looser values after
a cold, dense, strong-headwind convergence case exceeded the proposed position and time budgets.
Later model revisions added source-controlled effective BCs, advanced environment effects, the
Cramer sound-speed equation, spin-stability domain gating, empirical buckshot analysis, and
evidence-backed atmosphere validity flags.
The generated adaptive-convergence report evaluates 41 ranges in each of four G1, G7, and
tabulated-Cd scenarios against a reference with 1,000× tighter tolerances and a 25× smaller maximum
step. The generated run summary records the production budgets, maximum errors, half-tolerance
changes, display resolutions, and status for each scenario.

The report also records a maximum-step refinement table against the exact constant-Cd horizontal
solution. Its observed orders include the cubic-Hermite range-sampling stage and are not presented
as the internal Dormand–Prince tableau order. This is numerical self-convergence evidence. The
separately implemented fixed-distance RK4 G7 scenarios remain the independent solver comparison.

Wind is supplied as separate headwind and crosswind components and enters the model through the
air-relative velocity `v_rel = v_ground − v_wind`. Drag always acts opposite `v_rel`, so a
crosswind produces a lateral acceleration and genuine downrange drift inside the integrated state.
Positive crosswind blows from the shooter's left to right and drifts the projectile to the right.
With no crosswind, the lateral state remains exactly zero and the solution reduces to the
vertical-plane trajectory. Integrated wind drift agrees with the classical point-mass "lag time"
approximation, `drift ≈ crosswind × (time_of_flight − range / muzzle_velocity)`, to within a few
percent.

Each returned sample carries ground-frame velocity, air-relative velocity, ground speed, airspeed,
and aerodynamic diagnostics derived from that airspeed. Energy and momentum use ground speed.

Every trajectory result reports its requested distance, actual covered distance, termination
reason, accepted and rejected step counts, accepted step-size range, final step size, and maximum
normalized error estimate. A completed solve includes the exact requested endpoint. Ground impact,
minimum forward speed, maximum time, maximum steps, horizontal reversal, and non-finite state are
defined partial-result events. Interpolation, tables, charts, and exports do not extrapolate past
their covered distance. Because integration is in time, horizontal reversal has no `1/vx`
singularity.

For multi-projectile payloads, the reported payload energy and momentum are scalar arithmetic
totals:

```text
payload value = one-projectile value × payload count
```

The total does not imply that separate pellets travel or transfer energy as one solid projectile.

## Maximum point-blank range

The maximum point-blank range calculation includes:

- the selected vital-zone diameter
- bore-to-sight offset for the applicable firearm profile
- gravity
- aerodynamic drag.

The engine varies actual bore elevation and reintegrates the trajectory. The optimized zero is
selected so that the native trajectory's maximum ordinate reaches one-half of the vital-zone
diameter, then the far sight-line and lower vital-zone crossings are located on that trajectory.

The MPBR solution uses an internal calculation horizon independent of the display range. It is
reported only after the lower vital-zone crossing is covered. Otherwise, the result is marked
`horizon_limited`, `no_solution`, or `invalid_geometry` without substituting an endpoint value.
An independent test-only grid optimizer enumerates bore elevations, rejects trajectories whose
maximum ordinate exceeds the vital-zone radius, and selects the feasible trajectory with the
farthest lower crossing. Its zero and MPBR agree with the native root search within 0.5 m.

## Sight-in zero and holdover

Each firearm profile also carries a user-set **zero range**, the distance at which the sight is
actually zeroed. The engine solves the required bore elevation
by root-finding on the integrated vertical position, then reintegrates the entire shot at that
angle. The path comes directly from the native state:

```text
path(x) = integrated_vertical_position(x) − sight_height
```

`path(x)` is positive above the line of sight and negative below it. It equals `−sight_height` at
the muzzle and zero at the sight-in distance. The elevation holdover (come-up) is the angle
subtended by the path deficit, reported in both minutes of angle and milliradians:

```text
holdover = atan2(−path(x), x)      (radians, positive means hold up)
MOA = holdover × 3437.75           mil = holdover × 1000
```

The native core computes this angle and its first-order uncertainty before serialization. The
renderer only interpolates native values for display and converts radians to MOA or mil. Because
holdover is angular, it is independent of the metric or imperial unit selection. At zero distance,
where an aiming correction is undefined, the protocol convention is zero.

## Trajectory events

Event analysis runs on the natively zeroed trajectory through the complete solution horizon, not
only the shorter display/table range. The engine reports:

- the rising **near zero** and falling **far zero** crossings of the sight line
- the **maximum ordinate** and its range, measured as path above the sight line
- accelerating or decelerating crossings of Mach 1.2, 1.0, and 0.8
- **supersonic range**, defined as the first decelerating Mach 1.0 crossing for a projectile that
  starts supersonic
- **ground intersection**, defined as the falling crossing of the muzzle-height horizontal plane.

Sight-line and ground roots use cubic Hermite interpolation in range. The endpoint vertical
positions and integrated slopes `vy/vx` define each segment, which avoids moving an event when the
public range-table step changes. Mach crossings use linear interpolation between the solver's dense
retained states.

Each event family carries a status. `complete` means the defining crossing was found.
`horizon_limited` means it was not found before the solution horizon. `baseline_unavailable` means
the zeroed trajectory could not be analyzed. `not_applicable` is used when a subsonic launch has
no supersonic range. Missing crossings remain null. Trajectory endpoints are never presented as
event answers. The overview, status readout, copied summary, protocol, and CSV export preserve these
semantics.

## Spin drift

Rifle spin drift uses a Miller stability estimate with velocity and air-density corrections,
followed by the Litz empirical time-of-flight relationship. Twist rate and direction belong to the
rifle profile. A positive custom twist-rate override takes precedence over the profile twist.
Effective twist and gyroscopic stability are returned with the result. When bullet length or
diameter is missing, spin drift is reported as unavailable.

The drift correlation is evaluated only for `1.0 <= Sg <= 3.5`. A value below 1.0 is returned with
an `unstable` status. A value above 3.5 receives `outside_empirical_domain`. Neither case is assigned
a spin-drift displacement. These bounds follow Don Miller's 2005 stability definition and the
upper end of the experience he cited. The native suite reproduces his published 168-grain,
0.308-inch sample calculation. The original Miller rule is for substantially solid bullets. The
application does not apply a modified Miller formula to plastic- or open-tipped designs because it
does not collect the required metal-length and tip-geometry fields.

Positive drift indicates rightward displacement for right-hand twist. The result is an empirical
estimate, not a six-degree-of-freedom calculation.

## Built-in load data

| Load                  |                Mass | Muzzle velocity | Drag data         | Notes                                          |
| --------------------- | ------------------: | --------------: | ----------------- | ---------------------------------------------- |
| White Blackout HV     |                28 g |         575 m/s | G1 BC 0.054624717 | Effective BC fitted to 33 m and 50 m data      |
| BlackShock            |                32 g |         455 m/s | G1 BC 0.070967376 | Effective BC fitted to 33 m data               |
| Winchester X123RS15   |                1 oz |      1,760 ft/s | G1 BC 0.068       | Manufacturer-published BC                      |
| Hornady A-MAX         |              168 gr |      2,700 ft/s | G1 BC 0.475       | Manufacturer BC, 24-inch test barrel           |
| Federal Power-Shok SP |              150 gr |      2,820 ft/s | G1 BC 0.312368145 | Effective BC fitted to published velocity data |
| Winchester 00 buck    | 53.96 gr per pellet |      1,325 ft/s | Sphere            | Nine nominal 0.330-inch lead pellets           |

The native suite separates fixed legacy regression snapshots from production-solver verification.
It covers every G1 segment/boundary, every G7 reference-table knot, the independent three-regime G7
comparison, the 13-trajectory independent environment/model matrix with sight-zero and MPBR cases,
checksummed manufacturer velocity tables and generated conformance residuals, an
analytical vacuum trajectory, exact constant-Cd one-dimensional deceleration,
production/half/tenth/reference convergence tables, three-dimensional rotation and reflection
properties, mechanical-energy and horizontal-momentum conservation, drag-only dissipation,
adaptive-step diagnostics, all termination events, exact endpoint inclusion, zero error below 0.1
mm, MPBR sampling invariance, brute-force optimization agreement, and native vital-zone crossings,
legacy A/B tolerances, atmospheric
properties, air-relative diagnostics, twist sensitivity, spin direction, crosswind behavior,
sphere diagnostics, Mach–Cd interpolation/clamping, physical-force reconstruction, custom-curve
validity, malformed-curve rejection, synthetic constant and velocity-banded BC recovery,
confidence-bound coverage, and calibration/holdout separation.

The constant-Cd case isolates drag integration by using a reference/test solver configuration with
gravity disabled, then compares velocity and time at 100 m, 300 m, and 500 m with the exact
quadratic-drag range-domain solution `v(x) = v0 exp(-k x)` and
`t(x) = (exp(k x) - 1) / (k v0)`. The application uses the unchanged configuration default, which
keeps gravity enabled.

## Limitations

The calculation is a point-mass engineering model. It does not provide CFD or a
six-degree-of-freedom simulation. Its remaining exclusions include:

- launch yaw or aerodynamic jump (including the jump a crosswind induces at the muzzle)
- projectile-specific choke interaction or deformation aerodynamics
- pellet-to-pellet wake or swarm aerodynamics
- dynamic instability.

Crosswind drift and optional Coriolis acceleration are integrated as point-mass effects. The
separate empirical buckshot pattern model can fit measured D90 pattern data and pellet-count
probabilities, but it does not infer the excluded aerodynamics. Its input, fit, probability model,
and evidence boundary are documented in [Empirical buckshot pattern analysis](BUCKSHOT_PATTERN.md).

Slug coefficients are fitted from limited measurements, and uncertainty increases outside the
measured range and during transonic flight. Always confirm calculated results with real-world
chronographing and zeroing.
