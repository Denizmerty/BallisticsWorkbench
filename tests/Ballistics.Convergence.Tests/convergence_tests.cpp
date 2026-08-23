#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "ballistics.hpp"

namespace
{

struct ErrorMetrics
{
    double position_m {};
    double velocity_mps {};
    double time_s {};

    void include(
        const ErrorMetrics& other
    )
    {
        position_m = std::max(position_m, other.position_m);
        velocity_mps = std::max(velocity_mps, other.velocity_mps);
        time_s = std::max(time_s, other.time_s);
    }
};

struct ToleranceRow
{
    std::string id;
    double tolerance_scale {};
    ballistics::SolverConfiguration configuration;
    ballistics::SolverDiagnostics diagnostics;
    ErrorMetrics error_to_reference;
};

struct ScenarioDefinition
{
    std::string id;
    ballistics::Projectile projectile;
    ballistics::Atmosphere atmosphere;
    double maximum_distance_m {};
};

struct ScenarioReport
{
    std::string id;
    double maximum_distance_m {};
    std::size_t comparison_samples {};
    bool production_budget_passed {};
    bool half_tolerance_display_passed {};
    bool tighter_solution_improved {};
    ErrorMetrics half_tolerance_change;
    std::vector<ToleranceRow> rows;
};

struct AnalyticStepRow
{
    double maximum_step_s {};
    std::size_t accepted_steps {};
    double speed_error_mps {};
    double time_error_s {};
    double observed_speed_order {};
    double observed_time_order {};
};

constexpr ErrorMetrics production_budget { 0.0005, 0.01, 0.00001 };
// The most precise on-screen table values are 0.01 cm, 0.1 fps, and 0.001 s.
constexpr ErrorMetrics display_resolution { 0.0001, 0.03, 0.001 };

std::string compiler_identity()
{
#if defined(_MSC_VER)
    return "MSVC " + std::to_string(_MSC_VER);
#elif defined(__clang__)
    return "Clang " + std::string(__clang_version__);
#elif defined(__GNUC__)
    return "GCC " + std::string(__VERSION__);
#else
    return "unknown";
#endif
}

ErrorMetrics difference(
    const ballistics::TrajectorySample& actual,
    const ballistics::TrajectorySample& expected
)
{
    return {
        std::hypot(
            actual.position_m.y - expected.position_m.y,
            actual.position_m.z - expected.position_m.z
        ),
        std::hypot(
            actual.ground_velocity_mps.x - expected.ground_velocity_mps.x,
            actual.ground_velocity_mps.y - expected.ground_velocity_mps.y,
            actual.ground_velocity_mps.z - expected.ground_velocity_mps.z
        ),
        std::abs(actual.time_s - expected.time_s),
    };
}

bool within(
    const ErrorMetrics& actual,
    const ErrorMetrics& limit
)
{
    return actual.position_m <= limit.position_m && actual.velocity_mps <= limit.velocity_mps &&
        actual.time_s <= limit.time_s;
}

bool no_worse_when_tightened(
    const ErrorMetrics& tighter,
    const ErrorMetrics& production
)
{
    constexpr ErrorMetrics numerical_floor { 1e-10, 1e-9, 1e-11 };
    return tighter.position_m <=
        std::max(numerical_floor.position_m, production.position_m * 1.05) &&
        tighter.velocity_mps <=
        std::max(numerical_floor.velocity_mps, production.velocity_mps * 1.05) &&
        tighter.time_s <= std::max(numerical_floor.time_s, production.time_s * 1.05);
}

ballistics::SolverConfiguration scaled_configuration(
    double scale
)
{
    ballistics::SolverConfiguration configuration;
    configuration.relative_tolerance *= scale;
    configuration.absolute_position_tolerance_m *= scale;
    configuration.absolute_velocity_tolerance_mps *= scale;
    return configuration;
}

ballistics::SolverConfiguration reference_configuration()
{
    auto configuration = scaled_configuration(0.001);
    configuration.initial_time_step_s = 1e-5;
    configuration.maximum_time_step_s = 0.002;
    return configuration;
}

std::vector<double> comparison_distances(
    double maximum_distance_m
)
{
    std::vector<double> distances;
    constexpr std::size_t intervals = 40;
    distances.reserve(intervals + 1);
    for (std::size_t index = 0; index <= intervals; ++index)
    {
        distances.push_back(
            maximum_distance_m * static_cast<double>(index) / static_cast<double>(intervals)
        );
    }
    return distances;
}

ballistics::TrajectorySample sample_at(
    const ballistics::Trajectory& trajectory,
    double distance_m,
    std::string_view label
)
{
    const auto sample = trajectory.sample_at(distance_m);
    if (!sample)
    {
        throw std::runtime_error(
            std::string(label) + " has no sample at " + std::to_string(distance_m) + " m"
        );
    }
    return *sample;
}

std::vector<ScenarioDefinition> scenario_definitions()
{
    const auto& loads = ballistics::built_in_projectiles();

    auto g7 = loads[3];
    g7.provenance.id = "convergence:g7-hot-thin-crosswind";
    g7.definition.drag = ballistics::ReferenceBcDrag {
        ballistics::ReferenceDragCurve::g7,
        ballistics::ConstantBallisticCoefficient { 0.24 }
    };

    auto low_velocity = loads[3];
    low_velocity.provenance.id = "convergence:tabulated-low-velocity";
    low_velocity.definition.mass_kg = 0.012;
    low_velocity.ammunition.muzzle_velocity_mps = 360.0;
    low_velocity.definition.drag = ballistics::TabulatedDrag {
        0.008,
        { { 0.0, 0.22 },
          { 0.75, 0.23 },
          { 0.95, 0.31 },
          { 1.05, 0.38 },
          { 1.3, 0.29 },
          { 2.0, 0.24 } }
    };

    return {
        { "g1-standard-calm",
          loads[3],
          ballistics::Atmosphere::create(15.0, 1013.25, 50.0, 0.0, 0.0),
          2000.0 },
        { "g1-cold-dense-headwind",
          loads[4],
          ballistics::Atmosphere::create(-40.0, 1080.0, 20.0, 25.0, -10.0),
          1500.0 },
        { "g7-hot-thin-crosswind",
          g7,
          ballistics::Atmosphere::create(45.0, 700.0, 15.0, -12.0, 14.0),
          2000.0 },
        { "tabulated-low-velocity",
          low_velocity,
          ballistics::Atmosphere::create(5.0, 950.0, 80.0, 15.0, 6.0),
          1000.0 },
    };
}

ScenarioReport evaluate_scenario(
    const ScenarioDefinition& definition
)
{
    const auto distances = comparison_distances(definition.maximum_distance_m);
    const auto reference = ballistics::integrate_trajectory(
        definition.projectile,
        definition.atmosphere,
        definition.maximum_distance_m,
        1.0,
        0.25,
        reference_configuration()
    );
    if (reference.termination != ballistics::TrajectoryTermination::requested_distance)
    {
        throw std::runtime_error(definition.id + " tight reference did not cover its range");
    }

    const std::array<std::pair<std::string_view, double>, 3> levels {
        { { "production", 1.0 }, { "half", 0.5 }, { "tenth", 0.1 } }
    };
    ScenarioReport report;
    report.id = definition.id;
    report.maximum_distance_m = definition.maximum_distance_m;
    report.comparison_samples = distances.size();
    std::vector<ballistics::Trajectory> trajectories;
    trajectories.reserve(levels.size());
    for (const auto& [id, scale] : levels)
    {
        const auto configuration = scaled_configuration(scale);
        auto trajectory = ballistics::integrate_trajectory(
            definition.projectile,
            definition.atmosphere,
            definition.maximum_distance_m,
            1.0,
            0.25,
            configuration
        );
        if (trajectory.termination != ballistics::TrajectoryTermination::requested_distance)
        {
            throw std::runtime_error(
                definition.id + " " + std::string(id) + " solve did not cover its range"
            );
        }
        ToleranceRow row;
        row.id = id;
        row.tolerance_scale = scale;
        row.configuration = configuration;
        row.diagnostics = trajectory.solver;
        for (const auto distance_m : distances)
        {
            row.error_to_reference.include(difference(
                sample_at(trajectory, distance_m, id),
                sample_at(reference, distance_m, "tight reference")
            ));
        }
        report.rows.push_back(row);
        trajectories.push_back(std::move(trajectory));
    }

    for (const auto distance_m : distances)
    {
        report.half_tolerance_change.include(difference(
            sample_at(trajectories[0], distance_m, "production"),
            sample_at(trajectories[1], distance_m, "half tolerance")
        ));
    }
    report.production_budget_passed = within(report.rows[0].error_to_reference, production_budget);
    report.half_tolerance_display_passed = within(report.half_tolerance_change, display_resolution);
    report.tighter_solution_improved = no_worse_when_tightened(
        report.rows[2].error_to_reference,
        report.rows[0].error_to_reference
    );
    return report;
}

std::vector<AnalyticStepRow> evaluate_analytic_step_refinement(
    bool& passed
)
{
    auto projectile = ballistics::built_in_projectiles()[3];
    projectile.provenance.id = "convergence:constant-cd-analytic";
    projectile.definition.mass_kg = 0.01;
    projectile.ammunition.muzzle_velocity_mps = 300.0;
    projectile.definition.drag =
        ballistics::TabulatedDrag { 0.01, { { 0.0, 0.3 }, { 10.0, 0.3 } } };
    const auto atmosphere = ballistics::Atmosphere::create(15.0, 1013.25, 50.0, 0.0, 0.0);
    constexpr double distance_m = 500.0;
    constexpr double pi = 3.14159265358979323846;
    const auto diameter_m = ballistics::tabulated_drag(projectile)->reference_diameter_m;
    const auto area_m2 = pi * diameter_m * diameter_m / 4.0;
    const auto drag_per_metre =
        0.5 * atmosphere.density_kg_m3 * 0.3 * area_m2 / projectile.definition.mass_kg;
    const auto expected_speed_mps =
        projectile.ammunition.muzzle_velocity_mps * std::exp(-drag_per_metre * distance_m);
    const auto expected_time_s = (std::exp(drag_per_metre * distance_m) - 1.0) /
        (drag_per_metre * projectile.ammunition.muzzle_velocity_mps);

    constexpr std::array<double, 4> maximum_steps { 0.4, 0.2, 0.1, 0.05 };
    std::vector<AnalyticStepRow> rows;
    rows.reserve(maximum_steps.size());
    for (const auto maximum_step_s : maximum_steps)
    {
        ballistics::SolverConfiguration configuration;
        configuration.relative_tolerance = 1.0;
        configuration.absolute_position_tolerance_m = 1.0;
        configuration.absolute_velocity_tolerance_mps = 1.0;
        configuration.initial_time_step_s = maximum_step_s;
        configuration.maximum_time_step_s = maximum_step_s;
        configuration.include_gravity = false;
        const auto trajectory = ballistics::
            integrate_trajectory(projectile, atmosphere, distance_m, 1.0, 0.25, configuration);
        const auto& sample = sample_at(trajectory, distance_m, "analytic refinement");
        rows.push_back(
            { maximum_step_s,
              trajectory.solver.accepted_steps,
              std::abs(sample.ground_speed_mps - expected_speed_mps),
              std::abs(sample.time_s - expected_time_s) }
        );
    }
    for (std::size_t index = 1; index < rows.size(); ++index)
    {
        rows[index].observed_speed_order =
            std::log(rows[index - 1].speed_error_mps / rows[index].speed_error_mps) / std::log(2.0);
        rows[index].observed_time_order =
            std::log(rows[index - 1].time_error_s / rows[index].time_error_s) / std::log(2.0);
    }
    passed = rows.back().speed_error_mps < rows.front().speed_error_mps &&
        rows.back().time_error_s < rows.front().time_error_s &&
        rows[2].observed_speed_order >= 1.8 && rows[3].observed_speed_order >= 1.8 &&
        rows[2].observed_time_order >= 1.8 && rows[3].observed_time_order >= 1.8;
    return rows;
}

void write_metrics(
    std::ostream& output,
    const ErrorMetrics& metrics,
    std::string_view indent
)
{
    output << indent << "{\n"
           << indent << "  \"positionM\": " << metrics.position_m << ",\n"
           << indent << "  \"velocityMps\": " << metrics.velocity_mps << ",\n"
           << indent << "  \"timeS\": " << metrics.time_s << "\n"
           << indent << "}";
}

void write_report(
    const std::filesystem::path& path,
    bool passed,
    const ErrorMetrics& maximum_production_error,
    const ErrorMetrics& maximum_half_change,
    bool analytic_passed,
    const std::vector<AnalyticStepRow>& analytic_rows,
    const std::vector<ScenarioReport>& scenarios
)
{
    if (!path.parent_path().empty())
    {
        std::filesystem::create_directories(path.parent_path());
    }
    std::ofstream output(path, std::ios::binary);
    if (!output)
    {
        throw std::runtime_error("could not create report " + path.string());
    }
    output
        << std::setprecision(15) << "{\n"
        << "  \"schemaVersion\": 1,\n"
        << "  \"reportType\": \"adaptive_solver_convergence\",\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"compiler\": \"" << compiler_identity() << "\",\n"
        << "  \"evidenceLevel\": \"numerical_self_convergence_and_analytic_step_refinement\",\n"
        << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
        << "  \"referenceConfiguration\": {\n"
        << "    \"toleranceScale\": 0.001,\n"
        << "    \"maximumTimeStepS\": 0.002,\n"
        << "    \"relationshipToProduction\": \"1000x tighter tolerances and 25x smaller maximum "
           "step\"\n"
        << "  },\n"
        << "  \"productionBudget\": ";
    write_metrics(output, production_budget, "  ");
    output << ",\n  \"displayResolution\": ";
    write_metrics(output, display_resolution, "  ");
    output << ",\n  \"maximumProductionError\": ";
    write_metrics(output, maximum_production_error, "  ");
    output << ",\n  \"maximumHalfToleranceChange\": ";
    write_metrics(output, maximum_half_change, "  ");
    output << ",\n  \"analyticStepRefinement\": {\n"
           << "    \"model\": \"constant physical Cd horizontal quadratic drag\",\n"
           << "    \"velocityEquation\": \"v(x) = v0 exp(-k x)\",\n"
           << "    \"timeEquation\": \"t(x) = (exp(k x) - 1) / (k v0)\",\n"
           << "    \"distanceM\": 500,\n"
           << "    \"passed\": " << (analytic_passed ? "true" : "false") << ",\n"
           << "    \"rows\": [\n";
    for (std::size_t index = 0; index < analytic_rows.size(); ++index)
    {
        const auto& row = analytic_rows[index];
        output
            << "      {\n"
            << "        \"maximumTimeStepS\": " << row.maximum_step_s << ",\n"
            << "        \"acceptedSteps\": " << row.accepted_steps << ",\n"
            << "        \"speedErrorMps\": " << row.speed_error_mps << ",\n"
            << "        \"timeErrorS\": " << row.time_error_s << ",\n"
            << "        \"observedSpeedOrder\": " << row.observed_speed_order << ",\n"
            << "        \"observedTimeOrder\": " << row.observed_time_order << "\n"
            << "      }" << (index + 1 == analytic_rows.size() ? "\n" : ",\n");
    }
    output << "    ]\n"
           << "  },\n"
           << "  \"scenarios\": [\n";
    for (std::size_t scenario_index = 0; scenario_index < scenarios.size(); ++scenario_index)
    {
        const auto& scenario = scenarios[scenario_index];
        output
            << "    {\n"
            << "      \"id\": \"" << scenario.id << "\",\n"
            << "      \"maximumDistanceM\": " << scenario.maximum_distance_m << ",\n"
            << "      \"comparisonSamples\": " << scenario.comparison_samples << ",\n"
            << "      \"productionBudgetPassed\": "
            << (scenario.production_budget_passed ? "true" : "false") << ",\n"
            << "      \"halfToleranceDisplayPassed\": "
            << (scenario.half_tolerance_display_passed ? "true" : "false") << ",\n"
            << "      \"tighterSolutionImproved\": "
            << (scenario.tighter_solution_improved ? "true" : "false") << ",\n"
            << "      \"halfToleranceChange\": ";
        write_metrics(output, scenario.half_tolerance_change, "      ");
        output << ",\n      \"toleranceRows\": [\n";
        for (std::size_t row_index = 0; row_index < scenario.rows.size(); ++row_index)
        {
            const auto& row = scenario.rows[row_index];
            output
                << "        {\n"
                << "          \"id\": \"" << row.id << "\",\n"
                << "          \"toleranceScale\": " << row.tolerance_scale << ",\n"
                << "          \"relativeTolerance\": " << row.configuration.relative_tolerance
                << ",\n"
                << "          \"absolutePositionToleranceM\": "
                << row.configuration.absolute_position_tolerance_m << ",\n"
                << "          \"absoluteVelocityToleranceMps\": "
                << row.configuration.absolute_velocity_tolerance_mps << ",\n"
                << "          \"attemptedSteps\": " << row.diagnostics.attempted_steps << ",\n"
                << "          \"acceptedSteps\": " << row.diagnostics.accepted_steps << ",\n"
                << "          \"rejectedSteps\": " << row.diagnostics.rejected_steps << ",\n"
                << "          \"errorToReference\": ";
            write_metrics(output, row.error_to_reference, "          ");
            output << "\n        }" << (row_index + 1 == scenario.rows.size() ? "\n" : ",\n");
        }
        output << "      ]\n"
               << "    }" << (scenario_index + 1 == scenarios.size() ? "\n" : ",\n");
    }
    output << "  ]\n}\n";
}

} // namespace

