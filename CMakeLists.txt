cmake_minimum_required(VERSION 3.24)
project(BallisticsWorkbench VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(Ballistics.Core STATIC src/Ballistics.Core/src/ballistics.cpp)
target_include_directories(Ballistics.Core PUBLIC src/Ballistics.Core/include)

add_executable(Ballistics.Cli src/Ballistics.Cli/main.cpp)
target_link_libraries(Ballistics.Cli PRIVATE Ballistics.Core)
set_target_properties(Ballistics.Cli PROPERTIES OUTPUT_NAME ballistics_cli)

enable_testing()
add_executable(Ballistics.Core.Tests tests/Ballistics.Core.Tests/core_tests.cpp)
target_link_libraries(Ballistics.Core.Tests PRIVATE Ballistics.Core)
add_test(NAME Ballistics.Core.Tests COMMAND Ballistics.Core.Tests)
