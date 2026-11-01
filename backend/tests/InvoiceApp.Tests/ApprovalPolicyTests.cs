using System.Globalization;
using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

/// <summary>
/// User Story 1: single-approver limits (spec 001, FR-001, FR-002, FR-005, FR-006).
/// Amounts and role names are literals on purpose: a test that reads <c>ApprovalLimits</c> or
/// <c>ApprovalRoles</c> still passes when the constant itself is wrong.
/// </summary>
public class ApprovalPolicyTests
{
    private const string InvoiceId = "INV-1001";

    private static readonly Approver Manager = new("demo.manager", "Manager");
    private static readonly Approver Director = new("demo.director", "Director");

    // FR-001: a Manager approves alone up to 50,000.00 inclusive.

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_ManagerApprovesTheSmallestAmount()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 0.01m, Manager);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_ManagerApprovesExactlyTheManagerLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.00m, Manager);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    public void Decide_DirectorApprovesExactlyTheManagerLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.00m, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesManagerOneCentAboveTheManagerLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 50000.01m, Manager));

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
            () => ApprovalPolicy.Decide(InvoiceId, 50000.001m, Manager));

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
            "Director", 500000.001m, ApprovalRefusal.TwoApproversRequired,
            "Approval refused: invoice INV-1001 is 500,000.001. " +
            "Invoices above 500,000.00 need two approvers, which are not supported yet."
        },
        {
            "Manager", 50000.0100m, ApprovalRefusal.AmountAboveRoleLimit,
            "Approval refused: invoice INV-1001 is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
    };

    [Theory]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(RefusalsOfAmountsWithMoreThanTwoDecimals))]
    public void Decide_ShowsTheExactAmountWhenItHasMoreThanTwoDecimals(
        string role, decimal amount, ApprovalRefusal expectedReason, string expectedMessage)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, amount, new Approver("demo.user", role)));

        Assert.Equal(expectedReason, refusal.Reason);
        Assert.Equal(expectedMessage, refusal.Message);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesManagerAtTheDirectorLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 500000.00m, Manager));

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
        var outcome = ApprovalPolicy.Decide(InvoiceId, 50000.01m, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    [Fact]
    [Trait("Rule", "FR-002")]
    public void Decide_DirectorApprovesExactlyTheDirectorLimit()
    {
        var outcome = ApprovalPolicy.Decide(InvoiceId, 500000.00m, Director);

        Assert.Equal(ApprovalOutcome.Approved, outcome);
    }

    // Above 500,000.00 two approvers are needed; until User Story 2 exists every attempt is refused.

    [Fact]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesDirectorOneCentAboveTheDirectorLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 500000.01m, Director));

        Assert.Equal(ApprovalRefusal.TwoApproversRequired, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 is 500,000.01. " +
            "Invoices above 500,000.00 need two approvers, which are not supported yet.",
            refusal.Message);
    }

    [Fact]
    [Trait("Rule", "FR-002")]
    public void Decide_RefusesDirectorASubCentAboveTheDirectorLimit()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 500000.001m, Director));

        Assert.Equal(ApprovalRefusal.TwoApproversRequired, refusal.Reason);
        Assert.StartsWith("Approval refused: invoice INV-1001 is ", refusal.Message);
        Assert.EndsWith(". Invoices above 500,000.00 need two approvers, which are not supported yet.", refusal.Message);
    }

    [Fact]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-005")]
    public void Decide_RefusesManagerAboveTheDirectorLimitAsTwoApproversRequired()
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, 500000.01m, Manager));

        Assert.Equal(ApprovalRefusal.TwoApproversRequired, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 is 500,000.01. " +
            "Invoices above 500,000.00 need two approvers, which are not supported yet.",
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
            () => ApprovalPolicy.Decide(InvoiceId, 100.00m, new Approver("demo.user", role)));

        Assert.Equal(ApprovalRefusal.RoleCannotApprove, refusal.Reason);
        Assert.Equal(
            $"Approval refused: invoice INV-1001 cannot be approved by the {role} role. " +
            "Only Managers and Directors can approve invoices.",
            refusal.Message);
    }

    public static TheoryData<decimal> AmountsAboveTheManagerLimit => new()
    {
        60000.00m,
        600000.00m,
    };

    [Theory]
    [Trait("Rule", "FR-006")]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(AmountsAboveTheManagerLimit))]
    public void Decide_RefusesTheRoleBeforeCheckingTheAmount(decimal amount)
    {
        var refusal = Assert.Throws<ApprovalRefusedException>(
            () => ApprovalPolicy.Decide(InvoiceId, amount, new Approver("demo.admin", "Admin")));

        Assert.Equal(ApprovalRefusal.RoleCannotApprove, refusal.Reason);
        Assert.Equal(
            "Approval refused: invoice INV-1001 cannot be approved by the Admin role. " +
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
            "en-IN", "Director", 1234567.89m, ApprovalRefusal.TwoApproversRequired,
            "Approval refused: invoice INV-1001 is 1,234,567.89. " +
            "Invoices above 500,000.00 need two approvers, which are not supported yet."
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
                () => ApprovalPolicy.Decide(InvoiceId, amount, new Approver("demo.user", role)));

            Assert.Equal(expectedReason, refusal.Reason);
            Assert.Equal(expectedMessage, refusal.Message);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }
}
