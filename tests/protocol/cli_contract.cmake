if(NOT DEFINED BALLISTICS_CLI OR NOT DEFINED EXPECTED_ENGINE_VERSION OR
    NOT DEFINED EXPECTED_MODEL_VERSION OR NOT DEFINED VALID_REQUEST OR
    NOT DEFINED INVALID_REQUEST
)
    message(FATAL_ERROR "CLI contract test arguments are missing")
endif()

execute_process(
    COMMAND "${BALLISTICS_CLI}"
    INPUT_FILE "${VALID_REQUEST}"
    OUTPUT_VARIABLE valid_output
    ERROR_VARIABLE valid_error
    RESULT_VARIABLE valid_result
)
if(NOT valid_result EQUAL 0)
    message(FATAL_ERROR "Valid protocol request failed: ${valid_error}\n${valid_output}")
endif()
string(JSON valid_ok ERROR_VARIABLE json_error GET "${valid_output}" ok)
if(json_error OR NOT valid_ok)
    message(FATAL_ERROR "Valid response is not a successful JSON envelope: ${json_error}")
endif()
string(JSON request_id GET "${valid_output}" requestId)
if(NOT request_id STREQUAL "fixture-multiple-loads")
    message(FATAL_ERROR "Request ID was not echoed")
endif()
string(JSON engine_version GET "${valid_output}" engineVersion)
string(JSON model_version GET "${valid_output}" modelVersion)
if(NOT engine_version STREQUAL EXPECTED_ENGINE_VERSION OR
    NOT model_version STREQUAL EXPECTED_MODEL_VERSION
)
    message(FATAL_ERROR "Engine/model identity is missing from the response")
endif()
string(JSON load_count LENGTH "${valid_output}" loads)
if(NOT load_count EQUAL 9)
    message(FATAL_ERROR "Expected 9 loads from one request, got ${load_count}")
endif()
string(JSON first_custom_id GET "${valid_output}" loads 6 id)
string(JSON second_custom_id GET "${valid_output}" loads 7 id)
string(JSON third_custom_id GET "${valid_output}" loads 8 id)
if(NOT first_custom_id STREQUAL "custom:fixture-g7" OR
    NOT second_custom_id STREQUAL "custom:fixture-sphere" OR
    NOT third_custom_id STREQUAL "custom:fixture-mach-cd"
)
    message(FATAL_ERROR "Stable custom load IDs were not preserved")
endif()
string(JSON band_count LENGTH "${valid_output}" loads 6 ballisticCoefficientBands)
string(
    JSON high_speed_bc
    GET "${valid_output}" loads 6 ballisticCoefficientBands 2 ballisticCoefficient
)
if(NOT band_count EQUAL 3 OR NOT high_speed_bc EQUAL 0.28)
    message(FATAL_ERROR "Velocity-banded BC schedule was not preserved")
endif()
string(JSON sphere_validity GET "${valid_output}" loads 7 dragValidity status)
if(NOT sphere_validity STREQUAL "within_domain")
    message(FATAL_ERROR "In-domain sphere trajectory was reported outside model validity")
endif()
string(JSON mach_cd_model GET "${valid_output}" loads 8 dragModel)
string(JSON mach_cd_point_count LENGTH "${valid_output}" loads 8 machCdPoints)
string(JSON mach_cd_validity GET "${valid_output}" loads 8 dragValidity status)
string(JSON mach_cd_reference_diameter GET "${valid_output}" loads 8 dragReferenceDiameterM)
if(NOT mach_cd_model STREQUAL "MachCd" OR NOT mach_cd_point_count EQUAL 5 OR
    NOT mach_cd_validity STREQUAL "extrapolated" OR
    NOT mach_cd_reference_diameter EQUAL 0.00782
)
    message(FATAL_ERROR "Tabulated Mach-Cd metadata was not preserved")
endif()
string(FIND "${valid_output}" "\"code\":\"drag.tabulated_cd.outside_validity\"" mach_cd_warning)
if(mach_cd_warning EQUAL -1)
    message(FATAL_ERROR "Tabulated Mach-Cd endpoint clamping did not emit a structured warning")
endif()
string(JSON zeroing_status GET "${valid_output}" loads 3 zeroingStatus)
string(JSON bore_elevation GET "${valid_output}" loads 3 boreElevationRad)
string(JSON solver_mode GET "${valid_output}" loads 3 solverDiagnostics mode)
string(JSON accepted_steps GET "${valid_output}" loads 3 solverDiagnostics acceptedSteps)
string(JSON muzzle_path GET "${valid_output}" loads 3 points 0 pathM)
string(JSON muzzle_holdover GET "${valid_output}" loads 3 points 0 holdoverRad)
if(NOT zeroing_status STREQUAL "complete" OR bore_elevation LESS_EQUAL 0)
    message(FATAL_ERROR "Native sight zero metadata is missing or invalid")
endif()
if(NOT solver_mode STREQUAL "adaptive_time" OR accepted_steps LESS_EQUAL 0)
    message(FATAL_ERROR "Adaptive solver diagnostics are missing or invalid")
