using InvoiceApp.Api.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace InvoiceApp.Api.Tests;

/// <summary>
/// Runs the real API in memory: Program.cs with its service registrations and middleware, and the users in
/// appsettings.json. The type argument only names the assembly whose entry point is started. Top-level statements
/// generate an internal Program class, so SessionStore, a public type of the same assembly, stands in for it and
/// Program.cs needs no code for the tests.
/// </summary>
public class InvoiceAppFactory : WebApplicationFactory<SessionStore>
{
    /// <summary>
    /// A separate app with one more account, added through configuration as an operator would add it. Dispose it
    /// at the end of the test.
    /// </summary>
    public WebApplicationFactory<SessionStore> WithUser(string username, string password, string role) =>
        WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // A high index adds the account after the ones in appsettings.json instead of replacing one of them.
                ["Users:99:Username"] = username,
                ["Users:99:Password"] = password,
                ["Users:99:Role"] = role,
            })));
}
