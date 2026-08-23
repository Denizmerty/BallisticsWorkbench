#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>

#include "cli_input.hpp"
#include "protocol.hpp"

namespace
{

void expect_true(
    const char* label,
    bool value
)
{
    if (!value)
    {
        std::cerr << label << " failed\n";
        std::exit(1);
    }
}

const char* valid_request = R"json({
  "protocolVersion": 2,
  "requestId": "protocol-test",
  "scenario": {
    "displayDistanceM": 100,
    "solutionHorizonM": 500,
    "vitalZoneM": 0.2,
    "atmosphere": {
      "temperatureC": 15,
      "stationPressureHpa": 1013.25,
      "relativeHumidityPercent": 50,
      "headwindMps": 0,
      "crosswindMps": 0
    },
    "firearms": {
      "shotgun": {
        "sightHeightM": 0.025,
        "zeroRangeM": 50,
        "muzzleVelocityMultiplier": 1
      },
      "rifle": {
        "sightHeightM": 0.04,
        "zeroRangeM": 100,
        "muzzleVelocityMultiplier": 1,
        "twistInches": 10,
        "twistDirection": 1
      }
    },
    "uncertainty": {
      "method": "firstOrder",
      "sampleCount": 1000,
      "seed": 1113017667,
      "correlations": [],
      "shotgunMuzzleVelocityStandardDeviationMps": 2,
      "rifleMuzzleVelocityStandardDeviationMps": 3,
      "dragRelativeStandardDeviation": 0.02,
      "temperatureStandardDeviationC": 1,
      "stationPressureStandardDeviationHpa": 2,
      "headwindStandardDeviationMps": 0.5,
      "crosswindStandardDeviationMps": 1,
      "shotgunZeroRangeStandardDeviationM": 1,
      "rifleZeroRangeStandardDeviationM": 1.5
    },
    "buckshotPattern": {
      "loadId": "custom:sphere",
      "choke": "modified",
      "deformationClass": "hardenedLead",
      "pelletVelocityStandardDeviationMps": 5,
      "targetRangeM": 20,
      "minimumPelletCount": 3,
      "target": {
        "shape": "circle",
        "widthM": 0.3,
        "heightM": 0.3,
        "centerHorizontalM": 0,
        "centerVerticalM": 0
      },
      "observations": [
        {"rangeM": 10, "diameter90M": 0.4, "standardUncertaintyM": 0.02, "shellCount": 5, "role": "calibration"},
        {"rangeM": 20, "diameter90M": 0.8, "standardUncertaintyM": 0.03, "shellCount": 5, "role": "calibration"},
        {"rangeM": 30, "diameter90M": 1.22, "standardUncertaintyM": 0.04, "shellCount": 5, "role": "holdout"}
      ]
    }
  },
  "customLoads": [
    {
      "id": "custom:g7",
      "name": "Unicode \u00c7al\u0131\u015fma",
      "firearmGroup": "rifle",
      "muzzleVelocityMps": 800,
      "pelletCount": 1,
      "massKg": 0.01,
      "drag": {
        "kind": "referenceBc",
        "curve": "G7",
        "ballisticCoefficient": 0.25
      },
      "bulletGeometry": {
        "lengthInches": 1.2,
        "diameterInches": 0.308,
        "twistInches": 8
      }
    },
    {
      "id": "custom:sphere",
      "name": "Sphere",
      "firearmGroup": "shotgun",
      "muzzleVelocityMps": 400,
      "pelletCount": 9,
      "drag": {
        "kind": "sphere",
        "diameterM": 0.00838,
        "materialDensityKgM3": 11340
      }
    }
  ]
})json";

