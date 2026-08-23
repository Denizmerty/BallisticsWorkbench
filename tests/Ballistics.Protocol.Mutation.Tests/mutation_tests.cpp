#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "json.hpp"
#include "protocol.hpp"

namespace
{

constexpr std::size_t mutation_iterations = 12000;
constexpr std::size_t maximum_mutated_bytes = 16 * 1024;

[[noreturn]] void fail(
    std::string_view message,
    std::size_t case_index,
    std::string_view source
)
{
    std::cerr << "Protocol mutation property failed in case " << case_index << ": " << message
              << "\nInput bytes: " << source.size() << "\n";
    std::exit(1);
}

void expect(
    bool condition,
    std::string_view message,
    std::size_t case_index,
    std::string_view source
)
{
    if (!condition)
    {
        fail(message, case_index, source);
    }
}

class DeterministicGenerator
{
  public:
    explicit DeterministicGenerator(
        std::uint64_t seed
    )
        : state_(seed)
    {
    }

    [[nodiscard]] std::uint64_t next()
    {
        state_ ^= state_ >> 12;
        state_ ^= state_ << 25;
        state_ ^= state_ >> 27;
        return state_ * UINT64_C(2685821657736338717);
    }

    [[nodiscard]] std::size_t index(
        std::size_t upper_bound
    )
    {
        if (upper_bound == 0)
        {
            return 0;
        }
        return static_cast<std::size_t>(next() % static_cast<std::uint64_t>(upper_bound));
    }

    [[nodiscard]] char byte()
    {
        return static_cast<char>(next() & UINT64_C(0xff));
    }

  private:
    std::uint64_t state_;
};

constexpr std::string_view valid_request = R"json({
  "protocolVersion": 2,
  "requestId": "mutation-baseline",
  "scenario": {
    "displayDistanceM": 300,
    "solutionHorizonM": 2000,
    "vitalZoneM": 0.15,
    "atmosphere": {
      "temperatureC": 15,
      "stationPressureHpa": 1013.25,
      "relativeHumidityPercent": 50,
      "headwindMps": 0,
      "crosswindMps": 3
    },
    "firearms": {
      "shotgun": {
        "sightHeightM": 0.025,
        "zeroRangeM": 50,
        "muzzleVelocityMultiplier": 1
      },
      "rifle": {
        "sightHeightM": 0.04,
        "zeroRangeM": 100,
        "muzzleVelocityMultiplier": 1,
        "twistInches": 10,
        "twistDirection": 1
      }
    },
    "uncertainty": {
      "method": "firstOrder",
      "sampleCount": 1000,
      "seed": 1113017667,
      "correlations": [],
      "shotgunMuzzleVelocityStandardDeviationMps": 2,
      "rifleMuzzleVelocityStandardDeviationMps": 3,
      "dragRelativeStandardDeviation": 0.02,
      "temperatureStandardDeviationC": 1,
      "stationPressureStandardDeviationHpa": 2,
      "headwindStandardDeviationMps": 0.5,
      "crosswindStandardDeviationMps": 1,
      "shotgunZeroRangeStandardDeviationM": 1,
      "rifleZeroRangeStandardDeviationM": 1.5
    }
  },
  "customLoads": [{
    "id": "custom:mutation",
    "name": "Mutation baseline",
    "firearmGroup": "rifle",
    "muzzleVelocityMps": 800,
    "pelletCount": 1,
    "massKg": 0.01,
    "drag": {
      "kind": "referenceBc",
      "curve": "G7",
      "ballisticCoefficient": 0.25
    },
    "bulletGeometry": {
      "lengthInches": 1.2,
      "diameterInches": 0.308,
      "twistInches": 8
    }
  }]
})json";

const std::array<std::string_view, 22> malformed_corpus = {
    "",
    " ",
    "null",
    "true",
    "[]",
    "{}",
    "{",
    "}",
    "{\"protocolVersion\":2}",
    "{\"protocolVersion\":2,\"requestId\":\"x\",\"scenario\":null,\"customLoads\":[]}",
    "{\"protocolVersion\":1e9999,\"requestId\":\"x\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"\\uD800\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"\\uDC00\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"\\x00\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"x\",\"scenario\":{},\"customLoads\":[1,2,3,4]}",
    "{\"protocolVersion\":0,\"requestId\":\"x\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":1.5,\"requestId\":\"x\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"x y\",\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":0,\"scenario\":{},\"customLoads\":[]}",
    "{\"protocolVersion\":2,\"requestId\":\"x\",\"operation\":[],\"atmosphere\":{}}",
    "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]",
    "{\"a\":1,\"a\":2}",
};

