#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

#include "ballistics.hpp"

namespace ballistics
{
namespace
{

constexpr std::size_t variable_count = 7;
constexpr std::size_t metric_count = 8;

std::size_t variable_index(
    UncertaintyVariable variable
)
{
    switch (variable)
    {
    case UncertaintyVariable::muzzle_velocity:
        return 0;
    case UncertaintyVariable::drag:
        return 1;
    case UncertaintyVariable::temperature:
        return 2;
    case UncertaintyVariable::pressure:
        return 3;
    case UncertaintyVariable::headwind:
        return 4;
    case UncertaintyVariable::crosswind:
        return 5;
    case UncertaintyVariable::zero_range:
        return 6;
    }
    throw std::invalid_argument("unknown uncertainty variable");
}

std::array<double, variable_count> standard_deviations(
    const UncertaintyInputs& inputs
)
{
    return { inputs.muzzle_velocity_standard_deviation_mps, inputs.drag_relative_standard_deviation,
             inputs.temperature_standard_deviation_c,       inputs.pressure_standard_deviation_hpa,
             inputs.headwind_standard_deviation_mps,        inputs.crosswind_standard_deviation_mps,
             inputs.zero_range_standard_deviation_m };
}

using Matrix = std::array<std::array<double, variable_count>, variable_count>;

Matrix correlation_cholesky(
    const std::vector<UncertaintyCorrelation>& correlations
)
{
    Matrix correlation {};
    for (std::size_t row = 0; row < variable_count; ++row)
    {
        correlation[row][row] = 1.0;
    }
    Matrix declared {};
    for (const auto& item : correlations)
    {
        const auto first = variable_index(item.first);
        const auto second = variable_index(item.second);
        if (first == second || !std::isfinite(item.coefficient) ||
            std::abs(item.coefficient) >= 1.0)
        {
            throw std::invalid_argument("invalid uncertainty correlation");
        }
        if (declared[first][second] != 0.0 &&
            std::abs(correlation[first][second] - item.coefficient) > 1e-12)
        {
            throw std::invalid_argument("conflicting duplicate uncertainty correlation");
        }
        declared[first][second] = 1.0;
        declared[second][first] = 1.0;
        correlation[first][second] = item.coefficient;
        correlation[second][first] = item.coefficient;
    }

    Matrix lower {};
    for (std::size_t row = 0; row < variable_count; ++row)
    {
        for (std::size_t column = 0; column <= row; ++column)
        {
            auto value = correlation[row][column];
            for (std::size_t index = 0; index < column; ++index)
            {
                value -= lower[row][index] * lower[column][index];
            }
            if (row == column)
            {
                if (value < -1e-12)
                {
                    throw std::invalid_argument(
                        "uncertainty correlation matrix is not positive semidefinite"
                    );
                }
                lower[row][column] = std::sqrt(std::max(0.0, value));
            }
            else
            {
                if (lower[column][column] <= 1e-12)
                {
                    if (std::abs(value) > 1e-10)
                    {
                        throw std::invalid_argument(
                            "uncertainty correlation matrix has a singular inconsistent row"
                        );
                    }
                    lower[row][column] = 0.0;
                }
                else
                {
                    lower[row][column] = value / lower[column][column];
                }
            }
        }
    }
    return lower;
}

class NormalGenerator
{
  public:
    explicit NormalGenerator(
        std::uint64_t seed
    )
        : state_(seed)
    {
    }

    double next()
    {
        if (has_spare_)
        {
            has_spare_ = false;
            return spare_;
        }
        const auto first = std::max(uniform(), std::numeric_limits<double>::min());
        const auto second = uniform();
        const auto radius = std::sqrt(-2.0 * std::log(first));
        const auto angle = 2.0 * std::acos(-1.0) * second;
        spare_ = radius * std::sin(angle);
        has_spare_ = true;
        return radius * std::cos(angle);
    }

  private:
    std::uint64_t state_;
    bool has_spare_ {};
    double spare_ {};

    std::uint64_t bits()
    {
        state_ += 0x9e3779b97f4a7c15ULL;
        auto value = state_;
        value = (value ^ (value >> 30U)) * 0xbf58476d1ce4e5b9ULL;
        value = (value ^ (value >> 27U)) * 0x94d049bb133111ebULL;
        return value ^ (value >> 31U);
    }

