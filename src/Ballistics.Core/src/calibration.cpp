#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

#include "ballistics.hpp"

namespace ballistics
{
namespace
{

using Matrix = std::vector<std::vector<double>>;

bool solve_linear_system(
    Matrix matrix,
    std::vector<double> right_hand_side,
    std::vector<double>& solution
)
{
    const auto size = matrix.size();
    if (size == 0 || right_hand_side.size() != size ||
        std::any_of(
            matrix.begin(),
            matrix.end(),
            [size](const auto& row) { return row.size() != size; }
        ))
    {
        return false;
    }
    for (std::size_t column = 0; column < size; ++column)
    {
        auto pivot = column;
        for (auto row = column + 1; row < size; ++row)
        {
            if (std::abs(matrix[row][column]) > std::abs(matrix[pivot][column]))
            {
                pivot = row;
            }
        }
        if (!std::isfinite(matrix[pivot][column]) || std::abs(matrix[pivot][column]) < 1e-14)
        {
            return false;
        }
        std::swap(matrix[column], matrix[pivot]);
        std::swap(right_hand_side[column], right_hand_side[pivot]);
        const auto divisor = matrix[column][column];
        for (auto item = column; item < size; ++item)
        {
            matrix[column][item] /= divisor;
        }
        right_hand_side[column] /= divisor;
        for (std::size_t row = 0; row < size; ++row)
        {
            if (row == column)
            {
                continue;
            }
            const auto factor = matrix[row][column];
            for (auto item = column; item < size; ++item)
            {
                matrix[row][item] -= factor * matrix[column][item];
            }
            right_hand_side[row] -= factor * right_hand_side[column];
        }
    }
    solution = std::move(right_hand_side);
    return std::all_of(
        solution.begin(),
        solution.end(),
        [](double value) { return std::isfinite(value); }
    );
}

bool invert_matrix(
    const Matrix& matrix,
    Matrix& inverse
)
{
    const auto size = matrix.size();
    inverse.assign(size, std::vector<double>(size));
    for (std::size_t column = 0; column < size; ++column)
    {
        std::vector<double> unit(size);
        unit[column] = 1.0;
        std::vector<double> solved;
        if (!solve_linear_system(matrix, unit, solved))
        {
            return false;
        }
        for (std::size_t row = 0; row < size; ++row)
        {
            inverse[row][column] = solved[row];
        }
    }
    return true;
}

} // namespace

BcCalibrationResult calibrate_reference_ballistic_coefficient(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    const std::vector<VelocityObservation>& observations,
    BcFitKind fit_kind,
    const std::vector<double>& band_minimum_velocities_mps,
    std::size_t maximum_iterations
)
{
    constexpr double minimum_bc = 0.005;
    constexpr double maximum_bc = 2.0;
    constexpr double finite_difference_step = 1e-4;

    const auto* reference_drag = reference_bc_drag(projectile);
    if (!reference_drag)
    {
        throw std::invalid_argument("Calibration supports only G1 and G7 reference drag models.");
    }
    if (!validate_projectile(projectile).empty())
    {
        throw std::invalid_argument("Calibration projectile is invalid.");
    }
    if (observations.empty() || observations.size() > 32)
    {
        throw std::invalid_argument("Calibration requires between 1 and 32 observations.");
    }
    if (maximum_iterations == 0 || maximum_iterations > 100)
    {
        throw std::invalid_argument("Calibration iteration limit must be between 1 and 100.");
    }

    std::vector<double> thresholds;
    if (fit_kind == BcFitKind::constant)
    {
        if (!band_minimum_velocities_mps.empty())
        {
            throw std::invalid_argument("Constant-BC calibration cannot specify band thresholds.");
        }
        thresholds = { 0.0 };
    }
    else
    {
        thresholds = band_minimum_velocities_mps;
        if (thresholds.size() < 2 || thresholds.size() > 4 || thresholds.front() != 0.0)
        {
            throw std::invalid_argument(
                "Velocity-banded calibration requires 2 to 4 thresholds beginning at 0 m/s."
            );
        }
        for (std::size_t index = 0; index < thresholds.size(); ++index)
        {
            if (!std::isfinite(thresholds[index]) || thresholds[index] < 0.0 ||
                thresholds[index] > 2000.0 ||
                (index > 0 && thresholds[index] <= thresholds[index - 1]))
            {
                throw std::invalid_argument(
                    "Calibration band thresholds must be finite and strictly increasing."
                );
            }
        }
    }

    std::size_t calibration_count = 0;
    double previous_distance = -1.0;
    for (const auto& observation : observations)
    {
        if (!std::isfinite(observation.distance_m) || observation.distance_m <= 0.0 ||
            observation.distance_m > 2000.0 || observation.distance_m <= previous_distance)
        {
            throw std::invalid_argument(
                "Observation distances must be strictly increasing between 0 and 2000 m."
            );
        }
        if (!std::isfinite(observation.measured_velocity_mps) ||
            observation.measured_velocity_mps < 1.0 || observation.measured_velocity_mps > 2000.0)
        {
            throw std::invalid_argument("Observed velocity must be between 1 and 2000 m/s.");
        }
        if (!std::isfinite(observation.standard_deviation_mps) ||
            observation.standard_deviation_mps < 0.01 || observation.standard_deviation_mps > 200.0)
        {
            throw std::invalid_argument(
                "Observation standard deviation must be between 0.01 and 200 m/s."
            );
        }
        previous_distance = observation.distance_m;
        if (observation.role == ObservationRole::calibration)
        {
            ++calibration_count;
        }
    }
    if (calibration_count < thresholds.size())
    {
        throw std::invalid_argument(
            "Calibration requires at least as many calibration "
            "observations as fitted coefficients."
        );
    }

    BcCalibrationResult result;
    result.fit_kind = fit_kind;
    const auto log_minimum = std::log(minimum_bc);
    const auto log_maximum = std::log(maximum_bc);
    std::vector<double> parameters;
    parameters.reserve(thresholds.size());
    for (const auto threshold : thresholds)
    {
        const auto initial = effective_ballistic_coefficient(projectile, threshold);
        parameters.push_back(std::log(std::clamp(initial, minimum_bc, maximum_bc)));
    }

    const auto build_projectile = [&](const std::vector<double>& values)
    {
        auto candidate = projectile;
        BallisticCoefficientDefinition coefficient =
            ConstantBallisticCoefficient { std::exp(values.front()) };
        if (fit_kind == BcFitKind::velocity_bands)
        {
            BandedBallisticCoefficient schedule;
            schedule.bands.reserve(values.size());
            for (std::size_t index = 0; index < values.size(); ++index)
            {
                schedule.bands.push_back({ thresholds[index], std::exp(values[index]) });
            }
            coefficient = std::move(schedule);
        }
        candidate.definition.drag =
            ReferenceBcDrag { reference_drag->curve, std::move(coefficient) };
        return candidate;
    };

    const auto maximum_distance = observations.back().distance_m;
    const auto predict = [&](const std::vector<double>& values, std::vector<double>& predictions)
    {
        try
        {
            const auto candidate = build_projectile(values);
            const auto trajectory = integrate_trajectory(
                candidate,
                atmosphere,
                maximum_distance,
                1.0,
                0.25,
                SolverConfiguration {}
            );
            predictions.clear();
            predictions.reserve(observations.size());
            for (const auto& observation : observations)
            {
                const auto sample = trajectory.sample_at(observation.distance_m);
                if (!sample)
                {
                    return false;
                }
                predictions.push_back(sample->ground_speed_mps);
            }
            return true;
        }
        catch (const std::exception&)
        {
            return false;
        }
    };

    const auto evaluate =
        [&](const std::vector<double>& values,
            std::vector<double>& residuals,
            std::vector<double>* all_predictions = nullptr)
    {
        ++result.objective_evaluations;
        std::vector<double> predictions;
        if (!predict(values, predictions))
        {
            return std::numeric_limits<double>::infinity();
        }
        residuals.clear();
        residuals.reserve(calibration_count);
        double objective = 0.0;
        for (std::size_t index = 0; index < observations.size(); ++index)
        {
            if (observations[index].role != ObservationRole::calibration)
            {
                continue;
            }
            const auto residual = (predictions[index] - observations[index].measured_velocity_mps) /
                observations[index].standard_deviation_mps;
            residuals.push_back(residual);
            objective += residual * residual;
        }
        if (all_predictions)
        {
            *all_predictions = std::move(predictions);
        }
        return objective;
    };

    std::vector<double> residuals;
    auto objective = evaluate(parameters, residuals);
    if (!std::isfinite(objective))
    {
        result.status = CalibrationStatus::solver_failure;
        return result;
    }

    auto lambda = 1e-3;
    bool converged = false;
    for (std::size_t iteration = 0; iteration < maximum_iterations; ++iteration)
    {
        result.iterations = iteration + 1;
        Matrix jacobian(calibration_count, std::vector<double>(parameters.size()));
        bool derivative_failed = false;
        for (std::size_t parameter = 0; parameter < parameters.size(); ++parameter)
        {
            auto higher = parameters;
            auto lower = parameters;
            higher[parameter] = std::min(log_maximum, higher[parameter] + finite_difference_step);
            lower[parameter] = std::max(log_minimum, lower[parameter] - finite_difference_step);
            std::vector<double> higher_residuals;
            std::vector<double> lower_residuals;
            const auto higher_objective = evaluate(higher, higher_residuals);
            const auto lower_objective = evaluate(lower, lower_residuals);
            const auto span = higher[parameter] - lower[parameter];
            if (!std::isfinite(higher_objective) || !std::isfinite(lower_objective) || span <= 0.0)
            {
                derivative_failed = true;
                break;
            }
            for (std::size_t row = 0; row < calibration_count; ++row)
            {
                jacobian[row][parameter] = (higher_residuals[row] - lower_residuals[row]) / span;
            }
        }
        if (derivative_failed)
        {
            result.status = CalibrationStatus::solver_failure;
            return result;
        }

        Matrix normal(parameters.size(), std::vector<double>(parameters.size()));
        std::vector<double> gradient(parameters.size());
        for (std::size_t row = 0; row < calibration_count; ++row)
        {
            for (std::size_t first = 0; first < parameters.size(); ++first)
            {
                gradient[first] += jacobian[row][first] * residuals[row];
                for (std::size_t second = 0; second < parameters.size(); ++second)
                {
                    normal[first][second] += jacobian[row][first] * jacobian[row][second];
                }
            }
        }
        const auto maximum_gradient = std::max_element(
            gradient.begin(),
            gradient.end(),
            [](double first, double second) { return std::abs(first) < std::abs(second); }
        );
        if (maximum_gradient != gradient.end() && std::abs(*maximum_gradient) < 1e-10)
        {
            converged = true;
            break;
        }

        bool accepted = false;
        bool step_below_resolution = false;
        std::vector<double> accepted_delta;
        auto accepted_objective = objective;
        std::vector<double> accepted_residuals;
        for (int attempt = 0; attempt < 8; ++attempt)
        {
            auto damped = normal;
            for (std::size_t index = 0; index < damped.size(); ++index)
            {
                damped[index][index] += lambda * std::max(normal[index][index], 1e-9);
            }
            std::vector<double> negative_gradient(gradient.size());
            std::transform(
                gradient.begin(),
                gradient.end(),
                negative_gradient.begin(),
                [](double value) { return -value; }
            );
            std::vector<double> delta;
            if (!solve_linear_system(damped, negative_gradient, delta))
            {
                lambda *= 10.0;
                continue;
            }
            const auto maximum_trial_delta = *std::max_element(
                delta.begin(),
                delta.end(),
                [](double first, double second) { return std::abs(first) < std::abs(second); }
            );
            step_below_resolution = std::abs(maximum_trial_delta) < 1e-7;
            auto trial = parameters;
            for (std::size_t index = 0; index < trial.size(); ++index)
            {
                trial[index] = std::clamp(trial[index] + delta[index], log_minimum, log_maximum);
            }
            std::vector<double> trial_residuals;
            const auto trial_objective = evaluate(trial, trial_residuals);
            if (std::isfinite(trial_objective) && trial_objective < objective)
            {
                parameters = std::move(trial);
                accepted_delta = std::move(delta);
                accepted_objective = trial_objective;
                accepted_residuals = std::move(trial_residuals);
                accepted = true;
                lambda = std::max(lambda / 3.0, 1e-12);
                break;
            }
            lambda *= 10.0;
        }
        if (!accepted)
        {
            if (step_below_resolution)
            {
                converged = true;
                break;
            }
            if (lambda > 1e14)
            {
                break;
            }
            continue;
        }

        const auto improvement = objective - accepted_objective;
        objective = accepted_objective;
        residuals = std::move(accepted_residuals);
        const auto maximum_delta = *std::max_element(
            accepted_delta.begin(),
            accepted_delta.end(),
            [](double first, double second) { return std::abs(first) < std::abs(second); }
        );
        if (std::abs(maximum_delta) < 1e-7 || improvement < 1e-10 * (1.0 + objective))
        {
            converged = true;
            break;
        }
    }
    result.status =
        converged ? CalibrationStatus::converged : CalibrationStatus::maximum_iterations;

    std::vector<double> predictions;
    objective = evaluate(parameters, residuals, &predictions);
    if (!std::isfinite(objective))
    {
        result.status = CalibrationStatus::solver_failure;
        return result;
    }

    double calibration_squared_error = 0.0;
    double holdout_squared_error = 0.0;
    std::size_t holdout_count = 0;
    result.residuals.reserve(observations.size());
    for (std::size_t index = 0; index < observations.size(); ++index)
    {
        const auto residual = predictions[index] - observations[index].measured_velocity_mps;
        result.residuals.push_back(
            { observations[index].distance_m,
              observations[index].measured_velocity_mps,
              predictions[index],
              residual,
              residual / observations[index].standard_deviation_mps,
              observations[index].standard_deviation_mps,
              observations[index].role }
        );
        if (observations[index].role == ObservationRole::calibration)
        {
            calibration_squared_error += residual * residual;
        }
        else
        {
            holdout_squared_error += residual * residual;
            ++holdout_count;
        }
    }
    result.calibration_rmse_mps =
        std::sqrt(calibration_squared_error / static_cast<double>(calibration_count));
    result.weighted_rmse = std::sqrt(objective / static_cast<double>(calibration_count));
    if (holdout_count > 0)
    {
        result.holdout_rmse_mps =
            std::sqrt(holdout_squared_error / static_cast<double>(holdout_count));
    }
    const auto degrees_of_freedom = calibration_count - parameters.size();
    result.reduced_chi_square =
        degrees_of_freedom > 0 ? objective / static_cast<double>(degrees_of_freedom) : 0.0;

    Matrix final_jacobian(calibration_count, std::vector<double>(parameters.size()));
    bool final_derivative_valid = true;
    for (std::size_t parameter = 0; parameter < parameters.size(); ++parameter)
    {
        auto higher = parameters;
        auto lower = parameters;
        higher[parameter] = std::min(log_maximum, higher[parameter] + finite_difference_step);
        lower[parameter] = std::max(log_minimum, lower[parameter] - finite_difference_step);
        std::vector<double> higher_residuals;
        std::vector<double> lower_residuals;
        const auto higher_objective = evaluate(higher, higher_residuals);
        const auto lower_objective = evaluate(lower, lower_residuals);
        const auto span = higher[parameter] - lower[parameter];
        if (!std::isfinite(higher_objective) || !std::isfinite(lower_objective) || span <= 0.0)
        {
            final_derivative_valid = false;
            break;
        }
        for (std::size_t row = 0; row < calibration_count; ++row)
        {
            final_jacobian[row][parameter] = (higher_residuals[row] - lower_residuals[row]) / span;
        }
    }
    Matrix final_normal(parameters.size(), std::vector<double>(parameters.size()));
    if (final_derivative_valid)
    {
        for (std::size_t row = 0; row < calibration_count; ++row)
        {
            for (std::size_t first = 0; first < parameters.size(); ++first)
            {
                for (std::size_t second = 0; second < parameters.size(); ++second)
                {
                    final_normal[first][second] +=
                        final_jacobian[row][first] * final_jacobian[row][second];
                }
            }
        }
    }
    Matrix covariance;
    const auto covariance_valid =
        degrees_of_freedom > 0 && final_derivative_valid && invert_matrix(final_normal, covariance);
    if (!covariance_valid)
    {
        result.status = CalibrationStatus::insufficient_information;
    }

    const auto variance_scale = std::max(1.0, result.reduced_chi_square);
    result.estimates.reserve(parameters.size());
    for (std::size_t index = 0; index < parameters.size(); ++index)
    {
        BallisticCoefficientEstimate estimate;
        estimate.minimum_velocity_mps = thresholds[index];
        estimate.ballistic_coefficient = std::exp(parameters[index]);
        if (covariance_valid && covariance[index][index] >= 0.0 &&
            std::isfinite(covariance[index][index]))
        {
            const auto standard_error = std::sqrt(covariance[index][index] * variance_scale);
            estimate.confidence_95_low = std::clamp(
                std::exp(parameters[index] - 1.959963984540054 * standard_error),
                minimum_bc,
                maximum_bc
            );
            estimate.confidence_95_high = std::clamp(
                std::exp(parameters[index] + 1.959963984540054 * standard_error),
                minimum_bc,
                maximum_bc
            );
        }
        result.estimates.push_back(estimate);
    }
    return result;
}

} // namespace ballistics