const char* valid_calibration_request = R"json({
  "protocolVersion": 2,
  "requestId": "calibration-test",
  "operation": "calibrateReferenceBc",
  "atmosphere": {
    "temperatureC": 15,
    "stationPressureHpa": 1013.25,
    "relativeHumidityPercent": 50,
    "headwindMps": 0,
    "crosswindMps": 0
  },
  "projectile": {
    "curve": "G7",
    "massKg": 0.0109,
    "muzzleVelocityMps": 820,
    "initialBallisticCoefficient": 0.35
  },
  "fit": {
    "kind": "velocityBands",
    "minimumVelocitiesMps": [0, 700]
  },
  "observations": [
    {"distanceM": 100, "velocityMps": 750, "standardDeviationMps": 1, "role": "calibration"},
    {"distanceM": 200, "velocityMps": 690, "standardDeviationMps": 1, "role": "calibration"},
    {"distanceM": 300, "velocityMps": 635, "standardDeviationMps": 1, "role": "calibration"},
    {"distanceM": 400, "velocityMps": 585, "standardDeviationMps": 1, "role": "holdout"}
  ]
})json";

std::string request_with_custom_load_name(
    std::string name
)
{
    auto request = std::string(valid_request);
    const auto marker = request.find("\"name\": \"");
    const auto start = marker + std::string("\"name\": \"").size();
    const auto end = request.find('"', start);
    request.replace(start, end - start, std::move(name));
    return request;
}

} // namespace

