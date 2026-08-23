# Fitting artifacts

Reproducible fit inputs belong here and must conform to `../schemas/fit.schema.json`. Each measured
observation must name a source and be marked `calibration` or `holdout`. A fit without holdout data
is calibration evidence only.

The three `builtin-*.json` definitions reproduce the implemented effective G1 coefficients for
White Blackout HV, BlackShock, and Federal Power-Shok SP. They preserve source IDs, publication
qualification, assumed atmosphere, range/velocity uncertainty, parameter status, deterministic
optimizer identity, and the absence of holdout observations. Run
`../reference/run-builtin-fits.mjs` with the native CLI to generate the strict fit report and
documentation table.

These definitions transcribe publication tables. They are not newly collected raw chronograph or
Doppler evidence. BlackShock has one observation for one fitted coefficient, giving zero residual
degrees of freedom and no confidence interval. No definition may claim empirical validation until
it includes physically separate holdout observations.
