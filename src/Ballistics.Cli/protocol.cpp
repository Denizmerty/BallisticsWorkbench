#include "protocol.hpp"

#include "generated_protocol_structure.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <set>
#include <sstream>
#include <string>
#include <utility>

#include "json.hpp"

namespace ballistics::protocol
{
namespace
{

using Object = json::Value::Object;

bool safe_identifier(
    std::string_view value
)
{
    return std::all_of(
        value.begin(),
        value.end(),
        [](char character)
        {
            const auto byte = static_cast<unsigned char>(character);
            return std::isalnum(byte) != 0 || character == '-' || character == '_' ||
                character == '.' || character == ':';
        }
    );
}

class RequestReader
{
  public:
    explicit RequestReader(
        const json::Value& root
    )
        : root_(root)
    {
    }

    [[nodiscard]] RequestParseResult read()
    {
        RequestParseResult result;
        if (!root_.is_object())
        {
            issue("protocol.request.object", "$", "The protocol request must be a JSON object.");
            result.issues = std::move(issues_);
            return result;
        }

        const auto& root = root_.as_object();
        Request request;
        const auto operation = root.find("operation");
        if (operation != root.end())
        {
            if (!operation->second.is_string())
            {
                issue("protocol.field.string", "operation", "Field must be a JSON string.");
            }
            else if (operation->second.as_string() == "calibrateReferenceBc")
            {
                request.operation = RequestOperation::calibrate_reference_bc;
            }
            else
            {
                issue(
                    "validation.enum",
                    "operation",
                    "Operation must be calibrateReferenceBc when specified."
                );
            }
        }
        if (request.operation == RequestOperation::calibrate_reference_bc)
        {
            reject_unknown(root, generated::calibration_root_fields, "$.");
        }
        else
        {
            reject_unknown(root, generated::calculation_root_fields, "$.");
        }

        const auto protocol_version = number(root, "protocolVersion", "protocolVersion");
        if (protocol_version && *protocol_version != current_version)
        {
            issue(
                "protocol.version.unsupported",
                "protocolVersion",
                "Unsupported protocol version. Expected version " +
                    std::to_string(current_version) + "."
            );
        }
        else if (protocol_version)
        {
            request.protocol_version = static_cast<int>(*protocol_version);
        }

        if (const auto id = text(root, "requestId", "requestId"))
        {
            request.request_id = *id;
            request_id_ = *id;
            if (id->empty() || id->size() > 128)
            {
                issue(
                    "protocol.request_id.length",
                    "requestId",
                    "Request ID must contain between 1 and 128 bytes."
                );
            }
            if (!safe_identifier(*id))
            {
                issue(
                    "protocol.request_id.characters",
                    "requestId",
                    "Request ID contains unsupported characters."
                );
            }
        }

        if (request.operation == RequestOperation::calibrate_reference_bc)
        {
            read_calibration(root, request.calibration);
        }
        else
        {
            if (const auto* scenario_value = member(root, "scenario", "scenario"))
            {
                if (!scenario_value->is_object())
                {
                    issue("protocol.field.object", "scenario", "Scenario must be a JSON object.");
                }
                else
                {
                    read_scenario(scenario_value->as_object(), request.scenario);
                }
            }
            if (const auto* custom_value = member(root, "customLoads", "customLoads"))
            {
                if (!custom_value->is_array())
                {
                    issue(
                        "protocol.field.array",
                        "customLoads",
                        "Custom loads must be a JSON array."
                    );
                }
                else
                {
                    read_custom_loads(custom_value->as_array(), request.custom_loads);
                }
            }
            validate_buckshot_pattern_load(request);
        }

        result.request_id = request_id_;
        result.issues = std::move(issues_);
        if (result.issues.empty())
        {
            result.request = std::move(request);
        }
        return result;
    }

  private:
    const json::Value& root_;
    std::string request_id_;
    std::vector<ValidationIssue> issues_;

    void issue(
        std::string code,
        std::string field,
        std::string message
    )
    {
        issues_.push_back(
            { std::move(code), std::move(field), std::move(message), ValidationSeverity::error }
        );
    }

    const json::Value* member(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto found = object.find(key);
        if (found == object.end())
        {
            issue("protocol.field.required", std::move(field), "Required field is missing.");
            return nullptr;
        }
        return &found->second;
    }

    std::optional<double> number(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto* value = member(object, key, field);
        if (!value)
        {
            return std::nullopt;
        }
        if (!value->is_number())
        {
            issue("protocol.field.number", std::move(field), "Field must be a finite JSON number.");
            return std::nullopt;
        }
        return value->as_number();
    }

    std::optional<double> optional_number(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto found = object.find(key);
        if (found == object.end())
        {
            return std::nullopt;
        }
        if (!found->second.is_number())
        {
            issue("protocol.field.number", std::move(field), "Field must be a finite JSON number.");
            return std::nullopt;
        }
        return found->second.as_number();
    }

    std::optional<bool> optional_boolean(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto found = object.find(key);
        if (found == object.end())
        {
            return std::nullopt;
        }
        if (!found->second.is_bool())
        {
            issue("protocol.field.boolean", std::move(field), "Field must be a JSON boolean.");
            return std::nullopt;
        }
        return found->second.as_bool();
    }

    std::optional<std::string> optional_text(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto found = object.find(key);
        if (found == object.end())
        {
            return std::nullopt;
        }
        if (!found->second.is_string())
        {
            issue("protocol.field.string", std::move(field), "Field must be a JSON string.");
            return std::nullopt;
        }
        return found->second.as_string();
    }

    std::optional<std::string> text(
        const Object& object,
        std::string_view key,
        std::string field
    )
    {
        const auto* value = member(object, key, field);
        if (!value)
        {
            return std::nullopt;
        }
        if (!value->is_string())
        {
            issue("protocol.field.string", std::move(field), "Field must be a JSON string.");
            return std::nullopt;
        }
        return value->as_string();
    }

    void range(
        std::optional<double> value,
        double minimum,
        double maximum,
        std::string field,
        const std::string& label,
        double& output
    )
    {
        if (!value)
        {
            return;
        }
        if (!std::isfinite(*value) || *value < minimum || *value > maximum)
        {
            issue(
                "validation.range",
                std::move(field),
                label + " must be between " + compact_number(minimum) + " and " +
                    compact_number(maximum) + "."
            );
            return;
        }
        output = *value;
    }

    static std::string compact_number(
        double value
    )
    {
        std::ostringstream output;
        output << std::setprecision(15) << value;
        return output.str();
    }

    void reject_unknown(
        const Object& object,
        std::initializer_list<std::string_view> allowed,
        std::string_view prefix
    )
    {
        for (const auto& [key, value] : object)
        {
            static_cast<void>(value);
            if (std::find(allowed.begin(), allowed.end(), key) == allowed.end())
            {
                issue(
                    "protocol.field.unknown",
                    std::string(prefix) + key,
                    "Unknown protocol field."
                );
            }
        }
    }

    template <std::size_t Size>
    void reject_unknown(
        const Object& object,
        const std::array<std::string_view, Size>& allowed,
        std::string_view prefix
    )
    {
        for (const auto& [key, value] : object)
        {
            static_cast<void>(value);
            if (std::find(allowed.begin(), allowed.end(), key) == allowed.end())
            {
                issue(
                    "protocol.field.unknown",
                    std::string(prefix) + key,
                    "Unknown protocol field."
                );
            }
        }
    }

