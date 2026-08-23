#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "ballistics.hpp"
#include "json.hpp"

namespace
{

using ballistics::json::Value;

struct FlightResiduals
{
    double position_m {};
    double velocity_mps {};
    double time_s {};
    double ground_speed_mps {};
    double airspeed_mps {};
    double mach {};
    double drag_coefficient {};

    void include(
        const FlightResiduals& other
    )
    {
        position_m = std::max(position_m, other.position_m);
        velocity_mps = std::max(velocity_mps, other.velocity_mps);
        time_s = std::max(time_s, other.time_s);
        ground_speed_mps = std::max(ground_speed_mps, other.ground_speed_mps);
        airspeed_mps = std::max(airspeed_mps, other.airspeed_mps);
        mach = std::max(mach, other.mach);
        drag_coefficient = std::max(drag_coefficient, other.drag_coefficient);
    }
};

struct FlightTolerances
{
    double position_m {};
    double velocity_mps {};
    double time_s {};
    double scalar {};
    double drag_coefficient {};
};

struct ScenarioReport
{
    std::string id;
    std::string category;
    std::string drag_model;
    std::size_t sample_count {};
    std::string termination;
    bool passed { true };
    FlightResiduals residuals;
};

struct ZeroingReport
{
    std::string id;
    std::string status;
    std::size_t sample_count {};
    double bore_angle_residual_rad {};
    double zero_residual_m {};
    double path_residual_m {};
    double time_residual_s {};
    double velocity_residual_mps {};
    bool passed { true };
};

struct MpbrReport
{
    std::string id;
    std::string status;
    double zero_residual_m {};
    double mpbr_residual_m {};
    double maximum_path_residual_m {};
    bool passed { true };
};

const Value& field(
    const Value::Object& object,
    std::string_view name
)
{
    const auto item = object.find(name);
    if (item == object.end())
    {
        throw std::runtime_error("missing JSON field: " + std::string(name));
    }
    return item->second;
}

const Value::Object& object_field(
    const Value::Object& object,
    std::string_view name
)
{
    return field(object, name).as_object();
}

const Value::Array& array_field(
    const Value::Object& object,
    std::string_view name
)
{
    return field(object, name).as_array();
}

double number_field(
    const Value::Object& object,
    std::string_view name
)
{
    return field(object, name).as_number();
}

const std::string& string_field(
    const Value::Object& object,
    std::string_view name
)
{
    return field(object, name).as_string();
}

std::string read_text(
    const std::filesystem::path& path
)
{
    std::ifstream input(path, std::ios::binary);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }
    return { std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>() };
}

ballistics::Vec3 read_vector(
    const Value::Object& object
)
{
    return {
        number_field(object, "x"),
        number_field(object, "y"),
        number_field(object, "z"),
    };
}

