#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "ballistics.hpp"

namespace
{

struct BenchmarkResult
{
    std::string id;
    std::size_t iterations {};
    double median_ms {};
    double p95_ms {};
    double minimum_ms {};
    double maximum_ms {};
    double guard {};
    bool integration_diagnostics_available {};
    std::size_t accepted_steps_per_iteration {};
    std::size_t rejected_steps_per_iteration {};
    std::size_t retained_samples_per_iteration {};
    std::size_t estimated_retained_bytes_per_iteration {};
    std::size_t serialized_samples_per_iteration {};
};

struct BenchmarkObservation
{
    double guard {};
    bool integration_diagnostics_available {};
    std::size_t accepted_steps {};
    std::size_t rejected_steps {};
    std::size_t retained_samples {};
    std::size_t estimated_retained_bytes {};
    std::size_t serialized_samples {};
};

std::size_t projected_serialized_sample_count(
    const ballistics::Trajectory& trajectory
)
{
    const auto available_count = trajectory.samples.size();
    if (available_count == 0)
    {
        return 0;
    }
    const auto stride = std::max<std::size_t>(1, available_count / 500);
    const auto strided_count = (available_count + stride - 1) / stride;
    const auto endpoint_already_present = (available_count - 1) % stride == 0;
    return strided_count + (endpoint_already_present ? 0 : 1);
}

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

std::string platform_identity()
{
#if defined(_WIN32)
    return "windows";
#elif defined(__APPLE__)
    return "macos";
#elif defined(__linux__)
    return "linux";
#else
    return "unknown";
#endif
}

double percentile(
    const std::vector<double>& sorted_values,
    double fraction
)
{
    const auto index = static_cast<std::size_t>(
        std::ceil(fraction * static_cast<double>(sorted_values.size())) - 1.0
    );
    return sorted_values[std::min(index, sorted_values.size() - 1)];
}

BenchmarkResult benchmark(
    std::string id,
    std::size_t iterations,
    const std::function<BenchmarkObservation()>& operation
)
{
    volatile double warmup_guard = operation().guard;
    static_cast<void>(warmup_guard);

    std::vector<double> durations_ms;
    durations_ms.reserve(iterations);
    double guard {};
    BenchmarkObservation diagnostics;
    for (std::size_t iteration = 0; iteration < iterations; ++iteration)
    {
        const auto begin = std::chrono::steady_clock::now();
        const auto observation = operation();
        guard += observation.guard;
        const auto end = std::chrono::steady_clock::now();
        durations_ms.push_back(std::chrono::duration<double, std::milli>(end - begin).count());
        diagnostics = observation;
    }
    std::sort(durations_ms.begin(), durations_ms.end());
    return {
        std::move(id),
        iterations,
        percentile(durations_ms, 0.5),
        percentile(durations_ms, 0.95),
        durations_ms.front(),
        durations_ms.back(),
        guard,
        diagnostics.integration_diagnostics_available,
        diagnostics.accepted_steps,
        diagnostics.rejected_steps,
        diagnostics.retained_samples,
        diagnostics.estimated_retained_bytes,
        diagnostics.serialized_samples
    };
}

BenchmarkObservation trajectory_observation(
    const ballistics::Trajectory& trajectory
)
{
    const auto& sample = trajectory.samples.back();
    return {
        trajectory.covered_distance_m + sample.ground_speed_mps + sample.time_s +
            sample.position_m.y,
        true,
        trajectory.solver.accepted_steps,
        trajectory.solver.rejected_steps,
        trajectory.samples.size(),
        trajectory.samples.size() * sizeof(ballistics::TrajectorySample),
        projected_serialized_sample_count(trajectory)
    };
}

void write_results(
    std::ostream& output,
    const std::vector<BenchmarkResult>& results
)
{
    output
        << std::setprecision(15) << "{\n"
        << "  \"schemaVersion\": 1,\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"platform\": \"" << platform_identity() << "\",\n"
        << "  \"compiler\": \"" << compiler_identity() << "\",\n"
        << "  \"hardwareConcurrency\": " << std::thread::hardware_concurrency() << ",\n"
        << "  \"clock\": \"steady_clock wall time\",\n"
        << "  \"thresholdPolicy\": \"Report only. No timing threshold fails CI.\",\n"
        << "  \"benchmarks\": [\n";
    for (std::size_t index = 0; index < results.size(); ++index)
    {
        const auto& result = results[index];
        output
            << "    {\n"
            << "      \"id\": \"" << result.id << "\",\n"
            << "      \"iterations\": " << result.iterations << ",\n"
            << "      \"medianMs\": " << result.median_ms << ",\n"
            << "      \"p95Ms\": " << result.p95_ms << ",\n"
            << "      \"minimumMs\": " << result.minimum_ms << ",\n"
            << "      \"maximumMs\": " << result.maximum_ms << ",\n"
            << "      \"guard\": " << result.guard << ",\n"
            << "      \"integrationDiagnosticsAvailable\": "
            << (result.integration_diagnostics_available ? "true" : "false") << ",\n"
            << "      \"acceptedStepsPerIteration\": " << result.accepted_steps_per_iteration
            << ",\n"
            << "      \"rejectedStepsPerIteration\": " << result.rejected_steps_per_iteration
            << ",\n"
            << "      \"retainedSamplesPerIteration\": " << result.retained_samples_per_iteration
            << ",\n"
            << "      \"estimatedRetainedBytesPerIteration\": "
            << result.estimated_retained_bytes_per_iteration << ",\n"
            << "      \"serializedSamplesPerIteration\": "
            << result.serialized_samples_per_iteration << "\n"
            << "    }" << (index + 1 == results.size() ? "\n" : ",\n");
    }
    output << "  ]\n}\n";
}

} // namespace