    void read_calibration(
        const Object& root,
        CalibrationRequest& calibration
    )
    {
        calibration.projectile.provenance.id = "calibration:projectile";
        calibration.projectile.provenance.drag_description = "calibration initial reference BC";
        calibration.projectile.definition.name = "Calibration projectile";
        calibration.projectile.definition.short_name = "Calibration projectile";
        calibration.projectile.firearm.group = FirearmGroup::rifle;
        auto calibration_curve = ReferenceDragCurve::g1;
        double initial_ballistic_coefficient = 0.0;

        if (const auto* atmosphere = member(root, "atmosphere", "atmosphere"))
        {
            if (!atmosphere->is_object())
            {
                issue("protocol.field.object", "atmosphere", "Atmosphere must be a JSON object.");
            }
            else
            {
                const auto& object = atmosphere->as_object();
                reject_unknown(object, generated::calibration_atmosphere_fields, "atmosphere.");
                range(
                    number(object, "temperatureC", "atmosphere.temperatureC"),
                    -60,
                    60,
                    "atmosphere.temperatureC",
                    "Temperature (C)",
                    calibration.temperature_c
                );
                range(
                    number(object, "stationPressureHpa", "atmosphere.stationPressureHpa"),
                    500,
                    1100,
                    "atmosphere.stationPressureHpa",
                    "Station pressure (hPa)",
                    calibration.pressure_hpa
                );
                range(
                    number(object, "relativeHumidityPercent", "atmosphere.relativeHumidityPercent"),
                    0,
                    100,
                    "atmosphere.relativeHumidityPercent",
                    "Relative humidity (%)",
                    calibration.humidity_percent
                );
                range(
                    number(object, "headwindMps", "atmosphere.headwindMps"),
                    -100,
                    100,
                    "atmosphere.headwindMps",
                    "Headwind (m/s)",
                    calibration.headwind_mps
                );
                range(
                    number(object, "crosswindMps", "atmosphere.crosswindMps"),
                    -100,
                    100,
                    "atmosphere.crosswindMps",
                    "Crosswind (m/s)",
                    calibration.crosswind_mps
                );
            }
        }

        if (const auto* projectile = member(root, "projectile", "projectile"))
        {
            if (!projectile->is_object())
            {
                issue(
                    "protocol.field.object",
                    "projectile",
                    "Calibration projectile must be an object."
                );
            }
            else
            {
                const auto& object = projectile->as_object();
                reject_unknown(object, generated::calibration_projectile_fields, "projectile.");
                if (const auto curve = text(object, "curve", "projectile.curve"))
                {
                    if (*curve == "G1")
                    {
                        calibration_curve = ReferenceDragCurve::g1;
                    }
                    else if (*curve == "G7")
                    {
                        calibration_curve = ReferenceDragCurve::g7;
                    }
                    else
                    {
                        issue(
                            "validation.enum",
                            "projectile.curve",
                            "Calibration curve must be G1 or G7."
                        );
                    }
                }
                range(
                    number(object, "massKg", "projectile.massKg"),
                    1e-6,
                    10.0,
                    "projectile.massKg",
                    "Projectile mass (kg)",
                    calibration.projectile.definition.mass_kg
                );
                range(
                    number(object, "muzzleVelocityMps", "projectile.muzzleVelocityMps"),
                    1,
                    2000,
                    "projectile.muzzleVelocityMps",
                    "Muzzle velocity (m/s)",
                    calibration.projectile.ammunition.muzzle_velocity_mps
                );
                range(
                    number(
                        object,
                        "initialBallisticCoefficient",
                        "projectile.initialBallisticCoefficient"
                    ),
                    0.005,
                    2,
                    "projectile.initialBallisticCoefficient",
                    "Initial ballistic coefficient",
                    initial_ballistic_coefficient
                );
            }
        }
        calibration.projectile.definition.drag = ReferenceBcDrag {
            calibration_curve,
            ConstantBallisticCoefficient { initial_ballistic_coefficient }
        };

        if (const auto* fit = member(root, "fit", "fit"))
        {
            if (!fit->is_object())
            {
                issue(
                    "protocol.field.object",
                    "fit",
                    "Calibration fit definition must be an object."
                );
            }
            else
            {
                read_calibration_fit(fit->as_object(), calibration);
            }
        }
        if (const auto* observations = member(root, "observations", "observations"))
        {
            if (!observations->is_array())
            {
                issue("protocol.field.array", "observations", "Observations must be a JSON array.");
            }
            else
            {
                read_calibration_observations(observations->as_array(), calibration);
            }
        }
    }

    void read_calibration_fit(
        const Object& object,
        CalibrationRequest& calibration
    )
    {
        const auto kind = text(object, "kind", "fit.kind");
        if (!kind)
        {
            return;
        }
        if (*kind == "constant")
        {
            reject_unknown(object, generated::calibration_constant_fit_fields, "fit.");
            calibration.fit_kind = BcFitKind::constant;
            return;
        }
        if (*kind != "velocityBands")
        {
            reject_unknown(object, generated::calibration_velocity_bands_fit_fields, "fit.");
            issue("validation.enum", "fit.kind", "Fit kind must be constant or velocityBands.");
            return;
        }
        reject_unknown(object, generated::calibration_velocity_bands_fit_fields, "fit.");
        calibration.fit_kind = BcFitKind::velocity_bands;
        const auto* thresholds = member(object, "minimumVelocitiesMps", "fit.minimumVelocitiesMps");
        if (!thresholds || !thresholds->is_array())
        {
            if (thresholds)
            {
                issue(
                    "protocol.field.array",
                    "fit.minimumVelocitiesMps",
                    "Band thresholds must be a JSON array."
                );
            }
            return;
        }
        const auto& values = thresholds->as_array();
        if (values.size() < 2 || values.size() > 4)
        {
            issue(
                "calibration.fit.band_count",
                "fit.minimumVelocitiesMps",
                "Velocity-banded calibration requires between 2 and 4 thresholds."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 4);
        calibration.band_minimum_velocities_mps.reserve(count);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto field = "fit.minimumVelocitiesMps[" + std::to_string(index) + "]";
            if (!values[index].is_number())
            {
                issue(
                    "protocol.field.number",
                    field,
                    "Band threshold must be a finite JSON number."
                );
                calibration.band_minimum_velocities_mps.push_back(0.0);
                continue;
            }
            const auto value = values[index].as_number();
            calibration.band_minimum_velocities_mps.push_back(value);
            if (value < 0.0 || value > 2000.0)
            {
                issue(
                    "calibration.fit.band_range",
                    field,
                    "Band threshold must be between 0 and 2000 m/s."
                );
            }
            if (index == 0 && value != 0.0)
            {
                issue(
                    "calibration.fit.band_coverage",
                    field,
                    "The first calibration band must begin at 0 m/s."
                );
            }
            if (index > 0 && value <= calibration.band_minimum_velocities_mps[index - 1])
            {
                issue(
                    "calibration.fit.band_order",
                    field,
                    "Calibration band thresholds must be strictly increasing."
                );
            }
        }
    }

    void read_calibration_observations(
        const json::Value::Array& values,
        CalibrationRequest& calibration
    )
    {
        if (values.empty() || values.size() > 32)
        {
            issue(
                "calibration.observations.count",
                "observations",
                "Calibration requires between 1 and 32 observations."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 32);
        calibration.observations.reserve(count);
        double previous_distance = -1.0;
        std::size_t calibration_count = 0;
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto path = "observations[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", path, "Observation must be a JSON object.");
                continue;
            }
            const auto& object = values[index].as_object();
            reject_unknown(object, generated::calibration_observation_fields, path + ".");
            VelocityObservation observation;
            range(
                number(object, "distanceM", path + ".distanceM"),
                0.000001,
                2000,
                path + ".distanceM",
                "Observation distance (m)",
                observation.distance_m
            );
            range(
                number(object, "velocityMps", path + ".velocityMps"),
                1,
                2000,
                path + ".velocityMps",
                "Observed velocity (m/s)",
                observation.measured_velocity_mps
            );
            range(
                number(object, "standardDeviationMps", path + ".standardDeviationMps"),
                0.01,
                200,
                path + ".standardDeviationMps",
                "Velocity standard deviation (m/s)",
                observation.standard_deviation_mps
            );
            if (const auto role = text(object, "role", path + ".role"))
            {
                if (*role == "calibration")
                {
                    observation.role = ObservationRole::calibration;
                    ++calibration_count;
                }
                else if (*role == "holdout")
                {
                    observation.role = ObservationRole::holdout;
                }
                else
                {
                    issue(
                        "validation.enum",
                        path + ".role",
                        "Observation role must be calibration or holdout."
                    );
                }
            }
            if (observation.distance_m <= previous_distance)
            {
                issue(
                    "calibration.observations.order",
                    path + ".distanceM",
                    "Observation distances must be strictly increasing."
                );
            }
            previous_distance = observation.distance_m;
            calibration.observations.push_back(observation);
        }
        const auto parameter_count = calibration.fit_kind == BcFitKind::constant
            ? std::size_t { 1 }
            : calibration.band_minimum_velocities_mps.size();
        if (calibration_count < parameter_count)
        {
            issue(
                "calibration.observations.insufficient",
                "observations",
                "Provide at least as many calibration observations as fitted coefficients. Holdout "
                "points do not count toward fitting."
            );
        }
    }

