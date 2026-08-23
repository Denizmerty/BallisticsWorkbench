cmake_minimum_required(VERSION 3.24)

file(
    READ "${CMAKE_CURRENT_SOURCE_DIR}/config/product-metadata.json"
    BALLISTICS_PRODUCT_METADATA
)
string(
    JSON BALLISTICS_APPLICATION_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" applicationVersion
)
string(
    JSON BALLISTICS_MODEL_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" modelVersion
)
string(
    JSON BALLISTICS_PROTOCOL_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" protocolVersion
)
string(
    JSON BALLISTICS_PROFILE_INTERCHANGE_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" profileInterchangeVersion
)
string(
    JSON BALLISTICS_DRAG_DATA_INTERCHANGE_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" dragDataInterchangeVersion
)
string(
    JSON BALLISTICS_SETTINGS_SCHEMA_VERSION
    GET "${BALLISTICS_PRODUCT_METADATA}" settingsSchemaVersion
)
string(
    JSON BALLISTICS_CALCULATION_REQUEST_BYTES
    GET "${BALLISTICS_PRODUCT_METADATA}" limits calculationRequestBytes
)
string(
    JSON BALLISTICS_ENGINE_RESPONSE_BYTES
    GET "${BALLISTICS_PRODUCT_METADATA}" limits engineResponseBytes
)
string(
    JSON BALLISTICS_PROFILE_DOCUMENT_BYTES
    GET "${BALLISTICS_PRODUCT_METADATA}" limits profileDocumentBytes
)
string(
    JSON BALLISTICS_DRAG_DATA_DOCUMENT_BYTES
    GET "${BALLISTICS_PRODUCT_METADATA}" limits dragDataDocumentBytes
)
string(
    JSON BALLISTICS_CSV_EXPORT_BYTES
    GET "${BALLISTICS_PRODUCT_METADATA}" limits csvExportBytes
)

project(BallisticsWorkbench VERSION ${BALLISTICS_APPLICATION_VERSION} LANGUAGES CXX)

include(GNUInstallDirs)

find_program(BALLISTICS_NODE_EXECUTABLE NAMES node REQUIRED)

