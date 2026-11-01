namespace InvoiceApp.Domain;

/// <summary>Why an approval attempt was refused (FR-005). The API returns it as the <c>code</c>.</summary>
public enum ApprovalRefusal
{
    /// <summary>The role is neither Manager nor Director (FR-006).</summary>
    RoleCannotApprove,

    /// <summary>The amount is above the approver's own limit (FR-001).</summary>
    AmountAboveRoleLimit,

    /// <summary>The amount is above 500,000.00, which needs two approvers; not supported yet.</summary>
    TwoApproversRequired
}
