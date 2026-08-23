#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "ballistics.hpp"

namespace
{

void expect_near(
    const std::string& label,
    double actual,
    double expected,
    double tolerance
)
{
    if (std::abs(actual - expected) > tolerance)
    {
        std::cerr << std::setprecision(17) << label << ": expected " << expected << ", got "
                  << actual << ", difference " << std::abs(actual - expected) << '\n';
        std::exit(1);
    }
}

void expect_true(
    const std::string& label,
    bool condition
)
{
    if (!condition)
    {
        std::cerr << label << " failed\n";
        std::exit(1);
    }
}

ballistics::TrajectorySample require_sample(
    const std::string& label,
    std::optional<ballistics::TrajectorySample> sample
)
{
    if (!sample)
    {
        std::cerr << label << ": sample unavailable\n";
        std::exit(1);
    }
    return sample.value();
}

double legacy_cubic_bezier(
    const std::array<double, 4>& values,
    double u
)
{
    const auto q = 1.0 - u;
    return values[0] * q * q * q + 3.0 * values[1] * u * q * q + 3.0 * values[2] * u * u * q +
        values[3] * u * u * u;
}

double legacy_bezier_y_from_x(
    double x,
    const std::array<std::pair<double, double>, 4>& points
)
{
    std::array<double, 4> xs {};
    std::array<double, 4> ys {};
    for (std::size_t index = 0; index < points.size(); ++index)
    {
        xs[index] = points[index].first;
        ys[index] = points[index].second;
    }
    if (x <= xs.front())
    {
        return ys.front();
    }
    if (x >= xs.back())
    {
        return ys.back();
    }

    double low = 0.0;
    double high = 1.0;
    for (int iteration = 0; iteration < 70; ++iteration)
    {
        const auto u = (low + high) / 2.0;
        if (legacy_cubic_bezier(xs, u) < x)
        {
            low = u;
        }
        else
        {
            high = u;
        }
    }
    return legacy_cubic_bezier(ys, (low + high) / 2.0);
}

double legacy_sphere_drag_coefficient(
    double mach,
    double reynolds
)
{
    constexpr std::array<std::pair<double, double>, 4> shock_points {
        { { 0.1, 0.0 }, { 0.95, 0.0 }, { 0.55, 0.95 }, { 1.5, 1.0 } }
    };
    constexpr std::array<std::pair<double, double>, 4> mask_points {
        { { 0.0, 1.1 }, { 0.85, 1.1 }, { 0.57, 0.05 }, { 1.0, 0.0 } }
    };
    const auto corrected = std::clamp(
        mach,
        ballistics::sphere_supported_mach_min,
        ballistics::sphere_supported_mach_max
    );
    const auto shock = corrected >= ballistics::sphere_supported_mach_max
        ? 1.0
        : legacy_bezier_y_from_x(corrected, shock_points);
    const auto mask = corrected > 1.0 ? 0.0 : legacy_bezier_y_from_x(corrected, mask_points);
    const auto reynolds_scale = 0.78 + 0.22 * std::atan(-12.0 * (corrected - 0.23));
    return shock + mask * ballistics::sphere_drag_vs_reynolds(reynolds_scale * reynolds);
}

void set_constant_reference_drag(
    ballistics::Projectile& projectile,
    ballistics::ReferenceDragCurve curve,
    double coefficient
)
{
    projectile.definition.drag = ballistics::ReferenceBcDrag {
        curve,
        ballistics::ConstantBallisticCoefficient { coefficient }
    };
}

void set_banded_reference_drag(
    ballistics::Projectile& projectile,
    ballistics::ReferenceDragCurve curve,
    std::vector<ballistics::BallisticCoefficientBand> bands
)
{
    projectile.definition.drag = ballistics::ReferenceBcDrag {
        curve,
        ballistics::BandedBallisticCoefficient { std::move(bands) }
    };
}

void set_tabulated_drag(
    ballistics::Projectile& projectile,
    double reference_diameter_m,
    std::vector<ballistics::MachCdPoint> points
)
{
    projectile.definition.drag =
        ballistics::TabulatedDrag { reference_diameter_m, std::move(points) };
}

} // namespace