    double uniform()
    {
        return static_cast<double>(bits() >> 11U) * 0x1.0p-53;
    }
};

std::array<double, variable_count> correlated_normal(
    NormalGenerator& generator,
    const Matrix& lower
)
{
    std::array<double, variable_count> independent {};
    std::array<double, variable_count> correlated {};
    for (auto& value : independent)
    {
        value = generator.next();
    }
    for (std::size_t row = 0; row < variable_count; ++row)
    {
        for (std::size_t column = 0; column <= row; ++column)
        {
            correlated[row] += lower[row][column] * independent[column];
        }
    }
    return correlated;
}

double quantile(
    std::vector<double> values,
    double probability
)
{
    if (values.empty())
    {
        return 0.0;
    }
    std::sort(values.begin(), values.end());
    const auto position = probability * static_cast<double>(values.size() - 1);
    const auto lower = static_cast<std::size_t>(std::floor(position));
    const auto upper = static_cast<std::size_t>(std::ceil(position));
    const auto fraction = position - static_cast<double>(lower);
    return values[lower] + fraction * (values[upper] - values[lower]);
}

UncertaintyInterval interval(
    const std::vector<double>& values
)
{
    return { quantile(values, 0.5), quantile(values, 0.025), quantile(values, 0.975) };
}

double split_quantile_delta(
    const std::vector<double>& values
)
{
    if (values.size() < 40)
    {
        return std::numeric_limits<double>::infinity();
    }
    const auto midpoint = values.size() / 2;
    const std::vector<double> first(values.begin(), values.begin() + midpoint);
    const std::vector<double> second(values.begin() + midpoint, values.end());
    const auto first_low = quantile(first, 0.025);
    const auto second_low = quantile(second, 0.025);
    const auto first_high = quantile(first, 0.975);
    const auto second_high = quantile(second, 0.975);
    const auto scale = std::max({ 1.0, std::abs(quantile(values, 0.5)) });
    return std::max(std::abs(first_low - second_low), std::abs(first_high - second_high)) / scale;
}

double sight_line_elevation(
    const ShotGeometry& geometry
)
{
    return std::abs(geometry.target_elevation_m) > 1e-12
        ? std::atan2(geometry.target_elevation_m, geometry.target_distance_m)
        : geometry.target_inclination_rad;
}

using MetricValues = std::array<std::vector<double>, metric_count>;

} // namespace

MonteCarloUncertaintyResult propagate_monte_carlo_uncertainty(
    const Projectile& projectile,
    const ShotScenario& baseline_scenario,
    const UncertaintyInputs& uncertainty,
    const std::vector<UncertaintyCorrelation>& correlations,
    const std::vector<double>& output_distances_m,
    std::size_t sample_count,
    std::uint64_t seed
)
{
    if (sample_count < 100 || sample_count > 10000 || output_distances_m.empty() ||
        !std::is_sorted(output_distances_m.begin(), output_distances_m.end()) ||
        output_distances_m.front() < 0.0 ||
        output_distances_m.back() > baseline_scenario.geometry.maximum_distance_m + 1e-9)
    {
        throw std::invalid_argument("invalid Monte Carlo configuration");
    }
    const auto deviations = standard_deviations(uncertainty);
    if (std::any_of(
            deviations.begin(),
            deviations.end(),
            [](double value) { return !std::isfinite(value) || value < 0.0; }
        ))
    {
        throw std::invalid_argument("invalid uncertainty standard deviation");
    }
    const auto lower = correlation_cholesky(correlations);

    MonteCarloUncertaintyResult result;
    result.seed = seed;
    result.requested_sample_count = sample_count;
    result.samples.resize(output_distances_m.size());
    std::vector<MetricValues> values(output_distances_m.size());
    for (std::size_t output_index = 0; output_index < output_distances_m.size(); ++output_index)
    {
        result.samples[output_index].distance_m = output_distances_m[output_index];
        for (auto& metric : values[output_index])
        {
            metric.reserve(sample_count);
        }
    }

    const auto active_inputs = std::count_if(
        deviations.begin(),
        deviations.end(),
        [](double value) { return value > 0.0; }
    );
    NormalGenerator generator(seed);
    const auto reference_bc = reference_bc_drag(projectile) != nullptr;
    const auto sight_elevation_rad = sight_line_elevation(baseline_scenario.geometry);

    for (std::size_t sample_index = 0; sample_index < sample_count; ++sample_index)
    {
        const auto random = correlated_normal(generator, lower);
        auto scenario = baseline_scenario;
        const auto baseline_atmosphere = baseline_scenario.environment.firing_point;
        const auto temperature_c =
            std::clamp(baseline_atmosphere.temperature_c + random[2] * deviations[2], -60.0, 60.0);
        const auto pressure_hpa = std::clamp(
            baseline_atmosphere.station_pressure_hpa + random[3] * deviations[3],
            500.0,
            1100.0
        );
        const auto headwind_mps =
            std::clamp(baseline_atmosphere.headwind_mps + random[4] * deviations[4], -100.0, 100.0);
        const auto crosswind_mps = std::clamp(
            baseline_atmosphere.crosswind_mps + random[5] * deviations[5],
            -100.0,
            100.0
        );
        scenario.environment.firing_point = Atmosphere::create(
            temperature_c,
            pressure_hpa,
            baseline_atmosphere.relative_humidity_percent,
            headwind_mps,
            crosswind_mps
        );

        const auto baseline_velocity = projectile.ammunition.muzzle_velocity_mps *
            baseline_scenario.muzzle_velocity_multiplier;
        const auto sampled_velocity = std::clamp(
            baseline_velocity + random[0] * deviations[0],
            projectile.ammunition.muzzle_velocity_mps * 0.5,
            projectile.ammunition.muzzle_velocity_mps * 1.5
        );
        scenario.muzzle_velocity_multiplier =
            sampled_velocity / projectile.ammunition.muzzle_velocity_mps;
        scenario.geometry.zero_range_m = std::clamp(
            baseline_scenario.geometry.zero_range_m + random[6] * deviations[6],
            5.0,
            1000.0
        );
        const auto drag_log_delta = random[1] * deviations[1];
        scenario.solver.aerodynamic_drag_multiplier =
            baseline_scenario.solver.aerodynamic_drag_multiplier *
            std::exp(reference_bc ? -drag_log_delta : drag_log_delta);

        const auto zeroed = integrate_shot_scenario(projectile, scenario);
        if (zeroed.status != ZeroingStatus::complete ||
            zeroed.trajectory.covered_distance_m + 1e-9 < output_distances_m.back())
        {
            continue;
        }

        bool complete = true;
        std::vector<TrajectorySample> samples;
        samples.reserve(output_distances_m.size());
        for (const auto distance_m : output_distances_m)
        {
            const auto sample = zeroed.trajectory.sample_at(distance_m);
            if (!sample)
            {
                complete = false;
                break;
            }
            samples.push_back(*sample);
        }
        if (!complete)
        {
            continue;
        }

        ++result.completed_sample_count;
        for (std::size_t output_index = 0; output_index < samples.size(); ++output_index)
        {
            const auto& sample = samples[output_index];
            const auto path_m =
                line_of_sight_path_m(sample, scenario.geometry.sight_height_m, sight_elevation_rad);
            const std::array<double, metric_count> metrics {
                sample.ground_speed_mps,
                sample.energy_j,
                sample.momentum_kgms,
                sample.time_s,
                sample.drop_m,
                path_m,
                elevation_holdover_rad(path_m, sample.distance_m),
                sample.wind_drift_m
            };
            for (std::size_t metric_index = 0; metric_index < metric_count; ++metric_index)
            {
                values[output_index][metric_index].push_back(metrics[metric_index]);
            }
        }
    }

    if (result.completed_sample_count == 0)
    {
        result.status = UncertaintyStatus::baseline_unavailable;
        for (auto& sample : result.samples)
        {
            sample.available = false;
        }
        return result;
    }

    result.maximum_split_quantile_delta = 0.0;
    for (std::size_t output_index = 0; output_index < result.samples.size(); ++output_index)
    {
        const auto& metric = values[output_index];
        auto& sample = result.samples[output_index];
        sample.speed_mps = interval(metric[0]);
        sample.energy_j = interval(metric[1]);
        sample.momentum_kgms = interval(metric[2]);
        sample.time_s = interval(metric[3]);
        sample.drop_m = interval(metric[4]);
        sample.path_m = interval(metric[5]);
        sample.holdover_rad = interval(metric[6]);
        sample.wind_drift_m = interval(metric[7]);
        for (const auto& values_for_metric : metric)
        {
            result.maximum_split_quantile_delta = std::max(
                result.maximum_split_quantile_delta,
                split_quantile_delta(values_for_metric)
            );
        }
    }
    result.status = active_inputs == 0 ? UncertaintyStatus::no_inputs
        : result.completed_sample_count == sample_count
        ? UncertaintyStatus::complete
        : UncertaintyStatus::partial;
    return result;
}

} // namespace ballistics
