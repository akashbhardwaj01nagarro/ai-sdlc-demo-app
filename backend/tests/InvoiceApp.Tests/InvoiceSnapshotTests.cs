using System.Reflection;
using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

/// <summary>
/// Guards the helper every FR-005 test relies on: a snapshot that skips a property, ignores its value
/// or follows the live invoice would let a refused attempt change that property unnoticed.
/// </summary>
public class InvoiceSnapshotTests
{
    private static readonly PropertyInfo[] InvoiceProperties =
        typeof(Invoice).GetProperties(BindingFlags.Public | BindingFlags.Instance);

    // Two invoices that differ in every property, with no property at its default value. When Invoice
    // gains a property, set it in both; the guards below fail until you do. The first approval
    // (FirstApprovedBy, FirstApprovedAt; User Story 2) is set too, so a refusal that clears or replaces
    // it shows up in every snapshot comparison.
    private static Invoice PopulatedInvoice() => new()
    {
        Id = "INV-3001",
        CustomerName = "Harbour Academy",
        Amount = 12345.67m,
        Status = InvoiceStatus.Rejected,
        CreatedAt = new DateTime(2026, 9, 1, 8, 0, 0, DateTimeKind.Utc),
        FirstApprovedBy = "demo.manager",
        FirstApprovedAt = new DateTime(2026, 9, 2, 9, 0, 0, DateTimeKind.Utc),
        DecidedBy = "demo.director",
        DecidedAt = new DateTime(2026, 9, 2, 10, 15, 0, DateTimeKind.Utc),
        DecisionNote = "Duplicate invoice",
    };

    private static Invoice OtherPopulatedInvoice() => new()
    {
        Id = "INV-3002",
        CustomerName = "Hillside School",
        Amount = 765.43m,
        Status = InvoiceStatus.Approved,
        CreatedAt = new DateTime(2026, 8, 3, 7, 30, 0, DateTimeKind.Utc),
        FirstApprovedBy = "demo.director2",
        FirstApprovedAt = new DateTime(2026, 8, 4, 9, 30, 0, DateTimeKind.Utc),
        DecidedBy = "demo.manager",
        DecidedAt = new DateTime(2026, 8, 4, 12, 45, 0, DateTimeKind.Utc),
        DecisionNote = "Wrong customer",
    };

    public static TheoryData<string> InvoicePropertyNames
    {
        get
        {
            var names = new TheoryData<string>();
            foreach (var property in InvoiceProperties)
            {
                names.Add(property.Name);
            }

            return names;
        }
    }

    [Fact]
    [Trait("Rule", "FR-005")]
    public void Of_CoversEveryPublicPropertyOfInvoice()
    {
        var propertyNames = typeof(Invoice)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal);

        var snapshot = InvoiceSnapshot.Of(new Invoice());

        Assert.Equal(propertyNames, snapshot.Keys.OrderBy(name => name, StringComparer.Ordinal));
    }

    [Fact]
    [Trait("Rule", "FR-005")]
    public void Of_CopiesTheValueOfEveryProperty()
    {
        var invoice = PopulatedInvoice();
        // Guards: every value is set and unique, so a value that is dropped, defaulted or filed under
        // another property cannot match by accident.
        foreach (var property in InvoiceProperties)
        {
            Assert.False(
                HasDefaultValue(property, invoice),
                $"Set Invoice.{property.Name} to a non-default value in PopulatedInvoice().");
        }

        var values = InvoiceProperties.Select(property => property.GetValue(invoice)).ToList();
        Assert.True(
            values.Distinct().Count() == values.Count,
            "Give every property in PopulatedInvoice() a different value.");

        var snapshot = InvoiceSnapshot.Of(invoice);

        var expected = InvoiceProperties.ToDictionary(property => property.Name, property => property.GetValue(invoice));
        Assert.Equal(expected, snapshot);
    }

    [Theory]
    [Trait("Rule", "FR-005")]
    [MemberData(nameof(InvoicePropertyNames))]
    public void Of_ChangesWhenAnyOnePropertyChanges(string propertyName)
    {
        var property = typeof(Invoice).GetProperty(propertyName)!;
        var invoice = PopulatedInvoice();
        var replacement = property.GetValue(OtherPopulatedInvoice());
        Assert.False(
            Equals(property.GetValue(invoice), replacement),
            $"Give Invoice.{propertyName} different values in PopulatedInvoice() and OtherPopulatedInvoice().");
        var before = InvoiceSnapshot.Of(invoice);

        property.SetValue(invoice, replacement);

        var after = InvoiceSnapshot.Of(invoice);
        Assert.NotEqual(before, after);
        var expected = new Dictionary<string, object?>(before) { [propertyName] = replacement };
        Assert.Equal(expected, after);
    }

    private static bool HasDefaultValue(PropertyInfo property, Invoice invoice)
    {
        var value = property.GetValue(invoice);
        var typeDefault = property.PropertyType.IsValueType ? Activator.CreateInstance(property.PropertyType) : null;
        return value is null || value.Equals(typeDefault) || value.Equals(property.GetValue(new Invoice()));
    }
}