double vector_distance(
    const ballistics::Vec3& left,
    const ballistics::Vec3& right
)
{
    return std::hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

ballistics::DragModel read_drag_model(
    std::string_view value
)
{
    if (value == "G1")
    {
        return ballistics::DragModel::g1;
    }
    if (value == "G7")
    {
        return ballistics::DragModel::g7;
    }
    if (value == "sphere")
    {
        return ballistics::DragModel::sphere;
    }
    if (value == "tabulatedCd")
    {
        return ballistics::DragModel::tabulated_cd;
    }
    throw std::runtime_error("unsupported drag model: " + std::string(value));
}

ballistics::Projectile read_projectile(
    const Value::Object& object
)
{
    ballistics::Projectile projectile;
    projectile.provenance.id = string_field(object, "id");
    projectile.definition.name = projectile.provenance.id;
    projectile.definition.short_name = projectile.provenance.id;
    projectile.definition.mass_kg = number_field(object, "massKg");
    projectile.ammunition.muzzle_velocity_mps = number_field(object, "muzzleVelocityMps");
    projectile.ammunition.payload_count = 1;
    projectile.firearm.group = ballistics::FirearmGroup::rifle;
    projectile.provenance.is_custom = !projectile.provenance.id.starts_with("builtin:");
    const auto model = read_drag_model(string_field(object, "dragModel"));
    std::vector<ballistics::MachCdPoint> points;
    for (const auto& point_value : array_field(object, "machCdPoints"))
    {
        const auto& point = point_value.as_object();
        points.push_back({ number_field(point, "mach"), number_field(point, "dragCoefficient") });
    }
    if (model == ballistics::DragModel::sphere)
    {
        projectile.definition.drag = ballistics::SphereDrag {
            number_field(object, "sphereDiameterM"),
            number_field(object, "materialDensityKgM3")
        };
        projectile.provenance.drag_description = "sphere";
    }
    else if (model == ballistics::DragModel::tabulated_cd)
    {
        projectile.definition.drag = ballistics::TabulatedDrag {
            number_field(object, "dragReferenceDiameterM"),
            std::move(points)
        };
        projectile.provenance.drag_description = "tabulatedCd";
    }
    else
    {
        const auto curve = model == ballistics::DragModel::g7
            ? ballistics::ReferenceDragCurve::g7
            : ballistics::ReferenceDragCurve::g1;
        projectile.definition.drag = ballistics::ReferenceBcDrag {
            curve,
            ballistics::ConstantBallisticCoefficient {
                number_field(object, "ballisticCoefficient") }
        };
        projectile.provenance.drag_description = model == ballistics::DragModel::g7 ? "G7" : "G1";
    }

    const auto validation_issues = ballistics::validate_projectile(projectile);
    if (!validation_issues.empty())
    {
        std::ostringstream message;
        message << "invalid matrix projectile " << projectile.provenance.id;
        for (const auto& issue : validation_issues)
        {
            message << ". " << issue.code << " (" << issue.field << ")";
        }
        throw std::runtime_error(message.str());
    }
    return projectile;
}

ballistics::Atmosphere read_atmosphere(
    const Value::Object& object
)
{
    const auto atmosphere = ballistics::Atmosphere::create(
        number_field(object, "temperatureC"),
        number_field(object, "stationPressureHpa"),
        number_field(object, "relativeHumidityPercent"),
        number_field(object, "headwindMps"),
        number_field(object, "crosswindMps")
    );
    constexpr double transcription_tolerance = 1e-11;
    if (std::abs(atmosphere.density_kg_m3 - number_field(object, "densityKgM3")) >
            transcription_tolerance ||
        std::abs(atmosphere.speed_of_sound_mps - number_field(object, "speedOfSoundMps")) >
            transcription_tolerance ||
        std::abs(atmosphere.dynamic_viscosity_pa_s - number_field(object, "dynamicViscosityPaS")) >
            transcription_tolerance)
    {
        throw std::runtime_error("matrix atmosphere transcription no longer matches production");
    }
    return atmosphere;
}

FlightTolerances read_tolerances(
    const Value::Object& object
)
{
    return {
        number_field(object, "positionAbsoluteM"),
        number_field(object, "velocityAbsoluteMps"),
        number_field(object, "timeAbsoluteS"),
        number_field(object, "scalarAbsolute"),
        number_field(object, "dragCoefficientAbsolute"),
    };
}

bool within(
    const FlightResiduals& residuals,
    const FlightTolerances& tolerances
)
{
    return residuals.position_m <= tolerances.position_m &&
        residuals.velocity_mps <= tolerances.velocity_mps &&
        residuals.time_s <= tolerances.time_s && residuals.ground_speed_mps <= tolerances.scalar &&
        residuals.airspeed_mps <= tolerances.scalar && residuals.mach <= tolerances.scalar &&
        residuals.drag_coefficient <= tolerances.drag_coefficient;
}

FlightResiduals compare_sample(
    const ballistics::TrajectorySample& actual,
    const Value::Object& expected,
    const ballistics::Projectile& projectile,
    const ballistics::Atmosphere& atmosphere
)
{
    const auto expected_position = read_vector(object_field(expected, "positionM"));
    const auto expected_velocity = read_vector(object_field(expected, "groundVelocityMps"));
    const auto reference_state_diagnostics =
        ballistics::aerodynamic_diagnostics(projectile, expected_velocity, atmosphere);
    return {
        vector_distance(actual.position_m, expected_position),
        vector_distance(actual.ground_velocity_mps, expected_velocity),
        std::abs(actual.time_s - number_field(expected, "timeS")),
        std::abs(actual.ground_speed_mps - number_field(expected, "groundSpeedMps")),
        std::abs(actual.airspeed_mps - number_field(expected, "airspeedMps")),
        std::abs(actual.aerodynamics.mach - number_field(expected, "mach")),
        std::abs(reference_state_diagnostics.cd - number_field(expected, "dragCoefficient")),
    };
}

std::string trajectory_termination(
    ballistics::TrajectoryTermination value
)
{
    switch (value)
    {
    case ballistics::TrajectoryTermination::requested_distance:
        return "requested_distance";
    case ballistics::TrajectoryTermination::ground_impact:
        return "ground_impact";
    case ballistics::TrajectoryTermination::horizontal_reversal:
        return "horizontal_reversal";
    case ballistics::TrajectoryTermination::minimum_forward_speed:
        return "minimum_forward_speed";
    case ballistics::TrajectoryTermination::maximum_time:
        return "maximum_time";
    case ballistics::TrajectoryTermination::maximum_steps:
        return "maximum_steps";
    case ballistics::TrajectoryTermination::non_finite_state:
        return "non_finite_state";
    }
    return "unknown";
}

std::string zeroing_status(
    ballistics::ZeroingStatus value
)
{
    switch (value)
    {
    case ballistics::ZeroingStatus::complete:
        return "complete";
    case ballistics::ZeroingStatus::range_unavailable:
        return "range_unavailable";
    case ballistics::ZeroingStatus::no_solution:
        return "no_solution";
    case ballistics::ZeroingStatus::invalid_geometry:
        return "invalid_geometry";
    }
    return "unknown";
}

std::string mpbr_status(
    ballistics::MpbrStatus value
)
{
    switch (value)
    {
    case ballistics::MpbrStatus::complete:
        return "complete";
    case ballistics::MpbrStatus::horizon_limited:
        return "horizon_limited";
    case ballistics::MpbrStatus::no_solution:
        return "no_solution";
    case ballistics::MpbrStatus::invalid_geometry:
        return "invalid_geometry";
    }
    return "unknown";
}

ScenarioReport evaluate_scenario(
    const Value::Object& scenario
)
{
    ScenarioReport report;
    report.id = string_field(scenario, "id");
    report.category = string_field(scenario, "category");
    const auto& projectile_object = object_field(scenario, "projectile");
    report.drag_model = string_field(projectile_object, "dragModel");
    const auto projectile = read_projectile(projectile_object);
    const auto atmosphere = read_atmosphere(object_field(scenario, "atmosphere"));
    const auto& launch = object_field(scenario, "launch");
    auto configuration = ballistics::SolverConfiguration {};
    configuration.launch_elevation_rad = number_field(launch, "elevationRad");
    configuration.launch_azimuth_rad = number_field(launch, "azimuthRad");
    configuration.terminate_at_ground = false;

    const auto maximum_distance = number_field(scenario, "maximumDistanceM");
    const auto trajectory = ballistics::
        integrate_trajectory(projectile, atmosphere, maximum_distance, 1.0, 0.25, configuration);
    report.termination = trajectory_termination(trajectory.termination);
    const auto tolerances = read_tolerances(object_field(scenario, "tolerances"));
    const auto& samples = array_field(scenario, "samples");
    report.sample_count = samples.size();
    for (const auto& sample_value : samples)
    {
        const auto& expected = sample_value.as_object();
        const auto distance = number_field(expected, "distanceM");
        const auto actual = trajectory.sample_at(distance);
        if (!actual)
        {
            report.passed = false;
            continue;
        }
        report.residuals.include(compare_sample(*actual, expected, projectile, atmosphere));
    }
    report.passed = report.passed &&
        trajectory.termination == ballistics::TrajectoryTermination::requested_distance &&
        within(report.residuals, tolerances);
    return report;
}

ZeroingReport evaluate_zeroing_case(
    const Value::Object& item
)
{
    ZeroingReport report;
    report.id = string_field(item, "id");
    const auto projectile = read_projectile(object_field(item, "projectile"));
    const auto atmosphere = read_atmosphere(object_field(item, "atmosphere"));
    const auto maximum_distance = number_field(item, "maximumDistanceM");
    const auto zero_range = number_field(item, "zeroRangeM");
    const auto sight_height = number_field(item, "sightHeightM");
    const auto zeroed = ballistics::integrate_zeroed_trajectory(
        projectile,
        atmosphere,
        maximum_distance,
        zero_range,
        sight_height,
        1.0,
        0.25
    );
    report.status = zeroing_status(zeroed.status);
    report.bore_angle_residual_rad =
        std::abs(zeroed.bore_elevation_rad - number_field(item, "boreElevationRad"));
    report.zero_residual_m = std::abs(zeroed.zero_error_m - number_field(item, "zeroResidualM"));

    const auto& samples = array_field(item, "samples");
    report.sample_count = samples.size();
    for (const auto& sample_value : samples)
    {
        const auto& expected = sample_value.as_object();
        const auto actual = zeroed.trajectory.sample_at(number_field(expected, "distanceM"));
        if (!actual)
        {
            report.passed = false;
            continue;
        }
        report.path_residual_m = std::max(
            report.path_residual_m,
            std::abs(actual->position_m.y - sight_height - number_field(expected, "sightPathM"))
        );
        report.time_residual_s = std::max(
            report.time_residual_s,
            std::abs(actual->time_s - number_field(expected, "timeS"))
        );
        report.velocity_residual_mps = std::max(
            report.velocity_residual_mps,
            vector_distance(
                actual->ground_velocity_mps,
                read_vector(object_field(expected, "groundVelocityMps"))
            )
        );
    }

    const auto& tolerances = object_field(item, "tolerances");
    report.passed = report.passed && zeroed.status == ballistics::ZeroingStatus::complete &&
        report.bore_angle_residual_rad <= number_field(tolerances, "boreAngleAbsoluteRad") &&
        report.path_residual_m <= number_field(tolerances, "pathAbsoluteM") &&
        report.time_residual_s <= number_field(tolerances, "timeAbsoluteS") &&
        report.velocity_residual_mps <= number_field(tolerances, "velocityAbsoluteMps");
    return report;
}

MpbrReport evaluate_mpbr_case(
    const Value::Object& item
)
{
    MpbrReport report;
    report.id = string_field(item, "id");
    const auto projectile = read_projectile(object_field(item, "projectile"));
    const auto atmosphere = read_atmosphere(object_field(item, "atmosphere"));
    const auto maximum_distance = number_field(item, "maximumDistanceM");
    const auto sight_height = number_field(item, "sightHeightM");
    const auto vital_zone = number_field(item, "vitalZoneDiameterM");
    const auto mpbr = ballistics::compute_native_mpbr(
        projectile,
        atmosphere,
        maximum_distance,
        vital_zone,
        sight_height,
        1.0,
        0.25
    );
    report.status = mpbr_status(mpbr.status);
    report.zero_residual_m = std::abs(mpbr.zero_m - number_field(item, "zeroM"));
    report.mpbr_residual_m = std::abs(mpbr.mpbr_m - number_field(item, "mpbrM"));

    auto configuration = ballistics::SolverConfiguration {};
    configuration.launch_elevation_rad = number_field(item, "boreElevationRad");
    configuration.terminate_at_ground = false;
    const auto reference_angle_trajectory = ballistics::
        integrate_trajectory(projectile, atmosphere, maximum_distance, 1.0, 0.25, configuration);
    auto maximum_path_m = -sight_height;
    for (const auto& sample : reference_angle_trajectory.samples)
    {
        maximum_path_m = std::max(maximum_path_m, sample.position_m.y - sight_height);
    }
    report.maximum_path_residual_m = std::abs(maximum_path_m - number_field(item, "maximumPathM"));

    const auto& tolerances = object_field(item, "tolerances");
    report.passed = mpbr.status == ballistics::MpbrStatus::complete &&
        report.zero_residual_m <= number_field(tolerances, "zeroAbsoluteM") &&
        report.mpbr_residual_m <= number_field(tolerances, "mpbrAbsoluteM") &&
        report.maximum_path_residual_m <= number_field(tolerances, "maximumPathAbsoluteM");
    return report;
}

std::string compiler_identity()
{
#if defined(_MSC_VER)
    return "MSVC " + std::to_string(_MSC_VER);
#elif defined(__clang__)
    return "Clang " + std::to_string(__clang_major__) + "." + std::to_string(__clang_minor__);
#elif defined(__GNUC__)
    return "GCC " + std::to_string(__GNUC__) + "." + std::to_string(__GNUC_MINOR__);
#else
    return "unknown compiler";
#endif
}

std::string json_escape(
    std::string_view value
)
{
    std::string escaped;
    escaped.reserve(value.size());
    for (const char character : value)
    {
        switch (character)
        {
        case '\\':
            escaped += "\\\\";
            break;
        case '"':
            escaped += "\\\"";
            break;
        case '\n':
            escaped += "\\n";
            break;
        case '\r':
            escaped += "\\r";
            break;
        case '\t':
            escaped += "\\t";
            break;
        default:
            escaped += character;
            break;
        }
    }
    return escaped;
}

void write_residuals(
    std::ostream& output,
    const FlightResiduals& residuals,
    std::string_view indentation
)
{
    output << indentation << "\"positionM\": " << residuals.position_m << ",\n"
           << indentation << "\"velocityMps\": " << residuals.velocity_mps << ",\n"
           << indentation << "\"timeS\": " << residuals.time_s << ",\n"
           << indentation << "\"groundSpeedMps\": " << residuals.ground_speed_mps << ",\n"
           << indentation << "\"airspeedMps\": " << residuals.airspeed_mps << ",\n"
           << indentation << "\"mach\": " << residuals.mach << ",\n"
           << indentation << "\"dragCoefficient\": " << residuals.drag_coefficient;
}

void write_report(
    const std::filesystem::path& path,
    std::string_view artifact_id,
    bool passed,
    const FlightResiduals& aggregate,
    std::size_t sample_count,
    const std::set<std::string>& categories,
    const std::vector<ScenarioReport>& scenarios,
    const std::vector<ZeroingReport>& zeroing_cases,
    const std::vector<MpbrReport>& mpbr_cases
)
{
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path);
    if (!output)
    {
        throw std::runtime_error("could not write " + path.string());
    }
    output << std::setprecision(17);
    output
        << "{\n"
        << "  \"schemaVersion\": 1,\n"
        << "  \"reportType\": \"independent_flight_matrix\",\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"compiler\": \"" << json_escape(compiler_identity()) << "\",\n"
        << "  \"referenceArtifact\": \"" << json_escape(artifact_id) << "\",\n"
        << "  \"evidenceLevel\": \"independent_implementation_numerical_conformance\",\n"
        << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
        << "  \"aggregate\": {\n"
        << "    \"scenarioCount\": " << scenarios.size() << ",\n"
        << "    \"sampleCount\": " << sample_count << ",\n"
        << "    \"zeroingCaseCount\": " << zeroing_cases.size() << ",\n"
        << "    \"mpbrCaseCount\": " << mpbr_cases.size() << ",\n";
    write_residuals(output, aggregate, "    ");
    output << "\n  },\n  \"categories\": [";
    std::size_t category_index = 0;
    for (const auto& category : categories)
    {
        output << (category_index++ == 0 ? "" : ", ") << "\"" << json_escape(category) << "\"";
    }
    output << "],\n  \"scenarios\": [\n";
    for (std::size_t index = 0; index < scenarios.size(); ++index)
    {
        const auto& scenario = scenarios[index];
        output
            << "    {\n"
            << "      \"id\": \"" << json_escape(scenario.id) << "\",\n"
            << "      \"category\": \"" << json_escape(scenario.category) << "\",\n"
            << "      \"dragModel\": \"" << json_escape(scenario.drag_model) << "\",\n"
            << "      \"sampleCount\": " << scenario.sample_count << ",\n"
            << "      \"termination\": \"" << scenario.termination << "\",\n"
            << "      \"passed\": " << (scenario.passed ? "true" : "false") << ",\n"
            << "      \"maximumResiduals\": {\n";
        write_residuals(output, scenario.residuals, "        ");
        output << "\n      }\n    }" << (index + 1 == scenarios.size() ? "\n" : ",\n");
    }
    output << "  ],\n  \"zeroingCases\": [\n";
    for (std::size_t index = 0; index < zeroing_cases.size(); ++index)
    {
        const auto& item = zeroing_cases[index];
        output
            << "    {\n"
            << "      \"id\": \"" << json_escape(item.id) << "\",\n"
            << "      \"status\": \"" << item.status << "\",\n"
            << "      \"sampleCount\": " << item.sample_count << ",\n"
            << "      \"boreAngleResidualRad\": " << item.bore_angle_residual_rad << ",\n"
            << "      \"zeroResidualM\": " << item.zero_residual_m << ",\n"
            << "      \"pathResidualM\": " << item.path_residual_m << ",\n"
            << "      \"timeResidualS\": " << item.time_residual_s << ",\n"
            << "      \"velocityResidualMps\": " << item.velocity_residual_mps << ",\n"
            << "      \"passed\": " << (item.passed ? "true" : "false") << "\n"
            << "    }" << (index + 1 == zeroing_cases.size() ? "\n" : ",\n");
    }
    output << "  ],\n  \"mpbrCases\": [\n";
    for (std::size_t index = 0; index < mpbr_cases.size(); ++index)
    {
        const auto& item = mpbr_cases[index];
        output
            << "    {\n"
            << "      \"id\": \"" << json_escape(item.id) << "\",\n"
            << "      \"status\": \"" << item.status << "\",\n"
            << "      \"zeroResidualM\": " << item.zero_residual_m << ",\n"
            << "      \"mpbrResidualM\": " << item.mpbr_residual_m << ",\n"
            << "      \"maximumPathResidualM\": " << item.maximum_path_residual_m << ",\n"
            << "      \"passed\": " << (item.passed ? "true" : "false") << "\n"
            << "    }" << (index + 1 == mpbr_cases.size() ? "\n" : ",\n");
    }
    output << "  ]\n}\n";
}

} // namespace

