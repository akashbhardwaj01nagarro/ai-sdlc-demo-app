namespace InvoiceApp.Domain;

/// <summary>What an allowed approval attempt does to the invoice.</summary>
public enum ApprovalOutcome
{
    /// <summary>The final decision: the invoice becomes Approved.</summary>
    Approved
}
