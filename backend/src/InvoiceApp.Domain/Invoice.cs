namespace InvoiceApp.Domain;

public class Invoice
{
    public string Id { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public InvoiceStatus Status { get; set; } = InvoiceStatus.Draft;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // The first of the two approvals an invoice above 500,000.00 needs (FR-003); the second is the decision below.
    public string? FirstApprovedBy { get; set; }
    public DateTime? FirstApprovedAt { get; set; }

    public string? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
}