int main(
    int argc,
    char** argv
)
{
    try
    {
        std::filesystem::path scenario_path = std::filesystem::path(BALLISTICS_SOURCE_DIR) /
            "validation" / "scenarios" / "independent-flight-matrix.json";
        std::filesystem::path report_path =
            std::filesystem::current_path() / "validation" / "flight-matrix-residuals.json";
        for (int index = 1; index < argc; ++index)
        {
            const std::string_view argument = argv[index];
            if (argument == "--scenario" && index + 1 < argc)
            {
                scenario_path = argv[++index];
            }
            else if (argument == "--report" && index + 1 < argc)
            {
                report_path = argv[++index];
            }
            else
            {
                throw std::runtime_error(
                    "usage: flight_matrix_tests [--scenario PATH] [--report PATH]"
                );
            }
        }

        const auto root = ballistics::json::parse(read_text(scenario_path)).as_object();
        if (number_field(root, "schemaVersion") != 1 ||
            string_field(root, "modelVersion") != ballistics::model_version)
        {
            throw std::runtime_error("unsupported flight-matrix schema or model version");
        }

        std::vector<ScenarioReport> scenario_reports;
        std::vector<ZeroingReport> zeroing_reports;
        std::vector<MpbrReport> mpbr_reports;
        FlightResiduals aggregate;
        std::set<std::string> categories;
        std::size_t sample_count = 0;
        bool passed = true;

        for (const auto& scenario_value : array_field(root, "scenarios"))
        {
            auto report = evaluate_scenario(scenario_value.as_object());
            aggregate.include(report.residuals);
            categories.insert(report.category);
            sample_count += report.sample_count;
            passed = passed && report.passed;
            scenario_reports.push_back(std::move(report));
        }
        for (const auto& item : array_field(root, "zeroingCases"))
        {
            auto report = evaluate_zeroing_case(item.as_object());
            passed = passed && report.passed;
            zeroing_reports.push_back(std::move(report));
        }
        for (const auto& item : array_field(root, "mpbrCases"))
        {
            auto report = evaluate_mpbr_case(item.as_object());
            passed = passed && report.passed;
            mpbr_reports.push_back(std::move(report));
        }

        const auto artifact_id = string_field(root, "id");
        write_report(
            report_path,
            artifact_id,
            passed,
            aggregate,
            sample_count,
            categories,
            scenario_reports,
            zeroing_reports,
            mpbr_reports
        );

        for (const auto& report : scenario_reports)
        {
            std::cout
                << report.id << ": " << (report.passed ? "PASS" : "FAIL") << " position="
                << report.residuals.position_m << " velocity=" << report.residuals.velocity_mps
                << " time=" << report.residuals.time_s << '\n';
        }
        for (const auto& report : zeroing_reports)
        {
            std::cout << report.id << ": " << (report.passed ? "PASS" : "FAIL")
                      << " bore-angle=" << report.bore_angle_residual_rad
                      << " path=" << report.path_residual_m << '\n';
        }
        for (const auto& report : mpbr_reports)
        {
            std::cout << report.id << ": " << (report.passed ? "PASS" : "FAIL")
                      << " zero=" << report.zero_residual_m << " mpbr=" << report.mpbr_residual_m
                      << " max-path=" << report.maximum_path_residual_m << '\n';
        }
        std::cout << "Flight matrix report: " << report_path << '\n';
        return passed ? 0 : 1;
    }
    catch (const std::exception& error)
    {
        std::cerr << "Flight matrix validation failed: " << error.what() << '\n';
        return 1;
    }
}
