namespace InvoiceApp.Domain;

/// <summary>
/// The largest invoice amount each role may approve on its own (spec 001, FR-001, FR-002).
/// Limits are inclusive and compared exactly, never rounded.
/// </summary>
public static class ApprovalLimits
{
    public const decimal ManagerLimit = 50_000m;
    public const decimal DirectorLimit = 500_000m;
}
