# Validation Evidence Inventory

> Generated from `validation/manifest.json` and
> `validation/normalized/builtin-loads.json`. Change those records, then regenerate this file.

Model version: `2026.08.11`. Registered datasets: 14. Declared models and workflows: 5. Built-in loads: 6.

This inventory records the source, scope, and current gap for each claim. Passing numerical
checks do not raise a load above the evidence level recorded in the manifest.

## Evidence levels

| Level | Rank | Built-in loads | Meaning |
| --- | ---: | ---: | --- |
| `inventory_only` | 0 | 1 | Implementation values and their known provenance are recorded. Predictive accuracy has not been checked against a suitable external dataset. |
| `calibration_only` | 1 | 3 | One or more parameters were fitted to the reported observations. No physically separate holdout observations establish predictive error. |
| `manufacturer_conformance` | 2 | 2 | Output is compared with a manufacturer or publication table under the documented assumptions. This does not establish independent empirical accuracy. |
| `independent_model_conformance` | 3 | 0 | Output is compared with a separately implemented solver or reference model under stated assumptions and tolerances. |
| `empirical_holdout` | 4 | 0 | Predictions are compared with measured observations that were excluded from parameter fitting. |

## Declared models and workflows

| ID | Implementation | Description |
| --- | --- | --- |
| `smooth-sphere-morrison-collins` | `src/Ballistics.Core/src/ballistics.cpp` | Morrison Reynolds-dependent smooth-sphere drag with the Collins compressibility correction |
| `user-tabulated-mach-cd` | `src/Ballistics.Core/src/ballistics.cpp` | User-supplied projectile drag coefficients with linear interpolation and a physical force equation based on an explicit frontal reference diameter |
| `reference-bc-velocity-calibration` | `src/Ballistics.Core/src/ballistics.cpp` | Deterministic weighted nonlinear least-squares estimation of constant or fixed-threshold velocity-banded G1/G7 ballistic coefficients from range/velocity observations |
| `first-order-trajectory-uncertainty` | `src/Ballistics.Core/src/ballistics.cpp` | Deterministic local propagation of independent one-sigma scenario inputs into aligned trajectory-output standard deviations |
| `trajectory-event-analysis` | `src/Ballistics.Core/src/ballistics.cpp` | Range-domain analysis of a natively zeroed trajectory for sight-line zeros, maximum ordinate, Mach-regime crossings, supersonic range, and ground intersection |

### smooth-sphere-morrison-collins

Morrison Reynolds-dependent smooth-sphere drag with the Collins compressibility correction

Implementation: `src/Ballistics.Core/src/ballistics.cpp`.

- **Declared Validity:**
    - **Mach:**
        - 0.2
        - 1.5
    - **Reynolds:**
        - 100
        - 2000000
    - **Behavior Outside Domain:** calculation continues with a structured extrapolation warning
- **Sources:**
    - https://arc.id.au/CannonballDrag.html
    - https://doi.org/10.1017/S0022112079002597

### user-tabulated-mach-cd

User-supplied projectile drag coefficients with linear interpolation and a physical force equation based on an explicit frontal reference diameter

Implementation: `src/Ballistics.Core/src/ballistics.cpp`.

- **Declared Validity:**
    - **Mach:** bounded by the first and last user-supplied knots
    - **Reynolds:** not recorded
    - **Behavior Outside Domain:** the nearest endpoint Cd is held constant and a structured extrapolation warning is returned
- **Interpolation:** Piecewise linear, exact at knots, with no spline overshoot
- **Force Law:** a_drag = rho * Cd * A * v_air^2 / (2 * mass), A = pi * referenceDiameter^2 / 4
- **Sources:**
    - User-supplied numerical curve. The user is responsible for its provenance.

### reference-bc-velocity-calibration

Deterministic weighted nonlinear least-squares estimation of constant or fixed-threshold velocity-banded G1/G7 ballistic coefficients from range/velocity observations

Implementation: `src/Ballistics.Core/src/ballistics.cpp`.

- **Parameterization:** log ballistic coefficient, bounded to [0.005, 2.0]
- **Objective:** sum of squared (predicted - measured) velocity divided by supplied one-sigma uncertainty, using calibration-role observations only
- **Optimizer:** Levenberg-Marquardt with central numerical derivatives
- **Intervals:** Approximate local 95% intervals from inverse weighted J^T J on the log-BC scale. Variance scale is max(1, reduced chi-square).
- **Validation Boundary:** holdout observations are excluded from fitting and reported separately. A fit without holdout data cannot return a validation-ready state.
- **Test Evidence:**
    - synthetic constant-G1 coefficient recovery and confidence coverage
    - synthetic two-band G7 coefficient recovery
    - real CLI protocol fixture with separate calibration and holdout residuals

### first-order-trajectory-uncertainty

Deterministic local propagation of independent one-sigma scenario inputs into aligned trajectory-output standard deviations

Implementation: `src/Ballistics.Core/src/ballistics.cpp`.