endif()
if(muzzle_path GREATER -0.0399 OR muzzle_path LESS -0.0401)
    message(FATAL_ERROR "Native muzzle path does not include the rifle sight offset")
endif()
if(muzzle_holdover GREATER 0.000000000001 OR muzzle_holdover LESS -0.000000000001)
    message(FATAL_ERROR "Native zero-distance holdover convention is invalid")
endif()
string(JSON event_horizon GET "${valid_output}" loads 6 trajectoryEvents analyzedDistanceM)
string(JSON zero_event_status GET "${valid_output}" loads 6 trajectoryEvents zeroCrossingsStatus)
string(JSON near_zero GET "${valid_output}" loads 6 trajectoryEvents nearZeroM)
string(JSON far_zero GET "${valid_output}" loads 6 trajectoryEvents farZeroM)
string(JSON ordinate_status GET "${valid_output}" loads 6 trajectoryEvents maximumOrdinateStatus)
string(
    JSON ordinate_distance
    GET "${valid_output}" loads 6 trajectoryEvents maximumOrdinateDistanceM
)
string(JSON ordinate_path GET "${valid_output}" loads 6 trajectoryEvents maximumOrdinatePathM)
string(JSON ground_status GET "${valid_output}" loads 6 trajectoryEvents groundIntersectionStatus)
string(JSON ground_distance GET "${valid_output}" loads 6 trajectoryEvents groundIntersectionM)
string(JSON supersonic_status GET "${valid_output}" loads 6 trajectoryEvents supersonicRangeStatus)
if(NOT event_horizon EQUAL 500 OR NOT zero_event_status STREQUAL "complete" OR
    near_zero LESS_EQUAL 0 OR near_zero GREATER_EQUAL far_zero OR
    far_zero LESS 99.99 OR far_zero GREATER 100.01
)
    message(FATAL_ERROR "Near/far sight-zero events are missing or inconsistent")
endif()
if(NOT ordinate_status STREQUAL "complete" OR ordinate_distance LESS_EQUAL near_zero OR
    ordinate_distance GREATER_EQUAL far_zero OR ordinate_path LESS_EQUAL 0
)
    message(FATAL_ERROR "Maximum-ordinate event is missing or inconsistent")
endif()
if(NOT ground_status STREQUAL "complete" OR ground_distance LESS_EQUAL far_zero OR
    NOT supersonic_status STREQUAL "horizon_limited"
)
    message(FATAL_ERROR "Ground/supersonic event availability is inconsistent")
endif()
string(JSON uncertainty_status GET "${valid_output}" loads 6 uncertainty status)
string(JSON uncertainty_active GET "${valid_output}" loads 6 uncertainty activeInputCount)
string(JSON uncertainty_completed GET "${valid_output}" loads 6 uncertainty completedInputCount)
string(JSON uncertainty_point_count LENGTH "${valid_output}" loads 6 uncertainty points)
string(JSON trajectory_point_count LENGTH "${valid_output}" loads 6 points)
string(
    JSON uncertainty_muzzle_distance
    GET "${valid_output}" loads 6 uncertainty points 0 distanceM
)
string(
    JSON uncertainty_muzzle_speed_sd
    GET "${valid_output}" loads 6 uncertainty points 0 speedStandardDeviationMps
)
string(
    JSON uncertainty_final_path_sd
    GET "${valid_output}" loads 6 uncertainty points 2 pathStandardDeviationM
)
if(NOT uncertainty_status STREQUAL "complete" OR NOT uncertainty_active EQUAL 2 OR
    NOT uncertainty_completed EQUAL 2 OR NOT uncertainty_point_count EQUAL trajectory_point_count
)
    message(FATAL_ERROR "Deterministic uncertainty status/count metadata is invalid")
endif()
if(NOT uncertainty_muzzle_distance EQUAL 0 OR uncertainty_muzzle_speed_sd LESS 2.999 OR
    uncertainty_muzzle_speed_sd GREATER 3.001 OR uncertainty_final_path_sd LESS_EQUAL 0
)
    message(FATAL_ERROR "Deterministic uncertainty samples are missing or invalid")
endif()

execute_process(
    COMMAND "${BALLISTICS_CLI}"
    INPUT_FILE "${INVALID_REQUEST}"
    OUTPUT_VARIABLE invalid_output
    ERROR_VARIABLE invalid_error
    RESULT_VARIABLE invalid_result
)
if(NOT invalid_result EQUAL 2)
    message(FATAL_ERROR "Unsupported version should exit 2, got ${invalid_result}")
endif()
string(JSON invalid_ok GET "${invalid_output}" ok)
if(invalid_ok)
    message(FATAL_ERROR "Invalid request was reported as successful")
endif()
string(JSON issue_code GET "${invalid_output}" issues 0 code)
if(NOT issue_code STREQUAL "protocol.version.unsupported")
    message(FATAL_ERROR "Expected a structured version issue, got ${issue_code}")
endif()
