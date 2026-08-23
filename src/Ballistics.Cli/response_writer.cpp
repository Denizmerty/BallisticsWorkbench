#include "response_writer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iterator>
#include <optional>
#include <ostream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ballistics.hpp"

namespace ballistics::cli
{
namespace
{

const char* trajectory_status(
    ballistics::TrajectoryTermination termination
)
{
    using ballistics::TrajectoryTermination;
    switch (termination)
    {
    case TrajectoryTermination::requested_distance:
        return "complete";
    case TrajectoryTermination::ground_impact:
        return "ground_impact";
    case TrajectoryTermination::minimum_forward_speed:
        return "minimum_forward_speed";
    case TrajectoryTermination::maximum_time:
        return "maximum_time";
    case TrajectoryTermination::maximum_steps:
        return "maximum_steps";
    case TrajectoryTermination::horizontal_reversal:
        return "horizontal_reversal";
    case TrajectoryTermination::non_finite_state:
        return "non_finite_state";
    }
    return "unknown";
}

const char* mpbr_status(
    ballistics::MpbrStatus status
)
{
    using ballistics::MpbrStatus;
    switch (status)
    {
    case MpbrStatus::complete:
        return "complete";
    case MpbrStatus::horizon_limited:
        return "horizon_limited";
    case MpbrStatus::no_solution:
        return "no_solution";
    case MpbrStatus::invalid_geometry:
        return "invalid_geometry";
    }
    return "unknown";
}

const char* spin_status(
    ballistics::SpinDriftStatus status
)
{
    using ballistics::SpinDriftStatus;
    switch (status)
    {
    case SpinDriftStatus::available:
        return "available";
    case SpinDriftStatus::not_applicable:
        return "not_applicable";
    case SpinDriftStatus::missing_geometry:
        return "missing_geometry";
    case SpinDriftStatus::invalid_stability:
        return "invalid_stability";
    case SpinDriftStatus::unstable:
        return "unstable";
    case SpinDriftStatus::outside_empirical_domain:
        return "outside_empirical_domain";
    }
    return "unknown";
}

const char* zeroing_status(
    ballistics::ZeroingStatus status
)
{
    using ballistics::ZeroingStatus;
    switch (status)
    {
    case ZeroingStatus::complete:
        return "complete";
    case ZeroingStatus::range_unavailable:
        return "range_unavailable";
    case ZeroingStatus::no_solution:
        return "no_solution";
    case ZeroingStatus::invalid_geometry:
        return "invalid_geometry";
    }
    return "unknown";
}

const char* drag_validity_status(
    ballistics::DragValidityStatus status
)
{
    using ballistics::DragValidityStatus;
    switch (status)
    {
    case DragValidityStatus::within_domain:
        return "within_domain";
    case DragValidityStatus::extrapolated:
        return "extrapolated";
    case DragValidityStatus::not_declared:
        return "not_declared";
    }
    return "unknown";
}

const char* calibration_status(
    ballistics::CalibrationStatus status
)
{
    using ballistics::CalibrationStatus;
    switch (status)
    {
    case CalibrationStatus::converged:
        return "converged";
    case CalibrationStatus::maximum_iterations:
        return "maximum_iterations";
    case CalibrationStatus::insufficient_information:
        return "insufficient_information";
    case CalibrationStatus::solver_failure:
        return "solver_failure";
    }
    return "unknown";
}

const char* uncertainty_status(
    ballistics::UncertaintyStatus status
)
{
    using ballistics::UncertaintyStatus;
    switch (status)
    {
    case UncertaintyStatus::complete:
        return "complete";
    case UncertaintyStatus::partial:
        return "partial";
    case UncertaintyStatus::no_inputs:
        return "no_inputs";
    case UncertaintyStatus::baseline_unavailable:
        return "baseline_unavailable";
    }
    return "unknown";
}

const char* pattern_status(
    ballistics::PatternAnalysisStatus status
)
{
    using ballistics::PatternAnalysisStatus;
    switch (status)
    {
    case PatternAnalysisStatus::validated_in_domain:
        return "validated_in_domain";
    case PatternAnalysisStatus::extrapolated:
        return "extrapolated";
    case PatternAnalysisStatus::insufficient_information:
        return "insufficient_information";
    }
    return "unknown";
}

const char* choke_name(
    ballistics::ChokeClass choke
)
{
    using ballistics::ChokeClass;
    switch (choke)
    {
    case ChokeClass::cylinder:
        return "cylinder";
    case ChokeClass::improved_cylinder:
        return "improvedCylinder";
    case ChokeClass::modified:
        return "modified";
    case ChokeClass::full:
        return "full";
    case ChokeClass::custom:
        return "custom";
    }
    return "unknown";
}

const char* deformation_name(
    ballistics::PelletDeformationClass deformation
)
{
    using ballistics::PelletDeformationClass;
    switch (deformation)
    {
    case PelletDeformationClass::soft_lead:
        return "softLead";
    case PelletDeformationClass::hardened_lead:
        return "hardenedLead";
    case PelletDeformationClass::plated:
        return "plated";
    case PelletDeformationClass::buffered:
        return "buffered";
    case PelletDeformationClass::unknown:
        return "unknown";
    }
    return "unknown";
}

const char* trajectory_event_status(
    ballistics::TrajectoryEventStatus status
)
{
    using ballistics::TrajectoryEventStatus;
    switch (status)
    {
    case TrajectoryEventStatus::complete:
        return "complete";
    case TrajectoryEventStatus::horizon_limited:
        return "horizon_limited";
    case TrajectoryEventStatus::baseline_unavailable:
        return "baseline_unavailable";
    case TrajectoryEventStatus::not_applicable:
        return "not_applicable";
    }
    return "unknown";
}

void write_issues(
    std::ostream& output,
    const std::vector<ballistics::ValidationIssue>& issues
)
{
    using ballistics::ValidationSeverity;
    using ballistics::protocol::escape_json;
    output << '[';
    for (std::size_t index = 0; index < issues.size(); ++index)
    {
        if (index)
        {
            output << ',';
        }
        const auto& issue = issues[index];
        output << "{\"code\":\"" << escape_json(issue.code) << "\",\"field\":\""
               << escape_json(issue.field) << "\",\"message\":\"" << escape_json(issue.message)
               << "\",\"severity\":\""
               << (issue.severity == ValidationSeverity::warning ? "warning" : "error") << "\"}";
    }
    output << ']';
}

void write_buckshot_pattern(
    std::ostream& output,
    const ballistics::BuckshotPatternResult& result,
    const ballistics::protocol::BuckshotPatternConfiguration& configuration
)
{
    using ballistics::ObservationRole;
    using ballistics::protocol::escape_json;
    output
        << "{\"status\":\"" << pattern_status(result.status) << "\",\"choke\":\""
        << choke_name(configuration.input.choke) << "\",\"deformationClass\":\""
        << deformation_name(configuration.input.deformation)
        << "\",\"pelletVelocityStandardDeviationMps\":"
        << configuration.input.pellet_velocity_standard_deviation_mps
        << ",\"fittedAngularDiameterRad\":" << result.fitted_angular_diameter_rad
        << ",\"angularStandardUncertaintyRad\":" << result.angular_standard_uncertainty_rad
        << ",\"calibrationRmseM\":" << result.calibration_rmse_m
        << ",\"holdoutRmseM\":" << result.holdout_rmse_m.value_or(0.0)
        << ",\"reducedChiSquare\":" << result.reduced_chi_square
        << ",\"calibrationRangeMinM\":" << result.calibration_range_min_m
        << ",\"calibrationRangeMaxM\":" << result.calibration_range_max_m
        << ",\"targetRangeM\":" << configuration.input.target_range_m
        << ",\"predictedDiameter90M\":" << result.predicted_diameter_90_m
        << ",\"predictedDiameter90Low95M\":" << result.predicted_diameter_90_low_95_m
        << ",\"predictedDiameter90High95M\":" << result.predicted_diameter_90_high_95_m
        << ",\"perPelletHitProbability\":" << result.per_pellet_hit_probability
        << ",\"perPelletHitProbabilityLow95\":" << result.per_pellet_hit_probability_low_95
        << ",\"perPelletHitProbabilityHigh95\":" << result.per_pellet_hit_probability_high_95
        << ",\"expectedPelletCount\":" << result.expected_pellet_count << ",\"minimumPelletCount\":"
        << configuration.input.minimum_pellet_count << ",\"probabilityAtLeastMinimum\":"
        << result.probability_at_least_minimum << ",\"pelletCountProbabilities\":[";
    for (std::size_t index = 0; index < result.pellet_count_probabilities.size(); ++index)
    {
        if (index)
        {
            output << ',';
        }
        output << result.pellet_count_probabilities[index];
    }
    output << "],\"residuals\":[";
    for (std::size_t index = 0; index < result.residuals.size(); ++index)
    {
        if (index)
        {
            output << ',';
        }
        const auto& residual = result.residuals[index];
        output << "{\"rangeM\":" << residual.range_m << ",\"measuredDiameter90M\":"
               << residual.measured_diameter_90_m << ",\"predictedDiameter90M\":"
               << residual.predicted_diameter_90_m << ",\"residualM\":" << residual.residual_m
               << ",\"normalizedResidual\":" << residual.normalized_residual << ",\"role\":\""
               << (residual.role == ObservationRole::holdout ? "holdout" : "calibration") << "\"}";
    }
    output << "],\"validityStatement\":\"" << escape_json(result.validity_statement) << "\"}";
}

void write_optional_number(
    std::ostream& output,
    const std::optional<double>& value
)
{
    if (value)
    {
        output << *value;
    }
    else
    {
        output << "null";
    }
}

const ballistics::protocol::FirearmConfiguration& firearm_for(
    const ballistics::Projectile& load,
    const ballistics::protocol::Scenario& scenario
)
{
    return load.firearm.group == ballistics::FirearmGroup::rifle
        ? scenario.rifle
        : scenario.shotgun;
}

double temperature_velocity_multiplier(
    const ballistics::protocol::FirearmConfiguration& firearm,
    double temperature_c
)
{
    const auto& points = firearm.temperature_velocity_profile;
    if (points.empty())
    {
        return 1.0;
    }
    if (temperature_c <= points.front().temperature_c)
    {
        return points.front().multiplier;
    }
    if (temperature_c >= points.back().temperature_c)
    {
        return points.back().multiplier;
    }
    const auto upper = std::upper_bound(
        points.begin(),
        points.end(),
        temperature_c,
        [](double value, const auto& point) { return value < point.temperature_c; }
    );
    const auto& lower = *(upper - 1);
    const auto fraction =
        (temperature_c - lower.temperature_c) / (upper->temperature_c - lower.temperature_c);
    return lower.multiplier + fraction * (upper->multiplier - lower.multiplier);
}

ballistics::Environment scenario_environment(
    const ballistics::protocol::Scenario& scenario,
    const ballistics::Atmosphere& firing_point
)
{
    ballistics::Environment environment;
    environment.firing_point = firing_point;
    environment.firing_point_altitude_m = scenario.geometric_altitude_m;
    environment.altitude_dependent_atmosphere = scenario.altitude_dependent_atmosphere;
    environment.use_local_gravity = scenario.use_local_gravity;
    environment.coriolis_enabled = scenario.coriolis_enabled;
    environment.latitude_deg = scenario.latitude_deg;
    environment.shot_azimuth_deg = scenario.azimuth_deg;
    environment.wind_layers = scenario.wind_layers;
    environment.wind_provenance = scenario.wind_provenance;
    return environment;
}

double scenario_sight_line_elevation_rad(
    const ballistics::protocol::Scenario& scenario
)
{
    return std::abs(scenario.target_elevation_m) > 1e-12
        ? std::atan2(scenario.target_elevation_m, scenario.display_distance_m)
        : scenario.target_inclination_rad;
}

ballistics::ShotScenario make_shot_scenario(
    const ballistics::protocol::Scenario& scenario,
    const ballistics::protocol::FirearmConfiguration& firearm,
    const ballistics::Environment& environment
)
{
    ballistics::ShotScenario shot;
    shot.environment = environment;
    shot.geometry.maximum_distance_m = scenario.solution_horizon_m;
    shot.geometry.zero_range_m = firearm.zero_range_m;
    shot.geometry.sight_height_m = firearm.sight_height_m;
    shot.geometry.target_distance_m = scenario.display_distance_m;
    shot.geometry.target_elevation_m = scenario.target_elevation_m;
    shot.geometry.target_inclination_rad = scenario.target_inclination_rad;
    shot.geometry.vital_zone_m = scenario.vital_zone_m;
    shot.muzzle_velocity_multiplier = firearm.muzzle_velocity_multiplier *
        temperature_velocity_multiplier(firearm, scenario.temperature_c);
    return shot;
}

bool uses_advanced_scenario(
    const ballistics::protocol::Scenario& scenario
)
{
    return scenario.altitude_dependent_atmosphere || scenario.use_local_gravity ||
        scenario.coriolis_enabled || !scenario.wind_layers.empty() ||
        std::abs(scenario.target_inclination_rad) > 1e-12 ||
        std::abs(scenario.target_elevation_m) > 1e-12 ||
        !scenario.shotgun.temperature_velocity_profile.empty() ||
        !scenario.rifle.temperature_velocity_profile.empty();
}

int write_calibration_response(
    const ballistics::protocol::Request& request,
    std::ostream& output
)
{
    using namespace ballistics;
    using protocol::escape_json;

    const auto& calibration = request.calibration;
    const auto atmosphere = Atmosphere::create(
        calibration.temperature_c,
        calibration.pressure_hpa,
        calibration.humidity_percent,
        calibration.headwind_mps,
        calibration.crosswind_mps
    );
    const auto result = calibrate_reference_ballistic_coefficient(
        calibration.projectile,
        atmosphere,
        calibration.observations,
        calibration.fit_kind,
        calibration.band_minimum_velocities_mps
    );

    std::vector<ValidationIssue> issues;
    const auto has_holdout = std::any_of(
        calibration.observations.begin(),
        calibration.observations.end(),
        [](const VelocityObservation& observation)
        { return observation.role == ObservationRole::holdout; }
    );
    if (!has_holdout)
    {
        issues.push_back(
            { "calibration.holdout.missing",
              "observations",
              "No holdout observations were supplied. This fit is calibration-only and "
              "must not be presented as independent validation.",
              ValidationSeverity::warning }
        );
    }
    if (result.status == CalibrationStatus::maximum_iterations)
    {
        issues.push_back(
            { "calibration.fit.maximum_iterations",
              "fit",
              "The fitter reached its iteration limit. Inspect the residuals before using "
              "the estimates.",
              ValidationSeverity::warning }
        );
    }
    else if (result.status == CalibrationStatus::insufficient_information)
    {
        issues.push_back(
            { "calibration.fit.insufficient_information",
              "observations",
              "The observations provide no residual degrees of freedom or do not "
              "independently constrain every fitted coefficient. Confidence intervals "
              "are unavailable.",
              ValidationSeverity::warning }
        );
    }
    else if (result.status == CalibrationStatus::solver_failure)
    {
        issues.push_back(
            { "calibration.fit.solver_failure",
              "fit",
              "The native trajectory solver could not evaluate the requested fit.",
              ValidationSeverity::warning }
        );
    }

    const auto* reference = reference_bc_drag(calibration.projectile);
    const auto curve = reference && reference->curve == ReferenceDragCurve::g7 ? "G7" : "G1";
    const auto fit_kind =
        result.fit_kind == BcFitKind::velocity_bands ? "velocityBands" : "constant";
    const auto validation_claim_available = result.status == CalibrationStatus::converged &&
        has_holdout && result.holdout_rmse_mps.has_value();
    output << std::setprecision(15) << "{\"protocolVersion\":" << protocol::current_version
           << ",\"engineVersion\":\"" << engine_version << "\",\"modelVersion\":\"" << model_version
           << "\",\"requestId\":\"" << escape_json(request.request_id)
           << "\",\"ok\":true,\"operation\":\"calibrateReferenceBc\",\"issues\":";
    write_issues(output, issues);
    output << ",\"calibration\":{\"curve\":\"" << curve << "\",\"fitKind\":\"" << fit_kind
           << "\",\"status\":\"" << calibration_status(result.status) << "\",\"iterations\":"
           << result.iterations << ",\"objectiveEvaluations\":" << result.objective_evaluations
           << ",\"calibrationRmseMps\":" << result.calibration_rmse_mps
           << ",\"weightedRmse\":" << result.weighted_rmse << ",\"holdoutRmseMps\":";
    write_optional_number(output, result.holdout_rmse_mps);
    output << ",\"reducedChiSquare\":" << result.reduced_chi_square << ",\"hasHoldout\":"
           << (has_holdout ? "true" : "false") << ",\"validationClaimAvailable\":"
           << (validation_claim_available ? "true" : "false") << ",\"estimates\":[";
    for (std::size_t index = 0; index < result.estimates.size(); ++index)
    {
        if (index)
        {
            output << ',';
        }
        const auto& estimate = result.estimates[index];
        output << "{\"minimumVelocityMps\":" << estimate.minimum_velocity_mps
               << ",\"ballisticCoefficient\":" << estimate.ballistic_coefficient
               << ",\"confidence95Low\":";
        write_optional_number(output, estimate.confidence_95_low);
        output << ",\"confidence95High\":";
        write_optional_number(output, estimate.confidence_95_high);
        output << '}';
    }
    output << "],\"residuals\":[";
    for (std::size_t index = 0; index < result.residuals.size(); ++index)
    {
        if (index)
        {
            output << ',';
        }
        const auto& residual = result.residuals[index];
        output << "{\"distanceM\":" << residual.distance_m << ",\"measuredVelocityMps\":"
               << residual.measured_velocity_mps << ",\"predictedVelocityMps\":"
               << residual.predicted_velocity_mps << ",\"residualMps\":" << residual.residual_mps
               << ",\"normalizedResidual\":" << residual.normalized_residual
               << ",\"standardDeviationMps\":" << residual.standard_deviation_mps << ",\"role\":\""
               << (residual.role == ObservationRole::holdout ? "holdout" : "calibration") << "\"}";
    }
    output << "]}}\n";
    return EXIT_SUCCESS;
}

} // namespace

int write_response(
    const ballistics::protocol::Request& request,
    std::ostream& output
)
{
    using namespace ballistics;
    using protocol::escape_json;

    if (request.operation == protocol::RequestOperation::calibrate_reference_bc)
    {
        return write_calibration_response(request, output);
    }

    const auto& scenario = request.scenario;
    const auto atmosphere = Atmosphere::create(
        scenario.temperature_c,
        scenario.pressure_hpa,
        scenario.humidity_percent,
        scenario.headwind_mps,
        scenario.crosswind_mps
    );
    const auto environment = scenario_environment(scenario, atmosphere);
    const auto atmosphere_validity = atmosphere_model_validity(atmosphere);
    const auto sight_line_elevation_rad = scenario_sight_line_elevation_rad(scenario);
    auto loads = built_in_projectiles();
    loads.insert(loads.end(), request.custom_loads.begin(), request.custom_loads.end());

    std::vector<ZeroedTrajectory> zeroed_trajectories;
    std::vector<MpbrResult> mpbr_results;
    std::vector<DragValidity> drag_validity_results;
    std::vector<TrajectoryEvents> trajectory_event_results;
    std::vector<double> muzzle_velocity_multipliers;
    std::vector<ValidationIssue> response_issues;
    zeroed_trajectories.reserve(loads.size());
    mpbr_results.reserve(loads.size());
    drag_validity_results.reserve(loads.size());
    trajectory_event_results.reserve(loads.size());
    muzzle_velocity_multipliers.reserve(loads.size());

    if (!atmosphere_validity.sound_speed_within_declared_domain)
    {
        response_issues.push_back(
            { "atmosphere.sound_speed.extrapolated",
              "scenario.atmosphere",
              "The moist-air sound-speed calculation is outside the declared Cramer source "
              "domain. Mach-dependent results are marked as extrapolated model output.",
              ValidationSeverity::warning }
        );
    }
    for (const auto& load : loads)
    {
        const auto& firearm = firearm_for(load, scenario);
        const auto shot = make_shot_scenario(scenario, firearm, environment);
        muzzle_velocity_multipliers.push_back(shot.muzzle_velocity_multiplier);
        mpbr_results.push_back(compute_scenario_mpbr(load, shot));
        zeroed_trajectories.push_back(integrate_shot_scenario(load, shot));
        const auto& zeroed = zeroed_trajectories.back();
        trajectory_event_results.push_back(
            analyze_trajectory_events(zeroed, firearm.sight_height_m, sight_line_elevation_rad)
        );
        drag_validity_results.push_back(
            evaluate_drag_validity(load, zeroed.trajectory, scenario.display_distance_m)
        );
        const auto& drag_validity = drag_validity_results.back();
        if (drag_validity.status == DragValidityStatus::extrapolated)
        {
            const auto sphere = sphere_drag(load) != nullptr;
            response_issues.push_back(
                { sphere ? "drag.sphere.outside_validity" : "drag.tabulated_cd.outside_validity",
                  "loads." + load.provenance.id,
                  load.definition.short_name +
                      (sphere ? " leaves the declared sphere-correlation domain over the displayed "
                              : " leaves its supplied Mach-Cd knot domain over the displayed ") +
                      "trajectory (Mach " +
                      std::to_string(drag_validity.observed_mach_min.value_or(0.0)) + " to " +
                      std::to_string(drag_validity.observed_mach_max.value_or(0.0)) +
                      (sphere ? ")." : "). Endpoint Cd clamping was applied."),
                  ValidationSeverity::warning }
            );
        }
        if (zeroed.status != ZeroingStatus::complete)
        {
            response_issues.push_back(
                { "trajectory.zeroing_unavailable",
                  "loads." + load.provenance.id,
                  load.definition.short_name + " could not reach its configured sight-in zero (" +
                      zeroing_status(zeroed.status) + ").",
                  ValidationSeverity::warning }
            );
        }
        if (zeroed.trajectory.covered_distance_m + 1e-9 < scenario.display_distance_m)
        {
            response_issues.push_back(
                { "trajectory.partial",
                  "loads." + load.provenance.id,
                  load.definition.short_name + " ended at " +
                      std::to_string(zeroed.trajectory.covered_distance_m) + " m (" +
                      trajectory_status(zeroed.trajectory.termination) + ").",
                  ValidationSeverity::warning }
            );
        }
    }

    std::vector<std::vector<TrajectorySample>> output_samples_by_load(loads.size());
    std::vector<std::optional<TrajectoryUncertaintyResult>> uncertainty_results(loads.size());
    std::vector<std::optional<MonteCarloUncertaintyResult>> monte_carlo_results(loads.size());
    std::vector<std::optional<BuckshotPatternResult>> buckshot_pattern_results(loads.size());
    for (std::size_t load_index = 0; load_index < loads.size(); ++load_index)
    {
        const auto& trajectory = zeroed_trajectories[load_index].trajectory;
        const auto covered_distance =
            std::min(scenario.display_distance_m, trajectory.covered_distance_m);
        const auto available_end = std::upper_bound(
            trajectory.samples.begin(),
            trajectory.samples.end(),
            covered_distance,
            [](double value, const TrajectorySample& sample) { return value < sample.distance_m; }
        );
        const auto available_count =
            static_cast<std::size_t>(available_end - trajectory.samples.begin());
        const auto stride = std::max<std::size_t>(1, available_count / 500);
        auto& output_samples = output_samples_by_load[load_index];
        output_samples.reserve(std::min<std::size_t>(available_count + 1, 502));
        for (std::size_t index = 0; index < available_count; index += stride)
        {
            output_samples.push_back(trajectory.samples[index]);
        }
        const auto endpoint = trajectory.sample_at(covered_distance);
        if (endpoint &&
            (output_samples.empty() ||
             std::abs(output_samples.back().distance_m - endpoint->distance_m) > 1e-9))
        {
            output_samples.push_back(*endpoint);
        }

        if (!scenario.uncertainty)
        {
            continue;
        }
        const auto& configuration = *scenario.uncertainty;
        const auto rifle = loads[load_index].firearm.group == FirearmGroup::rifle;
        UncertaintyInputs inputs;
        inputs.muzzle_velocity_standard_deviation_mps = rifle
            ? configuration.rifle_muzzle_velocity_standard_deviation_mps
            : configuration.shotgun_muzzle_velocity_standard_deviation_mps;
        inputs.drag_relative_standard_deviation = configuration.drag_relative_standard_deviation;
        inputs.temperature_standard_deviation_c = configuration.temperature_standard_deviation_c;
        inputs.pressure_standard_deviation_hpa = configuration.pressure_standard_deviation_hpa;
        inputs.headwind_standard_deviation_mps = configuration.headwind_standard_deviation_mps;
        inputs.crosswind_standard_deviation_mps = configuration.crosswind_standard_deviation_mps;
        inputs.zero_range_standard_deviation_m = rifle
            ? configuration.rifle_zero_range_standard_deviation_m
            : configuration.shotgun_zero_range_standard_deviation_m;
        std::vector<double> output_distances;
        output_distances.reserve(output_samples.size());
        std::transform(
            output_samples.begin(),
            output_samples.end(),
            std::back_inserter(output_distances),
            [](const TrajectorySample& sample) { return sample.distance_m; }
        );
        const auto& firearm = firearm_for(loads[load_index], scenario);
        if (configuration.method == protocol::UncertaintyConfiguration::Method::monte_carlo)
        {
            const auto shot = make_shot_scenario(scenario, firearm, environment);
            monte_carlo_results[load_index] = propagate_monte_carlo_uncertainty(
                loads[load_index],
                shot,
                inputs,
                configuration.correlations,
                output_distances,
                configuration.monte_carlo_samples,
                configuration.monte_carlo_seed
            );
            const auto status = monte_carlo_results[load_index]->status;
            if (status == UncertaintyStatus::partial ||
                status == UncertaintyStatus::baseline_unavailable)
            {
                response_issues.push_back(
                    { status == UncertaintyStatus::partial
                          ? "uncertainty.monte_carlo.partial"
                          : "uncertainty.monte_carlo.baseline_unavailable",
                      "loads." + loads[load_index].provenance.id + ".uncertainty",
                      loads[load_index].definition.short_name +
                          " did not complete every requested Monte Carlo sample.",
                      ValidationSeverity::warning }
                );
            }
            continue;
        }
        if (uses_advanced_scenario(scenario))
        {
            response_issues.push_back(
                { "uncertainty.advanced_scenario.unavailable",
                  "loads." + loads[load_index].provenance.id + ".uncertainty",
                  "First-order uncertainty is unavailable when advanced environment, geometry, "
                  "or temperature-velocity behavior is active. Select Monte Carlo for this "
                  "scenario.",
                  ValidationSeverity::warning }
            );
            continue;
        }
        uncertainty_results[load_index] = propagate_trajectory_uncertainty(
            loads[load_index],
            atmosphere,
            zeroed_trajectories[load_index],
            covered_distance,
            firearm.zero_range_m,
            firearm.sight_height_m,
            muzzle_velocity_multipliers[load_index],
            inputs,
            output_distances
        );
        const auto status = uncertainty_results[load_index]->status;
        if (status == UncertaintyStatus::partial ||
            status == UncertaintyStatus::baseline_unavailable)
        {
            response_issues.push_back(
                { status == UncertaintyStatus::partial
                      ? "uncertainty.partial"
                      : "uncertainty.baseline_unavailable",
                  "loads." + loads[load_index].provenance.id + ".uncertainty",
                  loads[load_index].definition.short_name +
                      (status == UncertaintyStatus::partial
                           ? " has incomplete deterministic sensitivity coverage. Unavailable "
                             "confidence "
                             "bands are suppressed."
                           : " has no valid zeroed baseline, so uncertainty bands are "
                             "unavailable."),
                  ValidationSeverity::warning }
            );
        }
    }
    if (scenario.uncertainty &&
        scenario.uncertainty->shotgun_muzzle_velocity_standard_deviation_mps == 0.0 &&
        scenario.uncertainty->rifle_muzzle_velocity_standard_deviation_mps == 0.0 &&
        scenario.uncertainty->drag_relative_standard_deviation == 0.0 &&
        scenario.uncertainty->temperature_standard_deviation_c == 0.0 &&
        scenario.uncertainty->pressure_standard_deviation_hpa == 0.0 &&
        scenario.uncertainty->headwind_standard_deviation_mps == 0.0 &&
        scenario.uncertainty->crosswind_standard_deviation_mps == 0.0 &&
        scenario.uncertainty->shotgun_zero_range_standard_deviation_m == 0.0 &&
        scenario.uncertainty->rifle_zero_range_standard_deviation_m == 0.0)
    {
        response_issues.push_back(
            { "uncertainty.no_inputs",
              "scenario.uncertainty",
              "Uncertainty propagation was enabled, but every standard deviation is zero.",
              ValidationSeverity::warning }
        );
    }
    if (scenario.buckshot_pattern)
    {
        const auto& configuration = *scenario.buckshot_pattern;
        const auto selected = std::find_if(
            loads.begin(),
            loads.end(),
            [&](const Projectile& load) { return load.provenance.id == configuration.load_id; }
        );
        if (selected != loads.end())
        {
            const auto load_index = static_cast<std::size_t>(selected - loads.begin());
            auto input = configuration.input;
            input.pellet_count = static_cast<std::size_t>(selected->ammunition.payload_count);
            input.mean_muzzle_velocity_mps =
                zeroed_trajectories[load_index].trajectory.samples.front().ground_speed_mps;
            buckshot_pattern_results[load_index] = analyze_buckshot_pattern(input);
            if (buckshot_pattern_results[load_index]->status == PatternAnalysisStatus::extrapolated)
            {
                response_issues.push_back(
                    { "buckshot.pattern.extrapolated",
                      "scenario.buckshotPattern.targetRangeM",
                      selected->definition.short_name +
                          " pattern target range lies outside the supplied calibration range.",
                      ValidationSeverity::warning }
                );
            }
        }
    }

    output << std::setprecision(15) << "{\"protocolVersion\":" << protocol::current_version
           << ",\"engineVersion\":\"" << engine_version << "\",\"modelVersion\":\"" << model_version
           << "\",\"requestId\":\"" << escape_json(request.request_id)
           << "\",\"ok\":true,\"issues\":";
    write_issues(output, response_issues);
    output
        << ",\"atmosphere\":{\"densityKgM3\":" << atmosphere.density_kg_m3
        << ",\"speedOfSoundMps\":" << atmosphere.speed_of_sound_mps
        << ",\"viscosityPaS\":" << atmosphere.dynamic_viscosity_pa_s << ",\"densityModel\":\""
        << atmosphere_validity.density_model << "\",\"speedOfSoundModel\":\""
        << atmosphere_validity.sound_speed_model << "\",\"viscosityModel\":\""
        << atmosphere_validity.viscosity_model << "\",\"densityWithinDeclaredDomain\":"
        << (atmosphere_validity.density_within_declared_domain ? "true" : "false")
        << ",\"soundSpeedWithinDeclaredDomain\":"
        << (atmosphere_validity.sound_speed_within_declared_domain ? "true" : "false")
        << ",\"viscosityWithinDeclaredDomain\":"
        << (atmosphere_validity.viscosity_within_declared_domain ? "true" : "false")
        << ",\"altitudeBehavior\":\""
        << (scenario.altitude_dependent_atmosphere
                ? "icao_lapse_from_firing_point"
                : "homogeneous_at_firing_point")
        << "\"},\"scenarioModel\":{\"targetInclinationRad\":" << sight_line_elevation_rad
        << ",\"geometricAltitudeM\":" << scenario.geometric_altitude_m
        << ",\"localGravity\":" << (scenario.use_local_gravity ? "true" : "false")
        << ",\"coriolis\":" << (scenario.coriolis_enabled ? "true" : "false") << ",\"latitudeDeg\":"
        << scenario.latitude_deg << ",\"azimuthDeg\":" << scenario.azimuth_deg
        << ",\"windLayerCount\":" << scenario.wind_layers.size() << "},\"loads\":[";

    for (std::size_t load_index = 0; load_index < loads.size(); ++load_index)
    {
        const auto& load = loads[load_index];
        const auto& zeroed = zeroed_trajectories[load_index];
        const auto& trajectory = zeroed.trajectory;
        const auto& mpbr = mpbr_results[load_index];
        const auto& drag_validity = drag_validity_results[load_index];
        const auto& events = trajectory_event_results[load_index];
        const auto& firearm = firearm_for(load, scenario);
        const auto sight_zero_sample = trajectory.sample_at(firearm.zero_range_m);
        const auto effective_twist =
            load.firearm.twist_rate_inches.value_or(scenario.rifle.twist_inches);
        const auto spin_metadata = compute_spin_drift(
            load,
            0.0,
            effective_twist,
            trajectory.samples.front().ground_speed_mps,
            atmosphere,
            scenario.rifle.twist_direction
        );
        const auto display_complete =
            trajectory.covered_distance_m + 1e-9 >= scenario.display_distance_m;
        const auto covered_distance =
            std::min(scenario.display_distance_m, trajectory.covered_distance_m);
        const auto model = drag_model(load);
        const auto* reference = reference_bc_drag(load);
        const auto* tabulated = tabulated_drag(load);
        const auto* sphere = sphere_drag(load);
        const std::vector<BallisticCoefficientBand>* bands = nullptr;
        if (reference)
        {
            if (const auto* schedule =
                    std::get_if<BandedBallisticCoefficient>(&reference->coefficient))
            {
                bands = &schedule->bands;
            }
        }
        if (load_index)
        {
            output << ',';
        }
        output
            << "{\"id\":\"" << escape_json(load.provenance.id) << "\",\"name\":\""
            << escape_json(load.definition.name) << "\",\"shortName\":\""
            << escape_json(load.definition.short_name) << "\",\"dragModel\":\""
            << (model == DragModel::sphere             ? "Sphere"
                    : model == DragModel::tabulated_cd ? "MachCd"
                    : model == DragModel::g7
                    ? "G7"
                    : "G1")
            << "\",\"firearmGroup\":\""
            << (load.firearm.group == FirearmGroup::rifle ? "rifle" : "shotgun")
            << "\",\"source\":\"" << (load.provenance.is_custom ? "custom" : "builtIn")
            << "\",\"massKg\":" << load.definition.mass_kg << ",\"muzzleVelocityMps\":"
            << trajectory.samples.front().ground_speed_mps << ",\"ballisticCoefficient\":"
            << nominal_ballistic_coefficient(load) << ",\"ballisticCoefficientBands\":[";
        for (std::size_t band_index = 0; bands && band_index < bands->size(); ++band_index)
        {
            if (band_index)
            {
                output << ',';
            }
            const auto& band = (*bands)[band_index];
            output << "{\"minimumVelocityMps\":" << band.minimum_velocity_mps
                   << ",\"ballisticCoefficient\":" << band.ballistic_coefficient << '}';
        }
        output << "],\"dragReferenceDiameterM\":"
               << (tabulated ? tabulated->reference_diameter_m : 0.0) << ",\"machCdPoints\":[";
        for (std::size_t point_index = 0; tabulated && point_index < tabulated->points.size();
             ++point_index)
        {
            if (point_index)
            {
                output << ',';
            }
            const auto& point = tabulated->points[point_index];
            output << "{\"mach\":" << point.mach
                   << ",\"dragCoefficient\":" << point.drag_coefficient << '}';
        }
        output
            << "],\"bcKind\":\"" << escape_json(load.provenance.drag_description)
            << "\",\"sphereDiameterM\":" << (sphere ? sphere->diameter_m : 0.0)
            << ",\"materialDensityKgM3\":" << (sphere ? sphere->material_density_kg_m3 : 0.0)
            << ",\"pelletCount\":" << load.ammunition.payload_count
            << ",\"requestedDistanceM\":" << scenario.display_distance_m
            << ",\"coveredDistanceM\":" << covered_distance << ",\"trajectoryStatus\":\""
            << (display_complete ? "complete" : trajectory_status(trajectory.termination))
            << "\",\"solutionHorizonM\":" << scenario.solution_horizon_m
            << ",\"solverDiagnostics\":{\"mode\":\"adaptive_time\",\"attemptedSteps\":"
            << trajectory.solver.attempted_steps
            << ",\"acceptedSteps\":" << trajectory.solver.accepted_steps
            << ",\"rejectedSteps\":" << trajectory.solver.rejected_steps
            << ",\"minimumAcceptedTimeStepS\":" << trajectory.solver.minimum_accepted_time_step_s
            << ",\"maximumAcceptedTimeStepS\":" << trajectory.solver.maximum_accepted_time_step_s
            << ",\"finalTimeStepS\":" << trajectory.solver.final_time_step_s
            << ",\"maximumErrorNorm\":" << trajectory.solver.maximum_error_norm
            << "},\"dragValidity\":{\"status\":\"" << drag_validity_status(drag_validity.status)
            << "\",\"supportedMachMin\":";
        write_optional_number(output, drag_validity.supported_mach_min);
        output << ",\"supportedMachMax\":";
        write_optional_number(output, drag_validity.supported_mach_max);
        output << ",\"supportedReynoldsMin\":";
        write_optional_number(output, drag_validity.supported_reynolds_min);
        output << ",\"supportedReynoldsMax\":";
        write_optional_number(output, drag_validity.supported_reynolds_max);
        output << ",\"observedMachMin\":";
        write_optional_number(output, drag_validity.observed_mach_min);
        output << ",\"observedMachMax\":";
        write_optional_number(output, drag_validity.observed_mach_max);
        output << ",\"observedReynoldsMin\":";
        write_optional_number(output, drag_validity.observed_reynolds_min);
        output << ",\"observedReynoldsMax\":";
        write_optional_number(output, drag_validity.observed_reynolds_max);
        output << "},\"mpbrStatus\":\"" << mpbr_status(mpbr.status) << "\",\"zeroM\":";
        if (mpbr.status == MpbrStatus::complete)
        {
            output << mpbr.zero_m;
        }
        else
        {
            output << "null";
        }
        output << ",\"mpbrM\":";
        if (mpbr.status == MpbrStatus::complete)
        {
            output << mpbr.mpbr_m;
        }
        else
        {
            output << "null";
        }
        output << ",\"sightHeightM\":" << firearm.sight_height_m
               << ",\"sightZeroM\":" << firearm.zero_range_m << ",\"boreElevationRad\":";
        if (zeroed.status == ZeroingStatus::complete)
        {
            output << zeroed.bore_elevation_rad;
        }
        else
        {
            output << "null";
        }
        output << ",\"zeroErrorM\":";
        if (zeroed.status == ZeroingStatus::complete)
        {
            output << zeroed.zero_error_m;
        }
        else
        {
            output << "null";
        }
        output << ",\"zeroingStatus\":\"" << zeroing_status(zeroed.status)
               << "\",\"dropAtSightZeroM\":";
        if (zeroed.status == ZeroingStatus::complete && sight_zero_sample)
        {
            output << sight_zero_sample->drop_m;
        }
        else
        {
            output << "null";
        }
        output << ",\"spinDriftStatus\":\"" << spin_status(spin_metadata.status)
               << "\",\"effectiveTwistInches\":" << effective_twist << ",\"gyroscopicStability\":";
        if (std::isfinite(spin_metadata.gyroscopic_stability) &&
            spin_metadata.gyroscopic_stability > 0.0)
        {
            output << spin_metadata.gyroscopic_stability;
        }
        else
        {
            output << "null";
        }
        output << ",\"trajectoryEvents\":{\"analyzedDistanceM\":" << events.analyzed_distance_m
               << ",\"zeroCrossingsStatus\":\""
               << trajectory_event_status(events.zero_crossings_status) << "\",\"nearZeroM\":";
        write_optional_number(output, events.near_zero_m);
        output << ",\"farZeroM\":";
        write_optional_number(output, events.far_zero_m);
        output << ",\"maximumOrdinateStatus\":\""
               << trajectory_event_status(events.maximum_ordinate_status)
               << "\",\"maximumOrdinateDistanceM\":";
        write_optional_number(output, events.maximum_ordinate_distance_m);
        output << ",\"maximumOrdinatePathM\":";
        write_optional_number(output, events.maximum_ordinate_path_m);
        output << ",\"supersonicRangeStatus\":\""
               << trajectory_event_status(events.supersonic_range_status)
               << "\",\"supersonicRangeM\":";
        write_optional_number(output, events.supersonic_range_m);
        output << ",\"groundIntersectionStatus\":\""
               << trajectory_event_status(events.ground_intersection_status)
               << "\",\"groundIntersectionM\":";
        write_optional_number(output, events.ground_intersection_m);
        output << ",\"machCrossings\":[";
        for (std::size_t crossing_index = 0; crossing_index < events.mach_crossings.size();
             ++crossing_index)
        {
            if (crossing_index)
            {
                output << ',';
            }
            const auto& crossing = events.mach_crossings[crossing_index];
            output << "{\"mach\":" << crossing.mach << ",\"distanceM\":" << crossing.distance_m
                   << ",\"direction\":\""
                   << (crossing.direction == MachCrossingDirection::decelerating
                           ? "decelerating"
                           : "accelerating")
                   << "\"}";
        }
        output << "]}";
        output << ",\"uncertainty\":";
        if (monte_carlo_results[load_index])
        {
            const auto& uncertainty = *monte_carlo_results[load_index];
            output << "{\"method\":\"monte_carlo\",\"confidenceLevel\":0.95,\"status\":\""
                   << uncertainty_status(uncertainty.status) << "\",\"seed\":" << uncertainty.seed
                   << ",\"requestedSampleCount\":" << uncertainty.requested_sample_count
                   << ",\"completedSampleCount\":" << uncertainty.completed_sample_count
                   << ",\"maximumSplitQuantileDelta\":" << uncertainty.maximum_split_quantile_delta
                   << ",\"points\":[";
            const auto write_interval = [&](std::string_view name, const UncertaintyInterval& value)
            {
                output << "\"" << name << "\":{\"median\":" << value.median
                       << ",\"low95\":" << value.low_95 << ",\"high95\":" << value.high_95 << '}';
            };
            for (std::size_t index = 0; index < uncertainty.samples.size(); ++index)
            {
                if (index)
                {
                    output << ',';
                }
                const auto& sample = uncertainty.samples[index];
                output << "{\"distanceM\":" << sample.distance_m
                       << ",\"available\":" << (sample.available ? "true" : "false") << ',';
                write_interval("speedMps", sample.speed_mps);
                output << ',';
                write_interval("energyJ", sample.energy_j);
                output << ',';
                write_interval("momentumKgms", sample.momentum_kgms);
                output << ',';
                write_interval("timeS", sample.time_s);
                output << ',';
                write_interval("dropM", sample.drop_m);
                output << ',';
                write_interval("pathM", sample.path_m);
                output << ',';
                write_interval("holdoverRad", sample.holdover_rad);
                output << ',';
                write_interval("windDriftM", sample.wind_drift_m);
                output << '}';
            }
            output << "]}";
        }
        else if (!uncertainty_results[load_index])
        {
            output << "null";
        }
        else
        {
            const auto& uncertainty = *uncertainty_results[load_index];
            output << "{\"method\":\"first_order_central_difference\",\"confidenceLevel\":0.95,"
                      "\"status\":\""
                   << uncertainty_status(uncertainty.status) << "\",\"activeInputCount\":"
                   << uncertainty.active_input_count << ",\"completedInputCount\":"
                   << uncertainty.completed_input_count << ",\"points\":[";
            for (std::size_t index = 0; index < uncertainty.samples.size(); ++index)
            {
                if (index)
                {
                    output << ',';
                }
                const auto& sample = uncertainty.samples[index];
                output
                    << "{\"distanceM\":" << sample.distance_m
                    << ",\"available\":" << (sample.available ? "true" : "false")
                    << ",\"speedStandardDeviationMps\":" << sample.speed_standard_deviation_mps
                    << ",\"energyStandardDeviationJ\":" << sample.energy_standard_deviation_j
                    << ",\"momentumStandardDeviationKgms\":"
                    << sample.momentum_standard_deviation_kgms
                    << ",\"timeStandardDeviationS\":" << sample.time_standard_deviation_s
                    << ",\"dropStandardDeviationM\":" << sample.drop_standard_deviation_m
                    << ",\"pathStandardDeviationM\":" << sample.path_standard_deviation_m
                    << ",\"holdoverStandardDeviationRad\":"
                    << sample.holdover_standard_deviation_rad << ",\"windDriftStandardDeviationM\":"
                    << sample.wind_drift_standard_deviation_m << '}';
            }
            output << "]}";
        }
        output << ",\"buckshotPattern\":";
        if (buckshot_pattern_results[load_index] && scenario.buckshot_pattern)
        {
            write_buckshot_pattern(
                output,
                *buckshot_pattern_results[load_index],
                *scenario.buckshot_pattern
            );
        }
        else
        {
            output << "null";
        }
        output << ",\"points\":[";

        const auto& output_samples = output_samples_by_load[load_index];

        bool first = true;
        for (const auto& sample : output_samples)
        {
            if (!first)
            {
                output << ',';
            }
            first = false;
            const auto spin = compute_spin_drift(
                load,
                sample.time_s,
                effective_twist,
                trajectory.samples.front().ground_speed_mps,
                atmosphere,
                scenario.rifle.twist_direction
            );
            const auto path_m =
                line_of_sight_path_m(sample, firearm.sight_height_m, sight_line_elevation_rad);
            output
                << "{\"distanceM\":" << sample.distance_m
                << ",\"speedMps\":" << sample.ground_speed_mps
                << ",\"airspeedMps\":" << sample.airspeed_mps << ",\"energyJ\":" << sample.energy_j
                << ",\"momentumKgms\":" << sample.momentum_kgms << ",\"timeS\":" << sample.time_s
                << ",\"dropM\":" << sample.drop_m << ",\"pathM\":" << path_m
                << ",\"holdoverRad\":" << elevation_holdover_rad(path_m, sample.distance_m)
                << ",\"mach\":" << sample.aerodynamics.mach << ",\"spinDriftM\":";
            if (spin.status == SpinDriftStatus::available)
            {
                output << spin.drift_m;
            }
            else
            {
                output << "null";
            }
            output << ",\"windDriftM\":" << sample.wind_drift_m;
            if (sample.aerodynamics.has_reynolds)
            {
                output << ",\"cd\":" << sample.aerodynamics.cd
                       << ",\"reynolds\":" << sample.aerodynamics.reynolds;
            }
            else if (sample.aerodynamics.has_drag_coefficient)
            {
                output << ",\"referenceCd\":" << sample.aerodynamics.cd;
            }
            output << '}';
        }
        output << "]}";
    }
    output << "]}\n";
    return EXIT_SUCCESS;
}

} // namespace ballistics::cli