    void read_scenario(
        const Object& object,
        Scenario& scenario
    )
    {
        reject_unknown(object, generated::scenario_fields, "scenario.");
        range(
            number(object, "displayDistanceM", "scenario.displayDistanceM"),
            0,
            2000,
            "scenario.displayDistanceM",
            "Display distance (m)",
            scenario.display_distance_m
        );
        range(
            number(object, "solutionHorizonM", "scenario.solutionHorizonM"),
            100,
            2000,
            "scenario.solutionHorizonM",
            "Solution horizon (m)",
            scenario.solution_horizon_m
        );
        range(
            number(object, "vitalZoneM", "scenario.vitalZoneM"),
            0.01,
            2,
            "scenario.vitalZoneM",
            "Vital zone (m)",
            scenario.vital_zone_m
        );
        if (scenario.solution_horizon_m + 1e-9 < scenario.display_distance_m)
        {
            issue(
                "scenario.horizon.short",
                "scenario.solutionHorizonM",
                "Solution horizon cannot be shorter than the display distance."
            );
        }

        const auto geometry = object.find("geometry");
        if (geometry != object.end())
        {
            if (!geometry->second.is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.geometry",
                    "Shot geometry must be a JSON object."
                );
            }
            else
            {
                read_shot_geometry(geometry->second.as_object(), scenario);
            }
        }