const std::array<std::string_view, 17> structured_tokens = {
    "null",       "true",        "false",     "[]",        "{}",       "-1",
    "0",          "1e9999",      "1e-9999",   "NaN",       "Infinity", "\"\"",
    "\"bad id\"", "\"\\u0000\"", "[1,2,3,4]", "{\"x\":1}", "\\uD800",
};

void replace_random_byte(
    std::string& source,
    DeterministicGenerator& generator
)
{
    if (source.empty())
    {
        source.push_back(generator.byte());
        return;
    }
    source[generator.index(source.size())] = generator.byte();
}

void insert_random_bytes(
    std::string& source,
    DeterministicGenerator& generator
)
{
    if (source.size() >= maximum_mutated_bytes)
    {
        return;
    }
    const auto count = 1 + generator.index(12);
    std::string insertion;
    insertion.reserve(count);
    for (std::size_t index = 0; index < count; ++index)
    {
        insertion.push_back(generator.byte());
    }
    source.insert(generator.index(source.size() + 1), insertion);
}

void erase_random_range(
    std::string& source,
    DeterministicGenerator& generator
)
{
    if (source.empty())
    {
        return;
    }
    const auto offset = generator.index(source.size());
    const auto available = source.size() - offset;
    const auto count = 1 + generator.index(std::min<std::size_t>(available, 32));
    source.erase(offset, count);
}

void duplicate_random_range(
    std::string& source,
    DeterministicGenerator& generator
)
{
    if (source.empty() || source.size() >= maximum_mutated_bytes)
    {
        return;
    }
    const auto offset = generator.index(source.size());
    const auto available = source.size() - offset;
    const auto count = 1 + generator.index(std::min<std::size_t>(available, 48));
    const auto fragment = source.substr(offset, count);
    source.insert(generator.index(source.size() + 1), fragment);
}

void truncate(
    std::string& source,
    DeterministicGenerator& generator
)
{
    if (!source.empty())
    {
        source.resize(generator.index(source.size()));
    }
}

void insert_structured_token(
    std::string& source,
    DeterministicGenerator& generator
)
{
    const auto token = structured_tokens[generator.index(structured_tokens.size())];
    if (source.size() + token.size() <= maximum_mutated_bytes)
    {
        source.insert(generator.index(source.size() + 1), token);
    }
}

void replace_ascii_digit(
    std::string& source,
    DeterministicGenerator& generator
)
{
    std::vector<std::size_t> digits;
    for (std::size_t index = 0; index < source.size(); ++index)
    {
        if (source[index] >= '0' && source[index] <= '9')
        {
            digits.push_back(index);
        }
    }
    if (digits.empty())
    {
        insert_structured_token(source, generator);
        return;
    }
    const auto position = digits[generator.index(digits.size())];
    source[position] = static_cast<char>('0' + generator.index(10));
}

void mutate(
    std::string& source,
    DeterministicGenerator& generator
)
{
    switch (generator.index(7))
    {
    case 0:
        replace_random_byte(source, generator);
        break;
    case 1:
        insert_random_bytes(source, generator);
        break;
    case 2:
        erase_random_range(source, generator);
        break;
    case 3:
        duplicate_random_range(source, generator);
        break;
    case 4:
        truncate(source, generator);
        break;
    case 5:
        insert_structured_token(source, generator);
        break;
    default:
        replace_ascii_digit(source, generator);
        break;
    }
    if (source.size() > maximum_mutated_bytes)
    {
        source.resize(maximum_mutated_bytes);
    }
}