- **Method:** bounded central finite-difference sensitivities with independent root-sum-square variance combination
- **Confidence Display:** approximate two-sided 95% half-width equals 1.9599639845 times propagated standard deviation
- **Zeroing Semantics:** Muzzle velocity, drag, atmosphere, and wind hold nominal bore elevation fixed. Zero-range perturbations re-solve bore elevation.
- **Outputs:**
    - ground speed
    - energy
    - momentum
    - flight time
    - drop
    - sight path
    - wind drift
- **Limitations:**
    - inputs are assumed independent
    - first-order local approximation only
    - model-form and spin-drift uncertainty are excluded
    - correlated or materially nonlinear cases should use the separate Monte Carlo method
- **Test Evidence:**
    - muzzle-only analytic launch-point speed, energy, and momentum sensitivities
    - all-input root-sum-square propagation and availability
    - real CLI protocol fixture with aligned complete uncertainty samples

### trajectory-event-analysis

Range-domain analysis of a natively zeroed trajectory for sight-line zeros, maximum ordinate, Mach-regime crossings, supersonic range, and ground intersection

Implementation: `src/Ballistics.Core/src/ballistics.cpp`.

- **Interpolation:** Cubic Hermite interpolation in range uses integrated vertical position and vy/vx slope. Mach crossings use linear interpolation between retained dense states.
- **Thresholds:**
    - **Transonic Entry Mach:** 1.2
    - **Sonic Mach:** 1
    - **Transonic Exit Mach:** 0.8
- **Availability:** Each event family reports complete, horizon_limited, baseline_unavailable, or not_applicable as appropriate. An endpoint is never substituted for a missing crossing.
- **Test Evidence:**
    - configured far-zero recovery and ordered near/far crossings
    - maximum ordinate between the sight-line zeros
    - Mach-1 crossing consistency with supersonic range
    - ground intersection and explicit short-horizon availability

## Built-in load evidence

| Load | Drag | Evidence | Parameter source | Primary source | Archived copy |
| --- | --- | --- | --- | --- | --- |
| Baschieri & Pellagri White Blackout HV 12/70, 28 g | G1 | `calibration_only` | `fitted_to_same_table` | no | no |
| Baschieri & Pellagri BlackShock 12/70, 32 g | G1 | `calibration_only` | `fitted_to_same_table` | no | no |
| Winchester Ammunition Super-X X123RS15 12/76, 1 oz | G1 | `manufacturer_conformance` | `manufacturer_published` | yes | no |
| Hornady Manufacturing BLACK .308 Winchester 168 gr A-MAX, item 80971 | G1 | `manufacturer_conformance` | `manufacturer_published` | yes | no |
| Federal Premium Ammunition Power-Shok .308 Winchester 150 gr SP, 308A | G1 | `calibration_only` | `fitted_to_same_table` | yes | no |
| Winchester Ammunition Super-X 12/70 nine-pellet 00 buck | sphere | `inventory_only` | `nominal_geometry_and_material_derivation` | yes | no |

### Baschieri & Pellagri White Blackout HV 12/70, 28 g

Load ID: `builtin:white-blackout-hv`. Firearm group: `shotgun`.

Implementation values:

- **Mass Kg:** 0.028
- **Muzzle Velocity Mps:** 575
- **Drag Model:** G1
- **Ballistic Coefficient:** 0.054624716532086
- **Parameter Status:** fitted_to_same_table
- **Pellet Count:** 1

Linked datasets:

manufacturer-attributed-bp-white-blackout-hv-2018 (manufacturer_attributed_table), secondary-bp-white-blackout-hv-caccia-magazine-2019 (secondary_publication)

Known source facts:

A 2018 Hunting Spot report by B&P ballistic consultant Gianluca Garolini states that its study was conducted at the B&P test bench and publishes calculated White Blackout HV velocities of 575 m/s at 1 m and 443 m/s at 33 m. Caccia Magazine separately attributes 384 m/s at 50 m to B&P. Checksummed numerical transcriptions, publication/retrieval dates, and source qualifications are recorded in the validation manifest.

Current evidence:

The effective G1 BC was fitted to the same 33 m manufacturer-attributed and 50 m secondary-attributed values used by the native publication-conformance report. The sources describe the velocity table as calculated, and there is no independent holdout.

Open gap:

No manufacturer-controlled copy of the 2018 report or underlying B&P calculation record was located. The 50 m value is secondary attribution only. The source does not report the ammunition lot, atmosphere, calculation method, pressure-barrel dimensions, rounding beyond whole m/s, or uncertainty. The implementation uses the published V1 value as launch velocity.

### Baschieri & Pellagri BlackShock 12/70, 32 g

Load ID: `builtin:blackshock`. Firearm group: `shotgun`.

Implementation values:

- **Mass Kg:** 0.032
- **Muzzle Velocity Mps:** 455
- **Drag Model:** G1
- **Ballistic Coefficient:** 0.0709673760860212
- **Parameter Status:** fitted_to_same_table
- **Pellet Count:** 1

Linked datasets:

manufacturer-attributed-bp-blackshock-2018 (manufacturer_attributed_table)

Known source facts:

A 2018 Hunting Spot report by B&P ballistic consultant Gianluca Garolini states that its study was conducted at the B&P test bench and publishes calculated BlackShock velocities of 455 m/s at 1 m and 373 m/s at 33 m. A checksummed numerical transcription, publication/retrieval dates, and source qualification are recorded in the validation manifest.

Current evidence:

A single 33 m manufacturer-attributed calculated value constrains the effective G1 BC and is reproduced by the native publication-conformance report. No independent holdout data exist.

Open gap:

No manufacturer-controlled copy of the report or underlying B&P calculation record was located. The source does not report the ammunition lot, atmosphere, calculation method, pressure-barrel dimensions, rounding beyond whole m/s, or uncertainty. The implementation uses the published V1 value as launch velocity.

### Winchester Ammunition Super-X X123RS15 12/76, 1 oz

Load ID: `builtin:winchester-x123rs15`. Firearm group: `shotgun`.

Implementation values:

- **Mass Kg:** 0.028349523125
- **Muzzle Velocity Mps:** 536.448
- **Drag Model:** G1
- **Ballistic Coefficient:** 0.068
- **Parameter Status:** manufacturer_published
- **Pellet Count:** 1

Linked datasets:

manufacturer-winchester-x123rs15-2026 (manufacturer_table)

Known source facts:

The Winchester 2026 catalog identifies X123RS15 as a 3-inch 12-gauge, 1-ounce rifled slug with G1 BC 0.068 and publishes muzzle, 50, 100, and 125 yard velocity and energy. The locator, retrieval date, normalization, rounding limits, and a checksummed numerical transcription are recorded in the validation manifest.

Current evidence:

The native validation target compares the unmodified manufacturer-published G1 BC against the checksummed muzzle, 50, 100, and 125 yard velocity series and emits a machine-readable residual report. This is catalog conformance, not independent empirical validation.

Open gap:

The linked manufacturer catalog is not redistributed or independently archived. Test barrel, ammunition lot, sample size, atmosphere, measurement method, and uncertainty are not published in the located table.

### Hornady Manufacturing BLACK .308 Winchester 168 gr A-MAX, item 80971

Load ID: `builtin:hornady-amax-168`. Firearm group: `rifle`.

Implementation values:

- **Mass Kg:** 0.01088621688
- **Muzzle Velocity Mps:** 822.96
- **Drag Model:** G1
- **Ballistic Coefficient:** 0.475
- **Parameter Status:** manufacturer_published
- **Pellet Count:** 1

Linked datasets:

manufacturer-hornady-80971-2022 (manufacturer_table)

Known source facts:

Hornady's 2022 Standard Ballistics Chart identifies item 80971, G1 BC 0.475, 2,700 ft/s muzzle velocity, a 24-inch barrel basis, and velocity, energy, and trajectory through 500 yards. The locator, retrieval date, normalization, rounding limits, and a checksummed numerical transcription are recorded in the validation manifest.

Current evidence:

The native validation target compares the unmodified manufacturer-published G1 BC against the checksummed muzzle-through-500-yard velocity series and emits a machine-readable residual report. This is catalog conformance, not independent empirical validation.

Open gap:

The linked manufacturer PDF is not redistributed or independently archived. Ammunition lot, sample size, measurement method, atmosphere, and uncertainty are not published in the located chart.

### Federal Premium Ammunition Power-Shok .308 Winchester 150 gr SP, 308A

Load ID: `builtin:federal-sp-150`. Firearm group: `rifle`.

Implementation values:

- **Mass Kg:** 0.0097198365
- **Muzzle Velocity Mps:** 859.536
- **Drag Model:** G1
- **Ballistic Coefficient:** 0.312368144835017
- **Parameter Status:** fitted_to_same_table
- **Pellet Count:** 1

Linked datasets:

manufacturer-federal-308a-2022 (manufacturer_table)

Known source facts:

Federal's 2022 catalog publishes the 308A muzzle-through-500-yard velocity series. The 2019 catalog cross-check identifies a 24-inch barrel for the same product and series. The locator, retrieval date, normalization, rounding limits, and a checksummed numerical transcription are recorded in the validation manifest.

Current evidence:

The effective G1 BC 0.312368144835017 is reproducibly fitted to the same checksummed manufacturer series used by the native conformance report. The report labels this fitted-to-same-table and no physically separate holdout is recorded.

Open gap:

The linked manufacturer PDFs are not redistributed or independently archived. Ammunition lot, sample size, measurement method, atmosphere, and uncertainty are not published in the located tables.

### Winchester Ammunition Super-X 12/70 nine-pellet 00 buck

Load ID: `builtin:winchester-00-buck`. Firearm group: `shotgun`.

Implementation values:

- **Mass Kg:** 0.0034966699909749735
- **Muzzle Velocity Mps:** 403.86
- **Drag Model:** sphere
- **Sphere Diameter M:** 0.008382
- **Material Density Kg M3:** 11340
- **Parameter Status:** nominal_geometry_and_material_derivation
- **Pellet Count:** 9

Linked datasets:

manufacturer-winchester-xb1200-2019 (metadata_only), manufacturer-winchester-buckshot-diameters-2022 (metadata_only)

Known source facts:

Winchester's 2019 catalog identifies XB1200 as a 2.75-inch 12-gauge load with nine 00-buck pellets at a nominal 1,325 ft/s at 3 feet. Winchester's 2022 Shotshell Ammo 101 guide gives a nominal 0.33-inch 00-buck diameter. Both locators, retrieval dates, limitations, and checksummed numerical transcriptions are recorded in the validation manifest. Per-pellet mass remains a pure-lead-sphere derivation.

Current evidence:

Numerical integrator convergence is tested, but no raw sphere or buckshot velocity-decay holdout dataset validates the aerodynamic correlation for this load.

Open gap:

The linked manufacturer documents are not redistributed or independently archived. Pellet diameter tolerance, alloy, deformation, ammunition lot, test barrel, atmosphere, pattern distribution, and velocity uncertainty are not published in the located sources.

## Open evidence gap index

- 6 of 6 built-in loads lack an archived primary source copy.
- 2 of 6 built-in loads lack an identified primary manufacturer source.
- 6 of 6 built-in loads lack empirical holdout evidence.

| Load ID | Evidence level | Gap |
| --- | --- | --- |
| `builtin:white-blackout-hv` | `calibration_only` | No manufacturer-controlled copy of the 2018 report or underlying B&P calculation record was located. The 50 m value is secondary attribution only. The source does not report the ammunition lot, atmosphere, calculation method, pressure-barrel dimensions, rounding beyond whole m/s, or uncertainty. The implementation uses the published V1 value as launch velocity. |
| `builtin:blackshock` | `calibration_only` | No manufacturer-controlled copy of the report or underlying B&P calculation record was located. The source does not report the ammunition lot, atmosphere, calculation method, pressure-barrel dimensions, rounding beyond whole m/s, or uncertainty. The implementation uses the published V1 value as launch velocity. |
| `builtin:winchester-x123rs15` | `manufacturer_conformance` | The linked manufacturer catalog is not redistributed or independently archived. Test barrel, ammunition lot, sample size, atmosphere, measurement method, and uncertainty are not published in the located table. |
| `builtin:hornady-amax-168` | `manufacturer_conformance` | The linked manufacturer PDF is not redistributed or independently archived. Ammunition lot, sample size, measurement method, atmosphere, and uncertainty are not published in the located chart. |
| `builtin:federal-sp-150` | `calibration_only` | The linked manufacturer PDFs are not redistributed or independently archived. Ammunition lot, sample size, measurement method, atmosphere, and uncertainty are not published in the located tables. |
| `builtin:winchester-00-buck` | `inventory_only` | The linked manufacturer documents are not redistributed or independently archived. Pellet diameter tolerance, alloy, deformation, ammunition lot, test barrel, atmosphere, pattern distribution, and velocity uncertainty are not published in the located sources. |

## Dataset register

| Dataset | Kind | Publisher or author | Date or edition | Archived copy |
| --- | --- | --- | --- | --- |
| `reference-drag-g1-gnu-ballistics` | `reference_drag_function` | Derek Yates | 0.201 alpha | no |
| `reference-drag-g7-mccoy` | `reference_drag_curve` | Robert L. McCoy | 1999 | no |
| `independent-reference-drag-g7-py-ballisticcalc-2.2.10` | `reference_drag_curve` | py-ballisticcalc contributors | v2.2.10 | no |
| `manufacturer-hornady-80971-2022` | `manufacturer_table` | Hornady Manufacturing | 2022 | no |
| `manufacturer-federal-308a-2022` | `manufacturer_table` | Federal Premium Ammunition | 2022 | no |
| `manufacturer-winchester-x123rs15-2026` | `manufacturer_table` | Olin Winchester | 2026 | no |
| `manufacturer-winchester-xb1200-2019` | `metadata_only` | Olin Winchester | 2019 | no |
| `manufacturer-winchester-buckshot-diameters-2022` | `metadata_only` | Olin Winchester | 2022 | no |
| `manufacturer-attributed-bp-white-blackout-hv-2018` | `manufacturer_attributed_table` | Hunting Spot | 2018-02-14 | no |
| `manufacturer-attributed-bp-blackshock-2018` | `manufacturer_attributed_table` | Hunting Spot | 2018-02-14 | no |
| `secondary-bp-white-blackout-hv-caccia-magazine-2019` | `secondary_publication` | Caccia Magazine | 2019-04-11 | no |
| `reference-atmosphere-cipm-2007` | `atmosphere_reference` | Metrologia, copy hosted by the National Institute of Standards and Technology | 2008 | no |
| `reference-air-viscosity-naca-1135` | `atmosphere_reference` | National Advisory Committee for Aeronautics, NASA Technical Reports Server | 1953-01-01 | no |
| `reference-atmosphere-sound-speed-gavioso-2025` | `atmosphere_reference` | Journal of Physical and Chemical Reference Data | 2025-12-02 | no |

### reference-drag-g1-gnu-ballistics

GNU Ballistics Library G1 drag-function coefficients

Repository data: `sources/g1-gnu-ballistics.csv`. SHA-256: `f1e87cf0acac35b1478685875fbfb2c3743aa45f236d309541222625e3e29a2f`.