        if (const auto* value = member(object, "atmosphere", "scenario.atmosphere"))
        {
            if (!value->is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.atmosphere",
                    "Atmosphere must be a JSON object."
                );
            }
            else
            {
                read_atmosphere(value->as_object(), scenario);
            }
        }
        if (const auto* value = member(object, "firearms", "scenario.firearms"))
        {
            if (!value->is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.firearms",
                    "Firearms must be a JSON object."
                );
            }
            else
            {
                read_firearms(value->as_object(), scenario);
            }
        }
        const auto uncertainty = object.find("uncertainty");
        if (uncertainty != object.end())
        {
            if (!uncertainty->second.is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.uncertainty",
                    "Uncertainty configuration must be a JSON object."
                );
            }
            else
            {
                scenario.uncertainty.emplace();
                read_uncertainty(uncertainty->second.as_object(), *scenario.uncertainty);
            }
        }
        const auto buckshot_pattern = object.find("buckshotPattern");
        if (buckshot_pattern != object.end())
        {
            if (!buckshot_pattern->second.is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.buckshotPattern",
                    "Buckshot pattern configuration must be a JSON object."
                );
            }
            else
            {
                scenario.buckshot_pattern.emplace();
                read_buckshot_pattern(
                    buckshot_pattern->second.as_object(),
                    *scenario.buckshot_pattern
                );
            }
        }
    }

    void read_buckshot_pattern(
        const Object& object,
        BuckshotPatternConfiguration& configuration
    )
    {
        const std::string prefix = "scenario.buckshotPattern";
        reject_unknown(object, generated::buckshot_pattern_fields, prefix + ".");
        if (const auto load_id = text(object, "loadId", prefix + ".loadId"))
        {
            configuration.load_id = *load_id;
            if (load_id->empty() || load_id->size() > 128 || !safe_identifier(*load_id))
            {
                issue(
                    "scenario.buckshot_pattern.load_id",
                    prefix + ".loadId",
                    "Pattern load ID must be a safe identifier of at most 128 bytes."
                );
            }
        }
        if (const auto choke = text(object, "choke", prefix + ".choke"))
        {
            if (*choke == "cylinder")
                configuration.input.choke = ChokeClass::cylinder;
            else if (*choke == "improvedCylinder")
                configuration.input.choke = ChokeClass::improved_cylinder;
            else if (*choke == "modified")
                configuration.input.choke = ChokeClass::modified;
            else if (*choke == "full")
                configuration.input.choke = ChokeClass::full;
            else if (*choke == "custom")
                configuration.input.choke = ChokeClass::custom;
            else
                issue(
                    "validation.enum",
                    prefix + ".choke",
                    "Choke must be cylinder, improvedCylinder, modified, full, or custom."
                );
        }
        if (const auto deformation = text(object, "deformationClass", prefix + ".deformationClass"))
        {
            if (*deformation == "softLead")
                configuration.input.deformation = PelletDeformationClass::soft_lead;
            else if (*deformation == "hardenedLead")
                configuration.input.deformation = PelletDeformationClass::hardened_lead;
            else if (*deformation == "plated")
                configuration.input.deformation = PelletDeformationClass::plated;
            else if (*deformation == "buffered")
                configuration.input.deformation = PelletDeformationClass::buffered;
            else if (*deformation == "unknown")
                configuration.input.deformation = PelletDeformationClass::unknown;
            else
                issue(
                    "validation.enum",
                    prefix + ".deformationClass",
                    "Pellet deformation class is not recognized."
                );
        }
        range(
            number(
                object,
                "pelletVelocityStandardDeviationMps",
                prefix + ".pelletVelocityStandardDeviationMps"
            ),
            0,
            200,
            prefix + ".pelletVelocityStandardDeviationMps",
            "Pellet velocity standard deviation (m/s)",
            configuration.input.pellet_velocity_standard_deviation_mps
        );
        range(
            number(object, "targetRangeM", prefix + ".targetRangeM"),
            0.001,
            200,
            prefix + ".targetRangeM",
            "Pattern target range (m)",
            configuration.input.target_range_m
        );
        if (const auto minimum =
                number(object, "minimumPelletCount", prefix + ".minimumPelletCount"))
        {
            if (*minimum != std::floor(*minimum) || *minimum < 1.0 || *minimum > 1000.0)
            {
                issue(
                    "validation.integer_range",
                    prefix + ".minimumPelletCount",
                    "Minimum pellet count must be an integer between 1 and 1000."
                );
            }
            else
            {
                configuration.input.minimum_pellet_count = static_cast<std::size_t>(*minimum);
            }
        }
        read_buckshot_target(object, configuration.input.target, prefix);
        read_pattern_observations(object, configuration.input.observations, prefix);
    }

    void read_buckshot_target(
        const Object& parent,
        BuckshotTargetRegion& target,
        const std::string& prefix
    )
    {
        const auto* value = member(parent, "target", prefix + ".target");
        if (!value || !value->is_object())
        {
            if (value)
                issue(
                    "protocol.field.object",
                    prefix + ".target",
                    "Buckshot target must be an object."
                );
            return;
        }
        const auto& object = value->as_object();
        reject_unknown(object, generated::buckshot_target_fields, prefix + ".target.");
        if (const auto shape = text(object, "shape", prefix + ".target.shape"))
        {
            if (*shape == "circle")
                target.shape = TargetRegionShape::circle;
            else if (*shape == "rectangle")
                target.shape = TargetRegionShape::rectangle;
            else
                issue(
                    "validation.enum",
                    prefix + ".target.shape",
                    "Target shape must be circle or rectangle."
                );
        }
        range(
            number(object, "widthM", prefix + ".target.widthM"),
            0.001,
            10,
            prefix + ".target.widthM",
            "Target width (m)",
            target.width_m
        );
        range(
            number(object, "heightM", prefix + ".target.heightM"),
            0.001,
            10,
            prefix + ".target.heightM",
            "Target height (m)",
            target.height_m
        );
        range(
            number(object, "centerHorizontalM", prefix + ".target.centerHorizontalM"),
            -10,
            10,
            prefix + ".target.centerHorizontalM",
            "Target horizontal offset (m)",
            target.center_horizontal_m
        );
        range(
            number(object, "centerVerticalM", prefix + ".target.centerVerticalM"),
            -10,
            10,
            prefix + ".target.centerVerticalM",
            "Target vertical offset (m)",
            target.center_vertical_m
        );
    }

    void read_pattern_observations(
        const Object& parent,
        std::vector<PatternObservation>& observations,
        const std::string& prefix
    )
    {
        const auto* value = member(parent, "observations", prefix + ".observations");
        if (!value || !value->is_array())
        {
            if (value)
                issue(
                    "protocol.field.array",
                    prefix + ".observations",
                    "Pattern observations must be an array."
                );
            return;
        }
        if (value->as_array().size() < 3 || value->as_array().size() > 64)
        {
            issue(
                "scenario.buckshot_pattern.observations.count",
                prefix + ".observations",
                "Provide between 3 and 64 pattern observations."
            );
        }
        const auto count = std::min<std::size_t>(value->as_array().size(), 64);
        std::size_t calibration_count = 0;
        std::size_t holdout_count = 0;
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto path = prefix + ".observations[" + std::to_string(index) + "]";
            if (!value->as_array()[index].is_object())
            {
                issue("protocol.field.object", path, "Pattern observation must be an object.");
                continue;
            }
            const auto& object = value->as_array()[index].as_object();
            reject_unknown(object, generated::pattern_observation_fields, path + ".");
            PatternObservation observation;
            range(
                number(object, "rangeM", path + ".rangeM"),
                0.001,
                200,
                path + ".rangeM",
                "Observation range (m)",
                observation.range_m
            );
            range(
                number(object, "diameter90M", path + ".diameter90M"),
                0.001,
                20,
                path + ".diameter90M",
                "D90 pattern diameter (m)",
                observation.diameter_90_m
            );
            range(
                number(object, "standardUncertaintyM", path + ".standardUncertaintyM"),
                0.000001,
                5,
                path + ".standardUncertaintyM",
                "Pattern-diameter standard uncertainty (m)",
                observation.standard_uncertainty_m
            );
            if (const auto shell_count = number(object, "shellCount", path + ".shellCount"))
            {
                if (*shell_count != std::floor(*shell_count) || *shell_count < 1.0 ||
                    *shell_count > 1000.0)
                {
                    issue(
                        "validation.integer_range",
                        path + ".shellCount",
                        "Shell count must be an integer between 1 and 1000."
                    );
                }
                else
                {
                    observation.shell_count = static_cast<std::size_t>(*shell_count);
                }
            }
            if (const auto role = text(object, "role", path + ".role"))
            {
                if (*role == "calibration")
                {
                    observation.role = ObservationRole::calibration;
                    ++calibration_count;
                }
                else if (*role == "holdout")
                {
                    observation.role = ObservationRole::holdout;
                    ++holdout_count;
                }
                else
                {
                    issue(
                        "validation.enum",
                        path + ".role",
                        "Observation role must be calibration or holdout."
                    );
                }
            }
            observations.push_back(observation);
        }
        if (calibration_count < 2 || holdout_count < 1)
        {
            issue(
                "scenario.buckshot_pattern.evidence_split",
                prefix + ".observations",
                "Buckshot analysis requires at least two calibration observations and one "
                "physically separate holdout observation."
            );
        }
    }

    void validate_buckshot_pattern_load(
        const Request& request
    )
    {
        if (!request.scenario.buckshot_pattern)
        {
            return;
        }
        auto loads = built_in_projectiles();
        loads.insert(loads.end(), request.custom_loads.begin(), request.custom_loads.end());
        const auto& configuration = *request.scenario.buckshot_pattern;
        const auto found = std::find_if(
            loads.begin(),
            loads.end(),
            [&](const Projectile& load) { return load.provenance.id == configuration.load_id; }
        );
        if (found == loads.end())
        {
            issue(
                "scenario.buckshot_pattern.load_missing",
                "scenario.buckshotPattern.loadId",
                "Pattern analysis load ID does not identify an active load."
            );
            return;
        }
        if (found->firearm.group != FirearmGroup::shotgun)
        {
            issue(
                "scenario.buckshot_pattern.load_group",
                "scenario.buckshotPattern.loadId",
                "Pattern analysis requires a shotgun load."
            );
        }
        if (configuration.input.minimum_pellet_count >
            static_cast<std::size_t>(found->ammunition.payload_count))
        {
            issue(
                "scenario.buckshot_pattern.minimum_count",
                "scenario.buckshotPattern.minimumPelletCount",
                "Minimum pellet count cannot exceed the selected load payload count."
            );
        }
        if (configuration.input.pellet_velocity_standard_deviation_mps >
            found->ammunition.muzzle_velocity_mps / 2.0)
        {
            issue(
                "scenario.buckshot_pattern.velocity_spread",
                "scenario.buckshotPattern.pelletVelocityStandardDeviationMps",
                "Pellet velocity standard deviation cannot exceed half the selected load muzzle "
                "velocity."
            );
        }
    }

    void read_shot_geometry(
        const Object& object,
        Scenario& scenario
    )
    {
        reject_unknown(object, generated::geometry_fields, "scenario.geometry.");
        if (const auto inclination = optional_number(
                object,
                "targetInclinationDeg",
                "scenario.geometry.targetInclinationDeg"
            ))
        {
            if (!std::isfinite(*inclination) || *inclination < -60.0 || *inclination > 60.0)
            {
                issue(
                    "validation.range",
                    "scenario.geometry.targetInclinationDeg",
                    "Target inclination must be between -60 and 60 degrees."
                );
            }
            else
            {
                scenario.target_inclination_rad = *inclination * std::acos(-1.0) / 180.0;
            }
        }
        range(
            optional_number(object, "targetElevationM", "scenario.geometry.targetElevationM"),
            -1732,
            1732,
            "scenario.geometry.targetElevationM",
            "Target elevation (m)",
            scenario.target_elevation_m
        );
        if (std::abs(scenario.target_inclination_rad) > 1e-12 &&
            std::abs(scenario.target_elevation_m) > 1e-12)
        {
            issue(
                "scenario.geometry.ambiguous",
                "scenario.geometry",
                "Specify target inclination or target elevation, not both."
            );
        }
        if (std::abs(scenario.target_elevation_m) > 1e-12 && scenario.display_distance_m <= 0.0)
        {
            issue(
                "scenario.geometry.zero_distance",
                "scenario.displayDistanceM",
                "Target elevation requires a positive display distance."
            );
        }
    }

    void read_uncertainty(
        const Object& object,
        UncertaintyConfiguration& uncertainty
    )
    {
        reject_unknown(object, generated::uncertainty_fields, "scenario.uncertainty.");
        if (const auto method = optional_text(object, "method", "scenario.uncertainty.method"))
        {
            if (*method == "firstOrder")
            {
                uncertainty.method = UncertaintyConfiguration::Method::first_order;
            }
            else if (*method == "monteCarlo")
            {
                uncertainty.method = UncertaintyConfiguration::Method::monte_carlo;
            }
            else
            {
                issue(
                    "validation.enum",
                    "scenario.uncertainty.method",
                    "Uncertainty method must be firstOrder or monteCarlo."
                );
            }
        }
        if (const auto samples =
                optional_number(object, "sampleCount", "scenario.uncertainty.sampleCount"))
        {
            if (*samples != std::floor(*samples) || *samples < 100.0 || *samples > 10000.0)
            {
                issue(
                    "validation.integer_range",
                    "scenario.uncertainty.sampleCount",
                    "Monte Carlo sample count must be an integer between 100 and 10000."
                );
            }
            else
            {
                uncertainty.monte_carlo_samples = static_cast<std::size_t>(*samples);
            }
        }
        if (const auto seed = optional_number(object, "seed", "scenario.uncertainty.seed"))
        {
            if (*seed != std::floor(*seed) || *seed < 0.0 || *seed > 9007199254740991.0)
            {
                issue(
                    "validation.integer_range",
                    "scenario.uncertainty.seed",
                    "Monte Carlo seed must be an integer between 0 and 2^53-1."
                );
            }
            else
            {
                uncertainty.monte_carlo_seed = static_cast<std::uint64_t>(*seed);
            }
        }
        const auto correlations = object.find("correlations");
        if (correlations != object.end())
        {
            if (!correlations->second.is_array())
            {
                issue(
                    "protocol.field.array",
                    "scenario.uncertainty.correlations",
                    "Uncertainty correlations must be a JSON array."
                );
            }
            else
            {
                read_uncertainty_correlations(
                    correlations->second.as_array(),
                    uncertainty.correlations
                );
            }
        }
        range(
            number(
                object,
                "shotgunMuzzleVelocityStandardDeviationMps",
                "scenario.uncertainty.shotgunMuzzleVelocityStandardDeviationMps"
            ),
            0,
            200,
            "scenario.uncertainty.shotgunMuzzleVelocityStandardDeviationMps",
            "Shotgun muzzle-velocity standard deviation (m/s)",
            uncertainty.shotgun_muzzle_velocity_standard_deviation_mps
        );
        range(
            number(
                object,
                "rifleMuzzleVelocityStandardDeviationMps",
                "scenario.uncertainty.rifleMuzzleVelocityStandardDeviationMps"
            ),
            0,
            200,
            "scenario.uncertainty.rifleMuzzleVelocityStandardDeviationMps",
            "Rifle muzzle-velocity standard deviation (m/s)",
            uncertainty.rifle_muzzle_velocity_standard_deviation_mps
        );
        range(
            number(
                object,
                "dragRelativeStandardDeviation",
                "scenario.uncertainty.dragRelativeStandardDeviation"
            ),
            0,
            1,
            "scenario.uncertainty.dragRelativeStandardDeviation",
            "Relative BC or drag standard deviation",
            uncertainty.drag_relative_standard_deviation
        );
        range(
            number(
                object,
                "temperatureStandardDeviationC",
                "scenario.uncertainty.temperatureStandardDeviationC"
            ),
            0,
            30,
            "scenario.uncertainty.temperatureStandardDeviationC",
            "Temperature standard deviation (C)",
            uncertainty.temperature_standard_deviation_c
        );
        range(
            number(
                object,
                "stationPressureStandardDeviationHpa",
                "scenario.uncertainty.stationPressureStandardDeviationHpa"
            ),
            0,
            200,
            "scenario.uncertainty.stationPressureStandardDeviationHpa",
            "Station-pressure standard deviation (hPa)",
            uncertainty.pressure_standard_deviation_hpa
        );
        range(
            number(
                object,
                "headwindStandardDeviationMps",
                "scenario.uncertainty.headwindStandardDeviationMps"
            ),
            0,
            50,
            "scenario.uncertainty.headwindStandardDeviationMps",
            "Headwind standard deviation (m/s)",
            uncertainty.headwind_standard_deviation_mps
        );
        range(
            number(
                object,
                "crosswindStandardDeviationMps",
                "scenario.uncertainty.crosswindStandardDeviationMps"
            ),
            0,
            50,
            "scenario.uncertainty.crosswindStandardDeviationMps",
            "Crosswind standard deviation (m/s)",
            uncertainty.crosswind_standard_deviation_mps
        );
        range(
            number(
                object,
                "shotgunZeroRangeStandardDeviationM",
                "scenario.uncertainty.shotgunZeroRangeStandardDeviationM"
            ),
            0,
            200,
            "scenario.uncertainty.shotgunZeroRangeStandardDeviationM",
            "Shotgun zero-range standard deviation (m)",
            uncertainty.shotgun_zero_range_standard_deviation_m
        );
        range(
            number(
                object,
                "rifleZeroRangeStandardDeviationM",
                "scenario.uncertainty.rifleZeroRangeStandardDeviationM"
            ),
            0,
            200,
            "scenario.uncertainty.rifleZeroRangeStandardDeviationM",
            "Rifle zero-range standard deviation (m)",
            uncertainty.rifle_zero_range_standard_deviation_m
        );
    }

    std::optional<UncertaintyVariable> uncertainty_variable(
        std::string_view name,
        const std::string& path
    )
    {
        if (name == "muzzleVelocity")
            return UncertaintyVariable::muzzle_velocity;
        if (name == "drag")
            return UncertaintyVariable::drag;
        if (name == "temperature")
            return UncertaintyVariable::temperature;
        if (name == "stationPressure")
            return UncertaintyVariable::pressure;
        if (name == "headwind")
            return UncertaintyVariable::headwind;
        if (name == "crosswind")
            return UncertaintyVariable::crosswind;
        if (name == "zeroRange")
            return UncertaintyVariable::zero_range;
        issue("validation.enum", path, "Uncertainty variable is not recognized.");
        return std::nullopt;
    }

    void read_uncertainty_correlations(
        const json::Value::Array& values,
        std::vector<UncertaintyCorrelation>& correlations
    )
    {
        if (values.size() > 21)
        {
            issue(
                "scenario.uncertainty.correlations.limit",
                "scenario.uncertainty.correlations",
                "At most 21 uncertainty correlations are supported."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 21);
        std::set<std::pair<std::size_t, std::size_t>> pairs;
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto path = "scenario.uncertainty.correlations[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", path, "Correlation must be a JSON object.");
                continue;
            }
            const auto& object = values[index].as_object();
            reject_unknown(object, generated::uncertainty_correlation_fields, path + ".");
            const auto first_name = text(object, "first", path + ".first");
            const auto second_name = text(object, "second", path + ".second");
            const auto coefficient = number(object, "coefficient", path + ".coefficient");
            const auto first =
                first_name ? uncertainty_variable(*first_name, path + ".first") : std::nullopt;
            const auto second =
                second_name ? uncertainty_variable(*second_name, path + ".second") : std::nullopt;
            if (!first || !second || !coefficient)
            {
                continue;
            }
            const auto first_value = first.value();
            const auto second_value = second.value();
            const auto coefficient_value = coefficient.value();
            if (first_value == second_value || !std::isfinite(coefficient_value) ||
                std::abs(coefficient_value) >= 1.0)
            {
                issue(
                    "scenario.uncertainty.correlation.invalid",
                    path,
                    "Correlation variables must differ and the coefficient must be between -1 "
                    "and 1, excluding the endpoints."
                );
                continue;
            }
            auto first_index = static_cast<std::size_t>(first_value);
            auto second_index = static_cast<std::size_t>(second_value);
            if (second_index < first_index)
                std::swap(first_index, second_index);
            if (!pairs.emplace(first_index, second_index).second)
            {
                issue(
                    "scenario.uncertainty.correlation.duplicate",
                    path,
                    "Each uncertainty-variable pair may be declared once."
                );
                continue;
            }
            correlations.push_back({ first_value, second_value, coefficient_value });
        }
    }

    void read_atmosphere(
        const Object& object,
        Scenario& scenario
    )
    {
        reject_unknown(object, generated::atmosphere_fields, "scenario.atmosphere.");
        range(
            number(object, "temperatureC", "scenario.atmosphere.temperatureC"),
            -60,
            60,
            "scenario.atmosphere.temperatureC",
            "Temperature (C)",
            scenario.temperature_c
        );
        range(
            number(object, "stationPressureHpa", "scenario.atmosphere.stationPressureHpa"),
            500,
            1100,
            "scenario.atmosphere.stationPressureHpa",
            "Station pressure (hPa)",
            scenario.pressure_hpa
        );
        range(
            number(
                object,
                "relativeHumidityPercent",
                "scenario.atmosphere.relativeHumidityPercent"
            ),
            0,
            100,
            "scenario.atmosphere.relativeHumidityPercent",
            "Relative humidity (%)",
            scenario.humidity_percent
        );
        range(
            number(object, "headwindMps", "scenario.atmosphere.headwindMps"),
            -100,
            100,
            "scenario.atmosphere.headwindMps",
            "Headwind (m/s)",
            scenario.headwind_mps
        );
        range(
            number(object, "crosswindMps", "scenario.atmosphere.crosswindMps"),
            -100,
            100,
            "scenario.atmosphere.crosswindMps",
            "Crosswind (m/s)",
            scenario.crosswind_mps
        );
        range(
            optional_number(object, "geometricAltitudeM", "scenario.atmosphere.geometricAltitudeM"),
            -1000,
            11000,
            "scenario.atmosphere.geometricAltitudeM",
            "Geometric altitude (m)",
            scenario.geometric_altitude_m
        );
        if (const auto value = optional_boolean(
                object,
                "altitudeDependent",
                "scenario.atmosphere.altitudeDependent"
            ))
        {
            scenario.altitude_dependent_atmosphere = *value;
        }
        if (const auto value =
                optional_boolean(object, "useLocalGravity", "scenario.atmosphere.useLocalGravity"))
        {
            scenario.use_local_gravity = *value;
        }
        if (const auto value =
                optional_boolean(object, "coriolisEnabled", "scenario.atmosphere.coriolisEnabled"))
        {
            scenario.coriolis_enabled = *value;
        }
        range(
            optional_number(object, "latitudeDeg", "scenario.atmosphere.latitudeDeg"),
            -90,
            90,
            "scenario.atmosphere.latitudeDeg",
            "Latitude (degrees)",
            scenario.latitude_deg
        );
        range(
            optional_number(object, "azimuthDeg", "scenario.atmosphere.azimuthDeg"),
            -360,
            360,
            "scenario.atmosphere.azimuthDeg",
            "Shot azimuth (degrees)",
            scenario.azimuth_deg
        );
        if (const auto value =
                optional_text(object, "windProvenance", "scenario.atmosphere.windProvenance"))
        {
            if (value->size() > 240)
            {
                issue(
                    "validation.length",
                    "scenario.atmosphere.windProvenance",
                    "Wind provenance must not exceed 240 bytes."
                );
            }
            scenario.wind_provenance = *value;
        }
        const auto layers = object.find("windLayers");
        if (layers != object.end())
        {
            if (!layers->second.is_array())
            {
                issue(
                    "protocol.field.array",
                    "scenario.atmosphere.windLayers",
                    "Wind layers must be a JSON array."
                );
            }
            else
            {
                read_wind_layers(layers->second.as_array(), scenario.wind_layers);
            }
        }
    }

    void read_wind_layers(
        const json::Value::Array& values,
        std::vector<WindLayer>& layers
    )
    {
        if (values.size() > 16)
        {
            issue(
                "scenario.wind_layers.limit",
                "scenario.atmosphere.windLayers",
                "At most 16 wind layers are supported."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 16);
        layers.reserve(count);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto path = "scenario.atmosphere.windLayers[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", path, "Wind layer must be a JSON object.");
                continue;
            }
            const auto& object = values[index].as_object();
            reject_unknown(object, generated::wind_layer_fields, path + ".");
            WindLayer layer;
            if (const auto axis = text(object, "axis", path + ".axis"))
            {
                if (*axis == "height")
                {
                    layer.axis = WindLayerAxis::height;
                }
                else if (*axis == "downrange")
                {
                    layer.axis = WindLayerAxis::downrange;
                }
                else
                {
                    issue(
                        "validation.enum",
                        path + ".axis",
                        "Wind-layer axis must be height or downrange."
                    );
                }
            }
            range(
                number(object, "startM", path + ".startM"),
                -1000,
                2000,
                path + ".startM",
                "Wind-layer start (m)",
                layer.start_m
            );
            range(
                number(object, "endM", path + ".endM"),
                -1000,
                2000,
                path + ".endM",
                "Wind-layer end (m)",
                layer.end_m
            );
            range(
                number(object, "startHeadwindMps", path + ".startHeadwindMps"),
                -100,
                100,
                path + ".startHeadwindMps",
                "Wind-layer start headwind (m/s)",
                layer.start_headwind_mps
            );
            range(
                number(object, "endHeadwindMps", path + ".endHeadwindMps"),
                -100,
                100,
                path + ".endHeadwindMps",
                "Wind-layer end headwind (m/s)",
                layer.end_headwind_mps
            );
            range(
                number(object, "startCrosswindMps", path + ".startCrosswindMps"),
                -100,
                100,
                path + ".startCrosswindMps",
                "Wind-layer start crosswind (m/s)",
                layer.start_crosswind_mps
            );
            range(
                number(object, "endCrosswindMps", path + ".endCrosswindMps"),
                -100,
                100,
                path + ".endCrosswindMps",
                "Wind-layer end crosswind (m/s)",
                layer.end_crosswind_mps
            );
            if (const auto source = optional_text(object, "source", path + ".source"))
            {
                if (source->size() > 240)
                {
                    issue(
                        "validation.length",
                        path + ".source",
                        "Wind-layer source must not exceed 240 bytes."
                    );
                }
                layer.source = *source;
            }
            if (layer.end_m <= layer.start_m)
            {
                issue(
                    "scenario.wind_layer.order",
                    path + ".endM",
                    "Wind-layer end must be greater than its start."
                );
            }
            layers.push_back(std::move(layer));
        }
    }

    void read_firearms(
        const Object& object,
        Scenario& scenario
    )
    {
        reject_unknown(object, generated::firearms_fields, "scenario.firearms.");
        if (const auto* value = member(object, "shotgun", "scenario.firearms.shotgun"))
        {
            if (!value->is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.firearms.shotgun",
                    "Shotgun configuration must be a JSON object."
                );
            }
            else
            {
                read_firearm(
                    value->as_object(),
                    scenario.shotgun,
                    "scenario.firearms.shotgun",
                    false
                );
            }
        }
        if (const auto* value = member(object, "rifle", "scenario.firearms.rifle"))
        {
            if (!value->is_object())
            {
                issue(
                    "protocol.field.object",
                    "scenario.firearms.rifle",
                    "Rifle configuration must be a JSON object."
                );
            }
            else
            {
                read_firearm(value->as_object(), scenario.rifle, "scenario.firearms.rifle", true);
            }
        }
    }

    void read_firearm(
        const Object& object,
        FirearmConfiguration& firearm,
        const std::string& path,
        bool rifle
    )
    {
        if (rifle)
        {
            reject_unknown(object, generated::rifle_fields, path + ".");
        }
        else
        {
            reject_unknown(object, generated::shotgun_fields, path + ".");
        }
        range(
            number(object, "sightHeightM", path + ".sightHeightM"),
            0,
            0.25,
            path + ".sightHeightM",
            rifle ? "Rifle sight height (m)" : "Shotgun sight height (m)",
            firearm.sight_height_m
        );
        range(
            number(object, "zeroRangeM", path + ".zeroRangeM"),
            5,
            1000,
            path + ".zeroRangeM",
            rifle ? "Rifle zero range (m)" : "Shotgun zero range (m)",
            firearm.zero_range_m
        );
        range(
            number(object, "muzzleVelocityMultiplier", path + ".muzzleVelocityMultiplier"),
            0.75,
            1.25,
            path + ".muzzleVelocityMultiplier",
            "Muzzle velocity multiplier",
            firearm.muzzle_velocity_multiplier
        );
        if (const auto source = optional_text(
                object,
                "temperatureVelocitySource",
                path + ".temperatureVelocitySource"
            ))
        {
            if (source->size() > 240)
            {
                issue(
                    "validation.length",
                    path + ".temperatureVelocitySource",
                    "Temperature-velocity source must not exceed 240 bytes."
                );
            }
            firearm.temperature_velocity_source = *source;
        }
        const auto profile = object.find("temperatureVelocityProfile");
        if (profile != object.end())
        {
            if (!profile->second.is_array())
            {
                issue(
                    "protocol.field.array",
                    path + ".temperatureVelocityProfile",
                    "Temperature-velocity profile must be a JSON array."
                );
            }
            else
            {
                read_temperature_velocity_profile(
                    profile->second.as_array(),
                    firearm.temperature_velocity_profile,
                    path + ".temperatureVelocityProfile"
                );
            }
        }
        if (!rifle)
        {
            return;
        }

        range(
            number(object, "twistInches", path + ".twistInches"),
            5,
            30,
            path + ".twistInches",
            "Rifle twist (in/turn)",
            firearm.twist_inches
        );
        const auto direction = number(object, "twistDirection", path + ".twistDirection");
        if (direction && (*direction == -1.0 || *direction == 1.0))
        {
            firearm.twist_direction = static_cast<int>(*direction);
        }
        else if (direction)
        {
            issue(
                "validation.enum",
                path + ".twistDirection",
                "Twist direction must be either -1 or 1."
            );
        }
    }

    void read_temperature_velocity_profile(
        const json::Value::Array& values,
        std::vector<FirearmConfiguration::TemperatureVelocityPoint>& points,
        const std::string& path
    )
    {
        if (values.size() < 2 || values.size() > 12)
        {
            issue(
                "scenario.temperature_velocity.count",
                path,
                "Temperature-velocity profiles must contain between 2 and 12 points."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 12);
        points.reserve(count);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto point_path = path + "[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue(
                    "protocol.field.object",
                    point_path,
                    "Temperature-velocity point must be a JSON object."
                );
                continue;
            }
            const auto& object = values[index].as_object();
            reject_unknown(object, generated::temperature_velocity_point_fields, point_path + ".");
            FirearmConfiguration::TemperatureVelocityPoint point;
            range(
                number(object, "temperatureC", point_path + ".temperatureC"),
                -60,
                60,
                point_path + ".temperatureC",
                "Profile temperature (C)",
                point.temperature_c
            );
            range(
                number(object, "multiplier", point_path + ".multiplier"),
                0.75,
                1.25,
                point_path + ".multiplier",
                "Profile velocity multiplier",
                point.multiplier
            );
            if (!points.empty() && point.temperature_c <= points.back().temperature_c)
            {
                issue(
                    "scenario.temperature_velocity.order",
                    point_path + ".temperatureC",
                    "Profile temperatures must be strictly increasing."
                );
            }
            points.push_back(point);
        }
        if (!points.empty() && points.size() < 2)
        {
            points.clear();
        }
    }

    void read_custom_loads(
        const json::Value::Array& values,
        std::vector<Projectile>& loads
    )
    {
        if (values.size() > 3)
        {
            issue("custom_loads.limit", "customLoads", "At most 3 custom loads are supported.");
        }
        std::set<std::string> ids;
        const auto count = std::min<std::size_t>(values.size(), 3);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto path = "customLoads[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", path, "Custom load must be a JSON object.");
                continue;
            }
            Projectile load;
            read_custom_load(values[index].as_object(), load, path);
            const auto& load_id = load.provenance.id;
            if (!load_id.empty() && !load_id.starts_with("custom:"))
            {
                issue(
                    "custom_load.id.namespace",
                    path + ".id",
                    "Custom load IDs must use the custom: namespace."
                );
            }
            if (!load_id.empty() && (load_id.size() > 128 || !safe_identifier(load_id)))
            {
                issue(
                    "custom_load.id.characters",
                    path + ".id",
                    "Custom load ID is too long or contains unsupported characters."
                );
            }
            if (!load_id.empty() && !ids.insert(load_id).second)
            {
                issue("custom_load.id.duplicate", path + ".id", "Custom load IDs must be unique.");
            }
            const auto validation = validate_projectile(load);
            for (auto problem : validation)
            {
                problem.field = path + "." + problem.field;
                issues_.push_back(std::move(problem));
            }
            loads.push_back(std::move(load));
        }
    }

    void read_custom_load(
        const Object& object,
        Projectile& load,
        const std::string& path
    )
    {
        reject_unknown(object, generated::custom_load_fields, path + ".");
        load.provenance.is_custom = true;
        if (const auto value = text(object, "id", path + ".id"))
        {
            load.provenance.id = *value;
        }
        if (const auto value = text(object, "name", path + ".name"))
        {
            load.definition.name = *value;
            load.definition.short_name = *value;
            if (value->empty() || value->size() > 120)
            {
                issue(
                    "custom_load.name.length",
                    path + ".name",
                    "Custom load name must contain between 1 and 120 bytes."
                );
            }
        }
        if (const auto value = text(object, "firearmGroup", path + ".firearmGroup"))
        {
            if (*value == "rifle")
            {
                load.firearm.group = FirearmGroup::rifle;
            }
            else if (*value == "shotgun")
            {
                load.firearm.group = FirearmGroup::shotgun;
            }
            else
            {
                issue(
                    "validation.enum",
                    path + ".firearmGroup",
                    "Firearm group must be rifle or shotgun."
                );
            }
        }
        if (const auto value = number(object, "muzzleVelocityMps", path + ".muzzleVelocityMps"))
        {
            load.ammunition.muzzle_velocity_mps = *value;
        }
        if (const auto value = number(object, "pelletCount", path + ".pelletCount"))
        {
            if (*value != std::floor(*value) || *value < 1 || *value > 1000)
            {
                issue(
                    "validation.integer_range",
                    path + ".pelletCount",
                    "Payload count must be a whole number between 1 and 1000."
                );
            }
            else
            {
                load.ammunition.payload_count = static_cast<int>(*value);
            }
        }

        const auto* drag_value = member(object, "drag", path + ".drag");
        if (drag_value && drag_value->is_object())
        {
            read_drag(drag_value->as_object(), load, path + ".drag");
        }
        else if (drag_value)
        {
            issue(
                "protocol.field.object",
                path + ".drag",
                "Drag definition must be a JSON object."
            );
        }

        const auto mass = optional_number(object, "massKg", path + ".massKg");
        if (const auto* sphere = sphere_drag(load))
        {
            if (mass)
            {
                issue(
                    "protocol.field.forbidden",
                    path + ".massKg",
                    "Sphere mass is derived from its diameter and material density."
                );
            }
            load.definition.mass_kg = sphere->material_density_kg_m3 * 3.14159265358979323846 *
                sphere->diameter_m * sphere->diameter_m * sphere->diameter_m / 6.0;
        }
        else
        {
            if (!mass)
            {
                issue(
                    "protocol.field.required",
                    path + ".massKg",
                    "Mass is required for reference-BC and tabulated Mach-Cd projectiles."
                );
            }
            else
            {
                load.definition.mass_kg = *mass;
            }
        }

        const auto geometry = object.find("bulletGeometry");
        if (geometry != object.end())
        {
            if (!geometry->second.is_object())
            {
                issue(
                    "protocol.field.object",
                    path + ".bulletGeometry",
                    "Bullet geometry must be a JSON object."
                );
            }
            else
            {
                read_geometry(geometry->second.as_object(), load, path + ".bulletGeometry");
            }
        }
    }

    void read_drag(
        const Object& object,
        Projectile& load,
        const std::string& path
    )
    {
        const auto kind = text(object, "kind", path + ".kind");
        if (!kind)
        {
            return;
        }
        if (*kind == "referenceBc")
        {
            reject_unknown(object, generated::reference_bc_drag_fields, path + ".");
            const auto curve = text(object, "curve", path + ".curve");
            auto reference_curve = ReferenceDragCurve::g1;
            if (curve && *curve == "G1")
            {
                reference_curve = ReferenceDragCurve::g1;
            }
            else if (curve && *curve == "G7")
            {
                reference_curve = ReferenceDragCurve::g7;
            }
            else if (curve)
            {
                issue("validation.enum", path + ".curve", "Reference drag curve must be G1 or G7.");
            }
            const auto scalar = object.find("ballisticCoefficient");
            const auto schedule = object.find("velocityBands");
            BallisticCoefficientDefinition coefficient = ConstantBallisticCoefficient {};
            auto scheduled = false;
            if (scalar != object.end() && schedule != object.end())
            {
                issue(
                    "protocol.field.mutually_exclusive",
                    path,
                    "Reference drag must specify either ballisticCoefficient or velocityBands, not "
                    "both."
                );
            }
            else if (scalar != object.end())
            {
                if (!scalar->second.is_number())
                {
                    issue(
                        "protocol.field.number",
                        path + ".ballisticCoefficient",
                        "Field must be a finite JSON number."
                    );
                }
                else
                {
                    coefficient = ConstantBallisticCoefficient { scalar->second.as_number() };
                }
            }
            else if (schedule != object.end())
            {
                scheduled = true;
                if (!schedule->second.is_array())
                {
                    issue(
                        "protocol.field.array",
                        path + ".velocityBands",
                        "Velocity bands must be a JSON array."
                    );
                }
                else
                {
                    coefficient = BandedBallisticCoefficient {
                        read_bc_schedule(schedule->second.as_array(), path + ".velocityBands")
                    };
                }
            }
            else
            {
                issue(
                    "protocol.field.required",
                    path,
                    "Reference drag requires ballisticCoefficient or velocityBands."
                );
            }
            load.definition.drag = ReferenceBcDrag { reference_curve, std::move(coefficient) };
            load.provenance.drag_description = "user-entered " +
                (curve ? *curve : std::string("reference")) +
                (scheduled ? " velocity-banded BC" : " BC");
        }
        else if (*kind == "tabulatedCd")
        {
            reject_unknown(object, generated::tabulated_cd_drag_fields, path + ".");
            TabulatedDrag drag;
            if (const auto diameter =
                    number(object, "referenceDiameterM", path + ".referenceDiameterM"))
            {
                drag.reference_diameter_m = *diameter;
            }
            const auto* points = member(object, "points", path + ".points");
            if (points && points->is_array())
            {
                drag.points = read_mach_cd_points(points->as_array(), path + ".points");
            }
            else if (points)
            {
                issue(
                    "protocol.field.array",
                    path + ".points",
                    "Mach-Cd points must be a JSON array."
                );
            }
            load.definition.drag = std::move(drag);
            load.provenance.drag_description =
                "User-entered tabulated Mach-Cd with linear interpolation and endpoint clamping";
        }
        else if (*kind == "sphere")
        {
            reject_unknown(object, generated::sphere_drag_fields, path + ".");
            SphereDrag drag;
            if (const auto diameter = number(object, "diameterM", path + ".diameterM"))
            {
                drag.diameter_m = *diameter;
            }
            if (const auto density =
                    number(object, "materialDensityKgM3", path + ".materialDensityKgM3"))
            {
                drag.material_density_kg_m3 = *density;
            }
            load.definition.drag = drag;
            load.provenance.drag_description =
                "Morrison sphere Cd(Re) plus Collins transonic correction";
        }
        else
        {
            issue(
                "validation.enum",
                path + ".kind",
                "Drag kind must be referenceBc, tabulatedCd, or sphere."
            );
        }
    }

    std::vector<BallisticCoefficientBand> read_bc_schedule(
        const json::Value::Array& values,
        const std::string& path
    )
    {
        if (values.size() > 16)
        {
            issue(
                "custom_load.bc_schedule.limit",
                path,
                "At most 16 ballistic-coefficient bands are supported."
            );
        }
        const auto count = std::min<std::size_t>(values.size(), 16);
        std::vector<BallisticCoefficientBand> bands;
        bands.reserve(count);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto band_path = path + "[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", band_path, "BC band must be a JSON object.");
                continue;
            }
            const auto& band = values[index].as_object();
            reject_unknown(band, generated::bc_band_fields, band_path + ".");
            BallisticCoefficientBand parsed;
            if (const auto velocity =
                    number(band, "minimumVelocityMps", band_path + ".minimumVelocityMps"))
            {
                parsed.minimum_velocity_mps = *velocity;
            }
            if (const auto bc =
                    number(band, "ballisticCoefficient", band_path + ".ballisticCoefficient"))
            {
                parsed.ballistic_coefficient = *bc;
            }
            bands.push_back(parsed);
        }
        return bands;
    }

    std::vector<MachCdPoint> read_mach_cd_points(
        const json::Value::Array& values,
        const std::string& path
    )
    {
        if (values.size() > 64)
        {
            issue("custom_load.mach_cd.limit", path, "At most 64 Mach-Cd points are supported.");
        }
        const auto count = std::min<std::size_t>(values.size(), 64);
        std::vector<MachCdPoint> points;
        points.reserve(count);
        for (std::size_t index = 0; index < count; ++index)
        {
            const auto point_path = path + "[" + std::to_string(index) + "]";
            if (!values[index].is_object())
            {
                issue("protocol.field.object", point_path, "Mach-Cd point must be a JSON object.");
                continue;
            }
            const auto& point = values[index].as_object();
            reject_unknown(point, generated::mach_cd_point_fields, point_path + ".");
            MachCdPoint parsed;
            if (const auto mach = number(point, "mach", point_path + ".mach"))
            {
                parsed.mach = *mach;
            }
            if (const auto cd = number(point, "dragCoefficient", point_path + ".dragCoefficient"))
            {
                parsed.drag_coefficient = *cd;
            }
            points.push_back(parsed);
        }
        return points;
    }

    void read_geometry(
        const Object& object,
        Projectile& load,
        const std::string& path
    )
    {
        reject_unknown(object, generated::bullet_geometry_fields, path + ".");
        ProjectileGeometry geometry;
        if (const auto value = number(object, "lengthInches", path + ".lengthInches"))
        {
            geometry.length_inches = *value;
        }
        if (const auto value = number(object, "diameterInches", path + ".diameterInches"))
        {
            geometry.diameter_inches = *value;
        }
        if (const auto value = number(object, "twistInches", path + ".twistInches"))
        {
            load.firearm.twist_rate_inches = *value;
        }
        load.definition.geometry = geometry;
    }
};

} // namespace

