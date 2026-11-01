using System.Text.Json;

namespace InvoiceApp.Api.Tests;

/// <summary>
/// Reads a flat JSON object body (an invoice, an error) into property name and value, exactly as the client
/// receives it: strings stay strings, numbers become decimals, null stays null. Compare a body read before an
/// attempt with one read after it, as the unit tests compare InvoiceSnapshot copies: every property counts,
/// including properties added later, and a missing, extra or renamed property shows as a difference.
/// </summary>
public static class JsonBody
{
    public static async Task<IReadOnlyDictionary<string, object?>> ReadAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new NotSupportedException($"Expected a JSON object, but the body is: {text}");
        }

        var values = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            values.Add(property.Name, ValueOf(property));
        }

        return values;
    }

    private static object? ValueOf(JsonProperty property) => property.Value.ValueKind switch
    {
        JsonValueKind.String => property.Value.GetString(),
        JsonValueKind.Number => property.Value.GetDecimal(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => throw new NotSupportedException(
            $"Property '{property.Name}' is a JSON {property.Value.ValueKind}. Extend JsonBody to compare it."),
    };
}