option(BALLISTICS_WARNINGS_AS_ERRORS "Treat project compiler warnings as errors" OFF)
option(BALLISTICS_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
option(BALLISTICS_ENABLE_FUZZING "Build coverage-guided fuzz targets" OFF)

add_library(Ballistics.BuildOptions INTERFACE)
target_compile_features(Ballistics.BuildOptions INTERFACE cxx_std_20)
configure_file(
    cmake/product_identity.hpp.in
    ${CMAKE_CURRENT_BINARY_DIR}/generated/ballistics/product_identity.hpp
    @ONLY
)
target_include_directories(Ballistics.BuildOptions INTERFACE ${CMAKE_CURRENT_BINARY_DIR}/generated)

target_compile_options(
    Ballistics.BuildOptions
    INTERFACE
    $<$<CXX_COMPILER_ID:MSVC>:/W4;/permissive-;/Zc:__cplusplus;/Zc:preprocessor>
    $<$<CXX_COMPILER_ID:GNU,Clang,AppleClang>:-Wall;-Wextra;-Wpedantic;-Wshadow;-Wformat=2;-Wundef>
)

if(BALLISTICS_WARNINGS_AS_ERRORS)
    target_compile_options(
        Ballistics.BuildOptions
        INTERFACE
        $<$<CXX_COMPILER_ID:MSVC>:/WX>
        $<$<CXX_COMPILER_ID:GNU,Clang,AppleClang>:-Werror>
    )
endif()

if(BALLISTICS_ENABLE_SANITIZERS)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(
            Ballistics.BuildOptions
            INTERFACE
            -fsanitize=address,undefined
            -fno-omit-frame-pointer
        )
        target_link_options(
            Ballistics.BuildOptions
            INTERFACE
            -fsanitize=address,undefined
            -fno-omit-frame-pointer
        )
    else()
        message(FATAL_ERROR "BALLISTICS_ENABLE_SANITIZERS requires GCC or Clang")
    endif()
endif()

function(ballistics_configure_target target)
    target_link_libraries(${target} PRIVATE Ballistics.BuildOptions)
    set_target_properties(${target} PROPERTIES CXX_EXTENSIONS OFF)
endfunction()

add_library(
    Ballistics.Core STATIC
    src/Ballistics.Core/src/ballistics.cpp
    src/Ballistics.Core/src/buckshot_pattern.cpp
    src/Ballistics.Core/src/calibration.cpp
    src/Ballistics.Core/src/environment.cpp
    src/Ballistics.Core/src/monte_carlo.cpp
    src/Ballistics.Core/src/projectiles.cpp
    src/Ballistics.Core/src/trajectory_analysis.cpp
    src/Ballistics.Core/src/uncertainty.cpp
)
target_include_directories(Ballistics.Core PUBLIC src/Ballistics.Core/include)
ballistics_configure_target(Ballistics.Core)

add_executable(
    Ballistics.Cli
    src/Ballistics.Cli/cli_input.cpp
    src/Ballistics.Cli/legacy_cli.cpp
    src/Ballistics.Cli/main.cpp
    src/Ballistics.Cli/protocol.cpp
    src/Ballistics.Cli/response_writer.cpp
)
target_link_libraries(Ballistics.Cli PRIVATE Ballistics.Core)
set_target_properties(Ballistics.Cli PROPERTIES OUTPUT_NAME ballistics_cli)
ballistics_configure_target(Ballistics.Cli)

enable_testing()
add_executable(Ballistics.Core.Tests tests/Ballistics.Core.Tests/core_tests.cpp)
target_link_libraries(Ballistics.Core.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Core.Tests)
target_compile_definitions(
    Ballistics.Core.Tests
    PRIVATE BALLISTICS_SOURCE_DIR="${CMAKE_SOURCE_DIR}"
)
add_test(NAME Ballistics.Core.Tests COMMAND Ballistics.Core.Tests)

add_executable(
    Ballistics.AdvancedScenario.Tests
    tests/Ballistics.AdvancedScenario.Tests/advanced_scenario_tests.cpp
)
target_include_directories(Ballistics.AdvancedScenario.Tests PRIVATE tests/support)
target_link_libraries(Ballistics.AdvancedScenario.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.AdvancedScenario.Tests)
add_test(
    NAME Ballistics.AdvancedScenario.Tests
    COMMAND Ballistics.AdvancedScenario.Tests
)

add_executable(
    Ballistics.Projectile.Property.Tests
    tests/Ballistics.Projectile.Property.Tests/property_tests.cpp
)
target_link_libraries(Ballistics.Projectile.Property.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Projectile.Property.Tests)
add_test(
    NAME Ballistics.Projectile.Property.Tests
    COMMAND Ballistics.Projectile.Property.Tests
)
set_tests_properties(Ballistics.Projectile.Property.Tests PROPERTIES TIMEOUT 30)

add_executable(
    Ballistics.Validation.Tests
    tests/Ballistics.Validation.Tests/validation_tests.cpp
)
target_include_directories(Ballistics.Validation.Tests PRIVATE src/Ballistics.Cli)
target_link_libraries(Ballistics.Validation.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Validation.Tests)
target_compile_definitions(
    Ballistics.Validation.Tests
    PRIVATE BALLISTICS_SOURCE_DIR="${CMAKE_SOURCE_DIR}"
)
add_test(
    NAME Ballistics.Validation.Tests
    COMMAND
        Ballistics.Validation.Tests
        --report
        ${CMAKE_BINARY_DIR}/validation/g7-independent-residuals.json
        --manufacturer-report
        ${CMAKE_BINARY_DIR}/validation/manufacturer-conformance-residuals.json
        --atmosphere-report
        ${CMAKE_BINARY_DIR}/validation/atmosphere-conformance-residuals.json
)

add_executable(
    Ballistics.Convergence.Tests
    tests/Ballistics.Convergence.Tests/convergence_tests.cpp
)
target_link_libraries(Ballistics.Convergence.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Convergence.Tests)
add_test(
    NAME Ballistics.Convergence.Tests
    COMMAND
        Ballistics.Convergence.Tests
        --report
        ${CMAKE_BINARY_DIR}/validation/adaptive-convergence.json
)

add_executable(
    Ballistics.FlightMatrix.Tests
    tests/Ballistics.FlightMatrix.Tests/flight_matrix_tests.cpp
)
target_include_directories(Ballistics.FlightMatrix.Tests PRIVATE src/Ballistics.Cli)
target_link_libraries(Ballistics.FlightMatrix.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.FlightMatrix.Tests)
target_compile_definitions(
    Ballistics.FlightMatrix.Tests
    PRIVATE BALLISTICS_SOURCE_DIR="${CMAKE_SOURCE_DIR}"
)
add_test(
    NAME Ballistics.FlightMatrix.Tests
    COMMAND
        Ballistics.FlightMatrix.Tests
        --scenario
        ${CMAKE_SOURCE_DIR}/validation/scenarios/independent-flight-matrix.json
        --report
        ${CMAKE_BINARY_DIR}/validation/flight-matrix-residuals.json
)

add_test(
    NAME Ballistics.BuiltinFit.Tests
    COMMAND
        ${BALLISTICS_NODE_EXECUTABLE}
        ${CMAKE_SOURCE_DIR}/validation/reference/run-builtin-fits.mjs
        --engine
        $<TARGET_FILE:Ballistics.Cli>
        --output
        ${CMAKE_BINARY_DIR}/validation/builtin-effective-bc-fits.json
        --markdown
        ${CMAKE_BINARY_DIR}/validation/builtin-effective-bc-fits.md
)

add_executable(Ballistics.Benchmarks benchmarks/native_benchmarks.cpp)
target_link_libraries(Ballistics.Benchmarks PRIVATE Ballistics.Core)
set_target_properties(Ballistics.Benchmarks PROPERTIES OUTPUT_NAME ballistics_benchmarks)
ballistics_configure_target(Ballistics.Benchmarks)

add_executable(
    Ballistics.Protocol.Tests
    tests/Ballistics.Protocol.Tests/protocol_tests.cpp
    src/Ballistics.Cli/cli_input.cpp
    src/Ballistics.Cli/protocol.cpp
)
target_include_directories(Ballistics.Protocol.Tests PRIVATE src/Ballistics.Cli)
target_link_libraries(Ballistics.Protocol.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Protocol.Tests)
add_test(NAME Ballistics.Protocol.Tests COMMAND Ballistics.Protocol.Tests)

add_executable(
    Ballistics.Protocol.Mutation.Tests
    tests/Ballistics.Protocol.Mutation.Tests/mutation_tests.cpp
    src/Ballistics.Cli/protocol.cpp
)
target_include_directories(
    Ballistics.Protocol.Mutation.Tests
    PRIVATE src/Ballistics.Cli
)
target_link_libraries(Ballistics.Protocol.Mutation.Tests PRIVATE Ballistics.Core)
ballistics_configure_target(Ballistics.Protocol.Mutation.Tests)
add_test(
    NAME Ballistics.Protocol.Mutation.Tests
    COMMAND Ballistics.Protocol.Mutation.Tests
)
set_tests_properties(Ballistics.Protocol.Mutation.Tests PROPERTIES TIMEOUT 30)

if(BALLISTICS_ENABLE_FUZZING)
    if(NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
        message(FATAL_ERROR "BALLISTICS_ENABLE_FUZZING requires upstream Clang with libFuzzer")
    endif()
    add_executable(
        Ballistics.Protocol.Fuzz
        tests/Ballistics.Protocol.Fuzz/fuzz_protocol.cpp
        src/Ballistics.Cli/protocol.cpp
    )
    target_include_directories(Ballistics.Protocol.Fuzz PRIVATE src/Ballistics.Cli)
    target_link_libraries(Ballistics.Protocol.Fuzz PRIVATE Ballistics.Core)
    target_compile_options(Ballistics.Protocol.Fuzz PRIVATE -fsanitize=fuzzer)
    target_link_options(Ballistics.Protocol.Fuzz PRIVATE -fsanitize=fuzzer)
    ballistics_configure_target(Ballistics.Protocol.Fuzz)
endif()

add_test(
    NAME Ballistics.Cli.JsonProtocol
    COMMAND
        ${CMAKE_COMMAND}
        -DBALLISTICS_CLI=$<TARGET_FILE:Ballistics.Cli>
        -DEXPECTED_ENGINE_VERSION=${BALLISTICS_APPLICATION_VERSION}
        -DEXPECTED_MODEL_VERSION=${BALLISTICS_MODEL_VERSION}
        -DVALID_REQUEST=${CMAKE_SOURCE_DIR}/tests/protocol/valid-multiple-loads.json
        -DINVALID_REQUEST=${CMAKE_SOURCE_DIR}/tests/protocol/unsupported-version.json
        -P
        ${CMAKE_SOURCE_DIR}/tests/protocol/cli_contract.cmake
)
add_test(
    NAME Ballistics.Cli.CalibrationProtocol
    COMMAND
        ${CMAKE_COMMAND}
        -DBALLISTICS_CLI=$<TARGET_FILE:Ballistics.Cli>
        -DEXPECTED_MODEL_VERSION=${BALLISTICS_MODEL_VERSION}
        -DCALIBRATION_REQUEST=${CMAKE_SOURCE_DIR}/tests/protocol/valid-calibration.json
        -P
        ${CMAKE_SOURCE_DIR}/tests/protocol/calibration_contract.cmake
)

add_test(
    NAME Ballistics.Cli.RejectsTrailingNumericText
    COMMAND Ballistics.Cli --distance 100junk
)
set_tests_properties(Ballistics.Cli.RejectsTrailingNumericText PROPERTIES WILL_FAIL TRUE)
add_test(
    NAME Ballistics.Cli.RejectsUnknownArguments
    COMMAND Ballistics.Cli --unknown 1
)
set_tests_properties(Ballistics.Cli.RejectsUnknownArguments PROPERTIES WILL_FAIL TRUE)
add_test(
    NAME Ballistics.Cli.RejectsDuplicateArguments
    COMMAND Ballistics.Cli --distance 100 --distance 200
)
set_tests_properties(Ballistics.Cli.RejectsDuplicateArguments PROPERTIES WILL_FAIL TRUE)

install(
    TARGETS Ballistics.Cli
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    COMPONENT Runtime
)
install(
    FILES LICENSE
    DESTINATION ${CMAKE_INSTALL_DATADIR}/licenses/BallisticsWorkbench
    COMPONENT Runtime
)