std::string escape_json(
    std::string_view value
)
{
    static constexpr char hex[] = "0123456789abcdef";
    std::string output;
    output.reserve(value.size());
    for (const auto byte : value)
    {
        const auto c = static_cast<unsigned char>(byte);
        switch (c)
        {
        case '"':
            output += "\\\"";
            break;
        case '\\':
            output += "\\\\";
            break;
        case '\b':
            output += "\\b";
            break;
        case '\f':
            output += "\\f";
            break;
        case '\n':
            output += "\\n";
            break;
        case '\r':
            output += "\\r";
            break;
        case '\t':
            output += "\\t";
            break;
        default:
            if (c < 0x20)
            {
                output += "\\u00";
                output += hex[(c >> 4) & 0xf];
                output += hex[c & 0xf];
            }
            else
            {
                output += static_cast<char>(c);
            }
            break;
        }
    }
    return output;
}

RequestParseResult parse_request(
    std::string_view source
)
{
    if (source.size() > maximum_request_bytes)
    {
        return {
            std::nullopt,
            {},
            { { "protocol.request.too_large",
                "$",
                "Request exceeds the 1 MiB size limit.",
                ValidationSeverity::error } }
        };
    }
    try
    {
        const auto root = json::parse(source);
        return RequestReader(root).read();
    }
    catch (const json::ParseError& error)
    {
        return {
            std::nullopt,
            {},
            { { "protocol.json.invalid",
                "$",
                std::string(error.what()) + " at byte " + std::to_string(error.offset()) + ".",
                ValidationSeverity::error } }
        };
    }
}

std::string error_response(
    std::string_view request_id,
    const std::vector<ValidationIssue>& issues
)
{
    std::ostringstream output;
    output << "{\"protocolVersion\":" << current_version << ",\"engineVersion\":\""
           << engine_version << "\",\"modelVersion\":\"" << model_version << "\",\"requestId\":\""
           << escape_json(request_id) << "\",\"ok\":false,\"issues\":[";
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
    output << "]}\n";
    return output.str();
}

} // namespace ballistics::protocol
