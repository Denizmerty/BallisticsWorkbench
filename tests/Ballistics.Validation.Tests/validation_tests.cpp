#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "ballistics.hpp"
#include "json.hpp"

namespace
{

using ballistics::json::Value;

struct Residuals
{
    double velocity_relative {};
    double time_relative {};
    double position_absolute_m {};

    void include(
        const Residuals& other
    )
    {
        velocity_relative = std::max(velocity_relative, other.velocity_relative);
        time_relative = std::max(time_relative, other.time_relative);
        position_absolute_m = std::max(position_absolute_m, other.position_absolute_m);
    }
};

struct ScenarioReport
{
    std::string id;
    std::string regime;
    bool passed { true };
    Residuals maximum_residuals;
};

struct G1Band
{
    double threshold_fps {};
    double coefficient {};
    double exponent {};
};

struct ManufacturerVelocitySample
{
    double distance_m {};
    double published_velocity_mps {};
    double predicted_velocity_mps {};
    double velocity_relative_residual {};
};

struct ManufacturerLoadReport
{
    std::string load_id;
    std::vector<std::string> source_dataset_ids;
    std::string source_qualification;
    std::string parameter_status;
    double tolerance_velocity_relative {};
    double maximum_velocity_relative {};
    bool passed { true };
    std::vector<ManufacturerVelocitySample> samples;
};

struct PublishedVelocity
{
    double distance_m {};
    double velocity_mps {};
};

struct AtmosphereDensitySample
{
    double temperature_c {};
    double station_pressure_hpa {};
    double relative_humidity_percent {};
    double reference_density_kg_m3 {};
    double production_density_kg_m3 {};
    double density_relative_residual {};
};

struct AtmosphereSoundSpeedSample
{
    double temperature_c {};
    double station_pressure_hpa {};
    double relative_humidity_percent {};
    double co2_mole_fraction {};
    double acoustic_frequency_hz {};
    double reference_speed_of_sound_mps {};
    double reference_standard_uncertainty_mps {};
    double production_speed_of_sound_mps {};
    double speed_of_sound_relative_residual {};
};

struct AtmosphereViscositySample
{
    double temperature_c {};
    double reference_dynamic_viscosity_pa_s {};
    double production_dynamic_viscosity_pa_s {};
    double dynamic_viscosity_relative_residual {};
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

std::vector<G1Band> read_g1_bands(
    const std::filesystem::path& path
)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }

    std::string line;
    std::getline(input, line);
    std::vector<G1Band> bands;
    while (std::getline(input, line))
    {
        if (line.empty())
        {
            continue;
        }
        std::istringstream row(line);
        std::string threshold;
        std::string coefficient;
        std::string exponent;
        if (!std::getline(row, threshold, ',') || !std::getline(row, coefficient, ',') ||
            !std::getline(row, exponent, ','))
        {
            throw std::runtime_error("malformed G1 row: " + line);
        }
        bands.push_back({ std::stod(threshold), std::stod(coefficient), std::stod(exponent) });
    }
    return bands;
}

std::vector<PublishedVelocity> read_manufacturer_velocities(
    const std::filesystem::path& path
)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }

    std::string header;
    std::getline(input, header);
    const auto imperial = header.starts_with("distance_yd,velocity_fps");
    const auto metric = header.starts_with("distance_m,velocity_mps");
    if (!imperial && !metric)
    {
        throw std::runtime_error("unsupported manufacturer velocity header: " + header);
    }

    std::string line;
    std::vector<PublishedVelocity> samples;
    while (std::getline(input, line))
    {
        if (line.empty())
        {
            continue;
        }
        std::istringstream row(line);
        std::string distance;
        std::string velocity;
        if (!std::getline(row, distance, ',') || !std::getline(row, velocity, ','))
        {
            throw std::runtime_error("malformed manufacturer velocity row: " + line);
        }
        const auto parsed_distance = std::stod(distance);
        const auto parsed_velocity = std::stod(velocity);
        samples.push_back(
            imperial ? PublishedVelocity { parsed_distance * 0.9144,
                                           parsed_velocity * ballistics::fps_to_mps }
                     : PublishedVelocity { parsed_distance, parsed_velocity }
        );
    }
    if (samples.empty())
    {
        throw std::runtime_error("manufacturer velocity table is empty: " + path.string());
    }
    return samples;
}

