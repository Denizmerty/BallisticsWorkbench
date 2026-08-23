#pragma once

#include <charconv>
#include <cmath>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace ballistics::json
{

struct Value
{
    using Array = std::vector<Value>;
    using Object = std::map<std::string, Value, std::less<>>;
    using Storage = std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;

    Storage storage;

    [[nodiscard]] bool is_null() const
    {
        return std::holds_alternative<std::nullptr_t>(storage);
    }
    [[nodiscard]] bool is_bool() const
    {
        return std::holds_alternative<bool>(storage);
    }
    [[nodiscard]] bool is_number() const
    {
        return std::holds_alternative<double>(storage);
    }
    [[nodiscard]] bool is_string() const
    {
        return std::holds_alternative<std::string>(storage);
    }
    [[nodiscard]] bool is_array() const
    {
        return std::holds_alternative<Array>(storage);
    }
    [[nodiscard]] bool is_object() const
    {
        return std::holds_alternative<Object>(storage);
    }

    [[nodiscard]] const bool& as_bool() const
    {
        return std::get<bool>(storage);
    }
    [[nodiscard]] const double& as_number() const
    {
        return std::get<double>(storage);
    }
    [[nodiscard]] const std::string& as_string() const
    {
        return std::get<std::string>(storage);
    }
    [[nodiscard]] const Array& as_array() const
    {
        return std::get<Array>(storage);
    }
    [[nodiscard]] const Object& as_object() const
    {
        return std::get<Object>(storage);
    }
};

class ParseError : public std::runtime_error
{
  public:
    ParseError(
        const std::string& message,
        std::size_t offset
    )
        : std::runtime_error(message),
          offset_(offset)
    {
    }

    [[nodiscard]] std::size_t offset() const
    {
        return offset_;
    }

  private:
    std::size_t offset_;
};

class Parser
{
  public:
    explicit Parser(
        std::string_view source
    )
        : source_(source)
    {
    }

    [[nodiscard]] Value parse()
    {
        skip_whitespace();
        auto value = parse_value(0);
        skip_whitespace();
        if (position_ != source_.size())
        {
            fail("Unexpected text after the JSON value");
        }
        return value;
    }

  private:
    static constexpr std::size_t maximum_depth = 64;

    std::string_view source_;
    std::size_t position_ {};

    [[noreturn]] void fail(
        const std::string& message
    ) const
    {
        throw ParseError(message, position_);
    }

    void skip_whitespace()
    {
        while (position_ < source_.size())
        {
            const auto c = source_[position_];
            if (c != ' ' && c != '\t' && c != '\r' && c != '\n')
            {
                break;
            }
            ++position_;
        }
    }

    [[nodiscard]] char peek() const
    {
        return position_ < source_.size() ? source_[position_] : '\0';
    }

    bool consume(
        char expected
    )
    {
        if (peek() != expected)
        {
            return false;
        }
        ++position_;
        return true;
    }

    void expect(
        char expected
    )
    {
        if (!consume(expected))
        {
            fail(std::string("Expected '") + expected + "'");
        }
    }

    void expect_literal(
        std::string_view literal
    )
    {
        if (source_.substr(position_, literal.size()) != literal)
        {
            fail("Invalid JSON literal");
        }
        position_ += literal.size();
    }

    [[nodiscard]] Value parse_value(
        std::size_t depth
    )
    {
        if (depth > maximum_depth)
        {
            fail("JSON nesting exceeds the supported depth");
        }
        skip_whitespace();
        switch (peek())
        {
        case 'n':
            expect_literal("null");
            return Value { nullptr };
        case 't':
            expect_literal("true");
            return Value { true };
        case 'f':
            expect_literal("false");
            return Value { false };
        case '"':
            return Value { parse_string() };
        case '[':
            return Value { parse_array(depth + 1) };
        case '{':
            return Value { parse_object(depth + 1) };
        default:
            if (peek() == '-' || (peek() >= '0' && peek() <= '9'))
            {
                return Value { parse_number() };
            }
            fail("Expected a JSON value");
        }
    }

    [[nodiscard]] Value::Array parse_array(
        std::size_t depth
    )
    {
        expect('[');
        skip_whitespace();
        Value::Array values;
        if (consume(']'))
        {
            return values;
        }
        while (true)
        {
            values.push_back(parse_value(depth));
            skip_whitespace();
            if (consume(']'))
            {
                return values;
            }
            expect(',');
            skip_whitespace();
        }
    }

    [[nodiscard]] Value::Object parse_object(
        std::size_t depth
    )
    {
        expect('{');
        skip_whitespace();
        Value::Object values;
        if (consume('}'))
        {
            return values;
        }
        while (true)
        {
            if (peek() != '"')
            {
                fail("Expected a JSON object key");
            }
            auto key = parse_string();
            skip_whitespace();
            expect(':');
            auto value = parse_value(depth);
            if (!values.emplace(std::move(key), std::move(value)).second)
            {
                fail("Duplicate JSON object key");
            }
            skip_whitespace();
            if (consume('}'))
            {
                return values;
            }
            expect(',');
            skip_whitespace();
        }
    }

    static int hex_value(
        char c
    )
    {
        if (c >= '0' && c <= '9')
        {
            return c - '0';
        }
        if (c >= 'a' && c <= 'f')
        {
            return c - 'a' + 10;
        }
        if (c >= 'A' && c <= 'F')
        {
            return c - 'A' + 10;
        }
        return -1;
    }

    [[nodiscard]] std::uint16_t parse_code_unit()
    {
        if (position_ + 4 > source_.size())
        {
            fail("Incomplete Unicode escape");
        }
        std::uint16_t value {};
        for (int i = 0; i < 4; ++i)
        {
            const auto digit = hex_value(source_[position_++]);
            if (digit < 0)
            {
                fail("Invalid Unicode escape");
            }
            value = static_cast<std::uint16_t>((value << 4) | digit);
        }
        return value;
    }

    static void append_utf8(
        std::string& output,
        std::uint32_t codepoint
    )
    {
        if (codepoint <= 0x7f)
        {
            output.push_back(static_cast<char>(codepoint));
        }
        else if (codepoint <= 0x7ff)
        {
            output.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
        }
        else if (codepoint <= 0xffff)
        {
            output.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
        }
        else
        {
            output.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
        }
    }

    static bool valid_utf8(
        std::string_view value
    )
    {
        for (std::size_t index = 0; index < value.size();)
        {
            const auto lead = static_cast<unsigned char>(value[index++]);
            if (lead <= 0x7f)
            {
                continue;
            }

            int continuation_count {};
            std::uint32_t codepoint {};
            std::uint32_t minimum {};
            if (lead >= 0xc2 && lead <= 0xdf)
            {
                continuation_count = 1;
                codepoint = lead & 0x1f;
                minimum = 0x80;
            }
            else if (lead >= 0xe0 && lead <= 0xef)
            {
                continuation_count = 2;
                codepoint = lead & 0x0f;
                minimum = 0x800;
            }
            else if (lead >= 0xf0 && lead <= 0xf4)
            {
                continuation_count = 3;
                codepoint = lead & 0x07;
                minimum = 0x10000;
            }
            else
            {
                return false;
            }

            if (index + continuation_count > value.size())
            {
                return false;
            }
            for (int offset = 0; offset < continuation_count; ++offset)
            {
                const auto continuation = static_cast<unsigned char>(value[index++]);
                if ((continuation & 0xc0) != 0x80)
                {
                    return false;
                }
                codepoint = (codepoint << 6) | (continuation & 0x3f);
            }
            if (codepoint < minimum || codepoint > 0x10ffff ||
                (codepoint >= 0xd800 && codepoint <= 0xdfff))
            {
                return false;
            }
        }
        return true;
    }

    [[nodiscard]] std::string parse_string()
    {
        expect('"');
        std::string value;
        while (position_ < source_.size())
        {
            const auto c = static_cast<unsigned char>(source_[position_++]);
            if (c == '"')
            {
                if (!valid_utf8(value))
                {
                    fail("JSON string is not valid UTF-8");
                }
                return value;
            }
            if (c < 0x20)
            {
                fail("Unescaped control character in JSON string");
            }
            if (c != '\\')
            {
                value.push_back(static_cast<char>(c));
                continue;
            }
            if (position_ >= source_.size())
            {
                fail("Incomplete JSON string escape");
            }
            switch (source_[position_++])
            {
            case '"':
                value.push_back('"');
                break;
            case '\\':
                value.push_back('\\');
                break;
            case '/':
                value.push_back('/');
                break;
            case 'b':
                value.push_back('\b');
                break;
            case 'f':
                value.push_back('\f');
                break;
            case 'n':
                value.push_back('\n');
                break;
            case 'r':
                value.push_back('\r');
                break;
            case 't':
                value.push_back('\t');
                break;
            case 'u':
            {
                const auto high = parse_code_unit();
                std::uint32_t codepoint = high;
                if (high >= 0xd800 && high <= 0xdbff)
                {
                    if (position_ + 2 > source_.size() || source_[position_] != '\\' ||
                        source_[position_ + 1] != 'u')
                    {
                        fail("High surrogate must be followed by a low surrogate");
                    }
                    position_ += 2;
                    const auto low = parse_code_unit();
                    if (low < 0xdc00 || low > 0xdfff)
                    {
                        fail("Invalid low surrogate");
                    }
                    codepoint = 0x10000u + ((static_cast<std::uint32_t>(high) - 0xd800u) << 10u) +
                        (static_cast<std::uint32_t>(low) - 0xdc00u);
                }
                else if (high >= 0xdc00 && high <= 0xdfff)
                {
                    fail("Unexpected low surrogate");
                }
                append_utf8(value, codepoint);
                break;
            }
            default:
                fail("Invalid JSON string escape");
            }
        }
        fail("Unterminated JSON string");
    }

    [[nodiscard]] double parse_number()
    {
        const auto begin_position = position_;
        consume('-');
        if (consume('0'))
        {
            if (peek() >= '0' && peek() <= '9')
            {
                fail("Leading zeros are not valid JSON numbers");
            }
        }
        else
        {
            if (peek() < '1' || peek() > '9')
            {
                fail("Invalid JSON number");
            }
            while (peek() >= '0' && peek() <= '9')
            {
                ++position_;
            }
        }
        if (consume('.'))
        {
            if (peek() < '0' || peek() > '9')
            {
                fail("JSON fractional part requires a digit");
            }
            while (peek() >= '0' && peek() <= '9')
            {
                ++position_;
            }
        }
        if (peek() == 'e' || peek() == 'E')
        {
            ++position_;
            if (peek() == '+' || peek() == '-')
            {
                ++position_;
            }
            if (peek() < '0' || peek() > '9')
            {
                fail("JSON exponent requires a digit");
            }
            while (peek() >= '0' && peek() <= '9')
            {
                ++position_;
            }
        }

        const auto token = source_.substr(begin_position, position_ - begin_position);
        double value {};
        const auto parsed = std::from_chars(
            token.data(),
            token.data() + token.size(),
            value,
            std::chars_format::general
        );
        if (parsed.ec != std::errc {} || parsed.ptr != token.data() + token.size() ||
            !std::isfinite(value))
        {
            fail("JSON number is outside the supported finite range");
        }
        return value;
    }
};

[[nodiscard]] inline Value parse(
    std::string_view source
)
{
    return Parser(source).parse();
}

} // namespace ballistics::json
