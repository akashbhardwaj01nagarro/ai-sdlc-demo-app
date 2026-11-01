using InvoiceApp.Domain;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace InvoiceApp.Api.Tests;

/// <summary>The service registrations in Program.cs that the approval rules depend on.</summary>
public class ProgramTests : IClassFixture<InvoiceAppFactory>
{
    private readonly InvoiceAppFactory _factory;

    public ProgramTests(InvoiceAppFactory factory) => _factory = factory;

    // R-05. ApprovalService serialises read, decide and write on one decision gate per repository instance, and
    // each request gets its own ApprovalService (scoped). Only a repository registered as a singleton makes
    // simultaneous requests share that gate. With a scoped or transient repository every request gets its own
    // gate, two simultaneous approvals by one Director can both count (FR-004), and no other test notices: the
    // concurrency tests in InvoiceApp.Tests share one FakeInvoiceRepository.
    [Fact]
    [Trait("Rule", "FR-004")]
    public void Main_RegistersTheInvoiceRepositoryAsASingletonBecauseTheFR004DecisionGateIsPerRepositoryInstance()
    {
        using var firstRequest = _factory.Services.CreateScope();
        using var secondRequest = _factory.Services.CreateScope();

        var first = firstRequest.ServiceProvider.GetRequiredService<IInvoiceRepository>();
        var second = secondRequest.ServiceProvider.GetRequiredService<IInvoiceRepository>();

        Assert.True(
            ReferenceEquals(first, second),
            "IInvoiceRepository resolved to a different instance in each request scope. ApprovalService keeps one " +
            "decision gate per repository instance, so each request now decides behind its own gate and two " +
            "simultaneous approvals by the same user can both count (FR-004). Register the repository as a " +
            "singleton, or move the read-decide-write guard into the store.");
    }
}
