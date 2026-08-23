#pragma once

#include <iosfwd>
#include <string>

namespace ballistics::cli
{

[[nodiscard]] std::string read_standard_input(std::istream& stream);

} // namespace ballistics::cli