std::vector<AtmosphereDensitySample> read_atmosphere_densities(
    const std::filesystem::path& path
)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }

    std::string header;
    std::getline(input, header);
    if (header !=
        "temperature_c,station_pressure_hpa,relative_humidity_percent,co2_mole_fraction,"
        "density_kg_m3,compressibility_factor,water_vapor_mole_fraction")
    {
        throw std::runtime_error("unsupported atmosphere reference header: " + header);
    }

    std::string line;
    std::vector<AtmosphereDensitySample> samples;
    while (std::getline(input, line))
    {
        if (line.empty())
        {
            continue;
        }
        std::istringstream row(line);
        std::vector<std::string> cells;
        std::string cell;
        while (std::getline(row, cell, ','))
        {
            cells.push_back(cell);
        }
        if (cells.size() != 7)
        {
            throw std::runtime_error("malformed atmosphere reference row: " + line);
        }
        samples.push_back(
            { std::stod(cells[0]), std::stod(cells[1]), std::stod(cells[2]), std::stod(cells[4]) }
        );
    }
    if (samples.empty())
    {
        throw std::runtime_error("atmosphere reference table is empty: " + path.string());
    }
    return samples;
}

std::vector<AtmosphereSoundSpeedSample> read_atmosphere_sound_speeds(
    const std::filesystem::path& path
)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }

    std::string header;
    std::getline(input, header);
    if (header !=
        "temperature_c,station_pressure_hpa,relative_humidity_percent,co2_mole_fraction,"
        "acoustic_frequency_hz,speed_of_sound_mps,standard_uncertainty_mps")
    {
        throw std::runtime_error("unsupported atmosphere sound-speed header: " + header);
    }

    std::string line;
    std::vector<AtmosphereSoundSpeedSample> samples;
    while (std::getline(input, line))
    {
        if (line.empty())
        {
            continue;
        }
        std::istringstream row(line);
        std::vector<std::string> cells;
        std::string cell;
        while (std::getline(row, cell, ','))
        {
            cells.push_back(cell);
        }
        if (cells.size() != 7)
        {
            throw std::runtime_error("malformed atmosphere sound-speed row: " + line);
        }
        samples.push_back(
            { std::stod(cells[0]),
              std::stod(cells[1]),
              std::stod(cells[2]),
              std::stod(cells[3]),
              std::stod(cells[4]),
              std::stod(cells[5]),
              std::stod(cells[6]) }
        );
    }
    if (samples.empty())
    {
        throw std::runtime_error("atmosphere sound-speed table is empty: " + path.string());
    }
    return samples;
}

std::vector<AtmosphereViscositySample> read_atmosphere_viscosities(
    const std::filesystem::path& path
)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("could not open " + path.string());
    }

    std::string header;
    std::getline(input, header);
    if (header != "temperature_c,dynamic_viscosity_pa_s")
    {
        throw std::runtime_error("unsupported atmosphere viscosity header: " + header);
    }

    std::string line;
    std::vector<AtmosphereViscositySample> samples;
    while (std::getline(input, line))
    {
        if (line.empty())
        {
            continue;
        }
        std::istringstream row(line);
        std::string temperature;
        std::string viscosity;
        if (!std::getline(row, temperature, ',') || !std::getline(row, viscosity, ','))
        {
            throw std::runtime_error("malformed atmosphere viscosity row: " + line);
        }
        samples.push_back({ std::stod(temperature), std::stod(viscosity) });
    }
    if (samples.empty())
    {
        throw std::runtime_error("atmosphere viscosity table is empty: " + path.string());
    }
    return samples;
}

double relative_residual(
    double actual,
    double expected
)
{
    return std::abs(actual - expected) / std::max(std::abs(expected), 1e-15);
}

double g1_expected_cd(
    const G1Band& band,
    double speed_fps
)
{
    constexpr double standard_density_kg_m3 = 1.225;
    constexpr double pounds_to_kg = 0.45359237;
    constexpr double pi = 3.1415926535897932384626433832795;
    const auto speed_mps = speed_fps * ballistics::fps_to_mps;
    const auto reference_area_m2 = pi * ballistics::inches_to_m * ballistics::inches_to_m / 4.0;
    const auto retardation_mps2 =
        band.coefficient * std::pow(speed_fps, band.exponent) * ballistics::fps_to_mps;
    return retardation_mps2 /
        (0.5 * standard_density_kg_m3 * reference_area_m2 * speed_mps * speed_mps / pounds_to_kg);
}

bool nearly_equal(
    double actual,
    double expected,
    double relative_tolerance = 1e-12
)
{
    return relative_residual(actual, expected) <= relative_tolerance;
}

