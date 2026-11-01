using System.Globalization;

namespace InvoiceApp.Domain;

/// <summary>
/// Decides whether an approver may approve an invoice of a given amount (spec 001, FR-001, FR-002,
/// FR-005, FR-006). A pure function of values: it never receives the invoice, so it cannot change it.
/// Checks run in order (role, two approvers, role limit) and the first failure wins.
/// </summary>
public static class ApprovalPolicy
{
    public static ApprovalOutcome Decide(string invoiceId, decimal amount, Approver approver)
    {
        if (LimitFor(approver.Role) is not decimal roleLimit)
        {
            throw new ApprovalRefusedException(
                ApprovalRefusal.RoleCannotApprove,
                $"Approval refused: invoice {invoiceId} cannot be approved by the {approver.Role} role. " +
                "Only Managers and Directors can approve invoices.");
        }

        // Above the Director limit two approvers are needed; until that flow exists everyone is refused.
        if (amount > ApprovalLimits.DirectorLimit)
        {
            throw new ApprovalRefusedException(
                ApprovalRefusal.TwoApproversRequired,
                $"Approval refused: invoice {invoiceId} is {Format(amount)}. " +
                $"Invoices above {Format(ApprovalLimits.DirectorLimit)} need two approvers, which are not supported yet.");
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

    // Always two decimals, plus every further significant one up to decimal's 28, so an amount is never
    // rounded in a reason: 50,000.001 is not shown as 50,000.00, which would contradict the limit.
    private static readonly string AmountFormat = "#,##0.00" + new string('#', 26);

    // Invariant culture: the reason reads 600,000.00 whatever the server's regional settings.
    private static string Format(decimal amount) => amount.ToString(AmountFormat, CultureInfo.InvariantCulture);
}
