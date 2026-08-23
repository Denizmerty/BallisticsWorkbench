if(NOT DEFINED BALLISTICS_CLI OR NOT DEFINED EXPECTED_MODEL_VERSION OR
    NOT DEFINED CALIBRATION_REQUEST
)
    message(FATAL_ERROR "Calibration CLI contract test arguments are missing")
endif()

execute_process(
    COMMAND "${BALLISTICS_CLI}"
    INPUT_FILE "${CALIBRATION_REQUEST}"
    OUTPUT_VARIABLE output
    ERROR_VARIABLE error
    RESULT_VARIABLE result
)
if(NOT result EQUAL 0)
    message(FATAL_ERROR "Valid calibration request failed: ${error}\n${output}")
endif()

string(JSON ok ERROR_VARIABLE json_error GET "${output}" ok)
string(JSON operation GET "${output}" operation)
string(JSON request_id GET "${output}" requestId)
if(json_error OR NOT ok OR NOT operation STREQUAL "calibrateReferenceBc" OR
    NOT request_id STREQUAL "fixture-calibration"
)
    message(FATAL_ERROR "Calibration response envelope is invalid: ${json_error}")
endif()

string(JSON model_version GET "${output}" modelVersion)
string(JSON status GET "${output}" calibration status)
string(JSON fit_kind GET "${output}" calibration fitKind)
string(
    JSON validation_available
    GET "${output}" calibration validationClaimAvailable
)
if(NOT model_version STREQUAL EXPECTED_MODEL_VERSION OR NOT status STREQUAL "converged" OR
    NOT fit_kind STREQUAL "constant" OR NOT validation_available
)
    message(FATAL_ERROR "Calibration identity or convergence metadata is invalid")
endif()

string(JSON estimate_count LENGTH "${output}" calibration estimates)
string(JSON fitted_bc GET "${output}" calibration estimates 0 ballisticCoefficient)
string(JSON confidence_low GET "${output}" calibration estimates 0 confidence95Low)
string(JSON confidence_high GET "${output}" calibration estimates 0 confidence95High)
if(NOT estimate_count EQUAL 1 OR fitted_bc LESS_EQUAL 0 OR confidence_low GREATER_EQUAL fitted_bc OR
    confidence_high LESS_EQUAL fitted_bc
)
    message(FATAL_ERROR "Calibration coefficient or confidence interval is invalid")
endif()

string(JSON residual_count LENGTH "${output}" calibration residuals)
string(JSON last_role GET "${output}" calibration residuals 3 role)
string(JSON calibration_rmse GET "${output}" calibration calibrationRmseMps)
string(JSON holdout_rmse GET "${output}" calibration holdoutRmseMps)
if(NOT residual_count EQUAL 4 OR NOT last_role STREQUAL "holdout" OR
    calibration_rmse LESS 0 OR holdout_rmse LESS 0
)
    message(FATAL_ERROR "Calibration and holdout residual reporting is invalid")
endif()
