namespace InvoiceApp.Domain;

/// <summary>
/// An approval attempt broke an approval rule; the invoice is unchanged. Derives from <see cref="Exception"/>,
/// not <see cref="InvalidOperationException"/>, so the API maps it to 403 and never to 409.
/// </summary>
public sealed class ApprovalRefusedException : Exception
{
    public ApprovalRefusedException(ApprovalRefusal reason, string message)
        : base(message)
    {
        Reason = reason;
    }

    public ApprovalRefusal Reason { get; }
}
