using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class ApprovalServiceTests
{
    private const string InvoiceId = "INV-2001";

    // Times the fake clocks return. None of them is "now", so a time taken from DateTime.UtcNow instead of
    // the service's TimeProvider cannot match; each step of a test reads a different one.
    private static readonly DateTimeOffset ClockTime = new(2026, 10, 15, 13, 45, 30, 123, TimeSpan.Zero);
    private static readonly DateTimeOffset LaterClockTime = ClockTime.AddMinutes(90);
    private static readonly DateTimeOffset LatestClockTime = ClockTime.AddMinutes(180);
    private static readonly DateTime SeededFirstApprovalAt = new(2026, 10, 14, 16, 20, 0, DateTimeKind.Utc);

    // Concurrency tests: how long a decision gets to finish, and how long a decision that has to wait for
    // the gate is watched to make sure it does not finish.
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan GateWait = TimeSpan.FromMilliseconds(300);

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

    // A pending invoice above 500,000.00 whose first approval was given the day before.
    private static Invoice InvoiceAwaitingSecondApproval(decimal amount, string firstApprovedBy)
    {
        var invoice = InvoiceOf(amount, InvoiceStatus.PendingApproval);
        invoice.FirstApprovedBy = firstApprovedBy;
        invoice.FirstApprovedAt = SeededFirstApprovalAt;
        return invoice;
    }

    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Submit_MovesDraftToPendingApproval()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Draft);

        var result = ServiceFor(invoice).Submit("INV-1");

        Assert.Equal(InvoiceStatus.PendingApproval, result.Status);
    }

    // The message is the error text of the 409 that the UI shows, so it names the invoice and its current state.
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

        var error = Assert.Throws<InvalidOperationException>(() => service.Submit(InvoiceId));

        Assert.Equal($"Invoice INV-2001 is {status}; only drafts can be submitted.", error.Message);
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

    // FR-003: above 500,000.00 the first approval only records who approved and when; the invoice stays
    // pending and no final decision is recorded. 500,000.001 is above the limit too: a service that rounds the
    // amount to cents before deciding reads it as 500,000.00, and one Director approves it alone.
    public static TheoryData<decimal> AmountsAboveTheDirectorLimit => new()
    {
        500000.01m,
        500000.001m,
    };

    [Theory]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    [MemberData(nameof(AmountsAboveTheDirectorLimit))]
    public void Approve_FirstApprovalAboveTheDirectorLimitKeepsTheInvoicePending(decimal amount)
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(amount, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository, new FakeTimeProvider(ClockTime));
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var result = service.Approve(InvoiceId, new Approver("demo.director", "Director"));

        Assert.Equal(InvoiceStatus.PendingApproval, result.Status);
        Assert.Equal("demo.director", result.FirstApprovedBy);
        Assert.Equal(ClockTime.UtcDateTime, result.FirstApprovedAt);
        Assert.Equal(DateTimeKind.Utc, result.FirstApprovedAt!.Value.Kind);
        Assert.Null(result.DecidedBy);
        Assert.Null(result.DecidedAt);
        Assert.Equal(1, repository.UpdateCount);

        var expected = new Dictionary<string, object?>(before)
        {
            [nameof(Invoice.FirstApprovedBy)] = "demo.director",
            [nameof(Invoice.FirstApprovedAt)] = ClockTime.UtcDateTime,
        };
        Assert.Equal(expected, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
    }

    // Clarification Q1: a Manager may give the first approval; a Director then completes it, and the
    // invoice keeps both approvals.
    [Fact]
    [Trait("Rule", "FR-003")]
    [Trait("Clarification", "Q1")]
    public void Approve_ManagerGivesTheFirstApprovalAndADirectorCompletesIt()
    {
        var clock = new FakeTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(500000.01m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository, clock);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        service.Approve(InvoiceId, new Approver("demo.manager", "Manager"));

        var afterFirstApproval = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);
        var expectedAfterFirstApproval = new Dictionary<string, object?>(before)
        {
            [nameof(Invoice.FirstApprovedBy)] = "demo.manager",
            [nameof(Invoice.FirstApprovedAt)] = ClockTime.UtcDateTime,
        };
        Assert.Equal(expectedAfterFirstApproval, afterFirstApproval);
        Assert.Equal(1, repository.UpdateCount);

        clock.UtcNow = LaterClockTime;
        var result = service.Approve(InvoiceId, new Approver("demo.director", "Director"));

        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal("demo.manager", result.FirstApprovedBy);
        Assert.Equal("demo.director", result.DecidedBy);
        Assert.Equal(LaterClockTime.UtcDateTime, result.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, result.DecidedAt!.Value.Kind);
        Assert.Equal(2, repository.UpdateCount);

        var expectedAfterSecondApproval = new Dictionary<string, object?>(afterFirstApproval)
        {
            [nameof(Invoice.Status)] = InvoiceStatus.Approved,
            [nameof(Invoice.DecidedBy)] = "demo.director",
            [nameof(Invoice.DecidedAt)] = LaterClockTime.UtcDateTime,
        };
        Assert.Equal(expectedAfterSecondApproval, InvoiceSnapshot.Of(result));
    }

    // FR-003: a different Director gives the second approval and the record of the first approval is kept.
    // Both approvers are Directors, so a same-user check that compares roles refuses the second one.
    [Fact]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-004")]
    public void Approve_SecondApprovalByADifferentDirectorApprovesAndKeepsTheFirstApproval()
    {
        var clock = new FakeTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(600000.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository, clock);
        service.Approve(InvoiceId, new Approver("demo.director", "Director"));
        var afterFirstApproval = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);
        clock.UtcNow = LaterClockTime;

        var result = service.Approve(InvoiceId, new Approver("demo.director2", "Director"));

        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal("demo.director", result.FirstApprovedBy);
        Assert.Equal(ClockTime.UtcDateTime, result.FirstApprovedAt);
        Assert.Equal("demo.director2", result.DecidedBy);
        Assert.Equal(LaterClockTime.UtcDateTime, result.DecidedAt);
        Assert.Equal(2, repository.UpdateCount);

        var expected = new Dictionary<string, object?>(afterFirstApproval)
        {
            [nameof(Invoice.Status)] = InvoiceStatus.Approved,
            [nameof(Invoice.DecidedBy)] = "demo.director2",
            [nameof(Invoice.DecidedAt)] = LaterClockTime.UtcDateTime,
        };
        Assert.Equal(expected, InvoiceSnapshot.Of(result));
    }

    // FR-004: the Director who gave the first approval clicks Approve again. The clock has moved on, so a
    // repeated first approval would show in the snapshot as a new FirstApprovedAt.
    [Fact]
    [Trait("Rule", "FR-004")]
    [Trait("Rule", "FR-005")]
    public void Approve_RefusesTheSameDirectorTwice()
    {
        var clock = new FakeTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(600000.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository, clock);
        service.Approve(InvoiceId, new Approver("demo.director", "Director"));
        var afterFirstApproval = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);
        clock.UtcNow = LaterClockTime;

        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver("demo.director", "Director")));

        Assert.Equal(ApprovalRefusal.SameApproverTwice, refusal.Reason);
        Assert.Equal(
            "Approval refused: you gave the first approval for invoice INV-2001, " +
            "so the second approval must come from a different Director.",
            refusal.Message);
        Assert.Equal(afterFirstApproval, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(1, repository.UpdateCount);
    }

    // A refused second approval neither clears nor uses up the first approval: a different Director can
    // still complete the invoice, and the first approver stays the one recorded.
    [Fact]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    public void Approve_RefusedSecondApprovalKeepsTheFirstApprovalForADifferentDirector()
    {
        var clock = new FakeTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(600000.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository, clock);
        service.Approve(InvoiceId, new Approver("demo.director", "Director"));
        var afterFirstApproval = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);
        clock.UtcNow = LaterClockTime;

        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver("demo.manager", "Manager")));

        Assert.Equal(ApprovalRefusal.DirectorRequired, refusal.Reason);
        Assert.Equal(afterFirstApproval, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(1, repository.UpdateCount);

        clock.UtcNow = LatestClockTime;
        var result = service.Approve(InvoiceId, new Approver("demo.director2", "Director"));

        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal("demo.director", result.FirstApprovedBy);
        Assert.Equal(ClockTime.UtcDateTime, result.FirstApprovedAt);
        Assert.Equal("demo.director2", result.DecidedBy);
        Assert.Equal(LatestClockTime.UtcDateTime, result.DecidedAt);
        Assert.Equal(2, repository.UpdateCount);
    }

    // FR-004 with simultaneous requests. Each attempt gets its own service, as each HTTP request does (the
    // service is scoped, the repository a singleton), so only a gate shared through the repository
    // serialises them. T1, Director A's first approval, is held inside its clock read: after deciding,
    // before writing. Without the gate this interleaving makes A both approvers: T2 (Director B) still sees
    // no first approval and records B as first; T3 (A again) sees B as first and approves as A; then T1
    // writes A as the first approver. With the gate T2 and T3 wait for T1, B completes the approval, and A's
    // second attempt is refused as the same user or finds the invoice already approved.
    [Fact]
    [Trait("Rule", "FR-004")]
    public void Approve_ConcurrentApprovalsNeverCountTheSameUserTwice()
    {
        var clock = new BlockingTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(600000.00m, InvoiceStatus.PendingApproval));
        var directorA = new Approver("demo.director", "Director");
        var directorB = new Approver("demo.director2", "Director");

        DecisionThread first, second, repeat;
        bool secondFinishedWhileFirstWasDeciding;
        try
        {
            first = DecisionThread.Start(() => new ApprovalService(repository, clock).Approve(InvoiceId, directorA));
            Assert.True(
                clock.WaitUntilFirstCallIsHeld(Timeout),
                "Director A's first approval never read the time from the service's TimeProvider.");

            second = DecisionThread.Start(() => new ApprovalService(repository, clock).Approve(InvoiceId, directorB));
            secondFinishedWhileFirstWasDeciding = second.Join(GateWait);

            repeat = DecisionThread.Start(() => new ApprovalService(repository, clock).Approve(InvoiceId, directorA));
            repeat.Join(GateWait);
        }
        finally
        {
            clock.ReleaseFirstCall();
        }

        Assert.True(
            first.Join(Timeout) && second.Join(Timeout) && repeat.Join(Timeout),
            "An approval was still running after Director A's first approval was released.");

        var invoice = repository.GetById(InvoiceId)!;
        Assert.False(
            IsSameUser(invoice.FirstApprovedBy, invoice.DecidedBy),
            $"{invoice.FirstApprovedBy} counted as both the first and the second approver of {InvoiceId}.");
        Assert.False(
            secondFinishedWhileFirstWasDeciding,
            "Director B's approval finished while Director A's was still being decided: decisions are not serialised.");
        Assert.Null(first.Error);
        Assert.Null(second.Error);
        Assert.True(
            IsRefusedAsTheSameApprover(repeat.Error) || IsRefusedAsAlreadyApproved(repeat.Error),
            $"Director A's second attempt should be refused, but ended with: {Describe(repeat.Error)}");
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal("demo.director", invoice.FirstApprovedBy);
        Assert.Equal("demo.director2", invoice.DecidedBy);
        Assert.Equal(2, repository.UpdateCount);
    }

    // The theory seeds a first approval where the row names one, so every refusal is checked against an
    // invoice whose first approval must survive it. Without one, the refused first approvals above
    // 500,000.00 show a service that records the first approval before the policy refuses: the refused user
    // stays in FirstApprovedBy, and one Director could then complete the invoice alone. With one, every code
    // that can refuse a second approval is checked, the same user also in other letter case and with spaces.
    // The 50,000.001 row shows a service that rounds the amount to cents before deciding: it reads 50,000.00,
    // and the Manager's approval goes through.
    public static TheoryData<string?, string, string, decimal, ApprovalRefusal, string> RefusedAttempts => new()
    {
        {
            null, "demo.manager", "Manager", 50000.01m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-2001 is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            null, "demo.manager", "Manager", 50000.001m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-2001 is 50,000.001, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            null, "demo.admin", "Admin", 100.00m, ApprovalRefusal.RoleCannotApprove,
            "Approval refused: invoice INV-2001 cannot be approved by the Admin role. " +
            "Only Managers and Directors can approve invoices."
        },
        {
            null, "demo.admin", "Admin", 600000.00m, ApprovalRefusal.RoleCannotApprove,
            "Approval refused: invoice INV-2001 cannot be approved by the Admin role. " +
            "Only Managers and Directors can approve invoices."
        },
        {
            null, "demo.user", "manager", 500000.01m, ApprovalRefusal.RoleCannotApprove,
            "Approval refused: invoice INV-2001 cannot be approved by the manager role. " +
            "Only Managers and Directors can approve invoices."
        },
        {
            "demo.director", "demo.admin", "Admin", 600000.00m, ApprovalRefusal.RoleCannotApprove,
            "Approval refused: invoice INV-2001 cannot be approved by the Admin role. " +
            "Only Managers and Directors can approve invoices."
        },
        {
            "demo.director", "demo.director", "Director", 600000.00m, ApprovalRefusal.SameApproverTwice,
            "Approval refused: you gave the first approval for invoice INV-2001, " +
            "so the second approval must come from a different Director."
        },
        {
            "demo.director", "DEMO.Director", "Director", 600000.00m, ApprovalRefusal.SameApproverTwice,
            "Approval refused: you gave the first approval for invoice INV-2001, " +
            "so the second approval must come from a different Director."
        },
        {
            "demo.director", " demo.director ", "Director", 600000.00m, ApprovalRefusal.SameApproverTwice,
            "Approval refused: you gave the first approval for invoice INV-2001, " +
            "so the second approval must come from a different Director."
        },
        {
            "demo.director", "demo.manager", "Manager", 600000.00m, ApprovalRefusal.DirectorRequired,
            "Approval refused: invoice INV-2001 is above 500,000.00, so its second approval must come from a Director. " +
            "Your role is Manager."
        },
    };

    [Theory]
    [Trait("Rule", "FR-005")]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-004")]
    [MemberData(nameof(RefusedAttempts))]
    public void Approve_RefusedAttemptGivesTheReasonAndChangesNothing(
        string? firstApprovedBy, string username, string role, decimal amount,
        ApprovalRefusal expectedReason, string expectedMessage)
    {
        var invoice = firstApprovedBy is null
            ? InvoiceOf(amount, InvoiceStatus.PendingApproval)
            : InvoiceAwaitingSecondApproval(amount, firstApprovedBy);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver(username, role)));

        Assert.IsNotAssignableFrom<InvalidOperationException>(refusal);
        Assert.Equal(expectedReason, refusal.Reason);
        Assert.Equal(expectedMessage, refusal.Message);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);
    }

    [Fact]
    [Trait("Rule", "FR-005")]
    public void Approve_RefusedAttemptLeavesTheInvoiceApprovableByAnAllowedApprover()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(50000.01m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => service.Approve(InvoiceId, new Approver("demo.manager", "Manager")));

        Assert.Equal(ApprovalRefusal.AmountAboveRoleLimit, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-2001 is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it.",
            refusal.Message);
        Assert.Equal(before, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
        Assert.Equal(0, repository.UpdateCount);

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

    // The message is the error text of the 400 that the UI shows. ArgumentException appends the parameter name
    // to it, so a lost message still reads " (Parameter 'reason')": only the full text shows that it is missing.
    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_RequiresAReason()
    {
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, InvoiceStatus.PendingApproval));
        var service = new ApprovalService(repository);
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var error = Assert.Throws<ArgumentException>(() => service.Reject(InvoiceId, "demo.manager", "  "));

        Assert.Equal("reason", error.ParamName);
        Assert.Equal("A reason is required to reject an invoice. (Parameter 'reason')", error.Message);
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

    // FR-007: rejecting an invoice that awaits its second approval works as before and keeps the record of
    // the first approval. The rejection time comes from the service's TimeProvider.
    [Fact]
    [Trait("Rule", "FR-007")]
    public void Reject_KeepsTheFirstApprovalOfAnInvoiceAwaitingItsSecondApproval()
    {
        var repository = new FakeInvoiceRepository(InvoiceAwaitingSecondApproval(600000.00m, "demo.director"));
        var service = new ApprovalService(repository, new FakeTimeProvider(ClockTime));
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        var result = service.Reject(InvoiceId, "demo.admin", "Duplicate invoice");

        Assert.Equal(InvoiceStatus.Rejected, result.Status);
        Assert.Equal("demo.director", result.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovalAt, result.FirstApprovedAt);
        Assert.Equal(ClockTime.UtcDateTime, result.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, result.DecidedAt!.Value.Kind);
        Assert.Equal(1, repository.UpdateCount);

        var expected = new Dictionary<string, object?>(before)
        {
            [nameof(Invoice.Status)] = InvoiceStatus.Rejected,
            [nameof(Invoice.DecidedBy)] = "demo.admin",
            [nameof(Invoice.DecidedAt)] = ClockTime.UtcDateTime,
            [nameof(Invoice.DecisionNote)] = "Duplicate invoice",
        };
        Assert.Equal(expected, InvoiceSnapshot.Of(result));
    }

    // Reject decides inside the same gate as Approve. The rejection is held inside its clock read, after its
    // checks and before writing, and a Director's approval of the same invoice has to wait. Without the
    // gate the approval goes through first and the rejection then overwrites it.
    [Fact]
    [Trait("Rule", "lifecycle")]
    public void Reject_ConcurrentApprovalWaitsAndFindsTheInvoiceRejected()
    {
        var clock = new BlockingTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceOf(100.00m, InvoiceStatus.PendingApproval));

        DecisionThread rejection, approval;
        bool approvalFinishedWhileRejectionWasDeciding;
        try
        {
            rejection = DecisionThread.Start(
                () => new ApprovalService(repository, clock).Reject(InvoiceId, "demo.admin", "Duplicate invoice"));
            Assert.True(
                clock.WaitUntilFirstCallIsHeld(Timeout),
                "The rejection never read the time from the service's TimeProvider.");

            approval = DecisionThread.Start(
                () => new ApprovalService(repository, clock).Approve(InvoiceId, new Approver("demo.director", "Director")));
            approvalFinishedWhileRejectionWasDeciding = approval.Join(GateWait);
        }
        finally
        {
            clock.ReleaseFirstCall();
        }

        Assert.True(
            rejection.Join(Timeout) && approval.Join(Timeout),
            "A decision was still running after the rejection was released.");
        Assert.False(
            approvalFinishedWhileRejectionWasDeciding,
            "The approval finished while the rejection was still being decided: decisions are not serialised.");
        Assert.Null(rejection.Error);
        var error = Assert.IsType<InvalidOperationException>(approval.Error);
        Assert.Equal("Invoice INV-2001 is Rejected; only pending invoices can be decided.", error.Message);

        var invoice = repository.GetById(InvoiceId)!;
        Assert.Equal(InvoiceStatus.Rejected, invoice.Status);
        Assert.Equal("demo.admin", invoice.DecidedBy);
        Assert.Equal(1, repository.UpdateCount);
    }

    // FR-007, the mirror of the race above: the final approval, by a second Director, is held inside its clock
    // read, after deciding and before writing, and a rejection of the same invoice has to wait. A Reject that
    // checks the state before taking the gate still finds the invoice pending, waits, and then overwrites the
    // completed approval with Rejected.
    [Fact]
    [Trait("Rule", "FR-007")]
    public void Reject_WaitsForAConcurrentFinalApprovalAndFindsTheInvoiceApproved()
    {
        var clock = new BlockingTimeProvider(ClockTime);
        var repository = new FakeInvoiceRepository(InvoiceAwaitingSecondApproval(600000.00m, "demo.director"));
        var before = InvoiceSnapshot.Of(repository.GetById(InvoiceId)!);

        DecisionThread approval, rejection;
        bool rejectionFinishedWhileApprovalWasDeciding;
        try
        {
            approval = DecisionThread.Start(
                () => new ApprovalService(repository, clock).Approve(InvoiceId, new Approver("demo.director2", "Director")));
            Assert.True(
                clock.WaitUntilFirstCallIsHeld(Timeout),
                "The final approval never read the time from the service's TimeProvider.");

            rejection = DecisionThread.Start(
                () => new ApprovalService(repository, clock).Reject(InvoiceId, "demo.admin", "Duplicate invoice"));
            rejectionFinishedWhileApprovalWasDeciding = rejection.Join(GateWait);
        }
        finally
        {
            clock.ReleaseFirstCall();
        }

        Assert.True(
            approval.Join(Timeout) && rejection.Join(Timeout),
            "A decision was still running after the final approval was released.");
        Assert.False(
            rejectionFinishedWhileApprovalWasDeciding,
            "The rejection finished while the final approval was still being decided: decisions are not serialised.");
        Assert.Null(approval.Error);
        var error = Assert.IsType<InvalidOperationException>(rejection.Error);
        Assert.Equal("Invoice INV-2001 is Approved; only pending invoices can be decided.", error.Message);

        // The invoice stays as the final approval left it: approved by the second Director, first approval kept.
        var expected = new Dictionary<string, object?>(before)
        {
            [nameof(Invoice.Status)] = InvoiceStatus.Approved,
            [nameof(Invoice.DecidedBy)] = "demo.director2",
            [nameof(Invoice.DecidedAt)] = ClockTime.UtcDateTime,
        };
        Assert.Equal(expected, InvoiceSnapshot.Of(repository.GetById(InvoiceId)!));
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

    // One decision on its own background thread, not on the shared thread pool that held decisions would
    // tie up. Error is the exception the decision ended with, or null when it succeeded; read it after Join.
    private sealed class DecisionThread
    {
        private readonly Thread _thread;

        private DecisionThread(Action decide)
        {
            _thread = new Thread(() =>
            {
                try
                {
                    decide();
                }
                catch (Exception error)
                {
                    Error = error;
                }
            })
            {
                IsBackground = true,
            };
        }

        public Exception? Error { get; private set; }

        public static DecisionThread Start(Action decide)
        {
            var decision = new DecisionThread(decide);
            decision._thread.Start();
            return decision;
        }

        public bool Join(TimeSpan timeout) => _thread.Join(timeout);
    }

    // The identity rule of FR-004: usernames compared trimmed and ignoring case.
    private static bool IsSameUser(string? firstUsername, string? secondUsername) =>
        firstUsername is not null
        && secondUsername is not null
        && string.Equals(firstUsername.Trim(), secondUsername.Trim(), StringComparison.OrdinalIgnoreCase);

    private static bool IsRefusedAsTheSameApprover(Exception? error) =>
        error is ApprovalRefusedException { Reason: ApprovalRefusal.SameApproverTwice };

    private static bool IsRefusedAsAlreadyApproved(Exception? error) =>
        error is InvalidOperationException { Message: "Invoice INV-2001 is Approved; only pending invoices can be decided." };

    private static string Describe(Exception? error) =>
        error is null ? "success" : $"{error.GetType().Name}: {error.Message}";
}
