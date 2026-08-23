#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>
#include <numeric>
#include <stdexcept>

#include "ballistics.hpp"

namespace ballistics
{
namespace
{

constexpr double normal_95_quantile = 1.959963984540054;
constexpr double diameter_90_sigma_factor = 2.0 * 2.145966026289347;

bool finite_positive(
    double value
)
{
    return std::isfinite(value) && value > 0.0;
}

double normal_cdf(
    double value
)
{
    return 0.5 * std::erfc(-value / std::sqrt(2.0));
}

double rectangle_probability(
    double sigma_m,
    const BuckshotTargetRegion& target
)
{
    const auto x_low = target.center_horizontal_m - target.width_m / 2.0;
    const auto x_high = target.center_horizontal_m + target.width_m / 2.0;
    const auto y_low = target.center_vertical_m - target.height_m / 2.0;
    const auto y_high = target.center_vertical_m + target.height_m / 2.0;
    return std::clamp(
        (normal_cdf(x_high / sigma_m) - normal_cdf(x_low / sigma_m)) *
            (normal_cdf(y_high / sigma_m) - normal_cdf(y_low / sigma_m)),
        0.0,
        1.0
    );
}

double circle_probability(
    double sigma_m,
    const BuckshotTargetRegion& target
)
{
    const auto radius = target.width_m / 2.0;
    const auto x_low = target.center_horizontal_m - radius;
    const auto x_high = target.center_horizontal_m + radius;
    constexpr std::size_t intervals = 1024;
    const auto step = (x_high - x_low) / static_cast<double>(intervals);
    const auto integrand = [&](double x)
    {
        const auto relative_x = x - target.center_horizontal_m;
        const auto half_height =
            std::sqrt(std::max(0.0, radius * radius - relative_x * relative_x));
        const auto probability_y = normal_cdf((target.center_vertical_m + half_height) / sigma_m) -
            normal_cdf((target.center_vertical_m - half_height) / sigma_m);
        const auto density_x = std::exp(-0.5 * x * x / (sigma_m * sigma_m)) /
            (std::sqrt(2.0 * std::numbers::pi) * sigma_m);
        return density_x * probability_y;
    };
    auto integral = integrand(x_low) + integrand(x_high);
    for (std::size_t index = 1; index < intervals; ++index)
    {
        integral += (index % 2 == 0 ? 2.0 : 4.0) * integrand(x_low + step * index);
    }
    return std::clamp(integral * step / 3.0, 0.0, 1.0);
}

double target_probability(
    double diameter_90_m,
    const BuckshotTargetRegion& target
)
{
    const auto sigma_m = diameter_90_m / diameter_90_sigma_factor;
    return target.shape == TargetRegionShape::circle
        ? circle_probability(sigma_m, target)
        : rectangle_probability(sigma_m, target);
}

std::vector<double> binomial_probabilities(
    std::size_t count,
    double probability
)
{
    std::vector<double> result(count + 1);
    if (probability <= 0.0)
    {
        result.front() = 1.0;
        return result;
    }
    if (probability >= 1.0)
    {
        result.back() = 1.0;
        return result;
    }
    for (std::size_t hits = 0; hits <= count; ++hits)
    {
        const auto log_probability = std::lgamma(static_cast<double>(count + 1)) -
            std::lgamma(static_cast<double>(hits + 1)) -
            std::lgamma(static_cast<double>(count - hits + 1)) +
            static_cast<double>(hits) * std::log(probability) +
            static_cast<double>(count - hits) * std::log1p(-probability);
        result[hits] = std::exp(log_probability);
    }
    const auto total = std::accumulate(result.begin(), result.end(), 0.0);
    for (auto& item : result)
    {
        item /= total;
    }
    return result;
}

void validate_input(
    const BuckshotPatternInput& input
)
{
    if (input.pellet_count == 0 || input.pellet_count > 1000 ||
        !finite_positive(input.mean_muzzle_velocity_mps) ||
        !std::isfinite(input.pellet_velocity_standard_deviation_mps) ||
        input.pellet_velocity_standard_deviation_mps < 0.0 ||
        input.pellet_velocity_standard_deviation_mps > input.mean_muzzle_velocity_mps / 2.0 ||
        !finite_positive(input.target_range_m) || input.minimum_pellet_count == 0 ||
        input.minimum_pellet_count > input.pellet_count || !finite_positive(input.target.width_m) ||
        (input.target.shape == TargetRegionShape::rectangle &&
         !finite_positive(input.target.height_m)) ||
        !std::isfinite(input.target.center_horizontal_m) ||
        !std::isfinite(input.target.center_vertical_m) || input.observations.size() < 3 ||
        input.observations.size() > 64)
    {
        throw std::invalid_argument("invalid buckshot pattern input");
    }
    std::size_t calibration_count = 0;
    std::size_t holdout_count = 0;
    for (const auto& observation : input.observations)
    {
        if (!finite_positive(observation.range_m) || !finite_positive(observation.diameter_90_m) ||
            !finite_positive(observation.standard_uncertainty_m) || observation.shell_count == 0 ||
            observation.shell_count > 1000)
        {
            throw std::invalid_argument("invalid buckshot pattern observation");
        }
        if (observation.role == ObservationRole::calibration)
        {
            ++calibration_count;
        }
        else
        {
            ++holdout_count;
        }
    }
    if (calibration_count < 2 || holdout_count < 1)
    {
        throw std::invalid_argument(
            "buckshot pattern analysis requires at least two calibration and one holdout "
            "observation"
        );
    }
}

} // namespace

BuckshotPatternResult analyze_buckshot_pattern(
    const BuckshotPatternInput& input
)
{
    validate_input(input);
    double weighted_range_diameter = 0.0;
    double weighted_range_squared = 0.0;
    auto range_min = std::numeric_limits<double>::infinity();
    auto range_max = 0.0;
    for (const auto& observation : input.observations)
    {
        if (observation.role != ObservationRole::calibration)
        {
            continue;
        }
        const auto weight = static_cast<double>(observation.shell_count) /
            (observation.standard_uncertainty_m * observation.standard_uncertainty_m);
        weighted_range_diameter += weight * observation.range_m * observation.diameter_90_m;
        weighted_range_squared += weight * observation.range_m * observation.range_m;
        range_min = std::min(range_min, observation.range_m);
        range_max = std::max(range_max, observation.range_m);
    }
    if (!finite_positive(weighted_range_squared))
    {
        throw std::invalid_argument("buckshot calibration matrix is singular");
    }
    const auto angular_diameter = weighted_range_diameter / weighted_range_squared;
    BuckshotPatternResult result;
    result.fitted_angular_diameter_rad = angular_diameter;
    result.calibration_range_min_m = range_min;
    result.calibration_range_max_m = range_max;

    double calibration_squared_error = 0.0;
    double holdout_squared_error = 0.0;
    double weighted_squared_error = 0.0;
    std::size_t calibration_count = 0;
    std::size_t holdout_count = 0;
    for (const auto& observation : input.observations)
    {
        const auto predicted = angular_diameter * observation.range_m;
        const auto residual = predicted - observation.diameter_90_m;
        const auto normalized = residual / observation.standard_uncertainty_m;
        result.residuals.push_back(
            { observation.range_m,
              observation.diameter_90_m,
              predicted,
              residual,
              normalized,
              observation.role }
        );
        if (observation.role == ObservationRole::calibration)
        {
            calibration_squared_error += residual * residual;
            weighted_squared_error +=
                static_cast<double>(observation.shell_count) * normalized * normalized;
            ++calibration_count;
        }
        else
        {
            holdout_squared_error += residual * residual;
            ++holdout_count;
        }
    }
    result.calibration_rmse_m =
        std::sqrt(calibration_squared_error / static_cast<double>(calibration_count));
    result.holdout_rmse_m = std::sqrt(holdout_squared_error / static_cast<double>(holdout_count));
    result.reduced_chi_square = weighted_squared_error / static_cast<double>(calibration_count - 1);
    result.angular_standard_uncertainty_rad =
        std::sqrt(std::max(1.0, result.reduced_chi_square) / weighted_range_squared);

    const auto low_angular = std::max(
        angular_diameter - normal_95_quantile * result.angular_standard_uncertainty_rad,
        angular_diameter * 1e-6
    );
    const auto high_angular =
        angular_diameter + normal_95_quantile * result.angular_standard_uncertainty_rad;
    result.predicted_diameter_90_m = angular_diameter * input.target_range_m;
    result.predicted_diameter_90_low_95_m = low_angular * input.target_range_m;
    result.predicted_diameter_90_high_95_m = high_angular * input.target_range_m;

    result.per_pellet_hit_probability =
        target_probability(result.predicted_diameter_90_m, input.target);
    const auto probability_at_low_diameter =
        target_probability(result.predicted_diameter_90_low_95_m, input.target);
    const auto probability_at_high_diameter =
        target_probability(result.predicted_diameter_90_high_95_m, input.target);
    result.per_pellet_hit_probability_low_95 = std::min(
        { result.per_pellet_hit_probability,
          probability_at_low_diameter,
          probability_at_high_diameter }
    );
    result.per_pellet_hit_probability_high_95 = std::max(
        { result.per_pellet_hit_probability,
          probability_at_low_diameter,
          probability_at_high_diameter }
    );
    result.expected_pellet_count =
        static_cast<double>(input.pellet_count) * result.per_pellet_hit_probability;
    result.pellet_count_probabilities =
        binomial_probabilities(input.pellet_count, result.per_pellet_hit_probability);
    result.probability_at_least_minimum = std::accumulate(
        result.pellet_count_probabilities.begin() +
            static_cast<std::ptrdiff_t>(input.minimum_pellet_count),
        result.pellet_count_probabilities.end(),
        0.0
    );
    const auto in_range = input.target_range_m >= range_min && input.target_range_m <= range_max;
    result.status =
        in_range ? PatternAnalysisStatus::validated_in_domain : PatternAnalysisStatus::extrapolated;
    result.validity_statement =
        "Empirical D90-through-origin fit conditioned on the supplied choke, pellet velocity "
        "spread, "
        "and deformation class. Pellet-count probabilities assume independent isotropic Gaussian "
        "impacts. Pellet wakes, swarm aerodynamics, aim error, and extrapolation to other "
        "ammunition "
        "conditions are not modeled.";
    return result;
}

} // namespace ballistics
