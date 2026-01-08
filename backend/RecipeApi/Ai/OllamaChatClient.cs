using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace RecipeApi.Ai;

public sealed class OllamaChatClient(HttpClient http, OllamaConfig config)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public async Task<OllamaChatResult> ChatAsync(IReadOnlyList<OllamaChatMessage> messages, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.ApiKey))
        {
            throw new InvalidOperationException("Missing OLLAMA_API_KEY (or Ollama:ApiKey).");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/chat");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);
        request.Content = JsonContent.Create(new
        {
            model = config.Model,
            messages = messages.Select(m => new { role = m.Role, content = m.Content }),
            stream = false,
        });

        using var response = await http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Ollama request failed ({(int)response.StatusCode}): {body}");
        }

        var parsed = JsonSerializer.Deserialize<OllamaChatResponse>(body, JsonOptions)
            ?? throw new InvalidOperationException("Could not parse Ollama response.");

        return new OllamaChatResult(parsed.Model ?? config.Model, parsed.Message?.Content ?? string.Empty);
    }

    private sealed record OllamaChatResponse(string? Model, OllamaChatResponseMessage? Message);
    private sealed record OllamaChatResponseMessage(string? Role, string? Content);
}

public sealed record OllamaConfig(Uri BaseUri, string Model, string? ApiKey);

public sealed record OllamaChatMessage(string Role, string Content);

public sealed record OllamaChatResult(string Model, string Content);
