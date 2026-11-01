using System.Runtime.CompilerServices;

namespace InvoiceApp.Domain;

/// <summary>
/// Moves an invoice through its lifecycle: Draft -> PendingApproval -> Approved or Rejected.
/// Who may approve is decided by <see cref="ApprovalPolicy"/>; above 500,000.00 the first of two
/// approvals is recorded and the invoice stays pending until the second.
/// </summary>
public class ApprovalService
{
    // One decision gate per repository, shared by every service on it: each request gets its own service,
    // but the repository is a singleton. Submit, Approve and Reject read, decide and write inside the gate as
    // one step, so two simultaneous approvals cannot both count the same user (FR-004).
    private static readonly ConditionalWeakTable<IInvoiceRepository, object> DecisionGates = new();

    private readonly IInvoiceRepository _repository;
    private readonly TimeProvider _timeProvider;
    private readonly object _decisionGate;

    public ApprovalService(IInvoiceRepository repository)
        : this(repository, TimeProvider.System)
    {
    }

    public ApprovalService(IInvoiceRepository repository, TimeProvider timeProvider)
    {
        _repository = repository;
        _timeProvider = timeProvider;
        _decisionGate = DecisionGates.GetOrCreateValue(repository);
    }

    public Invoice Submit(string invoiceId)
    {
        lock (_decisionGate)
        {
            var invoice = Find(invoiceId);

            if (invoice.Status != InvoiceStatus.Draft)
            {
                throw new InvalidOperationException(
                    $"Invoice {invoiceId} is {invoice.Status}; only drafts can be submitted.");
            }

            invoice.Status = InvoiceStatus.PendingApproval;
            _repository.Update(invoice);
            return invoice;
        }
    }

    public Invoice Approve(string invoiceId, Approver approver)
    {
        lock (_decisionGate)
        {
            var invoice = Find(invoiceId);
            EnsurePending(invoice);

            // The repository hands out the live invoice, so every rule is checked before the first write.
            var outcome = ApprovalPolicy.Decide(invoice.Id, invoice.Amount, invoice.FirstApprovedBy, approver);

            var now = _timeProvider.GetUtcNow().UtcDateTime;
            if (outcome == ApprovalOutcome.FirstApprovalRecorded)
            {
                // FR-003: the invoice stays pending until a different Director gives the second approval.
                invoice.FirstApprovedBy = approver.Username;
                invoice.FirstApprovedAt = now;
            }
            else
            {
                // The final decision; a recorded first approval is kept.
                invoice.Status = InvoiceStatus.Approved;
                invoice.DecidedBy = approver.Username;
                invoice.DecidedAt = now;
            }

            _repository.Update(invoice);
            return invoice;
        }
    }

    public Invoice Reject(string invoiceId, string approver, string reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("A reason is required to reject an invoice.", nameof(reason));
        }

        lock (_decisionGate)
        {
            var invoice = Find(invoiceId);
            EnsurePending(invoice);

            // Not limited by role or amount, and a recorded first approval is kept (FR-007).
            var now = _timeProvider.GetUtcNow().UtcDateTime;
            invoice.Status = InvoiceStatus.Rejected;
            invoice.DecidedBy = approver;
            invoice.DecidedAt = now;
            invoice.DecisionNote = reason;
            _repository.Update(invoice);
            return invoice;
        }
    }

    private Invoice Find(string invoiceId) =>
        _repository.GetById(invoiceId)
        ?? throw new KeyNotFoundException($"Invoice {invoiceId} was not found.");

    private static void EnsurePending(Invoice invoice)
    {
        if (invoice.Status != InvoiceStatus.PendingApproval)
        {
            throw new InvalidOperationException(
                $"Invoice {invoice.Id} is {invoice.Status}; only pending invoices can be decided.");
        }
    }
}
