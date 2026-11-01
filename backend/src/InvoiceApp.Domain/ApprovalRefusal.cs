namespace InvoiceApp.Domain;

/// <summary>Why an approval attempt was refused (FR-005). The API returns it as the <c>code</c>.</summary>
public enum ApprovalRefusal
{
    /// <summary>The role is neither Manager nor Director (FR-006).</summary>
    RoleCannotApprove,

    /// <summary>The amount is above the approver's own limit (FR-001).</summary>
    AmountAboveRoleLimit,

    /// <summary>The approver gave the first approval and cannot give the second one too (FR-004).</summary>
    SameApproverTwice,

    /// <summary>The second approval of an invoice above 500,000.00 must come from a Director (FR-003).</summary>
    DirectorRequired
}
