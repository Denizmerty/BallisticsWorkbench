#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string_view>

#include "protocol.hpp"

namespace
{

void require(
    bool condition
)
{
    if (!condition)
    {
        std::abort();
    }
}

void verify_result(
    const ballistics::protocol::RequestParseResult& result
)
{
    require(result.request.has_value() == result.issues.empty());
    if (result.request)
    {
        require(result.request->protocol_version == ballistics::protocol::current_version);
        require(!result.request->request_id.empty());
        require(result.request->request_id.size() <= 128);
        return;
    }

    require(!result.issues.empty());
    for (const auto& issue : result.issues)
    {
        require(!issue.code.empty());
        require(!issue.field.empty());
        require(!issue.message.empty());
    }

    const auto response = ballistics::protocol::error_response(result.request_id, result.issues);
    require(!response.empty());
    require(response.back() == '\n');
}

} // namespace

extern "C" int LLVMFuzzerTestOneInput(
    const std::uint8_t* data,
    std::size_t size
)
{
    if (size > ballistics::protocol::maximum_request_bytes)
    {
        return 0;
    }

    const auto source = std::string_view(reinterpret_cast<const char*>(data), size);
    verify_result(ballistics::protocol::parse_request(source));
    return 0;
}
