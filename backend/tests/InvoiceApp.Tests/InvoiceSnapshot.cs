using System.Reflection;
using InvoiceApp.Domain;

namespace InvoiceApp.Tests;

/// <summary>
/// A copy of every public property value of an invoice, read by reflection so that properties added
/// later are covered without touching the tests. Compare a snapshot taken before an attempt with one
/// taken after it; never compare two references to the same live invoice.
/// </summary>
internal static class InvoiceSnapshot
{
    public static IReadOnlyDictionary<string, object?> Of(Invoice invoice)
    {
        ArgumentNullException.ThrowIfNull(invoice);

        var values = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in invoice.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!property.CanRead || property.GetIndexParameters().Length > 0)
            {
                throw new NotSupportedException(
                    $"Invoice.{property.Name} cannot be read as a single value. Extend InvoiceSnapshot to copy it.");
            }

            var propertyType = property.PropertyType;
            if (!propertyType.IsValueType && propertyType != typeof(string))
            {
                throw new NotSupportedException(
                    $"Invoice.{property.Name} is a {propertyType.Name}. A snapshot would share that object with the " +
                    "live invoice and miss changes to it. Extend InvoiceSnapshot to copy it.");
            }

            values.Add(property.Name, property.GetValue(invoice));
        }

        return values;
    }
}
