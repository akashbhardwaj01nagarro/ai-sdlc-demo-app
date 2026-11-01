namespace InvoiceApp.Domain;

/// <summary>The signed-in user attempting an approval. Built from the session, never from a request body.</summary>
public sealed record Approver(string Username, string Role);
