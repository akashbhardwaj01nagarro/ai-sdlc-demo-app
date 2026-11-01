using System.Globalization;
using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

/// <summary>
/// Approval limits by role (spec 001). User Story 1: single-approver limits (FR-001, FR-002, FR-005,
/// FR-006). User Story 2: two different approvers above 500,000.00, the second a Director (FR-003, FR-004).
/// Amounts and role names are literals on purpose: a test that reads <c>ApprovalLimits</c> or
/// <c>ApprovalRoles</c> still passes when the constant itself is wrong.
/// </summary>
public class ApprovalPolicyTests
{
    private const string InvoiceId = "INV-1001";

    // No first approval recorded yet: every single-approver decision, and the first of two approvals.
    private const string? NoFirstApproval = null;

    private static readonly Approver Manager = new("demo.manager", "Manager");
    private static readonly Approver Director = new("demo.director", "Director");

    // FR-001: a Manager approves alone up to 50,000.00 inclusive.

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_ManagerApprovesTheSmallestAmount()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 0.01m, NoFirstApproval, Manager);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_ManagerApprovesExactlyTheManagerLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.00m, NoFirstApproval, Manager);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_DirectorApprovesExactlyTheManagerLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.00m, NoFirstApproval, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesManagerOneCentAboveTheManagerLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 50000.01m, NoFirstApproval, Manager));

        Assert.Equal(ApprovalRefusal.AmountAboveRoleLimit, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it.",
            refusal.Message);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_RefusesManagerASubCentAboveTheManagerLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 50000.001m, NoFirstApproval, Manager));

        Assert.Equal(ApprovalRefusal.AmountAboveRoleLimit, refusal.Reason);
        Assert.StartsWith("Approval refused: invoice INV-1001 is ", refusal.Message);
        Assert.EndsWith(", above the 50,000.00 limit for the Manager role. A Director must approve it.", refusal.Message);
    }

    // A reason shows the amount's exact value: never rounded (a rounded sub-cent amount would read as the
    // limit it exceeds), and without the trailing zeros a stored scale can carry (50000.0100m reads 50,000.01).
    public static TheoryData<string, decimal, ApprovalRefusal, string> RefusalsOfAmountsWithMoreThanTwoDecimals => new()
    {
        {
            "Manager", 50000.001m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 50,000.001, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            "Manager", 50000.0100m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
    };

    [Theory]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(RefusalsOfAmountsWithMoreThanTwoDecimals))]
    public void Decide_ShowsTheExactAmountWhenItHasMoreThanTwoDecimals(
        string role, decimal amount, ApprovalRefusal expectedReason, string expectedMessage)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, amount, NoFirstApproval, new Approver("demo.user", role)));

        Assert.Equal(expectedReason, refusal.Reason);
        Assert.Equal(expectedMessage, refusal.Message);
    }

    // Also FR-003's at-limit case: at exactly 500,000.00 the Manager limit applies, not the two-approver rule,
    // so a two-approver threshold of >= 500,000.00 records a first approval here instead of refusing.
    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesManagerAtTheDirectorLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 500000.00m, NoFirstApproval, Manager));

        Assert.Equal(ApprovalRefusal.AmountAboveRoleLimit, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 is 500,000.00, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it.",
            refusal.Message);
    }

    // FR-002: a Director approves alone up to 500,000.00 inclusive.

    [Fact]
    [Trait("Rule", "FR-002")]
    public void Decide_DirectorApprovesOneCentAboveTheManagerLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.01m, NoFirstApproval, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    // Also FR-003's at-limit case: at exactly 500,000.00 one Director is still enough, so a two-approver
    // threshold of >= 500,000.00 records only a first approval here.
    [Fact]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    public void Decide_DirectorApprovesExactlyTheDirectorLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 500000.00m, NoFirstApproval, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    // FR-003: above 500,000.00 nobody approves alone. The first approval, from a Manager or a Director, is
    // only recorded and the invoice stays pending.

    [Fact]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    public void Decide_DirectorOneCentAboveTheDirectorLimitGivesOnlyTheFirstApproval()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 500000.01m, NoFirstApproval, Director);

        Assert.Equal(ApprovalOutcome.FirstApprovalRecorded, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    public void Decide_DirectorASubCentAboveTheDirectorLimitGivesOnlyTheFirstApproval()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 500000.001m, NoFirstApproval, Director);

        Assert.Equal(ApprovalOutcome.FirstApprovalRecorded, outcome);
    }

    // Clarification Q1: a Manager may give the first approval, although 500,000.01 is far above the Manager's
    // own limit. With the alternative "a Director gives the first approval" this test fails.
    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-003")]
    [Trait("Clarification", "Q1")]
    public void Decide_ManagerOneCentAboveTheDirectorLimitGivesTheFirstApproval()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 500000.01m, NoFirstApproval, Manager);

        Assert.Equal(ApprovalOutcome.FirstApprovalRecorded, outcome);
    }

    // The policy sees who gave the first approval, never their role: a first approval by a Manager and one
    // by a Director are completed the same way, by a different Director. A name that starts with, or is
    // part of, the other name is still a different user.
    public static TheoryData<string, string, decimal> SecondApprovalsByADifferentDirector => new()
    {
        { "demo.manager", "demo.director", 500000.01m },
        { "demo.director", "demo.director2", 600000.00m },
        { "demo.director2", "demo.director", 600000.00m },
    };

    [Theory]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-004")]
    [MemberData(nameof(SecondApprovalsByADifferentDirector))]
    public void Decide_ADifferentDirectorGivesTheSecondApproval(string firstApprovedBy, string username, decimal amount)
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, amount, firstApprovedBy, new Approver(username, "Director"));

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    // FR-004: the same user never counts as both approvers. A user is the username, trimmed and ignoring
    // case, on both sides: the recorded first approver and the approver signed in now.
    public static TheoryData<string, string> SecondApprovalsByTheFirstApprover => new()
    {
        { "demo.director", "demo.director" },
        { "demo.director", "DEMO.Director" },
        { "demo.director", " demo.director " },
        { " DEMO.Director ", "demo.director" },
    };

    [Theory]
    [Trait("Rule", "FR-004")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(SecondApprovalsByTheFirstApprover))]
    public void Decide_RefusesTheFirstApproverAsTheSecondApprover(string firstApprovedBy, string username)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, firstApprovedBy, new Approver(username, "Director")));

        Assert.Equal(ApprovalRefusal.SameApproverTwice, refusal.Reason);
        Assert.Equal(
            "Approval refused: you gave the first approval for invoice INV-1001, " +
            "so the second approval must come from a different Director.",
            refusal.Message);
    }

    // FR-004 whatever the server's regional settings. Under tr-TR the capital I of DEMO.DIRECTOR lowercases to
    // a dotless i, so ToLower(), ToUpper(), CurrentCultureIgnoreCase or string.Compare(a, b, true) read the first
    // approver signed in again as a different user, and one Director counts as both approvers.
    [Fact]
    [Trait("Rule", "FR-004")]
    [Trait("Rule", "FR-005")]
    public void Decide_RecognisesTheFirstApproverIndependentOfTheCurrentCulture()
    {
        var originalCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("tr-TR");
        try
        {
            // Guard: the culture must fold this username's case differently, or the test proves nothing.
            Assert.NotEqual("demo.director", "DEMO.DIRECTOR".ToLower(CultureInfo.CurrentCulture));

            var refusal = Assert.Throws<ApprovalRefusedException>(
                () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, "demo.director", new Approver("DEMO.DIRECTOR", "Director")));

            Assert.Equal(ApprovalRefusal.SameApproverTwice, refusal.Reason);
            Assert.Equal(
                "Approval refused: you gave the first approval for invoice INV-1001, " +
                "so the second approval must come from a different Director.",
                refusal.Message);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    // The same-user reason comes before the Director reason, because no change of role can fix it. Only a
    // Manager who gave the first approval (Clarification Q1) can tell the two orders apart.
    [Fact]
    [Trait("Rule", "FR-004")]
    [Trait("Rule", "FR-005")]
    [Trait("Clarification", "Q1")]
    public void Decide_RefusesTheFirstApproverBeforeCheckingForADirector()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, "demo.manager", Manager));

        Assert.Equal(ApprovalRefusal.SameApproverTwice, refusal.Reason);
        Assert.Equal(
            "Approval refused: you gave the first approval for invoice INV-1001, " +
            "so the second approval must come from a different Director.",
            refusal.Message);
    }

    [Fact]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesAManagerAsTheSecondApprover()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, "demo.director", Manager));

        Assert.Equal(ApprovalRefusal.DirectorRequired, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 is above 500,000.00, so its second approval must come from a Director. " +
            "Your role is Manager.",
            refusal.Message);
    }

    // FR-006 holds for the second approval too, and before every other rule: also for the user who gave the
    // first approval and now signs in with a role that cannot approve.
    public static TheoryData<string, string> SecondApprovalsByARoleThatCannotApprove => new()
    {
        { "demo.admin", "Admin" },
        { "demo.director", "Approver" },
    };

    [Theory]
    [Trait("Rule", "FR-006")]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(SecondApprovalsByARoleThatCannotApprove))]
    public void Decide_RefusesARoleThatCannotApproveAsTheSecondApprover(string username, string role)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, "demo.director", new Approver(username, role)));

        Assert.Equal(ApprovalRefusal.RoleCannotApprove, refusal.Reason);
        Assert.Equal(
            $"Approval refused: invoice INV-1001 cannot be approved by the {role} role. " +
            "Only Managers and Directors can approve invoices.",
            refusal.Message);
    }

    // FR-006: only the exact roles Manager and Director approve; everything else fails closed.

    [Theory]
    [Trait("Rule", "FR-006")]
    [Trait("Rule", "FR-005")]
    [InlineData("Admin")]
    [InlineData("Approver")]
    [InlineData("manager")]
    [InlineData("Director ")]
    [InlineData("")]
    public void Decide_RefusesARoleThatCannotApprove(string role)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 100.00m, NoFirstApproval, new Approver("demo.user", role)));

        Assert.Equal(ApprovalRefusal.RoleCannotApprove, refusal.Reason);
        Assert.Equal(
            $"Approval refused: invoice INV-1001 cannot be approved by the {role} role. " +
            "Only Managers and Directors can approve invoices.",
            refusal.Message);
    }

    // The role is checked before the amount. At 60,000.00 an Admin is told about its role, not the Manager
    // limit. Above 500,000.00 no role that cannot approve gives the first of two approvals, not only Admin: a
    // two-approver branch ahead of the role check that refuses Admin alone, or matches a role ignoring case or
    // spaces, records a first approval for one of these rows.
    public static TheoryData<string, decimal> RolesThatCannotApproveWithAmountsAboveTheManagerLimit => new()
    {
        { "Admin", 60000.00m },
        { "Admin", 500000.01m },
        { "Admin", 600000.00m },
        { "Approver", 500000.01m },
        { "Approver", 600000.00m },
        { "manager", 500000.01m },
        { "manager", 600000.00m },
        { "Director ", 500000.01m },
        { "Director ", 600000.00m },
        { "", 500000.01m },
        { "", 600000.00m },
    };

    [Theory]
    [Trait("Rule", "FR-006")]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(RolesThatCannotApproveWithAmountsAboveTheManagerLimit))]
    public void Decide_RefusesTheRoleBeforeCheckingTheAmount(string role, decimal amount)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, amount, NoFirstApproval, new Approver("demo.user", role)));

        Assert.Equal(ApprovalRefusal.RoleCannotApprove, refusal.Reason);
        Assert.Equal(
            $"Approval refused: invoice INV-1001 cannot be approved by the {role} role. " +
            "Only Managers and Directors can approve invoices.",
            refusal.Message);
    }

    // FR-005: amounts in a reason read the same whatever the reader's regional settings.

    public static TheoryData<string, string, decimal, ApprovalRefusal, string> RefusalsUnderAnotherCulture => new()
    {
        {
            "en-IN", "Manager", 250000.00m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 250,000.00, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            "de-DE", "Manager", 250000.00m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 250,000.00, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            "de-DE", "Manager", 250000.001m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 250,000.001, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
    };

    [Theory]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(RefusalsUnderAnotherCulture))]
    public void Decide_FormatsAmountsIndependentOfTheCurrentCulture(
        string cultureName, string role, decimal amount, ApprovalRefusal expectedReason, string expectedMessage)
    {
        var originalCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(cultureName);
        try
        {
            // Guard: the culture must format this amount differently, or the test proves nothing. Compare at
            // the precision the reason shows: two decimals, or every decimal of a sub-cent amount.
            var precision = "N" + Math.Max(2, (int)amount.Scale);
            Assert.NotEqual(
                amount.ToString(precision, CultureInfo.InvariantCulture),
                amount.ToString(precision, CultureInfo.CurrentCulture));

            var refusal = Assert.Throws<ApprovalRefusedException>(
                () => ApprovalPolicy.Decide(InvoiceId, amount, NoFirstApproval, new Approver("demo.user", role)));

            Assert.Equal(expectedReason, refusal.Reason);
            Assert.Equal(expectedMessage, refusal.Message);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    // The Director-required reason names the 500,000.00 threshold; en-IN would group it as 5,00,000.00.
    [Fact]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-005")]
    public void Decide_StatesTheTwoApproverThresholdIndependentOfTheCurrentCulture()
    {
        var originalCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-IN");
        try
        {
            // Guard: the culture must format the threshold differently, or the test proves nothing.
            Assert.NotEqual("500,000.00", 500000.00m.ToString("N2", CultureInfo.CurrentCulture));

            var refusal = Assert.Throws<ApprovalRefusedException>(
                () => ApprovalPolicy.Decide(InvoiceId, 600000.00m, "demo.director", Manager));

            Assert.Equal(ApprovalRefusal.DirectorRequired, refusal.Reason);
            Assert.Equal(
                "Approval refused: invoice INV-1001 is above 500,000.00, so its second approval must come from a Director. " +
                "Your role is Manager.",
                refusal.Message);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }
}
