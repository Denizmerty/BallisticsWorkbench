#include "cli_input.hpp"

#include <array>
#include <istream>

#include "protocol.hpp"

namespace ballistics::cli
{

std::string read_standard_input(
    std::istream& stream
)
{
    std::string content;
    content.reserve(4096);
    std::array<char, 4096> buffer {};
    while (stream)
    {
        stream.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        content.append(buffer.data(), static_cast<std::size_t>(stream.gcount()));
        if (content.size() > ballistics::protocol::maximum_request_bytes)
        {
            break;
        }
    }
    return content;
}

} // namespace ballistics::cli
