using InvoiceApp.Domain;

namespace InvoiceApp.Tests;

/// <summary>
/// Hands out the live invoice objects, like the in-memory repository, so a field written before a
/// refusal is visible to the test even though <see cref="Update"/> stores nothing.
/// <see cref="UpdateCount"/> records how often <see cref="Update"/> was called.
/// </summary>
internal class FakeInvoiceRepository : IInvoiceRepository
{
    private readonly List<Invoice> _invoices = new();

    public FakeInvoiceRepository(params Invoice[] seed) => _invoices.AddRange(seed);

    public int UpdateCount { get; private set; }

    public IReadOnlyList<Invoice> GetAll() => _invoices.ToList();
    public Invoice? GetById(string id) => _invoices.FirstOrDefault(i => i.Id == id);
    public IReadOnlyList<Invoice> GetByIds(IEnumerable<string> ids) => _invoices.Where(i => ids.Contains(i.Id)).ToList();
    public Invoice Add(Invoice invoice) { _invoices.Add(invoice); return invoice; }
    public void Update(Invoice invoice) => UpdateCount++;
    public bool Remove(string id) => _invoices.RemoveAll(i => i.Id == id) > 0;
}
