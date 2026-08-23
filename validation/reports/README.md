# Validation reports

Source-controlled reports belong here only when their inputs and generator are reproducible.
Cross-compiler numerical reports and timing benchmarks are generated into the CMake build tree and
uploaded by CI because compiler, operating-system, and hardware identity are part of the evidence.
The report register in `../manifest.json` names the complete canonical set, its schema,
classification, and claim boundary. Each platform generates `VALIDATION_SUMMARY.md` from that register. The
summary is a derived index and the underlying JSON files remain the evidence.

Independent trajectory comparison reports conform to `../schemas/report.schema.json`.
Expanded fixed-time flight-matrix reports conform to
`../schemas/flight-matrix-report.schema.json`. They compare 13 trajectories, one sight-zero case,
and one MPBR case from `../scenarios/independent-flight-matrix.json`, retaining category, drag model,
termination, sample counts, aggregate residuals, compiler, and model identity. A passing report
establishes cross-implementation numerical conformance to the declared formulas. It does not
establish the empirical suitability of a BC, atmosphere model, or sphere correlation.
Manufacturer-table velocity reports conform to `../schemas/manufacturer-report.schema.json` and
must preserve whether each drag parameter was manufacturer-published or fitted to the same table,
as well as whether the numerical source is a primary manufacturer publication or only a
manufacturer-attributed secondary publication.

Built-in effective-BC reports conform to `../schemas/fit-report.schema.json`. The cross-platform
`../reference/run-builtin-fits.mjs` runner validates each source definition, invokes the real native
JSON calibration protocol, validates the response and aggregate report, checks the fitted value
against the implemented coefficient, and regenerates `../../docs/generated/BUILTIN_FIT_EVIDENCE.md`.
The JSON build artifact retains compiler-specific fitted values and residuals. The stable Markdown
summary is checked in.

Atmosphere-property reports conform to `../schemas/atmosphere-report.schema.json`. They compare the
production model with independently generated CIPM-2007 density and NACA Report 1135 viscosity
datasets plus directly published Gavioso et al. sound-speed rows. Each section preserves the source
dataset, reference and production model identities, declared domain, every residual, and maximum.
Passing a section does not imply that production implements the reference model or validate
conditions outside that section's declared domain. Sound speed currently has only a
three-case, zero-frequency near-ambient baseline.

Adaptive-solver reports conform to `../schemas/convergence-report.schema.json`. They record exact
constant-Cd maximum-step refinement and multi-scenario production/half/tenth-tolerance comparisons
with a 1,000× tighter, smaller-step reference. They are numerical self-convergence evidence, not an
independent physical-model validation claim.

Native timing reports conform to `../schemas/benchmark-report.schema.json`. They retain the
platform, compiler, clock, hardware concurrency, iteration count, timing distribution, dense-grid
sample/storage cost, projected response sample count, and report policy for every named workload.
Full request-budget reports conform to
`../schemas/interaction-performance-report.schema.json` and retain host identity, warm and cold p95
budgets, startup estimates, and the worker-process decision. Native timings are report-only. The
interaction budget is a host-specific pass or fail check.
