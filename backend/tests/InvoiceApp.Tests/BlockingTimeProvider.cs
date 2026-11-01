namespace InvoiceApp.Tests;

/// <summary>
/// A clock whose first <see cref="GetUtcNow"/> call waits until the test calls <see cref="ReleaseFirstCall"/>;
/// later calls return at once. The service reads the clock after deciding and before writing, inside its
/// decision gate, so a held first call keeps one decision half done while the test starts others.
/// Release it in a <c>finally</c> block so a failing assertion never leaves a thread waiting.
/// </summary>
internal sealed class BlockingTimeProvider : TimeProvider
{
    private static readonly TimeSpan SafetyTimeout = TimeSpan.FromSeconds(30);

    private readonly DateTimeOffset _utcNow;
    private readonly ManualResetEventSlim _firstCallEntered = new(false);
    private readonly ManualResetEventSlim _firstCallReleased = new(false);
    private int _callCount;

    public BlockingTimeProvider(DateTimeOffset utcNow) => _utcNow = utcNow;

    public override DateTimeOffset GetUtcNow()
    {
        if (Interlocked.Increment(ref _callCount) == 1)
        {
            _firstCallEntered.Set();
            if (!_firstCallReleased.Wait(SafetyTimeout))
            {
                throw new TimeoutException("The test never released the first clock call.");
            }
        }

        return _utcNow;
    }

    /// <summary>Waits until a caller is held inside the first <see cref="GetUtcNow"/> call.</summary>
    public bool WaitUntilFirstCallIsHeld(TimeSpan timeout) => _firstCallEntered.Wait(timeout);

    public void ReleaseFirstCall() => _firstCallReleased.Set();
}
