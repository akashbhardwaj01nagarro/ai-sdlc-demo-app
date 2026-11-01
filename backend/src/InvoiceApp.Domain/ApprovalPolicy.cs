using System.Globalization;

namespace InvoiceApp.Domain;

/// <summary>
/// Decides whether an approver may approve an invoice of a given amount (spec 001, FR-001 to FR-006).
/// A pure function of values: it never receives the invoice, so it cannot change it. Checks run in order
/// (role; above 500,000.00 the same approver, then a Director for the second approval; otherwise the role
/// limit) and the first failure wins.
/// </summary>
public static class ApprovalPolicy
{
    public static ApprovalOutcome Decide(string invoiceId, decimal amount, string? firstApprovedBy, Approver approver)
    {
        // A null check, not `is not decimal roleLimit`: that variable is definitely assigned only because the throw
        // ends the branch, so a mutant of this guard would not compile and Stryker would drop every mutant in Decide.
        var limit = LimitFor(approver.Role);
        if (limit is null)
        {
            throw new ApprovalRefusedException(
                ApprovalRefusal.RoleCannotApprove,
                $"Approval refused: invoice {invoiceId} cannot be approved by the {approver.Role} role. " +
                "Only Managers and Directors can approve invoices.");
        }

        var roleLimit = limit.Value;

        // Above the Director limit two different users approve (FR-003): the first approval is only recorded,
        // and the second, from a Director, approves the invoice.
        if (amount > ApprovalLimits.DirectorLimit)
        {
            if (firstApprovedBy is null)
            {
                // Clarification Q1: a Manager or a Director may give the first approval.
                // To require a Director for the first approval as well, refuse non-Directors here with DirectorRequired.
                return ApprovalOutcome.FirstApprovalRecorded;
            }

            // Before the role check, because no change of role lets the first approver give the second one (FR-004).
            if (IsSameUser(firstApprovedBy, approver.Username))
            {
                throw new ApprovalRefusedException(
                    ApprovalRefusal.SameApproverTwice,
                    $"Approval refused: you gave the first approval for invoice {invoiceId}, " +
                    "so the second approval must come from a different Director.");
            }

            if (approver.Role != ApprovalRoles.Director)
            {
                throw new ApprovalRefusedException(
                    ApprovalRefusal.DirectorRequired,
                    $"Approval refused: invoice {invoiceId} is above {Format(ApprovalLimits.DirectorLimit)}, " +
                    $"so its second approval must come from a Director. Your role is {approver.Role}.");
            }

            return ApprovalOutcome.Approved;
        }

        if (amount > roleLimit)
        {
            throw new ApprovalRefusedException(
                ApprovalRefusal.AmountAboveRoleLimit,
                $"Approval refused: invoice {invoiceId} is {Format(amount)}, above the {Format(roleLimit)} limit " +
                $"for the {approver.Role} role. A Director must approve it.");
        }

        return ApprovalOutcome.Approved;
    }

    // Exact, case-sensitive match: any other role, including Admin, has no limit and is refused.
    private static decimal? LimitFor(string role) => role switch
    {
        ApprovalRoles.Manager => ApprovalLimits.ManagerLimit,
        ApprovalRoles.Director => ApprovalLimits.DirectorLimit,
        _ => null,
    };

    // A user is the signed-in username, trimmed and ignoring case (FR-004). Reading two spellings of one user
    // as two users would break dual control; reading two users as one only asks for another Director.
    private static bool IsSameUser(string firstUsername, string secondUsername) =>
        string.Equals(firstUsername.Trim(), secondUsername.Trim(), StringComparison.OrdinalIgnoreCase);

    // Always two decimals, plus every further significant one up to decimal's 28, so an amount is never
    // rounded in a reason: 50,000.001 is not shown as 50,000.00, which would contradict the limit.
    private static readonly string AmountFormat = "#,##0.00" + new string('#', 26);

    // Invariant culture: the reason reads 600,000.00 whatever the server's regional settings.
    private static string Format(decimal amount) => amount.ToString(AmountFormat, CultureInfo.InvariantCulture);
}