- **Kind:** reference_drag_function
- **Model:** G1
- **Source:**
    - **Title:** GNU Ballistics Library G1 drag-function coefficients
    - **Author:** Derek Yates
    - **Edition:** 0.201 alpha
    - **Online Transcription:** https://sourceforge.net/projects/ballisticslib/files/GNU%20Ballistics%20Library/0.201%20alpha/
- **Cross Checks:**
    - https://raw.githubusercontent.com/o-murphy/py-ballisticcalc/v2.2.10/py_ballisticcalc/drag_tables.py
- **Retrieved:** 2026-08-15
- **Units:**
    - **Minimum Velocity:** feet per second
    - **Coefficient:** GNU Ballistics retardation-law coefficient
    - **Exponent:** dimensionless
- **Normalization:** For the active descending velocity band, retardation in ft/s^2 is coefficient * velocity_fps^exponent / G1_BC.
- **License:** Numerical coefficient facts are transcribed for implementation conformance. The external program source is not redistributed.

### reference-drag-g7-mccoy

Modern Exterior Ballistics: The Launch and Flight Dynamics of Symmetric Projectiles

Repository data: `sources/g7-mccoy.csv`. SHA-256: `a275757af325add428ca961505e04898c7f909c369a50089ccaf213947a351e4`.

- **Kind:** reference_drag_curve
- **Model:** G7
- **Source:**
    - **Title:** Modern Exterior Ballistics: The Launch and Flight Dynamics of Symmetric Projectiles
    - **Author:** Robert L. McCoy
    - **Edition:** Second edition
    - **Year:** 1999
    - **Online Transcription:** https://jbmballistics.com/ballistics/downloads/text/mcg7.txt
- **Cross Checks:**
    - https://appliedballisticsllc.com/wp-content/uploads/2021/06/ABDOC130_CDM-2021-Copyright.pdf
- **Retrieved:** 2026-08-11
- **Units:**
    - **Mach:** dimensionless
    - **Cd:** dimensionless
- **Normalization:** G7 standard projectile reference drag coefficient
- **License:** Numerical facts are transcribed for implementation conformance. Source publications are not redistributed.

### independent-reference-drag-g7-py-ballisticcalc-2.2.10

py-ballisticcalc TableG7

Repository data: `sources/g7-py-ballisticcalc-2.2.10.csv`. SHA-256: `5f19bcaeecd96e36172c404ebad7a0ff8d030e09f2457bc463e6d0ea49eb070e`.

- **Kind:** reference_drag_curve
- **Model:** G7
- **Source:**
    - **Title:** py-ballisticcalc TableG7
    - **Author:** py-ballisticcalc contributors
    - **Edition:** v2.2.10
    - **Online Transcription:** https://raw.githubusercontent.com/o-murphy/py-ballisticcalc/v2.2.10/py_ballisticcalc/drag_tables.py
- **Cross Checks:**
    - https://github.com/o-murphy/py-ballisticcalc/releases/tag/v2.2.10
- **Retrieved:** 2026-08-15
- **Units:**
    - **Mach:** dimensionless
    - **Cd:** dimensionless
- **Normalization:** G7 standard projectile reference drag coefficient, transcribed independently from the production McCoy CSV for solver cross-checking.
- **License:** Only numerical facts are stored. py-ballisticcalc is LGPL-3.0. No library code is copied into the application.

### manufacturer-hornady-80971-2022

2022 Standard Ballistics Chart, BLACK 308 Win 168 gr A-MAX item 80971

Repository data: `sources/hornady-80971-2022.csv`. SHA-256: `f45d8c3638b2c9876e6b082edf260f8f05da4f39b154cbf33d33198211a39578`.

- **Kind:** manufacturer_table
- **Source:**
    - **Title:** 2022 Standard Ballistics Chart, BLACK 308 Win 168 gr A-MAX item 80971
    - **Publisher:** Hornady Manufacturing
    - **Edition Or Version:** 2022
    - **Publication Date:** 2022
    - **Locator:** https://static.hornady.media/presscenter/docs/1410998060-2022-Standard-Ballistics-Chart.pdf
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance yd:** yards
    - **Velocity fps:** feet per second
    - **Energy ft lb:** foot-pounds
    - **Trajectory in:** inches
- **Normalization:** The row for item 80971 is transcribed at the published muzzle and 100-yard intervals. The chart states that rifle data use a 24-inch barrel unless otherwise noted.
- **Uncertainty:** The table is rounded to whole feet per second and whole foot-pounds and to 0.1 inch. Lot, sample size, measurement method, atmosphere, and uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only the item 80971 numerical row is transcribed. The Hornady PDF is linked and is not redistributed.

### manufacturer-federal-308a-2022

Federal Catalog 2022, Power-Shok 308A rifle ballistics

Repository data: `sources/federal-308a-2022.csv`. SHA-256: `e67a83c7b1b2cb159e4b66c7eb29804e2bcfd492930c9211008e7892f9b565d9`.

