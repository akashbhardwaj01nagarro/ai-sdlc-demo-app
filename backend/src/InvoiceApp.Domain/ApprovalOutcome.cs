namespace InvoiceApp.Domain;

/// <summary>What an allowed approval attempt does to the invoice.</summary>
public enum ApprovalOutcome
{
    /// <summary>The final decision: the invoice becomes Approved.</summary>
    Approved,

    /// <summary>The first of two approvals above 500,000.00 (FR-003): recorded, and the invoice stays pending.</summary>
    FirstApprovalRecorded
}