int main(
    int argc,
    char** argv
)
{
    std::filesystem::path report_path = "adaptive-convergence.json";
    if (argc == 3 && std::string_view(argv[1]) == "--report")
    {
        report_path = argv[2];
    }
    else if (argc != 1)
    {
        std::cerr << "usage: Ballistics.Convergence.Tests [--report PATH]\n";
        return 2;
    }

    try
    {
        std::vector<ScenarioReport> reports;
        ErrorMetrics maximum_production_error;
        ErrorMetrics maximum_half_change;
        bool scenarios_passed = true;
        for (const auto& definition : scenario_definitions())
        {
            auto report = evaluate_scenario(definition);
            maximum_production_error.include(report.rows.front().error_to_reference);
            maximum_half_change.include(report.half_tolerance_change);
            scenarios_passed = scenarios_passed && report.production_budget_passed &&
                report.half_tolerance_display_passed && report.tighter_solution_improved;
            reports.push_back(std::move(report));
        }
        bool analytic_passed = false;
        const auto analytic_rows = evaluate_analytic_step_refinement(analytic_passed);
        const auto passed = scenarios_passed && analytic_passed;
        write_report(
            report_path,
            passed,
            maximum_production_error,
            maximum_half_change,
            analytic_passed,
            analytic_rows,
            reports
        );
        if (!passed)
        {
            std::cerr
                << std::setprecision(17)
                << "adaptive convergence failed: maximum production errors position="
                << maximum_production_error.position_m
                << " m, velocity=" << maximum_production_error.velocity_mps
                << " m/s, time=" << maximum_production_error.time_s << " s\n";
            for (const auto& row : analytic_rows)
            {
                std::cerr
                    << "analytic h=" << row.maximum_step_s << " speedError=" << row.speed_error_mps
                    << " timeError=" << row.time_error_s << " speedOrder="
                    << row.observed_speed_order << " timeOrder=" << row.observed_time_order << '\n';
            }
            return 1;
        }
        std::cout << "Adaptive convergence, production budgets, half-tolerance display stability, "
                     "and analytic step refinement passed.\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "convergence test exception: " << error.what() << '\n';
        return 1;
    }
}