- **Kind:** manufacturer_table
- **Source:**
    - **Title:** Federal Catalog 2022, Power-Shok 308A rifle ballistics
    - **Publisher:** Federal Premium Ammunition
    - **Edition Or Version:** 2022
    - **Publication Date:** 2022
    - **Locator:** https://www.federalpremium.com/on/demandware.static/-/Library-Sites-VistaFederalSharedLibrary/default/vd5051f299f79146229507233809e6144584db865/contentDocuments/catalog/Federal-Catalog-2022_website_sm.pdf
    - **Archived Locator:** not recorded
- **Cross Checks:**
    - https://www.federalpremium.com/on/demandware.static/-/Library-Sites-VistaFederalSharedLibrary/default/v626efddaad5102738688e30452860de662767353/contentDocuments/catalog/FederalPremium2019Catalog-Full.pdf
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance yd:** yards
    - **Velocity fps:** feet per second
- **Normalization:** The Power-Shok 308A velocity series is transcribed at the published muzzle and 100-yard intervals. The 2019 Federal catalog cross-check identifies a 24-inch test barrel for the same product and series.
- **Uncertainty:** Velocity is rounded to whole feet per second. Lot, sample size, measurement method, atmosphere, and uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only the 308A velocity series is transcribed. Federal catalog PDFs are linked and are not redistributed.

### manufacturer-winchester-x123rs15-2026

Winchester 2026 Online Catalog, shotshell ballistics, X123RS15

Repository data: `sources/winchester-x123rs15-2026.csv`. SHA-256: `36edad5493f0dd1a39f56b85649bce851f2773dce89f06b4a61377bb59433ae9`.

- **Kind:** manufacturer_table
- **Source:**
    - **Title:** Winchester 2026 Online Catalog, shotshell ballistics, X123RS15
    - **Publisher:** Olin Winchester
    - **Edition Or Version:** 2026 online catalog, page 40
    - **Publication Date:** 2026
    - **Locator:** https://online.flippingbook.com/view/721179895/42/
    - **Archived Locator:** not recorded
- **Cross Checks:**
    - https://online.flippingbook.com/view/816092/48/
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance yd:** yards
    - **Velocity fps:** feet per second
    - **Energy ft lb:** foot-pounds
- **Normalization:** The X123RS15 row is transcribed at muzzle, 50, 100, and 125 yards. Its published G1 ballistic coefficient is 0.068. The nominal slug is 1 ounce (438 grains) in a 3-inch 12-gauge shell.
- **Uncertainty:** Velocity and energy are rounded to whole units. Test barrel, lot, sample size, measurement method, atmosphere, and uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only one catalog row is transcribed. The Winchester catalog is linked and is not redistributed.

### manufacturer-winchester-xb1200-2019

Winchester Law Enforcement 2019 Catalog, Super-X Buckshot XB1200

Repository data: `sources/winchester-xb1200-2019.csv`. SHA-256: `818643681651cd56a5560135518570bdb694faa46c8df43b531c770bfa09b8e6`.

- **Kind:** metadata_only
- **Source:**
    - **Title:** Winchester Law Enforcement 2019 Catalog, Super-X Buckshot XB1200
    - **Publisher:** Olin Winchester
    - **Edition Or Version:** 2019
    - **Publication Date:** 2019
    - **Locator:** https://online.flippingbook.com/view/977082/13/
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Shell length in:** inches
    - **Velocity fps at 3 ft:** feet per second measured nominally at 3 feet
- **Normalization:** The XB1200 product row is transcribed without deriving a per-pellet mass or drag coefficient.
- **Uncertainty:** The catalog gives a nominal 3-foot velocity. Barrel, lot, sample size, atmosphere, velocity uncertainty, pellet alloy, and dimensional tolerance are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only the XB1200 product facts are transcribed. The Winchester catalog is linked and is not redistributed.

### manufacturer-winchester-buckshot-diameters-2022

Winchester Ammunition Academy: Shotshell Ammo 101

Repository data: `sources/winchester-buckshot-diameters-2022.csv`. SHA-256: `2f861434a599ceeca91e3e434414db47da3a8d5a119ffbaae6935656cfc5b6db`.

- **Kind:** metadata_only
- **Source:**
    - **Title:** Winchester Ammunition Academy: Shotshell Ammo 101
    - **Publisher:** Olin Winchester
    - **Edition Or Version:** 2022
    - **Publication Date:** 2022
    - **Locator:** https://winchester.com/-/media/Project/Consumer/PDFs/Winchester-Ammunition-Academy-Shotshell-Ammo-101.ashx
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Nominal diameter in:** inches
- **Normalization:** The complete published nominal buckshot-size diameter table is transcribed. The built-in XB1200 uses the 00 row, 0.33 inch.
- **Uncertainty:** The guide states nominal diameters but no manufacturing tolerance or pellet-alloy-specific diameter distribution.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only the six nominal size/diameter pairs are transcribed. The Winchester guide is linked and is not redistributed.

### manufacturer-attributed-bp-white-blackout-hv-2018

Test delle cartucce a palla Baschieri & Pellagri, White Blackout HV table

