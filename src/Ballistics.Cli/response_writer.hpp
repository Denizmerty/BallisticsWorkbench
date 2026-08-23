#pragma once

#include <iosfwd>

#include "protocol.hpp"

namespace ballistics::cli
{

int write_response(const protocol::Request& request, std::ostream& output);

} // namespace ballistics::cli
