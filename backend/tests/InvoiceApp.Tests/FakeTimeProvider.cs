namespace InvoiceApp.Tests;

/// <summary>
/// A clock that returns the time the test set, so a recorded time can be compared exactly. A service
/// that reads <c>DateTime.UtcNow</c> instead of its <see cref="TimeProvider"/>, or records local time,
/// records a different value.
/// </summary>
internal sealed class FakeTimeProvider : TimeProvider
{
    public FakeTimeProvider(DateTimeOffset utcNow) => UtcNow = utcNow;

    public DateTimeOffset UtcNow { get; set; }

    public override DateTimeOffset GetUtcNow() => UtcNow;
}