Repository data: `sources/bp-white-blackout-hv-hunting-spot-2018.csv`. SHA-256: `eff95b626b6a4ff9ae928e3c70abce5d353e54cb4b326303a524dedd214cb864`.

- **Kind:** manufacturer_attributed_table
- **Source Qualification:** A Hunting Spot report by B&P ballistic consultant Gianluca Garolini states that the study was conducted at the B&P test bench. No manufacturer-controlled copy was located.
- **Source:**
    - **Title:** Test delle cartucce a palla Baschieri & Pellagri, White Blackout HV table
    - **Author:** Gianluca Garolini
    - **Publisher:** Hunting Spot
    - **Edition Or Version:** PDF created 2018-01-16. Accompanying article published 2018-02-14.
    - **Publication Date:** 2018-02-14
    - **Locator:** https://cdn2.hubspot.net/hubfs/2739290/%5BOfferte%5D/Test-cartucce-a-palla-B%26P.pdf?_hsmi=59678583&t=1519918374079
    - **Archived Locator:** not recorded
- **Cross Checks:**
    - https://blog.hunting-spot.com/prova-e-recensione-delle-cartucce-per-cinghiale-baschieri-pellagri
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance m:** metres from the muzzle
    - **Velocity mps:** metres per second
- **Normalization:** The White Blackout HV V1 and 33-metre velocity cells are transcribed exactly. The report describes the velocity/trajectory table as calculated. These values are not raw chronograph observations.
- **Uncertainty:** Velocity is rounded to whole metres per second. Lot, pressure-barrel dimensions, atmosphere, calculation method, and numerical or measurement uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only two numerical cells are transcribed. The Hunting Spot PDF is linked and is not redistributed.

### manufacturer-attributed-bp-blackshock-2018

Test delle cartucce a palla Baschieri & Pellagri, BlackShock table

Repository data: `sources/bp-blackshock-hunting-spot-2018.csv`. SHA-256: `9efc50b80ef01c4de8bd6d616c6abbd01de2ba05ee01c0771486032c00cc73b0`.

- **Kind:** manufacturer_attributed_table
- **Source Qualification:** A Hunting Spot report by B&P ballistic consultant Gianluca Garolini states that the study was conducted at the B&P test bench. No manufacturer-controlled copy was located.
- **Source:**
    - **Title:** Test delle cartucce a palla Baschieri & Pellagri, BlackShock table
    - **Author:** Gianluca Garolini
    - **Publisher:** Hunting Spot
    - **Edition Or Version:** PDF created 2018-01-16. Accompanying article published 2018-02-14.
    - **Publication Date:** 2018-02-14
    - **Locator:** https://cdn2.hubspot.net/hubfs/2739290/%5BOfferte%5D/Test-cartucce-a-palla-B%26P.pdf?_hsmi=59678583&t=1519918374079
    - **Archived Locator:** not recorded
- **Cross Checks:**
    - https://blog.hunting-spot.com/prova-e-recensione-delle-cartucce-per-cinghiale-baschieri-pellagri
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance m:** metres from the muzzle
    - **Velocity mps:** metres per second
- **Normalization:** The BlackShock V1 and 33-metre velocity cells are transcribed exactly. The report describes the velocity/trajectory table as calculated. These values are not raw chronograph observations.
- **Uncertainty:** Velocity is rounded to whole metres per second. Lot, pressure-barrel dimensions, atmosphere, calculation method, and numerical or measurement uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only two numerical cells are transcribed. The Hunting Spot PDF is linked and is not redistributed.

### secondary-bp-white-blackout-hv-caccia-magazine-2019

Baschieri & Pellagri White Blackout HV calibro 12

Repository data: `sources/bp-white-blackout-hv-caccia-magazine-2019.csv`. SHA-256: `4b401f58ec56e8f99c1ee672d848dd1b24e642deb50ac11dee427c7c0a980403`.

- **Kind:** secondary_publication
- **Source Qualification:** Caccia Magazine attributes the 50-metre velocity to Baschieri & Pellagri. No underlying manufacturer table or measurement record was located.
- **Source:**
    - **Title:** Baschieri & Pellagri White Blackout HV calibro 12
    - **Author:** Simone Bertini
    - **Publisher:** Caccia Magazine
    - **Edition Or Version:** not recorded
    - **Publication Date:** 2019-04-11
    - **Locator:** https://www.cacciamagazine.it/baschieri-pellagri-white-blackout-hv-calibro-12/
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Distance m:** metres from the muzzle
    - **Velocity mps:** metres per second
- **Normalization:** The single 50-metre velocity attributed to B&P is transcribed exactly. No interpolation or unit conversion is applied.
- **Uncertainty:** Velocity is rounded to whole metres per second. Lot, barrel used for the attributed value, atmosphere, measured-versus-generated status, and uncertainty are not stated.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only the attributed 50-metre velocity is transcribed. The article is linked and is not redistributed.

### reference-atmosphere-cipm-2007

Revised formula for the density of moist air (CIPM-2007)

Repository data: `sources/atmosphere-cipm-2007.csv`. SHA-256: `b67797ee0081b669efb201901d5e230d2fe982a7ba44347eab93565b58cce1c4`.