int main(
    int argc,
    char** argv
)
{
    using namespace ballistics;

    std::size_t iterations = 3;
    std::filesystem::path output_path;
    for (int index = 1; index < argc; ++index)
    {
        const std::string_view argument = argv[index];
        if (argument == "--iterations" && index + 1 < argc)
        {
            iterations = static_cast<std::size_t>(std::stoul(argv[++index]));
        }
        else if (argument == "--output" && index + 1 < argc)
        {
            output_path = argv[++index];
        }
        else
        {
            std::cerr << "usage: ballistics_benchmarks [--iterations N] [--output PATH]\n";
            return 2;
        }
    }
    if (iterations == 0 || iterations > 100)
    {
        std::cerr << "iterations must be between 1 and 100\n";
        return 2;
    }

    const auto atmosphere = Atmosphere::create(15, 1013.25, 50, 0, 0);
    const auto strong_wind = Atmosphere::create(0, 1030, 80, 25, 15);
    const auto& built_ins = built_in_projectiles();

    std::vector<Projectile> nine_loads = built_ins;
    for (std::size_t index = 0; index < 3; ++index)
    {
        auto load = built_ins[3];
        load.provenance.id = "benchmark:g7-" + std::to_string(index);
        load.definition.name = load.provenance.id;
        load.definition.short_name = load.provenance.id;
        load.definition.drag = ReferenceBcDrag {
            ReferenceDragCurve::g7,
            ConstantBallisticCoefficient { 0.20 + 0.05 * static_cast<double>(index) }
        };
        nine_loads.push_back(load);
    }

    auto calibration_truth = built_ins[3];
    calibration_truth.definition.drag =
        ReferenceBcDrag { ReferenceDragCurve::g7, ConstantBallisticCoefficient { 0.25 } };
    const auto calibration_trajectory = integrate_trajectory(calibration_truth, atmosphere, 500);
    std::vector<VelocityObservation> calibration_observations;
    for (const double distance_m : { 100.0, 200.0, 300.0, 400.0, 500.0 })
    {
        const auto sample = calibration_trajectory.sample_at(distance_m);
        if (!sample)
        {
            throw std::runtime_error("could not create benchmark calibration observation");
        }
        calibration_observations.push_back(
            { distance_m,
              sample->ground_speed_mps,
              1.0,
              distance_m < 500.0 ? ObservationRole::calibration : ObservationRole::holdout }
        );
    }
    auto calibration_guess = calibration_truth;
    calibration_guess.definition.drag =
        ReferenceBcDrag { ReferenceDragCurve::g7, ConstantBallisticCoefficient { 0.20 } };

    const auto uncertainty_baseline =
        integrate_zeroed_trajectory(built_ins[3], atmosphere, 500, 100, 0.04);
    UncertaintyInputs uncertainty;
    uncertainty.muzzle_velocity_standard_deviation_mps = 3.0;
    uncertainty.drag_relative_standard_deviation = 0.02;
    uncertainty.headwind_standard_deviation_mps = 1.0;
    const std::vector<double> uncertainty_ranges { 0, 100, 200, 300, 400, 500 };

    std::vector<BenchmarkResult> results;
    for (const double distance_m : { 100.0, 500.0, 2000.0 })
    {
        results.push_back(benchmark(
            "six-builtins-" + std::to_string(static_cast<int>(distance_m)) + "m",
            iterations,
            [&]
            {
                BenchmarkObservation total { 0, true, 0, 0, 0, 0, 0 };
                for (const auto& load : built_ins)
                {
                    const auto observation =
                        trajectory_observation(integrate_trajectory(load, atmosphere, distance_m));
                    total.guard += observation.guard;
                    total.accepted_steps += observation.accepted_steps;
                    total.rejected_steps += observation.rejected_steps;
                    total.retained_samples += observation.retained_samples;
                    total.estimated_retained_bytes += observation.estimated_retained_bytes;
                    total.serialized_samples += observation.serialized_samples;
                }
                return total;
            }
        ));
    }

    results.push_back(benchmark(
        "nine-loads-2000m",
        iterations,
        [&]
        {
            BenchmarkObservation total { 0, true, 0, 0, 0, 0, 0 };
            for (const auto& load : nine_loads)
            {
                const auto observation =
                    trajectory_observation(integrate_trajectory(load, atmosphere, 2000));
                total.guard += observation.guard;
                total.accepted_steps += observation.accepted_steps;
                total.rejected_steps += observation.rejected_steps;
                total.retained_samples += observation.retained_samples;
                total.estimated_retained_bytes += observation.estimated_retained_bytes;
                total.serialized_samples += observation.serialized_samples;
            }
            return total;
        }
    ));
    results.push_back(benchmark(
        "nine-loads-2000m-full-calculation",
        iterations,
        [&]
        {
            BenchmarkObservation total { 0, true, 0, 0, 0, 0, 0 };
            for (const auto& load : nine_loads)
            {
                const auto rifle = load.firearm.group == FirearmGroup::rifle;
                const auto sight_height_m = rifle ? 0.04 : 0.025;
                const auto zero_range_m = rifle ? 100.0 : 50.0;
                const auto mpbr = compute_native_mpbr(load, atmosphere, 2000, 0.2, sight_height_m);
                const auto zeroed = integrate_zeroed_trajectory(
                    load,
                    atmosphere,
                    2000,
                    zero_range_m,
                    sight_height_m
                );
                const auto events = analyze_trajectory_events(zeroed, sight_height_m);
                const auto validity = evaluate_drag_validity(load, zeroed.trajectory, 2000);
                const auto observation = trajectory_observation(zeroed.trajectory);
                total.guard += observation.guard + mpbr.zero_m + mpbr.mpbr_m +
                    events.analyzed_distance_m +
                    static_cast<double>(validity.status == DragValidityStatus::within_domain);
                total.accepted_steps += observation.accepted_steps;
                total.rejected_steps += observation.rejected_steps;
                total.retained_samples += observation.retained_samples;
                total.estimated_retained_bytes += observation.estimated_retained_bytes;
                total.serialized_samples += observation.serialized_samples;
            }
            return total;
        }
    ));
    results.push_back(benchmark(
        "sphere-transonic-500m",
        iterations,
        [&] { return trajectory_observation(integrate_trajectory(built_ins[5], atmosphere, 500)); }
    ));
    results.push_back(benchmark(
        "strong-wind-rifle-2000m",
        iterations,
        [&]
        { return trajectory_observation(integrate_trajectory(built_ins[3], strong_wind, 2000)); }
    ));
    results.push_back(benchmark(
        "native-mpbr-rifle",
        iterations,
        [&]
        {
            const auto result = compute_native_mpbr(built_ins[3], atmosphere, 2000, 0.20, 0.04);
            return BenchmarkObservation { result.zero_m + result.mpbr_m, false, 0, 0, 0, 0, 0 };
        }
    ));
    results.push_back(benchmark(
        "constant-g7-calibration",
        iterations,
        [&]
        {
            const auto result = calibrate_reference_ballistic_coefficient(
                calibration_guess,
                atmosphere,
                calibration_observations,
                BcFitKind::constant
            );
            return BenchmarkObservation {
                result.estimates.front().ballistic_coefficient + result.calibration_rmse_mps,
                false,
                0,
                0,
                0,
                0,
                0
            };
        }
    ));
    results.push_back(benchmark(
        "three-input-uncertainty",
        iterations,
        [&]
        {
            const auto result = propagate_trajectory_uncertainty(
                built_ins[3],
                atmosphere,
                uncertainty_baseline,
                500,
                100,
                0.04,
                1.0,
                uncertainty,
                uncertainty_ranges
            );
            return BenchmarkObservation {
                result.samples.back().speed_standard_deviation_mps +
                    result.samples.back().path_standard_deviation_m,
                false,
                0,
                0,
                0,
                0,
                0
            };
        }
    ));

    write_results(std::cout, results);
    if (!output_path.empty())
    {
        if (!output_path.parent_path().empty())
        {
            std::filesystem::create_directories(output_path.parent_path());
        }
        std::ofstream output(output_path, std::ios::binary);
        if (!output)
        {
            std::cerr << "could not create benchmark output " << output_path << '\n';
            return 1;
        }
        write_results(output, results);
    }
    return 0;
}