void record_failure(
    std::vector<std::string>& failures,
    const std::string& label,
    double actual,
    double expected,
    double tolerance
)
{
    std::ostringstream message;
    message << std::setprecision(15) << label << ": expected " << expected << ", got " << actual
            << ", tolerance " << tolerance;
    failures.push_back(message.str());
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

void write_report(
    const std::filesystem::path& path,
    const std::string& scenario_set_id,
    bool passed,
    const Residuals& maximum_residuals,
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
        << "  \"scenarioSetId\": \"" << scenario_set_id << "\",\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"compiler\": \"" << compiler_identity() << "\",\n"
        << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
        << "  \"maximumResiduals\": {\n"
        << "    \"velocityRelative\": " << maximum_residuals.velocity_relative << ",\n"
        << "    \"timeRelative\": " << maximum_residuals.time_relative << ",\n"
        << "    \"positionAbsoluteM\": " << maximum_residuals.position_absolute_m << "\n"
        << "  },\n"
        << "  \"scenarios\": [\n";

    for (std::size_t index = 0; index < scenarios.size(); ++index)
    {
        const auto& scenario = scenarios[index];
        output
            << "    {\n"
            << "      \"id\": \"" << scenario.id << "\",\n"
            << "      \"regime\": \"" << scenario.regime << "\",\n"
            << "      \"passed\": " << (scenario.passed ? "true" : "false") << ",\n"
            << "      \"maximumResiduals\": {\n"
            << "        \"velocityRelative\": " << scenario.maximum_residuals.velocity_relative
            << ",\n"
            << "        \"timeRelative\": " << scenario.maximum_residuals.time_relative << ",\n"
            << "        \"positionAbsoluteM\": " << scenario.maximum_residuals.position_absolute_m
            << "\n"
            << "      }\n"
            << "    }" << (index + 1 == scenarios.size() ? "\n" : ",\n");
    }
    output << "  ]\n}\n";
}

void write_manufacturer_report(
    const std::filesystem::path& path,
    bool passed,
    const std::vector<ManufacturerLoadReport>& loads
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
        << "  \"reportType\": \"manufacturer_table_conformance\",\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"compiler\": \"" << compiler_identity() << "\",\n"
        << "  \"evidenceLevel\": \"manufacturer_conformance\",\n"
        << "  \"atmosphere\": {\n"
        << "    \"temperatureC\": 15,\n"
        << "    \"stationPressureHpa\": 1013.25,\n"
        << "    \"relativeHumidityPercent\": 0,\n"
        << "    \"headwindMps\": 0,\n"
        << "    \"crosswindMps\": 0,\n"
        << "    \"status\": \"assumed_not_published\"\n"
        << "  },\n"
        << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
        << "  \"loads\": [\n";

    for (std::size_t load_index = 0; load_index < loads.size(); ++load_index)
    {
        const auto& load = loads[load_index];
        output << "    {\n"
               << "      \"loadId\": \"" << load.load_id << "\",\n"
               << "      \"sourceDatasetIds\": [";
        for (std::size_t source_index = 0; source_index < load.source_dataset_ids.size();
             ++source_index)
        {
            output << "\"" << load.source_dataset_ids[source_index] << "\""
                   << (source_index + 1 == load.source_dataset_ids.size() ? "" : ", ");
        }
        output
            << "],\n"
            << "      \"sourceQualification\": \"" << load.source_qualification << "\",\n"
            << "      \"parameterStatus\": \"" << load.parameter_status << "\",\n"
            << "      \"toleranceVelocityRelative\": " << load.tolerance_velocity_relative << ",\n"
            << "      \"maximumVelocityRelative\": " << load.maximum_velocity_relative << ",\n"
            << "      \"passed\": " << (load.passed ? "true" : "false") << ",\n"
            << "      \"samples\": [\n";
        for (std::size_t sample_index = 0; sample_index < load.samples.size(); ++sample_index)
        {
            const auto& sample = load.samples[sample_index];
            output
                << "        {\n"
                << "          \"distanceM\": " << sample.distance_m << ",\n"
                << "          \"publishedVelocityMps\": " << sample.published_velocity_mps << ",\n"
                << "          \"predictedVelocityMps\": " << sample.predicted_velocity_mps << ",\n"
                << "          \"velocityRelativeResidual\": " << sample.velocity_relative_residual
                << "\n"
                << "        }" << (sample_index + 1 == load.samples.size() ? "\n" : ",\n");
        }
        output << "      ]\n"
               << "    }" << (load_index + 1 == loads.size() ? "\n" : ",\n");
    }
    output << "  ]\n}\n";
}

void write_atmosphere_report(
    const std::filesystem::path& path,
    bool passed,
    double density_tolerance_relative,
    double maximum_density_relative,
    const std::vector<AtmosphereDensitySample>& density_samples,
    double sound_speed_tolerance_relative,
    double maximum_sound_speed_relative,
    const std::vector<AtmosphereSoundSpeedSample>& sound_speed_samples,
    double viscosity_tolerance_relative,
    double maximum_viscosity_relative,
    const std::vector<AtmosphereViscositySample>& viscosity_samples
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
        << "  \"reportType\": \"atmosphere_property_conformance\",\n"
        << "  \"engineVersion\": \"" << ballistics::engine_version << "\",\n"
        << "  \"modelVersion\": \"" << ballistics::model_version << "\",\n"
        << "  \"compiler\": \"" << compiler_identity() << "\",\n"
        << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
        << "  \"density\": {\n"
        << "    \"sourceDatasetId\": \"reference-atmosphere-cipm-2007\",\n"
        << "    \"referenceModel\": \"CIPM-2007 moist-air density\",\n"
        << "    \"productionModel\": \"ideal moist-air mixture\",\n"
        << "    \"declaredDomain\": {\n"
        << "      \"temperatureC\": [15, 27],\n"
        << "      \"stationPressureHpa\": [600, 1100],\n"
        << "      \"relativeHumidityPercent\": [0, 100]\n"
        << "    },\n"
        << "    \"toleranceRelative\": " << density_tolerance_relative << ",\n"
        << "    \"maximumRelative\": " << maximum_density_relative << ",\n"
        << "    \"passed\": "
        << (maximum_density_relative <= density_tolerance_relative ? "true" : "false") << ",\n"
        << "    \"samples\": [\n";
    for (std::size_t index = 0; index < density_samples.size(); ++index)
    {
        const auto& sample = density_samples[index];
        output
            << "      {\n"
            << "        \"temperatureC\": " << sample.temperature_c << ",\n"
            << "        \"stationPressureHpa\": " << sample.station_pressure_hpa << ",\n"
            << "        \"relativeHumidityPercent\": " << sample.relative_humidity_percent << ",\n"
            << "        \"referenceDensityKgM3\": " << sample.reference_density_kg_m3 << ",\n"
            << "        \"productionDensityKgM3\": " << sample.production_density_kg_m3 << ",\n"
            << "        \"relativeResidual\": " << sample.density_relative_residual << "\n"
            << "      }" << (index + 1 == density_samples.size() ? "\n" : ",\n");
    }
    output
        << "    ]\n"
        << "  },\n"
        << "  \"speedOfSound\": {\n"
        << "    \"sourceDatasetId\": \"reference-atmosphere-sound-speed-gavioso-2025\",\n"
        << "    \"referenceModel\": \"Gavioso et al. 2025 humid-air model\",\n"
        << "    \"productionModel\": \"fixed-gamma ideal moist-air mixture\",\n"
        << "    \"declaredDomain\": {\n"
        << "      \"temperatureC\": [0, 30],\n"
        << "      \"stationPressureHpa\": [1013.25, 1013.25],\n"
        << "      \"relativeHumidityPercent\": [40, 80],\n"
        << "      \"acousticFrequencyHz\": [0, 0]\n"
        << "    },\n"
        << "    \"toleranceRelative\": " << sound_speed_tolerance_relative << ",\n"
        << "    \"maximumRelative\": " << maximum_sound_speed_relative << ",\n"
        << "    \"passed\": "
        << (maximum_sound_speed_relative <= sound_speed_tolerance_relative ? "true" : "false")
        << ",\n"
        << "    \"samples\": [\n";
    for (std::size_t index = 0; index < sound_speed_samples.size(); ++index)
    {
        const auto& sample = sound_speed_samples[index];
        output
            << "      {\n"
            << "        \"temperatureC\": " << sample.temperature_c << ",\n"
            << "        \"stationPressureHpa\": " << sample.station_pressure_hpa << ",\n"
            << "        \"relativeHumidityPercent\": " << sample.relative_humidity_percent << ",\n"
            << "        \"co2MoleFraction\": " << sample.co2_mole_fraction << ",\n"
            << "        \"acousticFrequencyHz\": " << sample.acoustic_frequency_hz << ",\n"
            << "        \"referenceSpeedMps\": " << sample.reference_speed_of_sound_mps << ",\n"
            << "        \"referenceStandardUncertaintyMps\": "
            << sample.reference_standard_uncertainty_mps << ",\n"
            << "        \"productionSpeedMps\": " << sample.production_speed_of_sound_mps << ",\n"
            << "        \"relativeResidual\": " << sample.speed_of_sound_relative_residual << "\n"
            << "      }" << (index + 1 == sound_speed_samples.size() ? "\n" : ",\n");
    }
    output
        << "    ]\n"
        << "  },\n"
        << "  \"dynamicViscosity\": {\n"
        << "    \"sourceDatasetId\": \"reference-air-viscosity-naca-1135\",\n"
        << "    \"referenceModel\": \"NACA Report 1135 Sutherland equation A3\",\n"
        << "    \"productionModel\": \"SI Sutherland equation\",\n"
        << "    \"declaredDomain\": {\n"
        << "      \"temperatureC\": [-60, 60]\n"
        << "    },\n"
        << "    \"toleranceRelative\": " << viscosity_tolerance_relative << ",\n"
        << "    \"maximumRelative\": " << maximum_viscosity_relative << ",\n"
        << "    \"passed\": "
        << (maximum_viscosity_relative <= viscosity_tolerance_relative ? "true" : "false") << ",\n"
        << "    \"samples\": [\n";
    for (std::size_t index = 0; index < viscosity_samples.size(); ++index)
    {
        const auto& sample = viscosity_samples[index];
        output
            << "      {\n"
            << "        \"temperatureC\": " << sample.temperature_c << ",\n"
            << "        \"referenceViscosityPaS\": " << sample.reference_dynamic_viscosity_pa_s
            << ",\n"
            << "        \"productionViscosityPaS\": " << sample.production_dynamic_viscosity_pa_s
            << ",\n"
            << "        \"relativeResidual\": " << sample.dynamic_viscosity_relative_residual
            << "\n"
            << "      }" << (index + 1 == viscosity_samples.size() ? "\n" : ",\n");
    }
    output << "    ]\n"
           << "  }\n"
           << "}\n";
}

} // namespace

