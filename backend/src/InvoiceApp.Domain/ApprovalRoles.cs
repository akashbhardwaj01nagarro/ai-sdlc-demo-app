namespace InvoiceApp.Domain;

/// <summary>Role names as they appear on the signed-in session. Matched exactly: <c>manager</c> is not a Manager.</summary>
public static class ApprovalRoles
{
    public const string Manager = "Manager";
    public const string Director = "Director";
    public const string Admin = "Admin";
}