int main()
{
    using namespace ballistics;
    const auto parsed = protocol::parse_request(valid_request);
    expect_true("valid request accepted", parsed.request.has_value() && parsed.issues.empty());
    expect_true("request ID preserved", parsed.request->request_id == "protocol-test");
    expect_true("multiple custom loads parsed", parsed.request->custom_loads.size() == 2);
    expect_true(
        "G7 discriminant parsed",
        drag_model(parsed.request->custom_loads[0]) == DragModel::g7
    );
    expect_true(
        "sphere discriminant parsed",
        drag_model(parsed.request->custom_loads[1]) == DragModel::sphere
    );
    expect_true(
        "Unicode escape decoded",
        parsed.request->custom_loads[0].definition.name ==
            "Unicode \xc3\x87"
            "al\xc4\xb1\xc5\x9fma"
    );

    std::string maximum_unicode_name;
    for (int index = 0; index < 60; ++index)
    {
        maximum_unicode_name += "\xc3\x87";
    }
    const auto maximum_unicode_request =
        protocol::parse_request(request_with_custom_load_name(maximum_unicode_name));
    expect_true(
        "120-byte Unicode load name accepted",
        maximum_unicode_request.request &&
            maximum_unicode_request.request->custom_loads[0].definition.name.size() == 120
    );
    maximum_unicode_name += "\xc3\x87";
    const auto oversized_unicode_request =
        protocol::parse_request(request_with_custom_load_name(maximum_unicode_name));
    expect_true(
        "122-byte Unicode load name rejected",
        !oversized_unicode_request.request &&
            std::any_of(
                oversized_unicode_request.issues.begin(),
                oversized_unicode_request.issues.end(),
                [](const auto& issue) { return issue.code == "custom_load.name.length"; }
            )
    );

    auto maximum_request = std::string(valid_request);
    maximum_request.append(protocol::maximum_request_bytes - maximum_request.size(), ' ');
    expect_true(
        "exact maximum-byte request accepted",
        protocol::parse_request(maximum_request).request.has_value()
    );
    std::istringstream maximum_stream(maximum_request);
    expect_true(
        "standard input preserves exact maximum-byte request",
        cli::read_standard_input(maximum_stream).size() == protocol::maximum_request_bytes
    );
    maximum_request.push_back(' ');
    std::istringstream oversized_stream(maximum_request);
    const auto oversized_input = cli::read_standard_input(oversized_stream);
    expect_true(
        "standard input retains enough bytes for oversize rejection",
        oversized_input.size() > protocol::maximum_request_bytes &&
            protocol::parse_request(oversized_input).issues[0].code == "protocol.request.too_large"
    );
    expect_true(
        "uncertainty block parsed",
        parsed.request->scenario.uncertainty.has_value() &&
            parsed.request->scenario.uncertainty->rifle_muzzle_velocity_standard_deviation_mps ==
                3.0 &&
            parsed.request->scenario.uncertainty->drag_relative_standard_deviation == 0.02 &&
            parsed.request->scenario.uncertainty->rifle_zero_range_standard_deviation_m == 1.5
    );
    expect_true(
        "buckshot pattern evidence parsed",
        parsed.request->scenario.buckshot_pattern.has_value() &&
            parsed.request->scenario.buckshot_pattern->load_id == "custom:sphere" &&
            parsed.request->scenario.buckshot_pattern->input.observations.size() == 3
    );

    auto negative_uncertainty = std::string(valid_request);
    const auto drag_sd = negative_uncertainty.find("\"dragRelativeStandardDeviation\": 0.02");
    negative_uncertainty.replace(
        drag_sd,
        std::string("\"dragRelativeStandardDeviation\": 0.02").size(),
        "\"dragRelativeStandardDeviation\": -0.02"
    );
    const auto invalid_uncertainty = protocol::parse_request(negative_uncertainty);
    expect_true(
        "negative uncertainty rejected",
        !invalid_uncertainty.request && !invalid_uncertainty.issues.empty()
    );

    auto unknown_uncertainty = std::string(valid_request);
    const auto uncertainty_end =
        unknown_uncertainty.find("\n    }", unknown_uncertainty.find("\"uncertainty\""));
    unknown_uncertainty.insert(uncertainty_end, ",\n      \"unexpected\": 1");
    const auto invalid_uncertainty_field = protocol::parse_request(unknown_uncertainty);
    expect_true(
        "unknown uncertainty field rejected",
        !invalid_uncertainty_field.request &&
            std::any_of(
                invalid_uncertainty_field.issues.begin(),
                invalid_uncertainty_field.issues.end(),
                [](const auto& issue) { return issue.code == "protocol.field.unknown"; }
            )
    );

    const auto calibration = protocol::parse_request(valid_calibration_request);
    expect_true(
        "calibration request accepted",
        calibration.request.has_value() && calibration.issues.empty()
    );
    expect_true(
        "calibration operation parsed",
        calibration.request->operation == protocol::RequestOperation::calibrate_reference_bc
    );
    expect_true(
        "calibration curve and fit parsed",
        drag_model(calibration.request->calibration.projectile) == DragModel::g7 &&
            calibration.request->calibration.fit_kind == BcFitKind::velocity_bands &&
            calibration.request->calibration.band_minimum_velocities_mps.size() == 2
    );
    expect_true(
        "calibration observation roles and uncertainty parsed",
        calibration.request->calibration.observations.size() == 4 &&
            calibration.request->calibration.observations[0].standard_deviation_mps == 1.0 &&
            calibration.request->calibration.observations[3].role == ObservationRole::holdout
    );

    auto unordered_observations = std::string(valid_calibration_request);
    const auto third_distance = unordered_observations.find("\"distanceM\": 300");
    unordered_observations
        .replace(third_distance, std::string("\"distanceM\": 300").size(), "\"distanceM\": 150");
    const auto invalid_observation_order = protocol::parse_request(unordered_observations);
    expect_true(
        "unordered calibration observations rejected",
        !invalid_observation_order.request &&
            std::any_of(
                invalid_observation_order.issues.begin(),
                invalid_observation_order.issues.end(),
                [](const auto& issue) { return issue.code == "calibration.observations.order"; }
            )
    );

    auto insufficient_observations = std::string(valid_calibration_request);
    const auto second_role = insufficient_observations.find(
        "\"role\": \"calibration\"",
        insufficient_observations.find("\"distanceM\": 200")
    );
    insufficient_observations.replace(
        second_role,
        std::string("\"role\": \"calibration\"").size(),
        "\"role\": \"holdout\""
    );
    const auto third_role = insufficient_observations.find(
        "\"role\": \"calibration\"",
        insufficient_observations.find("\"distanceM\": 300")
    );
    insufficient_observations.replace(
        third_role,
        std::string("\"role\": \"calibration\"").size(),
        "\"role\": \"holdout\""
    );
    const auto invalid_information = protocol::parse_request(insufficient_observations);
    expect_true(
        "too few calibration observations rejected",
        !invalid_information.request &&
            std::any_of(
                invalid_information.issues.begin(),
                invalid_information.issues.end(),
                [](const auto& issue)
                { return issue.code == "calibration.observations.insufficient"; }
            )
    );

    auto invalid_thresholds = std::string(valid_calibration_request);
    const auto thresholds = invalid_thresholds.find("[0, 700]");
    invalid_thresholds.replace(thresholds, std::string("[0, 700]").size(), "[100, 700]");
    const auto invalid_band_coverage = protocol::parse_request(invalid_thresholds);
    expect_true(
        "calibration bands must begin at zero",
        !invalid_band_coverage.request &&
            std::any_of(
                invalid_band_coverage.issues.begin(),
                invalid_band_coverage.issues.end(),
                [](const auto& issue) { return issue.code == "calibration.fit.band_coverage"; }
            )
    );

    auto banded_text = std::string(valid_request);
    const auto scalar_bc = banded_text.find("\"ballisticCoefficient\": 0.25");
    banded_text.replace(
        scalar_bc,
        std::string("\"ballisticCoefficient\": 0.25").size(),
        "\"velocityBands\":[{\"minimumVelocityMps\":0,\"ballisticCoefficient\":0.2},"
        "{\"minimumVelocityMps\":400,\"ballisticCoefficient\":0.25}]"
    );
    const auto banded = protocol::parse_request(banded_text);
    const auto* parsed_reference =
        banded.request ? reference_bc_drag(banded.request->custom_loads[0]) : nullptr;
    expect_true(
        "velocity-banded request accepted",
        parsed_reference &&
            std::holds_alternative<BandedBallisticCoefficient>(parsed_reference->coefficient)
    );
    const auto& parsed_bands =
        std::get<BandedBallisticCoefficient>(parsed_reference->coefficient).bands;
    expect_true(
        "velocity-band values preserved",
        parsed_bands[1].minimum_velocity_mps == 400.0 &&
            parsed_bands[1].ballistic_coefficient == 0.25
    );

    auto tabulated_text = std::string(valid_request);
    const auto drag_start = tabulated_text.find("\"drag\": {");
    const auto drag_end = tabulated_text.find("\n      },", drag_start);
    const std::string tabulated_drag =
        R"json("drag":{"kind":"tabulatedCd",)json"
        R"json("referenceDiameterM":0.00782,"points":[)json"
        R"json({"mach":0.5,"dragCoefficient":0.2},)json"
        R"json({"mach":1.2,"dragCoefficient":0.4},)json"
        R"json({"mach":3,"dragCoefficient":0.24}]})json";
    tabulated_text.replace(
        drag_start,
        drag_end - drag_start + std::string("\n      }").size(),
        tabulated_drag
    );
    const auto tabulated = protocol::parse_request(tabulated_text);
    expect_true(
        "tabulated Mach-Cd request accepted",
        tabulated.request &&
            drag_model(tabulated.request->custom_loads[0]) == DragModel::tabulated_cd
    );
    const auto* parsed_tabulated = tabulated.request
        ? ballistics::tabulated_drag(tabulated.request->custom_loads[0])
        : nullptr;
    expect_true(
        "tabulated Mach-Cd values preserved",
        parsed_tabulated && parsed_tabulated->reference_diameter_m == 0.00782 &&
            parsed_tabulated->points.size() == 3 &&
            parsed_tabulated->points[1].drag_coefficient == 0.4
    );

    auto unordered_curve = tabulated_text;
    const auto second_mach = unordered_curve.find("\"mach\":1.2");
    unordered_curve.replace(second_mach, std::string("\"mach\":1.2").size(), "\"mach\":0.4");
    const auto invalid_curve = protocol::parse_request(unordered_curve);
    expect_true(
        "unordered Mach-Cd curve rejected",
        !invalid_curve.request &&
            std::any_of(
                invalid_curve.issues.begin(),
                invalid_curve.issues.end(),
                [](const auto& issue) { return issue.code == "projectile.mach_cd.order"; }
            )
    );

    auto both_bc_forms = std::string(valid_request);
    const auto bc_insertion = both_bc_forms.find("\"ballisticCoefficient\": 0.25");
    both_bc_forms.insert(
        bc_insertion,
        "\"velocityBands\":[{\"minimumVelocityMps\":0,"
        "\"ballisticCoefficient\":0.2},{\"minimumVelocityMps\":400,"
        "\"ballisticCoefficient\":0.25}],"
    );
    const auto mutually_exclusive = protocol::parse_request(both_bc_forms);
    expect_true(
        "scalar and banded BC are mutually exclusive",
        !mutually_exclusive.request &&
            std::any_of(
                mutually_exclusive.issues.begin(),
                mutually_exclusive.issues.end(),
                [](const auto& issue) { return issue.code == "protocol.field.mutually_exclusive"; }
            )
    );

    auto unordered_bands = banded_text;
    const auto threshold = unordered_bands.find("\"minimumVelocityMps\":400");
    unordered_bands.replace(
        threshold,
        std::string("\"minimumVelocityMps\":400").size(),
        "\"minimumVelocityMps\":0"
    );
    const auto invalid_schedule = protocol::parse_request(unordered_bands);
    expect_true(
        "unordered velocity bands rejected",
        !invalid_schedule.request &&
            std::any_of(
                invalid_schedule.issues.begin(),
                invalid_schedule.issues.end(),
                [](const auto& issue) { return issue.code == "projectile.bc_schedule.order"; }
            )
    );

    const auto duplicate =
        protocol::parse_request(R"({"protocolVersion":2,"protocolVersion":2,"requestId":"x"})");
    expect_true(
        "duplicate JSON key rejected",
        !duplicate.request && !duplicate.issues.empty() &&
            duplicate.issues[0].code == "protocol.json.invalid"
    );

    auto invalid_utf8_text = std::string("{\"protocolVersion\":2,\"requestId\":\"");
    invalid_utf8_text.push_back(static_cast<char>(0xff));
    invalid_utf8_text += "\"}";
    const auto invalid_utf8 = protocol::parse_request(invalid_utf8_text);
    expect_true(
        "invalid UTF-8 rejected",
        !invalid_utf8.request && !invalid_utf8.issues.empty() &&
            invalid_utf8.issues[0].code == "protocol.json.invalid"
    );

    auto unsupported = std::string(valid_request);
    unsupported.replace(unsupported.find("\"protocolVersion\": 2"), 20, "\"protocolVersion\": 3");
    const auto wrong_version = protocol::parse_request(unsupported);
    expect_true("wrong version rejected", !wrong_version.request && !wrong_version.issues.empty());

    auto inconsistent = std::string(valid_request);
    const auto sphere_marker = inconsistent.find("\"id\": \"custom:sphere\"");
    const auto insertion = inconsistent.find("\"drag\":", sphere_marker);
    inconsistent.insert(insertion, "\"massKg\": 0.01,");
    const auto invalid_sphere = protocol::parse_request(inconsistent);
    expect_true("sphere plus mass rejected", !invalid_sphere.request);
    bool found_forbidden = false;
    for (const auto& issue : invalid_sphere.issues)
    {
        found_forbidden = found_forbidden || issue.code == "protocol.field.forbidden";
    }
    expect_true("sphere inconsistency is structured", found_forbidden);

    auto excessive_count = std::string(valid_request);
    const auto count_position = excessive_count.find("\"pelletCount\": 1");
    excessive_count.replace(count_position, 16, "\"pelletCount\": 1e30");
    const auto invalid_count = protocol::parse_request(excessive_count);
    expect_true("out-of-range integer rejected safely", !invalid_count.request);

    const auto response = protocol::error_response(
        "request\"id",
        { { "test.code", "test.field", "test message", ValidationSeverity::error } }
    );
    expect_true(
        "error response includes protocol version",
        response.find("\"protocolVersion\":" + std::to_string(protocol::current_version)) !=
            std::string::npos
    );
    expect_true(
        "error response includes model identity",
        response.find("\"engineVersion\":\"" + std::string(engine_version) + "\"") !=
                std::string::npos &&
            response.find("\"modelVersion\":\"" + std::string(model_version) + "\"") !=
                std::string::npos
    );
    expect_true(
        "error response escapes request ID",
        response.find("\"requestId\":\"request\\\"id\"") != std::string::npos
    );

    std::cout << "All protocol parsing tests passed.\n";
}
