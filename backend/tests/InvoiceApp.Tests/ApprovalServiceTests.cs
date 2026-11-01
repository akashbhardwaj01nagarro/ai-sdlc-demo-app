using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class ApprovalServiceTests
{
    private const string InvoiceId = "INV-2001";

    private static Invoice InvoiceWith(string id, InvoiceStatus status) =>
        new() { Id = id, CustomerName = "Test School", Amount = 100m, Status = status };

    private static ApprovalService ServiceFor(params Invoice[] invoices) =>
        new(new FakeInvoiceRepository(invoices));

    // Every field has a known value, so a snapshot taken before an attempt shows any change.
    private static Invoice InvoiceOf(decimal amount, InvoiceStatus status) =>
        new()
        {
            Id = InvoiceId,
            CustomerName = "Riverside College",
            Amount = amount,
            Status = status,
            CreatedAt = new DateTime(2026, 10, 1, 9, 30, 0, DateTimeKind.Utc),
        };

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Submit_MovesDraftToPendingApproval()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Draft);

        var result = ServiceFor(invoice).Submit("INV-1");

        Assert.Equal(InvoiceStatus.PendingApproval, result.Status);
    }

    [Theory]
    [Trait("Rule", "lifecycle")]
    [InlineData(InvoiceStatus.PendingApproval)]
    [InlineData(InvoiceStatus.Approved)]
    [InlineData(InvoiceStatus.Rejected)]
    public void Submit_RejectsInvoiceThatIsNotADraft(InvoiceStatus status)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, status));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        Assert.Throws<InvalidOperationException>(() => service.Submit(InvoiceId));

        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Submit_UpdatesTheRepositoryOnce()
    {
        var repository = new FakeInvoiceRepository(InvoiceWith("INV-1", InvoiceStatus.Draft));

        new ApprovalService(repository).Submit("INV-1");

        Assert.Equal(1, repository.UpdateCount);
    }

    public static TheoryData<string, string, decimal> ApprovalsWithinTheApproversLimit => new()
    {
        { "demo.manager", "Manager", 50000.00m },
        { "demo.director", "Director", 50000.01m },
        { "demo.director", "Director", 500000.00m },
    };

    [Theory]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-002")]
    [MemberData(nameof(ApprovalsWithinTheApproversLimit))]
    public void Approve_WithinTheApproversLimitRecordsTheDecisionAndUpdatesOnce(
        string username, string role, decimal amount)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(amount, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);
        var earliest = DateTime.UtcNow;

        var result = service.Approve(InvoiceId, new Approver(username, role));

        var latest = DateTime.UtcNow;
        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal(username, result.DecidedBy);
        Assert.NotNull(result.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, result.DecidedAt.Value.Kind);
        Assert.InRange(result.DecidedAt.Value, earliest, latest);
        Assert.Equal(1, repository.UpdateCount);

        // Only the decision fields change; amount, customer, note and anything added later stay as they were.
        var expected = new Dictionary<string, object?>(before)
        {
            [nameof(Invoice.Status)] = InvoiceStatus.Approved,
            [nameof(Invoice.DecidedBy)] = username,
            [nameof(Invoice.DecidedAt)] = result.DecidedAt,
        };
        Assert.Equal(expected, InvoiceSnapshot.Of(result));
    }

    public static TheoryData<string, string, decimal, ApprovalRefusal, string> RefusedAttempts => new()
    {
        {
            "demo.manager", "Manager", 50000.01m, ApprovalRefusal.AmountAboveRoleLimit,
            "is 50,000.01, above the 50,000.00 limit for the Manager role"
        },
        {
            "demo.admin", "Admin", 100.00m, ApprovalRefusal.RoleCannotApprove,
            "cannot be approved by the Admin role"
        },
        {
            "demo.director", "Director", 500000.01m, ApprovalRefusal.TwoApproversRequired,
            "is 500,000.01. Invoices above 500,000.00 need two approvers"
        },
    };

    [Theory]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(RefusedAttempts))]
    public void Approve_RefusedAttemptGivesTheReasonAndChangesNothing(
        string username, string role, decimal amount, ApprovalRefusal expectedReason, string expectedMessagePart)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(amount, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver(username, role)));

        Assert.IsNotAssignableFrom<InvalidOperationException>(refusal);
        Assert.Equal(expectedReason, refusal.Reason);
        Assert.StartsWith("Approval refused: invoice INV-2001 ", refusal.Message);
        Assert.Contains(expectedMessagePart, refusal.Message);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "FR-005")]
    public void Approve_RefusedAttemptLeavesTheInvoiceApprovableByAnAllowedApprover()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(50000.01m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver("demo.manager", "Manager")));

        var result = service.Approve(InvoiceId, new Approver("demo.director", "Director"));

        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal("demo.director", result.DecidedBy);
        Assert.Equal(1, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "FR-005")]
    public void Approve_ReportsNotFoundBeforeCheckingTheApprover()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var error = Assert.Throws<KeyNotFoundException>(
            () => service.Approve("INV-404", new Approver("demo.admin", "Admin")));

        Assert.Equal("Invoice INV-404 was not found.", error.Message);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    public static TheoryData<string, string, decimal, InvoiceStatus> AttemptsOnInvoicesThatAreNotPending => new()
    {
        { "demo.admin", "Admin", 100.00m, InvoiceStatus.Approved },
        { "demo.manager", "Manager", 60000.00m, InvoiceStatus.Rejected },
        { "demo.director", "Director", 600000.00m, InvoiceStatus.Draft },
        { "demo.manager", "Manager", 50000.00m, InvoiceStatus.Draft },
    };

    [Theory]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(AttemptsOnInvoicesThatAreNotPending))]
    public void Approve_ReportsWrongStateBeforeCheckingTheApprover(
        string username, string role, decimal amount, InvoiceStatus status)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(amount, status));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var error = Assert.Throws<InvalidOperationException>(
            () => service.Approve(InvoiceId, new Approver(username, role)));

        Assert.Equal($"Invoice INV-2001 is {status}; only pending invoices can be decided.", error.Message);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_RecordsReasonAndApprover()
    {
        var service = ServiceFor(InvoiceWith("INV-1", InvoiceStatus.PendingApproval));

        var result = service.Reject("INV-1", "demo.manager", "Duplicate invoice");

        Assert.Equal(InvoiceStatus.Rejected, result.Status);
        Assert.Equal("Duplicate invoice", result.DecisionNote);
        Assert.Equal("demo.manager", result.DecidedBy);
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_RequiresAReason()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var error = Assert.Throws<ArgumentException>(() => service.Reject(InvoiceId, "demo.manager", "  "));

        Assert.Equal("reason", error.ParamName);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "FR-007")]
    public void Reject_IsNotLimitedByAmount()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(600000.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);

        var result = service.Reject(InvoiceId, "demo.manager", "Duplicate invoice");

        Assert.Equal(InvoiceStatus.Rejected, result.Status);
        Assert.Equal(1, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_RecordsWhoRejectedAndWhen()
    {
        var service = ServiceFor(InvoiceWith("INV-1", InvoiceStatus.PendingApproval));
        var earliest = DateTime.UtcNow;

        var result = service.Reject("INV-1", "demo.admin", "Duplicate invoice");

        var latest = DateTime.UtcNow;
        Assert.Equal("demo.admin", result.DecidedBy);
        Assert.NotNull(result.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, result.DecidedAt.Value.Kind);
        Assert.InRange(result.DecidedAt.Value, earliest, latest);
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_UpdatesTheRepositoryOnce()
    {
        var repository = new FakeInvoiceRepository(InvoiceWith("INV-1", InvoiceStatus.PendingApproval));

        new ApprovalService(repository).Reject("INV-1", "demo.admin", "Duplicate invoice");

        Assert.Equal(1, repository.UpdateCount);
    }

    [Theory]
    [Trait("Rule", "lifecycle")]
    [InlineData(InvoiceStatus.Draft)]
    [InlineData(InvoiceStatus.Approved)]
    [InlineData(InvoiceStatus.Rejected)]
    public void Reject_RefusesInvoiceThatIsNotPending(InvoiceStatus status)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, status));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        Assert.Throws<InvalidOperationException>(
            () => service.Reject(InvoiceId, "demo.admin", "Duplicate invoice"));

        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }
}