- **Kind:** atmosphere_reference
- **Source:**
    - **Title:** Revised formula for the density of moist air (CIPM-2007)
    - **Author:** A. Picard, R. S. Davis, M. Glaser, and K. Fujii
    - **Publisher:** Metrologia, copy hosted by the National Institute of Standards and Technology
    - **Edition Or Version:** CIPM-2007
    - **Publication Date:** 2008
    - **Locator:** https://www.nist.gov/system/files/documents/calibrations/CIPM-2007.pdf
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Temperature c:** degrees Celsius
    - **Station pressure hpa:** hectopascals
    - **Relative humidity percent:** percent
    - **Co2 mole fraction:** dimensionless
    - **Density kg m3:** kilograms per cubic metre
    - **Compressibility factor:** dimensionless
    - **Water vapor mole fraction:** dimensionless
- **Normalization:** Values are generated directly from the CIPM-2007 equations and constants at a carbon-dioxide mole fraction of 0.0004. Decimal output is deterministically rounded to 12 places. Cases remain inside 15 to 27 degrees Celsius and 600 to 1100 hPa.
- **Uncertainty:** The source estimates a relative standard uncertainty of 22 parts in 10^6 over the stated pressure and temperature ranges, excluding uncertainty in measured environmental inputs. This comparison evaluates formula agreement, not sensor uncertainty.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only independently generated equation outputs and source metadata are stored. The NIST-hosted paper is linked and is not redistributed.

### reference-air-viscosity-naca-1135

Equations, Tables, and Charts for Compressible Flow

Repository data: `sources/air-viscosity-naca-1135.csv`. SHA-256: `0e116d2cb0b13627bf7f54711f79ce42376949d3013c99d290367ff60b512f23`.

- **Kind:** atmosphere_reference
- **Source:**
    - **Title:** Equations, Tables, and Charts for Compressible Flow
    - **Author:** Ames Research Staff
    - **Publisher:** National Advisory Committee for Aeronautics, NASA Technical Reports Server
    - **Edition Or Version:** NACA Report 1135
    - **Publication Date:** 1953-01-01
    - **Locator:** https://ntrs.nasa.gov/citations/19930091059
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Temperature c:** degrees Celsius
    - **Dynamic viscosity pa s:** pascal seconds
- **Normalization:** Values are generated from equation A3 using absolute temperature in degrees Rankine, then converted from pound-force seconds per square foot to pascal seconds. The selected cases cover the application's complete -60 to 60 degree Celsius input range and remain inside the report's stated 180 to 3400 degree Rankine range for Sutherland's formula.
- **Uncertainty:** The source describes Sutherland's equation as the more accurate approximation across its stated range but does not publish a numerical uncertainty for equation A3. This is formula conformance, not an empirical viscosity uncertainty claim.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only independently generated equation outputs and source metadata are stored. NASA identifies the report as US Government work with public use permitted. The PDF is linked and is not redistributed.

### reference-atmosphere-sound-speed-gavioso-2025

Speed of sound in humid air: Accurate thermodynamic model and experimental validation

Repository data: `sources/atmosphere-sound-speed-gavioso-2025.csv`. SHA-256: `7a34bfe2ad0b7d4ecae5717534c7a88ca656f25b4f0e9308c65300cd6d03d3b9`.

- **Kind:** atmosphere_reference
- **Source:**
    - **Title:** Speed of sound in humid air: Accurate thermodynamic model and experimental validation
    - **Author:** R. M. Gavioso, M. Astrua, M. Zucco, and M. Pisani
    - **Publisher:** Journal of Physical and Chemical Reference Data
    - **Edition Or Version:** Volume 54, 043101. DOI 10.1063/5.0294663.
    - **Publication Date:** 2025-12-02
    - **Locator:** https://doi.org/10.1063/5.0294663
    - **Archived Locator:** not recorded
- **Retrieved:** 2026-08-17
- **Units:**
    - **Temperature c:** degrees Celsius
    - **Station pressure hpa:** hectopascals
    - **Relative humidity percent:** percent
    - **Co2 mole fraction:** dimensionless
    - **Acoustic frequency hz:** hertz
    - **Speed of sound mps:** metres per second
    - **Standard uncertainty mps:** metres per second
- **Normalization:** Four rows at 0, 20, 30, and 50 degrees Celsius from Table 5 are transcribed exactly. One atmosphere is converted from 1 atm to 1013.25 hPa. No sound-speed or uncertainty value is converted. The 50 degree Celsius row retains its published 10 kHz frequency so the report does not mislabel it as a zero-frequency datum. The 2 atm row is excluded because it lies outside the application pressure input domain.
- **Uncertainty:** The table's per-row standard uncertainties are preserved. The cases all use a carbon-dioxide mole fraction of 0.000368. Three cases are inside the declared Cramer sound-speed domain and the 50 degree Celsius case explicitly exercises extrapolation. They do not validate the application's complete pressure, composition, or frequency domain.
- **Redistribution:**
    - **Status:** numerical_facts_only
    - **Note:** Only four numerical table rows from the open-access paper are transcribed. The paper and its software are linked and are not redistributed.
