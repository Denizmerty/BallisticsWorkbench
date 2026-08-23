#pragma once

#include "protocol.hpp"

namespace ballistics::cli
{

[[nodiscard]] protocol::Request legacy_request(int argc, char** argv);

} // namespace ballistics::cli
