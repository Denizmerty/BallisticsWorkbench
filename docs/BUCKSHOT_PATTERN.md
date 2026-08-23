# Empirical buckshot pattern analysis

Ballistics Workbench can fit a simple pattern-spread model to measurements from a specific
shotshell, firearm, choke, and test method. The result is separate from the pellet trajectory. The
trajectory predicts the motion of one pellet. Pattern analysis estimates how measured pellet
impacts are distributed around the point of aim.

The analysis is disabled by default. It does not ship with assumed pattern measurements. A result
is produced only after the user supplies enough calibration and holdout observations for an active
shotgun load.

## Measurements

Each observation records:

- range in metres
- measured D90 pattern diameter in metres
- standard uncertainty of that diameter in metres
- number of shells represented by the observation
- an evidence role of `calibration` or `holdout`

D90 is the diameter of a circle centered on the pattern center that contains 90% of the observed
pellet impacts. All observations in one fit should use the same centering rule, target method,
ammunition lot, firearm, choke, and definition of a valid pellet impact.

At least two observations must be assigned to calibration and at least one must be assigned to
holdout. Holdout observations are never used to fit the coefficient. They are retained to show
error on measurements that did not influence the fit. Repeated strings at several ranges are more
useful than treating individual shots as a precise population estimate.

The standard uncertainty should describe the uncertainty of the reported D90 value, including
shot-to-shot sampling variability where it is known. Shell count affects the fit weight, but it
does not replace a defensible uncertainty estimate.

## Fitted model

The fitted relationship is a weighted line through the origin:

```text
D90(range) = angular diameter × range
weight = shell count / standard uncertainty²
```

The fit reports:

- angular D90 diameter and its standard uncertainty
- calibration and holdout root-mean-square error
- reduced chi-square for the calibration observations
- the calibration range interval
- predicted D90 and an approximate 95% interval at the requested target range
- every measured value, prediction, residual, normalized residual, and evidence role

The result is marked `validated_in_domain` only when the requested target range lies between the
lowest and highest calibration ranges. It is marked `extrapolated` outside that interval. Choke,
pellet deformation class, and pellet velocity spread are recorded as conditioning metadata. The
model does not transfer a fit between those conditions.

## Target-region probabilities

The analysis converts predicted D90 to the standard deviation of a centered, isotropic, two-
dimensional Gaussian impact distribution. A target region can be a circle or rectangle and can be
offset horizontally or vertically from the aim point. The application integrates that distribution
over the region to obtain a per-pellet hit probability.

For a load with `n` pellets, pellet-count probabilities use a binomial model with the same hit
probability for every pellet. The output includes:

- per-pellet hit probability and a range derived from the D90 interval
- expected pellet count in the target region
- probability mass for 0 through `n` pellets
- probability of meeting the configured minimum pellet count

These probabilities assume independent impacts. They do not account for pellet-to-pellet wakes,
swarm aerodynamics, clustering, correlated deformation, point-of-aim error, shooter dispersion, or
target motion. Treat them as a compact summary of the fitted impact cloud, not a terminal-effects
or safety model.

## Workflow

1. Select or create the shotgun load used for the pattern test.
2. Open the empirical buckshot pattern input group and enable it.
3. Record the choke, deformation class, pellet velocity spread, and target region.
4. Enter the observations and reserve at least one range or shot group as holdout evidence.
5. Calculate, then review calibration error, holdout error, the domain status, and residuals.
6. Export CSV when an auditable copy is needed. The export includes the fit, interval, complete
   pellet-count distribution, residuals, and validity statement.

Combined-scenario profiles preserve the input configuration and observations. Imported profile
documents are schema checked, size limited, and decoded with the same range and evidence-split
rules as interactive input.

## Evidence boundary

The repository does not include a redistributable empirical buckshot pattern dataset with repeated
shell measurements, stated uncertainty, and a physically separate holdout. The implementation is
covered by synthetic native and protocol tests. Predictive accuracy belongs to the user's supplied
measurements until a suitable licensed dataset is added to the validation inventory.
