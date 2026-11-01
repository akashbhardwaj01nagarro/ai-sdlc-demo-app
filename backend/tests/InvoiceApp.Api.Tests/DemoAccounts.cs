using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using InvoiceApp.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace InvoiceApp.Api.Tests;

/// <summary>Signs in through POST /api/auth/login, as the web UI does, with the demo accounts.</summary>
public static class DemoAccounts
{
    // The demo accounts' shared password from appsettings.json; not a real credential.
    public const string Password = "ChangeMe123!";

    // The accounts in appsettings.json and the role each one has.
    private static readonly IReadOnlyDictionary<string, string> RolesOfShippedAccounts = new Dictionary<string, string>
    {
        ["demo.manager"] = "Manager",
        ["demo.director"] = "Director",
        ["demo.director2"] = "Director",
        ["demo.admin"] = "Admin",
    };

    /// <summary>Signs in one of the accounts in appsettings.json.</summary>
    public static Task<HttpClient> SignInAsync(this WebApplicationFactory<SessionStore> factory, string username) =>
        factory.SignInAsync(username, RolesOfShippedAccounts[username]);

    /// <summary>
    /// Returns a client whose requests carry the new session's bearer token. Fails when the account cannot sign in
    /// or has another role than the test expects, so a changed account fails at sign-in, not later with a status
    /// that looks like a broken rule.
    /// </summary>
    public static async Task<HttpClient> SignInAsync(
        this WebApplicationFactory<SessionStore> factory, string username, string expectedRole)
    {
        var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password = Password });

        Assert.True(
            response.StatusCode == HttpStatusCode.OK,
            $"{username} could not sign in: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        var session = await JsonBody.ReadAsync(response);
        Assert.Equal(username, session["username"]);
        Assert.Equal(expectedRole, session["role"]);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (string)session["token"]!);
        return client;
    }
}