void verify_error_envelope(
    std::string_view response,
    std::size_t case_index,
    std::string_view source
)
{
    expect(response.size() < 256 * 1024, "error response remained bounded", case_index, source);
    expect(
        !response.empty() && response.back() == '\n',
        "error response ends with newline",
        case_index,
        source
    );
    try
    {
        const auto document = ballistics::json::parse(response);
        expect(document.is_object(), "error response is a JSON object", case_index, source);
        const auto& object = document.as_object();
        const auto ok = object.find("ok");
        const auto version = object.find("protocolVersion");
        const auto issues = object.find("issues");
        expect(
            ok != object.end() && ok->second.is_bool() && !ok->second.as_bool(),
            "error response carries ok=false",
            case_index,
            source
        );
        expect(
            version != object.end() && version->second.is_number() &&
                version->second.as_number() == ballistics::protocol::current_version,
            "error response carries the current protocol version",
            case_index,
            source
        );
        expect(
            issues != object.end() && issues->second.is_array() &&
                !issues->second.as_array().empty(),
            "error response carries issues",
            case_index,
            source
        );
    }
    catch (const ballistics::json::ParseError&)
    {
        fail("error response is valid JSON", case_index, source);
    }
}

bool verify_parse(
    std::string_view source,
    std::size_t case_index
)
{
    ballistics::protocol::RequestParseResult parsed;
    try
    {
        parsed = ballistics::protocol::parse_request(source);
    }
    catch (const std::exception& exception)
    {
        std::cerr << "Unexpected exception: " << exception.what() << '\n';
        fail("parse_request never throws for bounded arbitrary input", case_index, source);
    }
    catch (...)
    {
        fail("parse_request never throws a non-standard exception", case_index, source);
    }

    expect(
        parsed.request.has_value() == parsed.issues.empty(),
        "accepted requests have no parse issues and rejected requests have issues",
        case_index,
        source
    );
    if (parsed.request)
    {
        const auto& request = *parsed.request;
        expect(
            request.protocol_version == ballistics::protocol::current_version,
            "accepted request uses the current protocol version",
            case_index,
            source
        );
        expect(
            !request.request_id.empty() && request.request_id.size() <= 128,
            "accepted request ID is bounded",
            case_index,
            source
        );
        expect(
            request.custom_loads.size() <= 3,
            "accepted custom-load collection is bounded",
            case_index,
            source
        );
        return true;
    }

    for (const auto& issue : parsed.issues)
    {
        expect(!issue.code.empty(), "rejection issue code is non-empty", case_index, source);
        expect(!issue.field.empty(), "rejection issue field is non-empty", case_index, source);
        expect(!issue.message.empty(), "rejection issue message is non-empty", case_index, source);
        expect(
            issue.severity == ballistics::ValidationSeverity::error,
            "protocol parse rejections are errors",
            case_index,
            source
        );
    }
    verify_error_envelope(
        ballistics::protocol::error_response(parsed.request_id, parsed.issues),
        case_index,
        source
    );
    return false;
}

void verify_oversize_rejection()
{
    const std::string oversized(ballistics::protocol::maximum_request_bytes + 1, ' ');
    const auto parsed = ballistics::protocol::parse_request(oversized);
    expect(
        !parsed.request && parsed.issues.size() == 1,
        "oversize request is rejected once",
        0,
        oversized
    );
    expect(
        parsed.issues[0].code == "protocol.request.too_large",
        "oversize rejection uses the stable issue code",
        0,
        oversized
    );
}

} // namespace

int main()
{
    verify_oversize_rejection();
    expect(verify_parse(valid_request, 0), "baseline request is accepted", 0, valid_request);

    std::size_t case_index = 1;
    std::size_t accepted = 1;
    std::size_t rejected = 0;
    for (const auto source : malformed_corpus)
    {
        if (verify_parse(source, case_index))
        {
            ++accepted;
        }
        else
        {
            ++rejected;
        }
        ++case_index;
    }

    DeterministicGenerator generator(UINT64_C(0x8e5f17a4c93d620b));
    for (std::size_t iteration = 0; iteration < mutation_iterations; ++iteration)
    {
        const auto corpus_index = generator.index(malformed_corpus.size() + 1);
        std::string source = corpus_index == 0
            ? std::string(valid_request)
            : std::string(malformed_corpus[corpus_index - 1]);
        const auto passes = 1 + generator.index(5);
        for (std::size_t pass = 0; pass < passes; ++pass)
        {
            mutate(source, generator);
        }
        if (verify_parse(source, case_index))
        {
            ++accepted;
        }
        else
        {
            ++rejected;
        }
        ++case_index;
    }

    expect(
        rejected > mutation_iterations / 2,
        "mutation suite exercises rejection paths",
        case_index,
        {}
    );
    std::cout << "Protocol mutation properties passed: " << case_index << " cases (" << accepted
              << " accepted, " << rejected << " rejected), seed 0x8e5f17a4c93d620b.\n";
    return 0;
}