int main(
    int argc,
    char** argv
)
{
    using namespace ballistics;

    std::filesystem::path report_path = "g7-independent-residuals.json";
    std::filesystem::path manufacturer_report_path = "manufacturer-conformance-residuals.json";
    std::filesystem::path atmosphere_report_path = "atmosphere-conformance-residuals.json";
    for (int index = 1; index < argc; index += 2)
    {
        if (index + 1 >= argc)
        {
            std::cerr << "usage: Ballistics.Validation.Tests [--report PATH] "
                         "[--manufacturer-report PATH] [--atmosphere-report PATH]\n";
            return 2;
        }
        const std::string_view option = argv[index];
        if (option == "--report")
        {
            report_path = argv[index + 1];
        }
        else if (option == "--manufacturer-report")
        {
            manufacturer_report_path = argv[index + 1];
        }
        else if (option == "--atmosphere-report")
        {
            atmosphere_report_path = argv[index + 1];
        }
        else
        {
            std::cerr << "usage: Ballistics.Validation.Tests [--report PATH] "
                         "[--manufacturer-report PATH] [--atmosphere-report PATH]\n";
            return 2;
        }
    }

    const std::filesystem::path source_directory = BALLISTICS_SOURCE_DIR;
    std::vector<std::string> failures;

    try
    {
        const auto g1_bands =
            read_g1_bands(source_directory / "validation/sources/g1-gnu-ballistics.csv");
        if (g1_bands.size() != 39)
        {
            failures.push_back("G1 source does not contain 39 effective bands");
        }

        constexpr double standard_speed_of_sound_mps = 340.294;
        constexpr double boundary_offset_fps = 1e-4;
        for (std::size_t index = 0; index < g1_bands.size(); ++index)
        {
            const auto& band = g1_bands[index];
            const auto upper_threshold =
                index == 0 ? band.threshold_fps + 200.0 : g1_bands[index - 1].threshold_fps;
            const auto segment_speed_fps = (band.threshold_fps + upper_threshold) / 2.0;
            const auto segment_mach = segment_speed_fps * fps_to_mps / standard_speed_of_sound_mps;
            const auto expected_segment_cd = g1_expected_cd(band, segment_speed_fps);
            const auto actual_segment_cd = g1_drag_coefficient(segment_mach);
            if (!nearly_equal(actual_segment_cd, expected_segment_cd))
            {
                record_failure(
                    failures,
                    "G1 segment " + std::to_string(index),
                    actual_segment_cd,
                    expected_segment_cd,
                    1e-12
                );
            }

            if (band.threshold_fps > 0.0)
            {
                const auto upper_speed_fps = band.threshold_fps + boundary_offset_fps;
                const auto upper_mach = upper_speed_fps * fps_to_mps / standard_speed_of_sound_mps;
                const auto expected_upper_cd = g1_expected_cd(band, upper_speed_fps);
                const auto actual_upper_cd = g1_drag_coefficient(upper_mach);
                if (!nearly_equal(actual_upper_cd, expected_upper_cd))
                {
                    record_failure(
                        failures,
                        "G1 upper boundary " + std::to_string(index),
                        actual_upper_cd,
                        expected_upper_cd,
                        1e-12
                    );
                }

                if (index + 1 < g1_bands.size())
                {
                    const auto lower_speed_fps = band.threshold_fps - boundary_offset_fps;
                    const auto lower_mach =
                        lower_speed_fps * fps_to_mps / standard_speed_of_sound_mps;
                    const auto expected_lower_cd =
                        g1_expected_cd(g1_bands[index + 1], lower_speed_fps);
                    const auto actual_lower_cd = g1_drag_coefficient(lower_mach);
                    if (!nearly_equal(actual_lower_cd, expected_lower_cd))
                    {
                        record_failure(
                            failures,
                            "G1 lower boundary " + std::to_string(index),
                            actual_lower_cd,
                            expected_lower_cd,
                            1e-12
                        );
                    }
                }
            }
        }
        if (g1_drag_coefficient(0.0) != 0.0)
        {
            failures.push_back("G1 Mach-zero behavior changed");
        }

        const auto inventory =
            json::parse(read_text(source_directory / "validation/normalized/builtin-loads.json"));
        const auto& inventory_root = inventory.as_object();
        const auto& inventory_loads = array_field(inventory_root, "loads");
        const auto& built_ins = built_in_projectiles();
        if (inventory_loads.size() != built_ins.size())
        {
            failures.push_back("built-in provenance inventory count differs from production loads");
        }
        for (std::size_t index = 0; index < std::min(inventory_loads.size(), built_ins.size());
             ++index)
        {
            const auto& record = inventory_loads[index].as_object();
            const auto& implementation = object_field(record, "implementation");
            const auto& load = built_ins[index];
            if (string_field(record, "id") != load.provenance.id ||
                !nearly_equal(number_field(implementation, "massKg"), load.definition.mass_kg) ||
                !nearly_equal(
                    number_field(implementation, "muzzleVelocityMps"),
                    load.ammunition.muzzle_velocity_mps
                ) ||
                number_field(implementation, "pelletCount") != load.ammunition.payload_count)
            {
                failures.push_back(
                    "built-in inventory mismatch for index " + std::to_string(index)
                );
            }
        }

        const auto artifact =
            json::parse(read_text(source_directory / "validation/scenarios/g7-independent.json"));
        const auto& root = artifact.as_object();
        const auto scenario_set_id = string_field(root, "id");
        const auto& atmosphere_json = object_field(root, "atmosphere");
        const auto atmosphere = Atmosphere::create(
            number_field(atmosphere_json, "temperatureC"),
            number_field(atmosphere_json, "stationPressureHpa"),
            number_field(atmosphere_json, "relativeHumidityPercent"),
            number_field(atmosphere_json, "headwindMps"),
            number_field(atmosphere_json, "crosswindMps")
        );

        for (const auto& check_value : array_field(root, "aerodynamicChecks"))
        {
            const auto& check = check_value.as_object();
            const auto mach = number_field(check, "mach");
            const auto expected_cd = number_field(check, "dragCoefficient");
            const auto expected_acceleration = number_field(check, "accelerationMps2");
            auto projectile = built_ins[3];
            projectile.definition.drag = ReferenceBcDrag {
                ReferenceDragCurve::g7,
                ConstantBallisticCoefficient { number_field(check, "ballisticCoefficient") }
            };
            const auto speed_mps = mach * atmosphere.speed_of_sound_mps;
            const auto actual_cd = g7_drag_coefficient(mach);
            const auto actual_acceleration =
                drag_retardation_mps2(speed_mps, projectile, atmosphere);
            if (!nearly_equal(actual_cd, expected_cd))
            {
                record_failure(
                    failures,
                    "G7 independent Cd Mach " + std::to_string(mach),
                    actual_cd,
                    expected_cd,
                    1e-12
                );
            }
            if (!nearly_equal(actual_acceleration, expected_acceleration, 2e-12))
            {
                record_failure(
                    failures,
                    "G7 independent acceleration Mach " + std::to_string(mach),
                    actual_acceleration,
                    expected_acceleration,
                    2e-12
                );
            }
        }

        std::vector<ScenarioReport> scenario_reports;
        Residuals overall_maximum;
        for (const auto& scenario_value : array_field(root, "scenarios"))
        {
            const auto& scenario = scenario_value.as_object();
            ScenarioReport report;
            report.id = string_field(scenario, "id");
            report.regime = string_field(scenario, "regime");
            const auto& tolerances = object_field(scenario, "tolerances");
            const auto velocity_tolerance = number_field(tolerances, "velocityRelative");
            const auto time_tolerance = number_field(tolerances, "timeRelative");
            const auto position_tolerance = number_field(tolerances, "positionAbsoluteM");

            auto projectile = built_ins[3];
            projectile.provenance.id = "validation:" + report.id;
            projectile.definition.name = report.id;
            projectile.definition.short_name = report.id;
            projectile.ammunition.muzzle_velocity_mps = number_field(scenario, "muzzleVelocityMps");
            projectile.definition.drag = ReferenceBcDrag {
                ReferenceDragCurve::g7,
                ConstantBallisticCoefficient { number_field(scenario, "ballisticCoefficient") }
            };
            const auto maximum_distance_m = number_field(scenario, "maximumDistanceM");
            const auto trajectory =
                integrate_trajectory(projectile, atmosphere, maximum_distance_m);

            if (trajectory.termination != TrajectoryTermination::requested_distance)
            {
                failures.push_back(report.id + " did not cover its requested validation range");
                report.passed = false;
            }
            for (const auto& sample_value : array_field(scenario, "samples"))
            {
                const auto& expected = sample_value.as_object();
                const auto distance_m = number_field(expected, "distanceM");
                const auto actual = trajectory.sample_at(distance_m);
                if (!actual)
                {
                    failures.push_back(
                        report.id + " has no production sample at " + std::to_string(distance_m) +
                        " m"
                    );
                    report.passed = false;
                    continue;
                }
                Residuals residual {
                    relative_residual(actual->ground_speed_mps, number_field(expected, "speedMps")),
                    relative_residual(actual->time_s, number_field(expected, "timeS")),
                    std::abs(actual->position_m.y - number_field(expected, "verticalPositionM"))
                };
                report.maximum_residuals.include(residual);
                if (residual.velocity_relative > velocity_tolerance ||
                    residual.time_relative > time_tolerance ||
                    residual.position_absolute_m > position_tolerance)
                {
                    report.passed = false;
                }
            }
            if (!report.passed)
            {
                failures.push_back(
                    report.id + " exceeds its declared independent-reference tolerance"
                );
            }
            overall_maximum.include(report.maximum_residuals);
            scenario_reports.push_back(report);
        }

        write_report(
            report_path,
            scenario_set_id,
            failures.empty(),
            overall_maximum,
            scenario_reports
        );

        constexpr double atmosphere_property_tolerance = 0.001;
        auto density_samples = read_atmosphere_densities(
            source_directory / "validation/sources/atmosphere-cipm-2007.csv"
        );
        const auto atmosphere_failure_start = failures.size();
        double maximum_atmosphere_density_residual = 0.0;
        for (auto& sample : density_samples)
        {
            const auto production = Atmosphere::create(
                sample.temperature_c,
                sample.station_pressure_hpa,
                sample.relative_humidity_percent,
                0.0,
                0.0
            );
            sample.production_density_kg_m3 = production.density_kg_m3;
            sample.density_relative_residual =
                relative_residual(sample.production_density_kg_m3, sample.reference_density_kg_m3);
            maximum_atmosphere_density_residual =
                std::max(maximum_atmosphere_density_residual, sample.density_relative_residual);
            if (sample.density_relative_residual > atmosphere_property_tolerance)
            {
                record_failure(
                    failures,
                    "atmosphere density at " + std::to_string(sample.temperature_c) + " C, " +
                        std::to_string(sample.station_pressure_hpa) + " hPa, " +
                        std::to_string(sample.relative_humidity_percent) + "% RH",
                    sample.production_density_kg_m3,
                    sample.reference_density_kg_m3,
                    atmosphere_property_tolerance
                );
            }
        }

        auto sound_speed_samples = read_atmosphere_sound_speeds(
            source_directory / "validation/sources/atmosphere-sound-speed-gavioso-2025.csv"
        );
        double maximum_atmosphere_sound_speed_residual = 0.0;
        for (auto& sample : sound_speed_samples)
        {
            const auto production = Atmosphere::create(
                sample.temperature_c,
                sample.station_pressure_hpa,
                sample.relative_humidity_percent,
                0.0,
                0.0
            );
            sample.production_speed_of_sound_mps = production.speed_of_sound_mps;
            sample.speed_of_sound_relative_residual = relative_residual(
                sample.production_speed_of_sound_mps,
                sample.reference_speed_of_sound_mps
            );
            maximum_atmosphere_sound_speed_residual = std::max(
                maximum_atmosphere_sound_speed_residual,
                sample.speed_of_sound_relative_residual
            );
            if (sample.speed_of_sound_relative_residual > atmosphere_property_tolerance)
            {
                record_failure(
                    failures,
                    "atmosphere sound speed at " + std::to_string(sample.temperature_c) + " C, " +
                        std::to_string(sample.station_pressure_hpa) + " hPa, " +
                        std::to_string(sample.relative_humidity_percent) + "% RH",
                    sample.production_speed_of_sound_mps,
                    sample.reference_speed_of_sound_mps,
                    atmosphere_property_tolerance
                );
            }
        }

        auto viscosity_samples = read_atmosphere_viscosities(
            source_directory / "validation/sources/air-viscosity-naca-1135.csv"
        );
        double maximum_atmosphere_viscosity_residual = 0.0;
        for (auto& sample : viscosity_samples)
        {
            const auto production =
                Atmosphere::create(sample.temperature_c, 1013.25, 0.0, 0.0, 0.0);
            sample.production_dynamic_viscosity_pa_s = production.dynamic_viscosity_pa_s;
            sample.dynamic_viscosity_relative_residual = relative_residual(
                sample.production_dynamic_viscosity_pa_s,
                sample.reference_dynamic_viscosity_pa_s
            );
            maximum_atmosphere_viscosity_residual = std::max(
                maximum_atmosphere_viscosity_residual,
                sample.dynamic_viscosity_relative_residual
            );
            if (sample.dynamic_viscosity_relative_residual > atmosphere_property_tolerance)
            {
                record_failure(
                    failures,
                    "atmosphere viscosity at " + std::to_string(sample.temperature_c) + " C",
                    sample.production_dynamic_viscosity_pa_s,
                    sample.reference_dynamic_viscosity_pa_s,
                    atmosphere_property_tolerance
                );
            }
        }

        const auto atmosphere_passed = failures.size() == atmosphere_failure_start;
        write_atmosphere_report(
            atmosphere_report_path,
            atmosphere_passed,
            atmosphere_property_tolerance,
            maximum_atmosphere_density_residual,
            density_samples,
            atmosphere_property_tolerance,
            maximum_atmosphere_sound_speed_residual,
            sound_speed_samples,
            atmosphere_property_tolerance,
            maximum_atmosphere_viscosity_residual,
            viscosity_samples
        );

        struct ManufacturerDefinition
        {
            std::size_t built_in_index;
            std::vector<std::string> source_paths;
            std::vector<std::string> source_dataset_ids;
            const char* source_qualification;
            const char* parameter_status;
            double velocity_tolerance;
        };
        const std::vector<ManufacturerDefinition> manufacturer_definitions {
            { 0,
              { "validation/sources/bp-white-blackout-hv-hunting-spot-2018.csv",
                "validation/sources/bp-white-blackout-hv-caccia-magazine-2019.csv" },
              { "manufacturer-attributed-bp-white-blackout-hv-2018",
                "secondary-bp-white-blackout-hv-caccia-magazine-2019" },
              "manufacturer_attributed_secondary_publication",
              "fitted_to_same_table",
              0.01 },
            { 1,
              { "validation/sources/bp-blackshock-hunting-spot-2018.csv" },
              { "manufacturer-attributed-bp-blackshock-2018" },
              "manufacturer_attributed_secondary_publication",
              "fitted_to_same_table",
              0.01 },
            { 2,
              { "validation/sources/winchester-x123rs15-2026.csv" },
              { "manufacturer-winchester-x123rs15-2026" },
              "primary_manufacturer_publication",
              "manufacturer_published",
              0.005 },
            { 3,
              { "validation/sources/hornady-80971-2022.csv" },
              { "manufacturer-hornady-80971-2022" },
              "primary_manufacturer_publication",
              "manufacturer_published",
              0.005 },
            { 4,
              { "validation/sources/federal-308a-2022.csv" },
              { "manufacturer-federal-308a-2022" },
              "primary_manufacturer_publication",
              "fitted_to_same_table",
              0.005 },
        };
        const auto manufacturer_atmosphere = Atmosphere::create(15.0, 1013.25, 0.0, 0.0, 0.0);
        std::vector<ManufacturerLoadReport> manufacturer_reports;
        const auto manufacturer_failure_start = failures.size();
        for (const auto& definition : manufacturer_definitions)
        {
            std::vector<PublishedVelocity> source_samples;
            for (const auto& source_path : definition.source_paths)
            {
                const auto file_samples =
                    read_manufacturer_velocities(source_directory / source_path);
                source_samples
                    .insert(source_samples.end(), file_samples.begin(), file_samples.end());
            }
            std::ranges::sort(source_samples, {}, &PublishedVelocity::distance_m);
            const auto maximum_distance_m = source_samples.back().distance_m;
            const auto trajectory = integrate_trajectory(
                built_ins[definition.built_in_index],
                manufacturer_atmosphere,
                maximum_distance_m
            );
            ManufacturerLoadReport report;
            report.load_id = built_ins[definition.built_in_index].provenance.id;
            report.source_dataset_ids = definition.source_dataset_ids;
            report.source_qualification = definition.source_qualification;
            report.parameter_status = definition.parameter_status;
            report.tolerance_velocity_relative = definition.velocity_tolerance;
            if (trajectory.termination != TrajectoryTermination::requested_distance)
            {
                failures.push_back(report.load_id + " did not cover its manufacturer table range");
                report.passed = false;
            }
            for (const auto& published : source_samples)
            {
                const auto actual = trajectory.sample_at(published.distance_m);
                if (!actual)
                {
                    failures.push_back(
                        report.load_id + " has no sample at manufacturer distance " +
                        std::to_string(published.distance_m) + " m"
                    );
                    report.passed = false;
                    continue;
                }
                const auto residual =
                    relative_residual(actual->ground_speed_mps, published.velocity_mps);
                report.maximum_velocity_relative =
                    std::max(report.maximum_velocity_relative, residual);
                report.samples.push_back(
                    { published.distance_m,
                      published.velocity_mps,
                      actual->ground_speed_mps,
                      residual }
                );
            }
            if (report.maximum_velocity_relative > report.tolerance_velocity_relative)
            {
                failures.push_back(
                    report.load_id + " exceeds its manufacturer-table velocity tolerance"
                );
                report.passed = false;
            }
            manufacturer_reports.push_back(std::move(report));
        }
        const auto manufacturer_passed = failures.size() == manufacturer_failure_start;
        write_manufacturer_report(
            manufacturer_report_path,
            manufacturer_passed,
            manufacturer_reports
        );
    }
    catch (const std::exception& error)
    {
        failures.push_back(std::string("validation test exception: ") + error.what());
    }

    for (const auto& failure : failures)
    {
        std::cerr << failure << '\n';
    }
    if (!failures.empty())
    {
        return 1;
    }
    std::cout << "G1 boundary data, built-in provenance inventory, independent G7 scenarios, "
                 "atmosphere-property conformance, and manufacturer-table conformance passed.\n";
    return 0;
}
