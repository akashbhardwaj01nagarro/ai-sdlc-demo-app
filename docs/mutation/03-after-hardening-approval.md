# Mutation score after hardening, approval scope

- Code under test: commit 2a4dfac plus the hardening commit (equivalent `ApprovalPolicy` guard, two message assertions); 97 unit tests.
- Tools: .NET SDK 8.0.427, Stryker.NET 4.13.0. No Safe Mode warning; 0 compile-error mutants in `ApprovalPolicy.cs`.
- Command (from `backend/tests/InvoiceApp.Tests`): `dotnet stryker -m "**/Approv*.cs" -O StrykerOutput/03-after-hardening-approval`

All approval mutants are detected. 7 are counted as Timeout: under those mutants a concurrency test waits its full 10 s for a held decision that never reaches the clock, so the session exceeds Stryker's limit; each of the 7 is also killed by a fast test (see the whole-project run, where the 5 policy timeouts are reported as Killed).

## Stryker summary

| File                        | Score   | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| --------------------------- | ------- | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalLimits.cs           | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalOutcome.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalPolicy.cs           | 100.00% | 19     | 0        | 5       | 0           | 6       | 0              | 24             | 0                | 30            |
| ApprovalRefusal.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalRefusedException.cs | 100.00% | 1      | 0        | 0       | 0           | 0       | 0              | 1              | 0                | 1             |
| ApprovalRoles.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalService.cs          | 100.00% | 21     | 0        | 2       | 0           | 10      | 0              | 23             | 0                | 33            |
| Approver.cs                 | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| DiscountCalculator.cs       | N\/A    | 0      | 0        | 0       | 0           | 22      | 0              | 0              | 0                | 22            |
| IInvoiceRepository.cs       | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs                  | N\/A    | 0      | 0        | 0       | 0           | 2       | 0              | 0              | 0                | 2             |
| InvoiceStatus.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 100.00%

### *Coverage Thresholds: high:80 low:60 break:0*