int main()
{
    using namespace ballistics;

    const auto atmosphere = Atmosphere::create(15, 1013.25, 50, 0);

    {
        bool rejected_non_finite = false;
        try
        {
            static_cast<void>(Atmosphere::create(std::nan(""), 1013.25, 50, 0));
        }
        catch (const std::invalid_argument&)
        {
            rejected_non_finite = true;
        }
        expect_true("non-finite atmosphere rejected", rejected_non_finite);
    }

    expect_near("density", atmosphere.density_kg_m3, 1.221089389807009, 1e-12);
    expect_near("sound", atmosphere.speed_of_sound_mps, 340.87562704634331, 1e-10);
    expect_near("viscosity", atmosphere.dynamic_viscosity_pa_s, 1.7892858603596875e-5, 1e-15);

    const double expected_speed_100[] = {
        294.63429894657418, 287.76752947896654, 307.59827322028275,
        761.01165933052721, 763.9688036680418,  211.89480154786187
    };

    const double expected_drop_100[] = {
        0.26569895354242606,  0.35459204290220553,  0.27086613524221997,
        0.076295671455500882, 0.071838139853772562, 0.52679368762147694
    };

    const double expected_speed_500[] = {
        46.863850390811102, 79.902462889757729, 80.698792540593189,
        540.24753247570914, 447.41399014813362, 46.070273170270468
    };

    const double expected_drop_500[] = {
        49.140045086915229, 37.031619866433509, 33.367062985982599,
        2.413770370279821,  2.6222625716929642, 88.902774776936681
    };

    const auto& loads = built_in_projectiles();

    {
        std::vector<std::string> ids;
        for (const auto& load : loads)
        {
            expect_true("built-in projectile validates", validate_projectile(load).empty());
            expect_true("built-in projectile ID is stable", !load.provenance.id.empty());
            ids.push_back(load.provenance.id);
        }
        std::sort(ids.begin(), ids.end());
        expect_true(
            "built-in projectile IDs are unique",
            std::adjacent_find(ids.begin(), ids.end()) == ids.end()
        );

        auto exclusive_drag = loads[3];
        set_tabulated_drag(exclusive_drag, 0.01, { { 0.0, 0.3 }, { 2.0, 0.3 } });
        expect_true(
            "drag alternatives are structurally exclusive",
            tabulated_drag(exclusive_drag) && !reference_bc_drag(exclusive_drag) &&
                !sphere_drag(exclusive_drag)
        );

        auto inconsistent_sphere = loads[5];
        inconsistent_sphere.definition.mass_kg *= 2;
        const auto sphere_issues = validate_projectile(inconsistent_sphere);
        expect_true(
            "inconsistent sphere mass rejected",
            std::any_of(
                sphere_issues.begin(),
                sphere_issues.end(),
                [](const auto& issue)
                { return issue.code == "projectile.sphere.mass_inconsistent"; }
            )
        );
    }

    // Reference-BC schedules are selected from airspeed with exact, right-continuous thresholds.
    {
        auto scheduled = loads[3];
        set_banded_reference_drag(
            scheduled,
            ReferenceDragCurve::g1,
            { { 0.0, 0.2 }, { 400.0, 0.4 }, { 700.0, 0.3 } }
        );
        expect_true("velocity-banded BC validates", validate_projectile(scheduled).empty());
        expect_near(
            "BC band below first transition",
            effective_ballistic_coefficient(scheduled, 399.9),
            0.2,
            1e-15
        );
        expect_near(
            "BC band at transition",
            effective_ballistic_coefficient(scheduled, 400.0),
            0.4,
            1e-15
        );
        expect_near(
            "BC band at high speed",
            effective_ballistic_coefficient(scheduled, 900.0),
            0.3,
            1e-15
        );

        auto constant_low = scheduled;
        set_constant_reference_drag(constant_low, ReferenceDragCurve::g1, 0.2);
        auto constant_high = constant_low;
        set_constant_reference_drag(constant_high, ReferenceDragCurve::g1, 0.4);
        expect_near(
            "scheduled retardation below transition",
            drag_retardation_mps2(399.9, scheduled, atmosphere),
            drag_retardation_mps2(399.9, constant_low, atmosphere),
            1e-12
        );
        expect_near(
            "scheduled retardation at transition",
            drag_retardation_mps2(400.0, scheduled, atmosphere),
            drag_retardation_mps2(400.0, constant_high, atmosphere),
            1e-12
        );

        auto unordered = scheduled;
        set_banded_reference_drag(
            unordered,
            ReferenceDragCurve::g1,
            { { 0.0, 0.2 }, { 500.0, 0.3 }, { 400.0, 0.4 } }
        );
        const auto unordered_issues = validate_projectile(unordered);
        expect_true(
            "unordered BC schedule rejected",
            std::any_of(
                unordered_issues.begin(),
                unordered_issues.end(),
                [](const auto& issue) { return issue.code == "projectile.bc_schedule.order"; }
            )
        );

        auto uncovered = scheduled;
        set_banded_reference_drag(
            uncovered,
            ReferenceDragCurve::g1,
            { { 100.0, 0.2 }, { 400.0, 0.4 } }
        );
        const auto uncovered_issues = validate_projectile(uncovered);
        expect_true(
            "uncovered BC schedule rejected",
            std::any_of(
                uncovered_issues.begin(),
                uncovered_issues.end(),
                [](const auto& issue) { return issue.code == "projectile.bc_schedule.coverage"; }
            )
        );
    }

    // The current sphere fit declares the exact Mach/Reynolds box in which it is treated as
    // supported. Calculations continue outside the box and report extrapolation.
    {
        double maximum_newton_difference = 0.0;
        constexpr std::array<double, 9> reynolds_cases {
            100.0, 300.0, 1000.0, 10000.0, 100000.0, 477000.0, 900000.0, 1.2e6, 2.0e6
        };
        for (const auto reynolds : reynolds_cases)
        {
            for (int index = 0; index <= 1300; ++index)
            {
                const auto mach = 0.2 + static_cast<double>(index) / 1000.0;
                maximum_newton_difference = std::max(
                    maximum_newton_difference,
                    std::abs(
                        sphere_drag_coefficient(mach, reynolds) -
                        legacy_sphere_drag_coefficient(mach, reynolds)
                    )
                );
            }
        }
        expect_true(
            "safeguarded Newton sphere inversion preserves legacy correlation",
            maximum_newton_difference <= 2e-13
        );
        expect_near(
            "sphere coefficient clamps below declared Mach range",
            sphere_drag_coefficient(0.0, 100000.0),
            legacy_sphere_drag_coefficient(0.0, 100000.0),
            2e-13
        );
        expect_near(
            "sphere coefficient clamps above declared Mach range",
            sphere_drag_coefficient(3.0, 100000.0),
            legacy_sphere_drag_coefficient(3.0, 100000.0),
            2e-13
        );
        bool invalid_sphere_inputs_rejected = false;
        try
        {
            static_cast<void>(sphere_drag_coefficient(-0.1, 0.0));
        }
        catch (const std::invalid_argument&)
        {
            invalid_sphere_inputs_rejected = true;
        }
        expect_true(
            "invalid direct sphere coefficient inputs rejected",
            invalid_sphere_inputs_rejected
        );

        const auto in_domain_trajectory = integrate_trajectory(loads[5], atmosphere, 100);
        const auto in_domain = evaluate_drag_validity(loads[5], in_domain_trajectory, 100);
        expect_true(
            "sphere validity in domain",
            in_domain.status == DragValidityStatus::within_domain
        );
        expect_true(
            "sphere validity fields present",
            in_domain.supported_mach_min.has_value() && in_domain.supported_mach_max.has_value()
        );
        expect_near(
            "sphere supported Mach minimum",
            *in_domain.supported_mach_min,
            sphere_supported_mach_min,
            1e-15
        );
        expect_near(
            "sphere supported Mach maximum",
            *in_domain.supported_mach_max,
            sphere_supported_mach_max,
            1e-15
        );

        const auto long_trajectory = integrate_trajectory(loads[5], atmosphere, 500);
        const auto extrapolated = evaluate_drag_validity(loads[5], long_trajectory, 500);
        expect_true(
            "slow sphere trajectory reports extrapolation",
            extrapolated.status == DragValidityStatus::extrapolated &&
                extrapolated.observed_mach_min.has_value() &&
                *extrapolated.observed_mach_min < sphere_supported_mach_min
        );

        const auto reference_trajectory = integrate_trajectory(loads[3], atmosphere, 100);
        const auto reference = evaluate_drag_validity(loads[3], reference_trajectory, 100);
        expect_true(
            "reference curve validity not overclaimed",
            reference.status == DragValidityStatus::not_declared
        );
        expect_true(
            "model identity is nonempty",
            !engine_version.empty() && !model_version.empty()
        );

        const std::string manifest_path =
            std::string(BALLISTICS_SOURCE_DIR) + "/validation/manifest.json";
        std::ifstream manifest_input(manifest_path);
        const auto manifest_opens = manifest_input.good();
        std::stringstream manifest_buffer;
        manifest_buffer << manifest_input.rdbuf();
        const auto manifest = manifest_buffer.str();
        expect_true("model manifest opens", manifest_opens);
        expect_true(
            "model version matches manifest",
            manifest.find("\"modelVersion\": \"" + std::string(model_version) + "\"") !=
                std::string::npos
        );
        expect_true(
            "sphere validity is source controlled",
            manifest.find("\"mach\": [0.2, 1.5]") != std::string::npos &&
                manifest.find("\"reynolds\": [100, 2000000]") != std::string::npos
        );
    }

    // Weighted reference-BC calibration separates fitted and held-out observations and reports
    // confidence intervals from the final weighted Jacobian.
    {
        auto truth = loads[3];
        set_constant_reference_drag(truth, ReferenceDragCurve::g1, 0.42);
        const auto truth_trajectory = integrate_trajectory(truth, atmosphere, 400);
        std::vector<VelocityObservation> observations;
        for (const auto distance : { 100.0, 200.0, 300.0, 400.0 })
        {
            observations.push_back(
                { distance,
                  require_sample("calibration truth", truth_trajectory.sample_at(distance))
                      .ground_speed_mps,
                  0.5,
                  distance == 400.0 ? ObservationRole::holdout : ObservationRole::calibration }
            );
        }
        auto initial = truth;
        set_constant_reference_drag(initial, ReferenceDragCurve::g1, 0.2);
        const auto fitted = calibrate_reference_ballistic_coefficient(
            initial,
            atmosphere,
            observations,
            BcFitKind::constant
        );
        expect_true(
            "constant BC calibration converges",
            fitted.status == CalibrationStatus::converged && fitted.estimates.size() == 1
        );
        expect_near(
            "constant BC calibration recovers truth",
            fitted.estimates[0].ballistic_coefficient,
            0.42,
            2e-5
        );
        expect_true(
            "constant BC confidence interval contains truth",
            fitted.estimates[0].confidence_95_low.has_value() &&
                fitted.estimates[0].confidence_95_high.has_value() &&
                *fitted.estimates[0].confidence_95_low <= 0.42 &&
                *fitted.estimates[0].confidence_95_high >= 0.42
        );
        expect_true(
            "calibration and holdout errors are separate",
            fitted.calibration_rmse_mps < 0.01 && fitted.holdout_rmse_mps.has_value() &&
                *fitted.holdout_rmse_mps < 0.01 &&
                fitted.residuals.back().role == ObservationRole::holdout
        );

        const std::vector<VelocityObservation> just_determined_observations {
            { 200.0,
              require_sample("just-determined calibration truth", truth_trajectory.sample_at(200.0))
                  .ground_speed_mps,
              0.5,
              ObservationRole::calibration }
        };
        const auto just_determined = calibrate_reference_ballistic_coefficient(
            initial,
            atmosphere,
            just_determined_observations,
            BcFitKind::constant
        );
        expect_true(
            "one observation can determine one BC without claiming uncertainty",
            just_determined.status == CalibrationStatus::insufficient_information &&
                just_determined.estimates.size() == 1 &&
                !just_determined.estimates[0].confidence_95_low.has_value() &&
                !just_determined.estimates[0].confidence_95_high.has_value() &&
                just_determined.reduced_chi_square == 0.0
        );
        expect_near(
            "just-determined BC recovers truth",
            just_determined.estimates[0].ballistic_coefficient,
            0.42,
            2e-5
        );
        expect_near(
            "just-determined residual is numerically zero",
            just_determined.residuals[0].residual_mps,
            0.0,
            1e-5
        );

        auto banded_truth = loads[3];
        set_banded_reference_drag(
            banded_truth,
            ReferenceDragCurve::g7,
            { { 0.0, 0.25 }, { 700.0, 0.4 } }
        );
        const auto banded_trajectory = integrate_trajectory(banded_truth, atmosphere, 600);
        std::vector<VelocityObservation> banded_observations;
        for (const auto distance : { 75.0, 150.0, 250.0, 350.0, 450.0, 600.0 })
        {
            banded_observations.push_back(
                { distance,
                  require_sample("banded calibration truth", banded_trajectory.sample_at(distance))
                      .ground_speed_mps,
                  0.75,
                  distance == 450.0 ? ObservationRole::holdout : ObservationRole::calibration }
            );
        }
        auto banded_initial = banded_truth;
        set_constant_reference_drag(banded_initial, ReferenceDragCurve::g7, 0.3);
        const auto banded_fit = calibrate_reference_ballistic_coefficient(
            banded_initial,
            atmosphere,
            banded_observations,
            BcFitKind::velocity_bands,
            { 0.0, 700.0 },
            40
        );
        expect_true(
            "banded BC calibration converges",
            banded_fit.status == CalibrationStatus::converged && banded_fit.estimates.size() == 2
        );
        expect_near(
            "banded BC calibration recovers low-speed band",
            banded_fit.estimates[0].ballistic_coefficient,
            0.25,
            0.003
        );
        expect_near(
            "banded BC calibration recovers high-speed band",
            banded_fit.estimates[1].ballistic_coefficient,
            0.4,
            0.003
        );
    }

    // First-order uncertainty uses fixed-bore central sensitivities and root-sum-square combination.
    // Muzzle velocity has exact, easily checked derivatives at the muzzle.
    {
        const auto& projectile = loads[3];
        const auto baseline =
            integrate_zeroed_trajectory(projectile, atmosphere, 300, 100, 0.04, 1.0, 0.25);
        const std::vector<double> distances { 0.0, 100.0, 300.0 };

        UncertaintyInputs muzzle_only;
        muzzle_only.muzzle_velocity_standard_deviation_mps = 5.0;
        const auto muzzle = propagate_trajectory_uncertainty(
            projectile,
            atmosphere,
            baseline,
            300,
            100,
            0.04,
            1.0,
            muzzle_only,
            distances
        );
        expect_true(
            "muzzle uncertainty completes",
            muzzle.status == UncertaintyStatus::complete && muzzle.active_input_count == 1 &&
                muzzle.completed_input_count == 1 && muzzle.samples.size() == distances.size()
        );
        expect_near(
            "muzzle speed SD is exact",
            muzzle.samples[0].speed_standard_deviation_mps,
            5.0,
            1e-9
        );
        expect_near(
            "muzzle momentum SD is exact",
            muzzle.samples[0].momentum_standard_deviation_kgms,
            projectile.definition.mass_kg * 5.0,
            1e-10
        );
        expect_near(
            "muzzle energy SD is exact",
            muzzle.samples[0].energy_standard_deviation_j,
            projectile.definition.mass_kg * projectile.ammunition.muzzle_velocity_mps * 5.0,
            1e-6
        );
        expect_near(
            "muzzle path uncertainty is zero",
            muzzle.samples[0].path_standard_deviation_m,
            0.0,
            1e-12
        );
        expect_near(
            "muzzle holdover uncertainty is zero",
            muzzle.samples[0].holdover_standard_deviation_rad,
            0.0,
            1e-12
        );
        expect_true(
            "downrange muzzle sensitivity is nonzero",
            muzzle.samples.back().speed_standard_deviation_mps > 0.0 &&
                muzzle.samples.back().drop_standard_deviation_m > 0.0 &&
                muzzle.samples.back().time_standard_deviation_s > 0.0
        );

        UncertaintyInputs combined;
        combined.muzzle_velocity_standard_deviation_mps = 5.0;
        combined.drag_relative_standard_deviation = 0.05;
        combined.temperature_standard_deviation_c = 2.0;
        combined.pressure_standard_deviation_hpa = 5.0;
        combined.headwind_standard_deviation_mps = 1.0;
        combined.crosswind_standard_deviation_mps = 1.5;
        combined.zero_range_standard_deviation_m = 1.0;
        const auto propagated = propagate_trajectory_uncertainty(
            projectile,
            atmosphere,
            baseline,
            300,
            100,
            0.04,
            1.0,
            combined,
            distances
        );
        expect_true(
            "all deterministic uncertainty inputs complete",
            propagated.status == UncertaintyStatus::complete &&
                propagated.active_input_count == 7 && propagated.completed_input_count == 7 &&
                std::all_of(
                    propagated.samples.begin(),
                    propagated.samples.end(),
                    [](const auto& sample) { return sample.available; }
                )
        );
        expect_true(
            "independent sensitivities combine in quadrature",
            propagated.samples.back().speed_standard_deviation_mps >=
                    muzzle.samples.back().speed_standard_deviation_mps &&
                propagated.samples.back().path_standard_deviation_m > 0.0 &&
                propagated.samples.back().holdover_standard_deviation_rad > 0.0 &&
                propagated.samples.back().wind_drift_standard_deviation_m > 0.0
        );

        const auto none = propagate_trajectory_uncertainty(
            projectile,
            atmosphere,
            baseline,
            300,
            100,
            0.04,
            1.0,
            {},
            distances
        );
        expect_true(
            "zero uncertainty inputs are explicit",
            none.status == UncertaintyStatus::no_inputs && none.active_input_count == 0 &&
                none.samples.back().speed_standard_deviation_mps == 0.0
        );

        const auto unavailable = propagate_trajectory_uncertainty(
            projectile,
            atmosphere,
            {},
            300,
            100,
            0.04,
            1.0,
            combined,
            distances
        );
        expect_true(
            "unavailable baseline preserves requested input count",
            unavailable.status == UncertaintyStatus::baseline_unavailable &&
                unavailable.active_input_count == 7 && unavailable.completed_input_count == 0 &&
                std::all_of(
                    unavailable.samples.begin(),
                    unavailable.samples.end(),
                    [](const auto& sample) { return !sample.available; }
                )
        );

        auto invalid = combined;
        invalid.drag_relative_standard_deviation = -0.1;
        bool invalid_rejected = false;
        try
        {
            static_cast<void>(propagate_trajectory_uncertainty(
                projectile,
                atmosphere,
                baseline,
                300,
                100,
                0.04,
                1.0,
                invalid,
                distances
            ));
        }
        catch (const std::invalid_argument&)
        {
            invalid_rejected = true;
        }
        expect_true("negative uncertainty rejected", invalid_rejected);
    }

    // Direct Mach-Cd curves use linear interpolation, clamp only at their endpoints, and feed the
    // same physical force equation as every other explicit-Cd drag model.
    {
        auto tabulated = loads[3];
        tabulated.provenance.id = "custom:tabulated-core-test";
        set_tabulated_drag(
            tabulated,
            0.00782,
            { { 0.5, 0.20 }, { 1.0, 0.40 }, { 2.0, 0.30 }, { 3.0, 0.24 } }
        );
        expect_true(
            "tabulated Mach-Cd projectile validates",
            validate_projectile(tabulated).empty()
        );
        expect_near(
            "tabulated Cd clamps below domain",
            tabulated_drag_coefficient(tabulated, 0.1),
            0.20,
            1e-15
        );
        expect_near(
            "tabulated Cd preserves knot",
            tabulated_drag_coefficient(tabulated, 1.0),
            0.40,
            1e-15
        );
        expect_near(
            "tabulated Cd interpolates linearly",
            tabulated_drag_coefficient(tabulated, 1.5),
            0.35,
            1e-15
        );
        expect_near(
            "tabulated Cd clamps above domain",
            tabulated_drag_coefficient(tabulated, 5.0),
            0.24,
            1e-15
        );

        const auto speed = atmosphere.speed_of_sound_mps * 1.5;
        const auto reference_diameter = tabulated_drag(tabulated)->reference_diameter_m;
        const auto area = 3.14159265358979323846 * reference_diameter * reference_diameter / 4.0;
        const auto expected_force_acceleration = 0.5 * atmosphere.density_kg_m3 * 0.35 * area *
            speed * speed / tabulated.definition.mass_kg;
        expect_near(
            "tabulated Cd uses physical drag force",
            drag_retardation_mps2(speed, tabulated, atmosphere),
            expected_force_acceleration,
            1e-12
        );

        const auto diagnostics = aerodynamic_diagnostics(tabulated, { speed, 0, 0 }, atmosphere);
        expect_true(
            "tabulated Cd diagnostics available",
            diagnostics.has_drag_coefficient && diagnostics.has_reynolds
        );
        expect_near("tabulated diagnostic Cd", diagnostics.cd, 0.35, 1e-15);

        const auto trajectory = integrate_trajectory(tabulated, atmosphere, 100);
        const auto validity = evaluate_drag_validity(tabulated, trajectory, 100);
        expect_true(
            "tabulated curve reports supplied Mach domain",
            validity.status == DragValidityStatus::within_domain &&
                validity.supported_mach_min == 0.5 && validity.supported_mach_max == 3.0 &&
                !validity.supported_reynolds_min.has_value()
        );

        auto narrow = tabulated;
        set_tabulated_drag(narrow, 0.00782, { { 0.5, 0.30 }, { 1.5, 0.24 } });
        const auto narrow_trajectory = integrate_trajectory(narrow, atmosphere, 100);
        expect_true(
            "tabulated endpoint clamp is reported",
            evaluate_drag_validity(narrow, narrow_trajectory, 100).status ==
                DragValidityStatus::extrapolated
        );

        auto unordered = tabulated;
        set_tabulated_drag(unordered, 0.00782, { { 0.5, 0.2 }, { 0.4, 0.3 } });
        const auto unordered_issues = validate_projectile(unordered);
        expect_true(
            "unordered Mach-Cd curve rejected",
            std::any_of(
                unordered_issues.begin(),
                unordered_issues.end(),
                [](const auto& issue) { return issue.code == "projectile.mach_cd.order"; }
            )
        );
    }

    for (std::size_t i = 0; i < loads.size(); ++i)
    {
        const auto trajectory = integrate_trajectory_legacy(loads[i], atmosphere, 500);

        const auto& point =
            require_sample(loads[i].definition.short_name + " 100 m", trajectory.sample_at(100));
        expect_near(
            loads[i].definition.short_name + " speed",
            point.ground_speed_mps,
            expected_speed_100[i],
            2e-6
        );
        expect_near(
            loads[i].definition.short_name + " drop",
            point.drop_m,
            expected_drop_100[i],
            2e-8
        );

        const auto& distant =
            require_sample(loads[i].definition.short_name + " 500 m", trajectory.sample_at(500));
        expect_near(
            loads[i].definition.short_name + " 500m speed",
            distant.ground_speed_mps,
            expected_speed_500[i],
            3e-4
        );
        expect_near(
            loads[i].definition.short_name + " 500m drop",
            distant.drop_m,
            expected_drop_500[i],
            3e-4
        );

        const auto adaptive = integrate_trajectory(loads[i], atmosphere, 500);
        const auto& adaptive_100 = require_sample(
            loads[i].definition.short_name + " adaptive 100 m",
            adaptive.sample_at(100)
        );
        const auto& adaptive_500 = require_sample(
            loads[i].definition.short_name + " adaptive 500 m",
            adaptive.sample_at(500)
        );
        expect_near(
            loads[i].definition.short_name + " adaptive/legacy speed 100",
            adaptive_100.ground_speed_mps,
            point.ground_speed_mps,
            0.02
        );
        expect_near(
            loads[i].definition.short_name + " adaptive/legacy drop 100",
            adaptive_100.drop_m,
            point.drop_m,
            0.0001
        );
        expect_near(
            loads[i].definition.short_name + " adaptive/legacy speed 500",
            adaptive_500.ground_speed_mps,
            distant.ground_speed_mps,
            0.05
        );
        expect_near(
            loads[i].definition.short_name + " adaptive/legacy drop 500",
            adaptive_500.drop_m,
            distant.drop_m,
            0.1
        );
        expect_true(
            loads[i].definition.short_name + " adaptive diagnostics",
            adaptive.solver.mode == SolverMode::adaptive_time &&
                adaptive.solver.accepted_steps > 0 &&
                adaptive.solver.attempted_steps ==
                    adaptive.solver.accepted_steps + adaptive.solver.rejected_steps
        );
    }

    const auto rifle = integrate_trajectory(loads[3], atmosphere, 500);
    const auto mpbr = compute_mpbr(rifle, 0.20, 0.04);
    const auto legacy_mpbr =
        compute_mpbr(integrate_trajectory_legacy(loads[3], atmosphere, 500), 0.20, 0.04);

    expect_true("rifle MPBR complete", mpbr.status == MpbrStatus::complete);
    expect_near("legacy rifle zero", legacy_mpbr.zero_m, 233.02425823415155, 2e-6);
    expect_near("legacy rifle mpbr", legacy_mpbr.mpbr_m, 274.05964995648782, 2e-6);
    expect_near("adaptive/legacy rifle zero", mpbr.zero_m, legacy_mpbr.zero_m, 0.01);
    expect_near("adaptive/legacy rifle mpbr", mpbr.mpbr_m, legacy_mpbr.mpbr_m, 0.01);

    struct Scenario
    {
        const char* name;
        double temperature;
        double pressure;
        double humidity;
        double wind;
        double density;
        double sound;
        double viscosity;
        double speeds[3];
        double drops[3];
        double times[3];
    };

    const Scenario scenarios[] = {
        { "cold dense",
          -20,
          1080,
          10,
          8,
          1.4861308513295794,
          319.08809701652433,
          1.6152672443407784e-5,
          { 159.88990220884142, 735.69583679082052, 126.39335458923827 },
          { 1.0770294234157969, 0.16899921076125737, 2.093900702778833 },
          { 0.55437447450442523, 0.18998681246499557, 0.75597542473990853 } },
        { "hot high",
          40,
          700,
          90,
          -5,
          0.7508018322434107,
          360.12914640573479,
          1.907454712187927e-5,
          { 312.8831457038163, 788.62489129972914, 227.33191063153743 },
          { 0.58964405099444051, 0.161126647008459, 1.136185789691708 },
          { 0.37956398295021948, 0.18346889513561374, 0.52330142484948017 } }
    };

    const std::size_t scenario_loads[] = { 0, 3, 5 };

    for (const auto& scenario : scenarios)
    {
        const auto air = Atmosphere::create(
            scenario.temperature,
            scenario.pressure,
            scenario.humidity,
            scenario.wind
        );

        const std::string name_prefix = std::string(scenario.name);

        expect_near(name_prefix + " density", air.density_kg_m3, scenario.density, 2e-12);
        expect_near(name_prefix + " sound", air.speed_of_sound_mps, scenario.sound, 2e-10);
        expect_near(
            name_prefix + " viscosity",
            air.dynamic_viscosity_pa_s,
            scenario.viscosity,
            2e-15
        );

        for (std::size_t i = 0; i < 3; ++i)
        {
            const auto multiplier = (scenario_loads[i] == 3) ? 1.03 : 0.97;
            const auto& load = loads[scenario_loads[i]];

            const auto trajectory = integrate_trajectory_legacy(load, air, 300, multiplier);
            const auto prefix = name_prefix + " " + load.definition.short_name;
            const auto& point = require_sample(prefix + " point", trajectory.sample_at(150));
            expect_near(prefix + " speed", point.ground_speed_mps, scenario.speeds[i], 3e-6);
            expect_near(prefix + " drop", point.drop_m, scenario.drops[i], 3e-8);
            expect_near(prefix + " time", point.time_s, scenario.times[i], 3e-9);

            expect_near(
                prefix + " energy identity",
                point.energy_j,
                0.5 * load.definition.mass_kg * point.ground_speed_mps * point.ground_speed_mps,
                1e-9
            );

            expect_near(
                prefix + " momentum identity",
                point.momentum_kgms,
                load.definition.mass_kg * point.ground_speed_mps,
                1e-12
            );

            expect_true(
                prefix + " complete range",
                trajectory.termination == TrajectoryTermination::requested_distance &&
                    std::abs(trajectory.covered_distance_m - 300) < 1e-9
            );

            for (std::size_t j = 1; j < trajectory.samples.size(); ++j)
            {
                expect_true(
                    prefix + " increasing distance",
                    trajectory.samples[j].distance_m > trajectory.samples[j - 1].distance_m
                );

                expect_true(
                    prefix + " finite values",
                    std::isfinite(trajectory.samples[j].ground_speed_mps) &&
                        std::isfinite(trajectory.samples[j].drop_m) &&
                        std::isfinite(trajectory.samples[j].time_s)
                );
            }

            const auto adaptive = integrate_trajectory(load, air, 300, multiplier);
            const auto& adaptive_point =
                require_sample(prefix + " adaptive point", adaptive.sample_at(150));
            expect_near(
                prefix + " adaptive/legacy speed",
                adaptive_point.ground_speed_mps,
                point.ground_speed_mps,
                0.15
            );
            expect_near(
                prefix + " adaptive/legacy drop",
                adaptive_point.drop_m,
                point.drop_m,
                0.0005
            );
            expect_near(
                prefix + " adaptive/legacy time",
                adaptive_point.time_s,
                point.time_s,
                0.00025
            );
        }
    }

    // In vacuum, the time-domain state has the closed-form constant-gravity solution. This checks
    // the integration variable, launch geometry, and dense range interpolation independently of the
    // empirical drag models.
    {
        SolverConfiguration vacuum_configuration;
        vacuum_configuration.include_aerodynamic_drag = false;
        vacuum_configuration.launch_elevation_rad = 0.1;
        const auto vacuum =
            integrate_trajectory(loads[3], atmosphere, 400, 1.0, 0.25, vacuum_configuration);
        const auto& point = require_sample("vacuum 400", vacuum.sample_at(400));
        const auto velocity = loads[3].ammunition.muzzle_velocity_mps;
        const auto expected_time = 400.0 / (velocity * std::cos(0.1));
        const auto expected_height =
            400.0 * std::tan(0.1) - gravity_mps2 * expected_time * expected_time / 2.0;
        expect_true(
            "vacuum trajectory complete",
            vacuum.termination == TrajectoryTermination::requested_distance
        );
        expect_near("vacuum analytical time", point.time_s, expected_time, 2e-12);
        expect_near("vacuum analytical height", point.position_m.y, expected_height, 2e-10);
        expect_near(
            "vacuum analytical vertical velocity",
            point.ground_velocity_mps.y,
            velocity * std::sin(0.1) - gravity_mps2 * expected_time,
            2e-10
        );
    }

    // With gravity disabled and a constant physical Cd, horizontal quadratic drag has the exact
    // range-domain solution v(x) = v0 exp(-k x), t(x) = (exp(k x) - 1) / (k v0).
    {
        auto constant_cd = loads[3];
        constant_cd.provenance.id = "test:constant-cd-analytic";
        constant_cd.ammunition.muzzle_velocity_mps = 300.0;
        set_tabulated_drag(constant_cd, 0.01, { { 0.0, 0.3 }, { 10.0, 0.3 } });
        expect_true(
            "constant-Cd analytic projectile validates",
            validate_projectile(constant_cd).empty()
        );

        SolverConfiguration constant_cd_configuration;
        constant_cd_configuration.include_gravity = false;
        const auto trajectory = integrate_trajectory(
            constant_cd,
            atmosphere,
            500.0,
            1.0,
            0.25,
            constant_cd_configuration
        );
        const auto area = 3.14159265358979323846 * 0.01 * 0.01 / 4.0;
        const auto drag_per_metre =
            0.5 * atmosphere.density_kg_m3 * 0.3 * area / constant_cd.definition.mass_kg;
        double maximum_speed_error_mps = 0.0;
        double maximum_time_error_s = 0.0;
        for (const auto distance : { 100.0, 300.0, 500.0 })
        {
            const auto& sample =
                require_sample("constant-Cd analytic sample", trajectory.sample_at(distance));
            const auto expected_speed =
                constant_cd.ammunition.muzzle_velocity_mps * std::exp(-drag_per_metre * distance);
            const auto expected_time = (std::exp(drag_per_metre * distance) - 1.0) /
                (drag_per_metre * constant_cd.ammunition.muzzle_velocity_mps);
            maximum_speed_error_mps = std::max(
                maximum_speed_error_mps,
                std::abs(sample.ground_speed_mps - expected_speed)
            );
            maximum_time_error_s =
                std::max(maximum_time_error_s, std::abs(sample.time_s - expected_time));
            expect_near("constant-Cd one-dimensional height", sample.position_m.y, 0.0, 1e-14);
            expect_near(
                "constant-Cd one-dimensional lateral position",
                sample.position_m.z,
                0.0,
                1e-14
            );
        }
        expect_near(
            "constant-Cd maximum analytical speed error",
            maximum_speed_error_mps,
            0.0,
            1e-4
        );
        expect_near("constant-Cd maximum analytical time error", maximum_time_error_s, 0.0, 1e-7);
    }

    // Launch elevation and azimuth are verified over a deterministic angle/range matrix against
    // the closed-form vacuum solution. This exercises the full three-dimensional launch rotation,
    // including negative angles, to cover more than a single vertical plane.
    {
        constexpr std::array<double, 3> elevations { -0.08, 0.0, 0.12 };
        constexpr std::array<double, 5> azimuths { -0.35, -0.15, 0.0, 0.15, 0.35 };
        constexpr std::array<double, 3> distances { 75.0, 200.0, 350.0 };
        const auto velocity = loads[3].ammunition.muzzle_velocity_mps;
        for (const auto elevation : elevations)
        {
            for (const auto azimuth : azimuths)
            {
                SolverConfiguration configuration;
                configuration.include_aerodynamic_drag = false;
                configuration.launch_elevation_rad = elevation;
                configuration.launch_azimuth_rad = azimuth;
                const auto trajectory = integrate_trajectory(
                    loads[3],
                    atmosphere,
                    distances.back(),
                    1.0,
                    0.25,
                    configuration
                );
                const auto horizontal_velocity = velocity * std::cos(elevation);
                const auto downrange_velocity = horizontal_velocity * std::cos(azimuth);
                const auto lateral_velocity = horizontal_velocity * std::sin(azimuth);
                const auto label = "vacuum rotation e=" + std::to_string(elevation) +
                    " a=" + std::to_string(azimuth);
                expect_true(
                    label + " complete",
                    trajectory.termination == TrajectoryTermination::requested_distance
                );
                for (const auto distance : distances)
                {
                    const auto& sample =
                        require_sample(label + " sample", trajectory.sample_at(distance));
                    const auto expected_time = distance / downrange_velocity;
                    const auto expected_height = velocity * std::sin(elevation) * expected_time -
                        0.5 * gravity_mps2 * expected_time * expected_time;
                    expect_near(label + " time", sample.time_s, expected_time, 5e-12);
                    expect_near(label + " height", sample.position_m.y, expected_height, 2e-9);
                    expect_near(
                        label + " lateral position",
                        sample.position_m.z,
                        lateral_velocity * expected_time,
                        2e-9
                    );
                    expect_near(
                        label + " downrange velocity",
                        sample.ground_velocity_mps.x,
                        downrange_velocity,
                        2e-10
                    );
                    expect_near(
                        label + " vertical velocity",
                        sample.ground_velocity_mps.y,
                        velocity * std::sin(elevation) - gravity_mps2 * expected_time,
                        2e-10
                    );
                    expect_near(
                        label + " lateral velocity",
                        sample.ground_velocity_mps.z,
                        lateral_velocity,
                        2e-10
                    );
                }
            }
        }
    }

    // Reflection about the vertical launch plane must preserve scalar/downrange state and reverse
    // lateral state. Mirroring crosswind with launch azimuth extends the property to moving air.
    {
        const auto compare_reflections =
            [&](const std::string& label,
                const Atmosphere& positive_air,
                const Atmosphere& negative_air,
                double azimuth)
        {
            SolverConfiguration positive_configuration;
            positive_configuration.launch_elevation_rad = 0.06;
            positive_configuration.launch_azimuth_rad = azimuth;
            auto negative_configuration = positive_configuration;
            negative_configuration.launch_azimuth_rad = -azimuth;
            const auto positive = integrate_trajectory(
                loads[3],
                positive_air,
                600.0,
                1.0,
                0.25,
                positive_configuration
            );
            const auto negative = integrate_trajectory(
                loads[3],
                negative_air,
                600.0,
                1.0,
                0.25,
                negative_configuration
            );
            for (const auto distance : { 100.0, 300.0, 600.0 })
            {
                const auto& left =
                    require_sample(label + " positive", positive.sample_at(distance));
                const auto& right =
                    require_sample(label + " negative", negative.sample_at(distance));
                expect_near(label + " time symmetry", left.time_s, right.time_s, 2e-12);
                expect_near(
                    label + " height symmetry",
                    left.position_m.y,
                    right.position_m.y,
                    2e-10
                );
                expect_near(
                    label + " speed symmetry",
                    left.ground_speed_mps,
                    right.ground_speed_mps,
                    2e-10
                );
                expect_near(
                    label + " lateral position reflection",
                    left.position_m.z,
                    -right.position_m.z,
                    2e-10
                );
                expect_near(
                    label + " lateral velocity reflection",
                    left.ground_velocity_mps.z,
                    -right.ground_velocity_mps.z,
                    2e-10
                );
            }
        };
        compare_reflections("calm azimuth", atmosphere, atmosphere, 0.18);
        compare_reflections(
            "mirrored wind/azimuth",
            Atmosphere::create(5.0, 900.0, 75.0, 12.0, 7.0),
            Atmosphere::create(5.0, 900.0, 75.0, 12.0, -7.0),
            0.12
        );
    }

    // In drag-free flight, specific mechanical energy is conserved and horizontal momentum is
    // constant. With gravity disabled and drag enabled, air-relative speed, kinetic energy, and
    // momentum must be non-increasing while range and time remain strictly ordered.
    {
        SolverConfiguration conservative_configuration;
        conservative_configuration.include_aerodynamic_drag = false;
        conservative_configuration.launch_elevation_rad = 0.17;
        conservative_configuration.launch_azimuth_rad = 0.21;
        const auto conservative = integrate_trajectory(
            loads[3],
            atmosphere,
            500.0,
            1.0,
            0.25,
            conservative_configuration
        );
        const auto& initial = conservative.samples.front();
        const auto initial_specific_energy =
            0.5 * initial.ground_speed_mps * initial.ground_speed_mps +
            gravity_mps2 * initial.position_m.y;
        const auto initial_horizontal_momentum = loads[3].definition.mass_kg *
            std::hypot(initial.ground_velocity_mps.x, initial.ground_velocity_mps.z);
        for (const auto& sample : conservative.samples)
        {
            const auto specific_energy = 0.5 * sample.ground_speed_mps * sample.ground_speed_mps +
                gravity_mps2 * sample.position_m.y;
            const auto horizontal_momentum = loads[3].definition.mass_kg *
                std::hypot(sample.ground_velocity_mps.x, sample.ground_velocity_mps.z);
            expect_near(
                "vacuum mechanical-energy conservation",
                specific_energy,
                initial_specific_energy,
                2e-8
            );
            expect_near(
                "vacuum horizontal-momentum conservation",
                horizontal_momentum,
                initial_horizontal_momentum,
                2e-12
            );
        }

        SolverConfiguration dissipative_configuration;
        dissipative_configuration.include_gravity = false;
        dissipative_configuration.launch_elevation_rad = 0.04;
        dissipative_configuration.launch_azimuth_rad = -0.08;
        const auto moving_air = Atmosphere::create(-20.0, 1080.0, 20.0, 18.0, 9.0);
        const auto dissipative =
            integrate_trajectory(loads[3], moving_air, 800.0, 1.0, 0.25, dissipative_configuration);
        expect_true(
            "dissipative trajectory complete",
            dissipative.termination == TrajectoryTermination::requested_distance
        );
        for (std::size_t index = 1; index < dissipative.samples.size(); ++index)
        {
            const auto& before = dissipative.samples[index - 1];
            const auto& after = dissipative.samples[index];
            expect_true(
                "dissipative distance strictly increases",
                after.distance_m > before.distance_m
            );
            expect_true("dissipative time strictly increases", after.time_s > before.time_s);
            expect_true(
                "air-relative speed cannot increase without gravity",
                after.airspeed_mps <= before.airspeed_mps + 1e-10
            );
            expect_true(
                "air-relative kinetic energy cannot increase without gravity",
                0.5 * loads[3].definition.mass_kg * after.airspeed_mps * after.airspeed_mps <=
                    0.5 * loads[3].definition.mass_kg * before.airspeed_mps * before.airspeed_mps +
                        1e-8
            );
            expect_true(
                "air-relative momentum cannot increase without gravity",
                loads[3].definition.mass_kg * after.airspeed_mps <=
                    loads[3].definition.mass_kg * before.airspeed_mps + 1e-10
            );
        }
    }

    // Production tolerances are compared with a much tighter, smaller-step reference solve.
    {
        SolverConfiguration reference_configuration;
        reference_configuration.relative_tolerance = 1e-11;
        reference_configuration.absolute_position_tolerance_m = 1e-11;
        reference_configuration.absolute_velocity_tolerance_mps = 1e-10;
        reference_configuration.initial_time_step_s = 1e-5;
        reference_configuration.maximum_time_step_s = 0.002;
        const auto production = integrate_trajectory(loads[3], atmosphere, 600);
        const auto reference =
            integrate_trajectory(loads[3], atmosphere, 600, 1.0, 0.25, reference_configuration);
        for (const auto distance : { 100.0, 300.0, 600.0 })
        {
            const auto& actual =
                require_sample("production convergence", production.sample_at(distance));
            const auto& expected =
                require_sample("reference convergence", reference.sample_at(distance));
            expect_near(
                "production/reference speed",
                actual.ground_speed_mps,
                expected.ground_speed_mps,
                0.002
            );
            expect_near("production/reference drop", actual.drop_m, expected.drop_m, 0.0001);
            expect_near("production/reference time", actual.time_s, expected.time_s, 2e-6);
        }
    }

    // Sight-in is solved by changing the actual bore elevation, not by rotating a horizontal
    // trajectory after integration. The native path intersects the sight line to much better than
    // the public 0.1 mm acceptance threshold.
    {
        const auto zeroed =
            integrate_zeroed_trajectory(loads[3], atmosphere, 600, 100, 0.04, 1.0, 0.25);
        expect_true("native zero solution complete", zeroed.status == ZeroingStatus::complete);
        expect_true("native bore elevation positive", zeroed.bore_elevation_rad > 0.0);
        const auto& zero = require_sample("native zero sample", zeroed.trajectory.sample_at(100));
        expect_near("native zero intersects sight line", zero.position_m.y, 0.04, 0.0001);
        expect_near(
            "native zero residual metadata",
            zeroed.zero_error_m,
            zero.position_m.y - 0.04,
            1e-12
        );

        const auto coarse =
            integrate_zeroed_trajectory(loads[3], atmosphere, 600, 100, 0.04, 1.0, 5.0);
        expect_true(
            "coarse native zero solution complete",
            coarse.status == ZeroingStatus::complete
        );
        expect_near(
            "native zero angle sampling invariance",
            zeroed.bore_elevation_rad,
            coarse.bore_elevation_rad,
            1e-12
        );

        const auto event_trajectory =
            integrate_zeroed_trajectory(loads[3], atmosphere, 1200, 100, 0.04, 1.0, 5.0);
        const auto events = analyze_trajectory_events(event_trajectory, 0.04);
        expect_true(
            "trajectory zero events complete",
            events.zero_crossings_status == TrajectoryEventStatus::complete &&
                events.near_zero_m.has_value() && events.far_zero_m.has_value() &&
                *events.near_zero_m > 0.0 && *events.near_zero_m < *events.far_zero_m
        );
        expect_near("configured zero is the far zero", *events.far_zero_m, 100.0, 0.01);
        expect_true(
            "maximum ordinate event complete",
            events.maximum_ordinate_status == TrajectoryEventStatus::complete &&
                events.maximum_ordinate_distance_m.has_value() &&
                events.maximum_ordinate_path_m.has_value() &&
                *events.maximum_ordinate_distance_m > *events.near_zero_m &&
                *events.maximum_ordinate_distance_m < *events.far_zero_m &&
                *events.maximum_ordinate_path_m > 0.0
        );
        expect_true(
            "ground intersection event complete",
            events.ground_intersection_status == TrajectoryEventStatus::complete &&
                events.ground_intersection_m.has_value() &&
                *events.ground_intersection_m > *events.far_zero_m
        );
        expect_true(
            "supersonic range event complete",
            events.supersonic_range_status == TrajectoryEventStatus::complete &&
                events.supersonic_range_m.has_value()
        );
        const auto mach_one = std::find_if(
            events.mach_crossings.begin(),
            events.mach_crossings.end(),
            [](const auto& crossing)
            {
                return crossing.mach == 1.0 &&
                    crossing.direction == MachCrossingDirection::decelerating;
            }
        );
        expect_true("Mach-one crossing is reported", mach_one != events.mach_crossings.end());
        expect_near(
            "supersonic range matches Mach-one crossing",
            *events.supersonic_range_m,
            mach_one->distance_m,
            1e-12
        );
        const auto& mach_one_sample = require_sample(
            "Mach-one event sample",
            event_trajectory.trajectory.sample_at(mach_one->distance_m)
        );
        expect_near("Mach-one event is refined", mach_one_sample.aerodynamics.mach, 1.0, 1e-8);

        const auto short_events = analyze_trajectory_events(
            integrate_zeroed_trajectory(loads[3], atmosphere, 120, 100, 0.04),
            0.04
        );
        expect_true(
            "unreached events remain horizon limited",
            short_events.ground_intersection_status == TrajectoryEventStatus::horizon_limited &&
                short_events.supersonic_range_status == TrajectoryEventStatus::horizon_limited
        );
        const auto unavailable_events = analyze_trajectory_events({}, 0.04);
        expect_true(
            "invalid zeroed baseline suppresses trajectory events",
            unavailable_events.zero_crossings_status ==
                    TrajectoryEventStatus::baseline_unavailable &&
                unavailable_events.maximum_ordinate_status ==
                    TrajectoryEventStatus::baseline_unavailable &&
                unavailable_events.mach_crossings.empty()
        );
    }

    // MPBR uses an internal numerical sampling ceiling, so presentation sampling cannot move the
    // reported optimum zero or lower vital-zone crossing.
    {
        const auto fine =
            compute_mpbr(integrate_trajectory(loads[3], atmosphere, 500, 1.0, 0.25), 0.20, 0.04);
        const auto coarse =
            compute_mpbr(integrate_trajectory(loads[3], atmosphere, 500, 1.0, 5.0), 0.20, 0.04);
        expect_true(
            "MPBR sampling comparison complete",
            fine.status == MpbrStatus::complete && coarse.status == MpbrStatus::complete
        );
        expect_near("MPBR sampling-invariant zero", fine.zero_m, coarse.zero_m, 1e-10);
        expect_near("MPBR sampling-invariant range", fine.mpbr_m, coarse.mpbr_m, 1e-10);

        const auto native_fine =
            compute_native_mpbr(loads[3], atmosphere, 500, 0.20, 0.04, 1.0, 0.25);
        const auto native_coarse =
            compute_native_mpbr(loads[3], atmosphere, 500, 0.20, 0.04, 1.0, 5.0);
        expect_true(
            "native MPBR complete",
            native_fine.status == MpbrStatus::complete &&
                native_coarse.status == MpbrStatus::complete
        );
        expect_near(
            "native MPBR sampling-invariant zero",
            native_fine.zero_m,
            native_coarse.zero_m,
            1e-10
        );
        expect_near(
            "native MPBR sampling-invariant range",
            native_fine.mpbr_m,
            native_coarse.mpbr_m,
            1e-10
        );

        const auto native_zero = integrate_zeroed_trajectory(
            loads[3],
            atmosphere,
            500,
            native_fine.zero_m,
            0.04,
            1.0,
            0.25
        );
        expect_true(
            "native MPBR zero trajectory complete",
            native_zero.status == ZeroingStatus::complete
        );
        double maximum_path = -0.04;
        for (const auto& sample : native_zero.trajectory.samples)
        {
            maximum_path = std::max(maximum_path, sample.position_m.y - 0.04);
        }
        expect_near("native MPBR maximum ordinate", maximum_path, 0.10, 0.0001);
        const auto& native_limit = require_sample(
            "native MPBR endpoint",
            native_zero.trajectory.sample_at(native_fine.mpbr_m)
        );
        expect_near("native MPBR lower crossing", native_limit.position_m.y - 0.04, -0.10, 0.0001);
    }

    // Cross-check the native root-search MPBR with a separate grid optimizer. The
    // reference enumerates bore elevations, rejects every trajectory whose maximum ordinate exceeds
    // the vital-zone radius, and retains the feasible trajectory with the farthest lower crossing.
    {
        struct BruteForceMpbr
        {
            bool available {};
            double elevation_rad {};
            double zero_m {};
            double range_m {};
        };
        constexpr double horizon_m = 800.0;
        constexpr double sight_height_m = 0.04;
        constexpr double radius_m = 0.10;
        const auto evaluate_elevation = [&](double elevation_rad)
        {
            BruteForceMpbr candidate;
            candidate.elevation_rad = elevation_rad;
            SolverConfiguration configuration;
            configuration.launch_elevation_rad = elevation_rad;
            const auto trajectory =
                integrate_trajectory(loads[3], atmosphere, horizon_m, 1.0, 0.25, configuration);
            if (trajectory.termination != TrajectoryTermination::requested_distance)
            {
                return candidate;
            }
            std::size_t apex = 0;
            auto maximum_path_m = trajectory.samples.front().position_m.y - sight_height_m;
            for (std::size_t index = 1; index < trajectory.samples.size(); ++index)
            {
                const auto path_m = trajectory.samples[index].position_m.y - sight_height_m;
                if (path_m > maximum_path_m)
                {
                    maximum_path_m = path_m;
                    apex = index;
                }
            }
            if (maximum_path_m > radius_m)
            {
                return candidate;
            }
            const auto descending_crossing = [&](double level_m)
            {
                auto previous_path_m = trajectory.samples[apex].position_m.y - sight_height_m;
                for (std::size_t index = apex + 1; index < trajectory.samples.size(); ++index)
                {
                    const auto path_m = trajectory.samples[index].position_m.y - sight_height_m;
                    if (previous_path_m > level_m && path_m <= level_m)
                    {
                        const auto fraction =
                            (previous_path_m - level_m) / (previous_path_m - path_m);
                        return trajectory.samples[index - 1].distance_m +
                            fraction *
                            (trajectory.samples[index].distance_m -
                             trajectory.samples[index - 1].distance_m);
                    }
                    previous_path_m = path_m;
                }
                return 0.0;
            };
            candidate.zero_m = descending_crossing(0.0);
            candidate.range_m = descending_crossing(-radius_m);
            candidate.available = candidate.zero_m > 0.0 && candidate.range_m > candidate.zero_m;
            return candidate;
        };

        BruteForceMpbr brute;
        constexpr double coarse_minimum_elevation_rad = -0.002;
        constexpr double coarse_step_rad = 0.0001;
        for (int index = 0; index <= 220; ++index)
        {
            const auto candidate =
                evaluate_elevation(coarse_minimum_elevation_rad + coarse_step_rad * index);
            if (candidate.available && candidate.range_m > brute.range_m)
            {
                brute = candidate;
            }
        }
        expect_true("brute-force MPBR coarse solution available", brute.available);
        const auto coarse_elevation_rad = brute.elevation_rad;
        constexpr double fine_step_rad = 0.000002;
        for (int index = -50; index <= 50; ++index)
        {
            const auto candidate = evaluate_elevation(coarse_elevation_rad + fine_step_rad * index);
            if (candidate.available && candidate.range_m > brute.range_m)
            {
                brute = candidate;
            }
        }

        const auto native =
            compute_native_mpbr(loads[3], atmosphere, horizon_m, 0.20, sight_height_m, 1.0, 0.25);
        expect_true(
            "native/brute-force MPBR complete",
            native.status == MpbrStatus::complete && brute.available
        );
        expect_near("native/brute-force optimal zero", native.zero_m, brute.zero_m, 0.5);
        expect_near("native/brute-force maximum range", native.mpbr_m, brute.range_m, 0.5);
    }

    // Every non-success exit reports an explicit event and retains its actual endpoint.
    {
        SolverConfiguration ground_configuration;
        ground_configuration.launch_elevation_rad = 0.01;
        ground_configuration.terminate_at_ground = true;
        ground_configuration.minimum_forward_speed_mps = 0.0;
        const auto ground =
            integrate_trajectory(loads[3], atmosphere, 2000, 1.0, 0.25, ground_configuration);
        expect_true(
            "ground impact termination",
            ground.termination == TrajectoryTermination::ground_impact
        );
        expect_near(
            "ground impact event height",
            ground.samples.back().position_m.y,
            ground_configuration.ground_height_m,
            1e-9
        );
        expect_near(
            "ground impact coverage endpoint",
            ground.samples.back().distance_m,
            ground.covered_distance_m,
            1e-12
        );

        SolverConfiguration time_configuration;
        time_configuration.maximum_time_s = 0.01;
        time_configuration.minimum_forward_speed_mps = 0.0;
        const auto timed =
            integrate_trajectory(loads[3], atmosphere, 1000, 1.0, 0.25, time_configuration);
        expect_true(
            "maximum-time termination",
            timed.termination == TrajectoryTermination::maximum_time
        );
        expect_near("maximum-time endpoint", timed.samples.back().time_s, 0.01, 1e-12);

        SolverConfiguration steps_configuration;
        steps_configuration.maximum_steps = 1;
        steps_configuration.minimum_forward_speed_mps = 0.0;
        const auto steps =
            integrate_trajectory(loads[3], atmosphere, 1000, 1.0, 0.25, steps_configuration);
        expect_true(
            "maximum-step termination",
            steps.termination == TrajectoryTermination::maximum_steps
        );
        expect_near(
            "maximum-step coverage endpoint",
            steps.samples.back().distance_m,
            steps.covered_distance_m,
            1e-12
        );

        auto slow_sphere = loads[5];
        slow_sphere.ammunition.muzzle_velocity_mps = 10.0;
        const auto strong_headwind = Atmosphere::create(15, 1013.25, 50, 100, 0);
        SolverConfiguration reversal_configuration;
        reversal_configuration.minimum_forward_speed_mps = 0.0;
        reversal_configuration.maximum_time_s = 10.0;
        const auto reversal = integrate_trajectory(
            slow_sphere,
            strong_headwind,
            1000,
            1.0,
            0.25,
            reversal_configuration
        );
        expect_true(
            "horizontal reversal termination",
            reversal.termination == TrajectoryTermination::horizontal_reversal
        );
        expect_true(
            "horizontal reversal remains finite",
            std::all_of(
                reversal.samples.begin(),
                reversal.samples.end(),
                [](const auto& item)
                {
                    return std::isfinite(item.distance_m) && std::isfinite(item.time_s) &&
                        std::isfinite(item.ground_speed_mps);
                }
            )
        );
    }

    expect_near("sea-level altitude pressure", altitude_to_pressure_hpa(0), 1013.25, 1e-12);
    expect_near(
        "below-sea-level pressure altitude",
        altitude_to_pressure_hpa(-1000),
        1139.2884209588751,
        1e-10
    );

    for (const double altitude : { -700.0, 0.0, 500.0, 1500.0, 3000.0, 6000.0, 10000.0 })
    {
        expect_near(
            "altitude pressure round trip",
            pressure_to_altitude_m(altitude_to_pressure_hpa(altitude)),
            altitude,
            2e-9
        );
    }
    expect_near(
        "altimeter setting to station pressure",
        altimeter_setting_to_station_pressure_hpa(1013.25, 1500.0),
        845.4724690949225,
        1e-10
    );
    expect_near(
        "station pressure to altimeter setting",
        station_pressure_to_altimeter_setting_hpa(845.4724690949225, 1500.0),
        1013.25,
        1e-10
    );
    expect_near(
        "standard density altitude",
        density_to_altitude_m(1.0580519375349757),
        1500.0,
        1e-9
    );

    expect_near(
        "exact upward holdover angle",
        elevation_holdover_rad(-100.0, 100.0),
        3.14159265358979323846 / 4.0,
        1e-15
    );
    expect_near(
        "exact downward holdover angle",
        elevation_holdover_rad(100.0, 100.0),
        -3.14159265358979323846 / 4.0,
        1e-15
    );
    expect_near("zero-range holdover convention", elevation_holdover_rad(-0.04, 0.0), 0.0, 0.0);
    bool invalid_holdover_rejected = false;
    try
    {
        static_cast<void>(elevation_holdover_rad(0.0, -1.0));
    }
    catch (const std::invalid_argument&)
    {
        invalid_holdover_rejected = true;
    }
    expect_true("invalid holdover geometry rejected", invalid_holdover_rejected);

    const auto sphere_diagnostics = aerodynamic_diagnostics(loads[5], { 300, 0, 0 }, atmosphere);
    expect_true(
        "sphere diagnostics available",
        sphere_diagnostics.has_drag_coefficient && sphere_diagnostics.has_reynolds &&
            sphere_diagnostics.cd > 0 && sphere_diagnostics.reynolds > 0
    );

    const auto g1_diagnostics = aerodynamic_diagnostics(loads[3], { 800, 0, 0 }, atmosphere);
    expect_true(
        "G1 diagnostics expose unified reference Cd",
        g1_diagnostics.has_drag_coefficient && !g1_diagnostics.has_reynolds &&
            g1_diagnostics.cd > 0.0
    );
    const auto reference_area = 3.14159265358979323846 * inches_to_m * inches_to_m / 4.0;
    const auto g1_physical_acceleration = 0.5 * atmosphere.density_kg_m3 * g1_diagnostics.cd *
        reference_area * 800.0 * 800.0 / (nominal_ballistic_coefficient(loads[3]) * 0.45359237);
    expect_near(
        "G1 unified physical force reconstruction",
        drag_retardation_mps2(800, loads[3], atmosphere),
        g1_physical_acceleration,
        1e-12
    );

    auto g7_reference = loads[3];
    set_constant_reference_drag(
        g7_reference,
        ReferenceDragCurve::g7,
        nominal_ballistic_coefficient(g7_reference)
    );
    const auto g7_diagnostics = aerodynamic_diagnostics(g7_reference, { 800, 0, 0 }, atmosphere);
    const auto g7_physical_acceleration = 0.5 * atmosphere.density_kg_m3 * g7_diagnostics.cd *
        reference_area * 800.0 * 800.0 / (nominal_ballistic_coefficient(g7_reference) * 0.45359237);
    expect_near(
        "G7 unified physical force reconstruction",
        drag_retardation_mps2(800, g7_reference, atmosphere),
        g7_physical_acceleration,
        1e-12
    );

    const auto spin_right = compute_spin_drift(
        loads[3],
        0.5,
        10,
        loads[3].ammunition.muzzle_velocity_mps,
        atmosphere,
        1
    );
    const auto spin_left = compute_spin_drift(
        loads[3],
        0.5,
        10,
        loads[3].ammunition.muzzle_velocity_mps,
        atmosphere,
        -1
    );

    expect_true(
        "spin available",
        spin_right.status == SpinDriftStatus::available &&
            spin_left.status == SpinDriftStatus::available
    );
    expect_near("spin direction symmetry", spin_right.drift_m, -spin_left.drift_m, 1e-15);

    // Canonical G7 curve conformance. Every source-data knot is exercised so a shifted or mutated
    // ordinate cannot hide behind trajectory regression values.
    {
        const std::string table_path =
            std::string(BALLISTICS_SOURCE_DIR) + "/validation/sources/g7-mccoy.csv";
        std::ifstream input(table_path);
        expect_true("G7 reference CSV opens", input.good());
        std::string line;
        std::getline(input, line);
        std::size_t knot_count = 0;
        while (std::getline(input, line))
        {
            const auto separator = line.find(',');
            expect_true("G7 reference CSV row", separator != std::string::npos);
            const auto mach = std::stod(line.substr(0, separator));
            const auto expected_cd = std::stod(line.substr(separator + 1));
            expect_near(
                "G7 knot " + std::to_string(mach),
                g7_drag_coefficient(mach),
                expected_cd,
                1e-12
            );
            ++knot_count;
        }
        expect_true("G7 knot count", knot_count == 84);
        expect_near("G7 Mach 1.0", g7_drag_coefficient(1.0), 0.3803, 1e-12);
        expect_near("G7 Mach 3.0", g7_drag_coefficient(3.0), 0.2424, 1e-12);
        expect_near("G7 interpolation", g7_drag_coefficient(1.0125), 0.3909, 1e-12);
    }

    // MPBR must be complete only when the lower vital-zone crossing is covered, and the answer is
    // invariant once sufficient trajectory horizon exists.
    {
        const auto short_rifle = integrate_trajectory(loads[3], atmosphere, 100);
        const auto short_mpbr = compute_mpbr(short_rifle, 0.20, 0.04);
        expect_true(
            "short MPBR is horizon-limited",
            short_mpbr.status == MpbrStatus::horizon_limited
        );

        const auto long_rifle = integrate_trajectory(loads[3], atmosphere, 2000);
        const auto long_mpbr = compute_mpbr(long_rifle, 0.20, 0.04);
        expect_true("long MPBR complete", long_mpbr.status == MpbrStatus::complete);
        expect_near("MPBR horizon invariance zero", long_mpbr.zero_m, mpbr.zero_m, 1e-9);
        expect_near("MPBR horizon invariance range", long_mpbr.mpbr_m, mpbr.mpbr_m, 1e-9);
        expect_true(
            "invalid MPBR geometry",
            compute_mpbr(long_rifle, 0.05, 0.04).status == MpbrStatus::invalid_geometry
        );
    }

    // Partial trajectories expose their actual coverage and never interpolate beyond it.
    {
        const auto partial = integrate_trajectory(loads[0], atmosphere, 2000);
        expect_true(
            "partial trajectory status",
            partial.termination == TrajectoryTermination::minimum_forward_speed
        );
        expect_true("partial trajectory coverage", partial.covered_distance_m < 2000.0);
        expect_true("partial trajectory no extrapolation", !partial.sample_at(2000.0).has_value());
        expect_true(
            "partial trajectory endpoint stored",
            std::abs(partial.samples.back().distance_m - partial.covered_distance_m) < 1e-12
        );

        const auto complete = integrate_trajectory(loads[3], atmosphere, 123.45);
        expect_true(
            "complete trajectory exact endpoint",
            complete.termination == TrajectoryTermination::requested_distance &&
                std::abs(complete.samples.back().distance_m - 123.45) < 1e-12
        );
    }

    // Diagnostics are derived from the same air-relative speed used by drag.
    {
        const auto headwind = Atmosphere::create(15, 1013.25, 50, 50, 0);
        const auto diagnostics = aerodynamic_diagnostics(loads[5], { 300, 0, 0 }, headwind);
        expect_near("headwind ground speed", diagnostics.ground_speed_mps, 300.0, 1e-12);
        expect_near("headwind airspeed", diagnostics.airspeed_mps, 350.0, 1e-12);
        expect_near("headwind Mach", diagnostics.mach, 350.0 / headwind.speed_of_sound_mps, 1e-12);
    }

    // The Miller stability term is inversely proportional to twist squared.
    {
        const auto spin_nine = compute_spin_drift(
            loads[3],
            0.5,
            9,
            loads[3].ammunition.muzzle_velocity_mps,
            atmosphere,
            1
        );
        const auto spin_eighteen = compute_spin_drift(
            loads[3],
            0.5,
            18,
            loads[3].ammunition.muzzle_velocity_mps,
            atmosphere,
            1
        );
        expect_true(
            "fast-twist comparison available",
            spin_nine.status == SpinDriftStatus::available
        );
        expect_true("slow twist is unstable", spin_eighteen.status == SpinDriftStatus::unstable);
        expect_near(
            "inverse-square twist stability",
            spin_nine.gyroscopic_stability,
            4.0 * spin_eighteen.gyroscopic_stability,
            1e-12
        );
        const auto spin_five = compute_spin_drift(
            loads[3],
            0.5,
            5,
            loads[3].ammunition.muzzle_velocity_mps,
            atmosphere,
            1
        );
        expect_true(
            "extreme fast twist is outside empirical drift domain",
            spin_five.status == SpinDriftStatus::outside_empirical_domain
        );
    }

    // Miller (Precision Shooting, March 2005), sample case 1: the equation estimates Sg for the
    // measured 12-inch twist of a 168-grain, 0.308-inch, 3.98-caliber-long projectile at 2,800 fps.
    {
        auto miller_case = loads[3];
        miller_case.definition.mass_kg = 168.0 * grains_to_kg;
        miller_case.definition.geometry = ProjectileGeometry { 3.98 * 0.308, 0.308 };
        miller_case.ammunition.muzzle_velocity_mps = 2800.0 * fps_to_mps;
        auto standard_density = atmosphere;
        standard_density.density_kg_m3 = 1.225;
        const auto published_example = compute_spin_drift(
            miller_case,
            0.5,
            12.0,
            miller_case.ammunition.muzzle_velocity_mps,
            standard_density,
            1
        );
        expect_near(
            "published Miller case 1 stability",
            published_example.gyroscopic_stability,
            1.6954377663173301,
            1e-12
        );
        expect_true(
            "published Miller case remains inside drift domain",
            published_example.status == SpinDriftStatus::available
        );
    }

    // Crosswind wind drift (full 3D integration).
    {
        const auto calm = Atmosphere::create(15, 1013.25, 50, 0, 0);
        const auto calm_traj = integrate_trajectory(loads[3], calm, 500);
        expect_near(
            "no crosswind means no drift at 100",
            require_sample("calm 100", calm_traj.sample_at(100)).wind_drift_m,
            0.0,
            1e-15
        );
        expect_near(
            "no crosswind means no drift at 500",
            require_sample("calm 500", calm_traj.sample_at(500)).wind_drift_m,
            0.0,
            1e-15
        );

        const auto right = Atmosphere::create(15, 1013.25, 50, 0, 5);
        const auto left = Atmosphere::create(15, 1013.25, 50, 0, -5);
        const auto right_traj = integrate_trajectory(loads[3], right, 500);
        const auto left_traj = integrate_trajectory(loads[3], left, 500);

        const auto drift_300 = require_sample("right 300", right_traj.sample_at(300)).wind_drift_m;
        expect_true("positive crosswind drifts right", drift_300 > 0.0);
        expect_near(
            "crosswind sign symmetry",
            drift_300,
            -require_sample("left 300", left_traj.sample_at(300)).wind_drift_m,
            1e-12
        );

        // Drift grows monotonically downrange.
        expect_true(
            "drift increases with range",
            require_sample("right 500", right_traj.sample_at(500)).wind_drift_m > drift_300 &&
                drift_300 > require_sample("right 100", right_traj.sample_at(100)).wind_drift_m
        );

        // Small-angle crosswind is very nearly linear in wind speed.
        const auto right_ten = Atmosphere::create(15, 1013.25, 50, 0, 10);
        const auto drift_10 =
            require_sample(
                "right ten 300",
                integrate_trajectory(loads[3], right_ten, 500).sample_at(300)
            )
                .wind_drift_m;
        expect_near("drift is linear in wind speed", drift_10, 2.0 * drift_300, 0.02 * drift_10);

        // Cross-check against the independent point-mass "lag time" model:
        // drift ~= crosswind * (time_of_flight - range / muzzle_velocity).
        const auto tof = require_sample("right TOF 300", right_traj.sample_at(300)).time_s;
        const auto lag_drift = 5.0 * (tof - 300.0 / loads[3].ammunition.muzzle_velocity_mps);
        expect_true(
            "integrated drift agrees with lag-time model",
            std::abs(drift_300 - lag_drift) / drift_300 < 0.15
        );
    }

    // Seeded Monte Carlo propagation is reproducible and reports ordered empirical intervals.
    {
        ShotScenario scenario;
        scenario.environment = Environment::homogeneous(atmosphere);
        scenario.geometry.maximum_distance_m = 120.0;
        scenario.geometry.zero_range_m = 100.0;
        scenario.geometry.sight_height_m = 0.04;
        scenario.geometry.target_distance_m = 100.0;
        scenario.geometry.vital_zone_m = 0.15;

        UncertaintyInputs inputs;
        inputs.muzzle_velocity_standard_deviation_mps = 4.0;
        inputs.drag_relative_standard_deviation = 0.025;
        inputs.temperature_standard_deviation_c = 1.0;
        inputs.pressure_standard_deviation_hpa = 2.0;
        inputs.crosswind_standard_deviation_mps = 0.75;
        inputs.zero_range_standard_deviation_m = 0.5;
        const std::vector<UncertaintyCorrelation> correlations {
            { UncertaintyVariable::muzzle_velocity, UncertaintyVariable::drag, -0.35 }
        };
        const std::vector<double> distances { 0.0, 50.0, 100.0 };
        const auto first = propagate_monte_carlo_uncertainty(
            loads[3],
            scenario,
            inputs,
            correlations,
            distances,
            100,
            0x4d435f53454544ULL
        );
        const auto repeated = propagate_monte_carlo_uncertainty(
            loads[3],
            scenario,
            inputs,
            correlations,
            distances,
            100,
            0x4d435f53454544ULL
        );
        expect_true("Monte Carlo complete", first.status == UncertaintyStatus::complete);
        expect_true("Monte Carlo sample count", first.completed_sample_count == 100);
        expect_true("Monte Carlo output count", first.samples.size() == distances.size());
        expect_true(
            "Monte Carlo seeded reproducibility",
            first.samples[2].speed_mps.median == repeated.samples[2].speed_mps.median &&
                first.samples[2].path_m.low_95 == repeated.samples[2].path_m.low_95 &&
                first.maximum_split_quantile_delta == repeated.maximum_split_quantile_delta
        );
        for (const auto& sample : first.samples)
        {
            expect_true("Monte Carlo sample available", sample.available);
            expect_true(
                "Monte Carlo speed interval ordered",
                sample.speed_mps.low_95 <= sample.speed_mps.median &&
                    sample.speed_mps.median <= sample.speed_mps.high_95
            );
            expect_true(
                "Monte Carlo path interval ordered",
                sample.path_m.low_95 <= sample.path_m.median &&
                    sample.path_m.median <= sample.path_m.high_95
            );
        }
        expect_true(
            "Monte Carlo convergence diagnostic finite",
            std::isfinite(first.maximum_split_quantile_delta) &&
                first.maximum_split_quantile_delta >= 0.0
        );
    }

    std::cout << "All C++ numerical regression tests passed.\n";
}
