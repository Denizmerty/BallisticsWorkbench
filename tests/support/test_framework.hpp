#pragma once

#include <cmath>
#include <cstddef>
#include <exception>
#include <functional>
#include <iostream>
#include <source_location>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ballistics::testing
{

class Failure : public std::exception
{
  public:
    explicit Failure(
        std::string message
    )
        : message_(std::move(message))
    {
    }

    [[nodiscard]] const char* what() const noexcept override
    {
        return message_.c_str();
    }

  private:
    std::string message_;
};

using TestFunction = void (*)();

struct TestCase
{
    std::string_view name;
    TestFunction function;
};

inline std::vector<TestCase>& registry()
{
    static std::vector<TestCase> tests;
    return tests;
}

class Registrar
{
  public:
    Registrar(
        std::string_view name,
        TestFunction function
    )
    {
        registry().push_back({ name, function });
    }
};

[[noreturn]] inline void fail(
    std::string_view message,
    const std::source_location& location = std::source_location::current()
)
{
    std::ostringstream output;
    output << location.file_name() << ':' << location.line() << ": " << message;
    throw Failure(output.str());
}

inline void expect(
    bool condition,
    std::string_view message,
    const std::source_location& location = std::source_location::current()
)
{
    if (!condition)
    {
        fail(message, location);
    }
}

inline void expect_near(
    double actual,
    double expected,
    double tolerance,
    std::string_view message,
    const std::source_location& location = std::source_location::current()
)
{
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance)
    {
        std::ostringstream output;
        output.precision(17);
        output << message << ": expected " << expected << " +/- " << tolerance << ", got "
               << actual;
        fail(output.str(), location);
    }
}

template <typename Case, typename Function>
void for_each_case(
    std::span<const Case> cases,
    Function&& function
)
{
    for (std::size_t index = 0; index < cases.size(); ++index)
    {
        try
        {
            std::invoke(function, cases[index]);
        }
        catch (const Failure& error)
        {
            std::ostringstream output;
            output << "parameter " << index << ": " << error.what();
            throw Failure(output.str());
        }
    }
}

inline int run_all()
{
    std::size_t failed = 0;
    for (const auto& test : registry())
    {
        try
        {
            test.function();
            std::cout << "[pass] " << test.name << '\n';
        }
        catch (const std::exception& error)
        {
            ++failed;
            std::cerr << "[fail] " << test.name << ": " << error.what() << '\n';
        }
        catch (...)
        {
            ++failed;
            std::cerr << "[fail] " << test.name << ": unknown exception\n";
        }
    }
    std::cout << registry().size() - failed << '/' << registry().size() << " tests passed\n";
    return failed == 0 ? 0 : 1;
}

} // namespace ballistics::testing

#define BW_TEST_CONCATENATE_DETAIL(left, right) left##right
#define BW_TEST_CONCATENATE(left, right) BW_TEST_CONCATENATE_DETAIL(left, right)
#define BW_TEST_CASE(name)                                                                         \
    static void BW_TEST_CONCATENATE(bw_test_function_, __LINE__)();                                \
    static const ::ballistics::testing::Registrar                                                  \
        BW_TEST_CONCATENATE(bw_test_registrar_, __LINE__)(                                         \
            name,                                                                                  \
            &BW_TEST_CONCATENATE(bw_test_function_, __LINE__)                                      \
        );                                                                                         \
    static void BW_TEST_CONCATENATE(bw_test_function_, __LINE__)()
