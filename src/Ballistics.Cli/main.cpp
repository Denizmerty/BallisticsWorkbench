#include <cstdlib>
#include <exception>
#include <iostream>
#include <string>
#include <utility>

#include "ballistics.hpp"
#include "cli_input.hpp"
#include "legacy_cli.hpp"
#include "protocol.hpp"
#include "response_writer.hpp"

int main(
    int argc,
    char** argv
)
{
    const bool structured_protocol = argc == 1;
    std::string request_id;
    try
    {
        ballistics::protocol::Request request;
        if (structured_protocol)
        {
            auto parsed =
                ballistics::protocol::parse_request(ballistics::cli::read_standard_input(std::cin));
            request_id = parsed.request_id;
            if (!parsed.request)
            {
                std::cout << ballistics::protocol::error_response(parsed.request_id, parsed.issues);
                return 2;
            }
            request = std::move(*parsed.request);
        }
        else
        {
            request = ballistics::cli::legacy_request(argc, argv);
        }
        request_id = request.request_id;
        return ballistics::cli::write_response(request, std::cout);
    }
    catch (const std::exception& error)
    {
        if (structured_protocol)
        {
            std::cout << ballistics::protocol::error_response(
                request_id,
                { { "engine.calculation.failed",
                    "$",
                    error.what(),
                    ballistics::ValidationSeverity::error } }
            );
            return 3;
        }
        std::cerr << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
