# Mutation score after hardening, whole Domain project

- Code under test: commit 2a4dfac plus the hardening commit (equivalent `ApprovalPolicy` guard, two message assertions); 97 unit tests.
- Tools: .NET SDK 8.0.427, Stryker.NET 4.13.0. No Safe Mode warning; 0 compile-error mutants in `ApprovalPolicy.cs`.
- Command (from `backend/tests/InvoiceApp.Tests`): `dotnet stryker -O StrykerOutput/03-after-hardening-whole`

The only undetected mutants are outside this feature: `DiscountCalculator.cs` (17 no coverage; untested, unrelated) and the `string.Empty` defaults of `Invoice.Id` and `Invoice.CustomerName` (2 survivors; default values, not approval behaviour).

## Stryker summary

| File                        | Score   | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| --------------------------- | ------- | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalLimits.cs           | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalOutcome.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalPolicy.cs           | 100.00% | 24     | 0        | 0       | 0           | 6       | 0              | 24             | 0                | 30            |
| ApprovalRefusal.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalRefusedException.cs | 100.00% | 1      | 0        | 0       | 0           | 0       | 0              | 1              | 0                | 1             |
| ApprovalRoles.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalService.cs          | 100.00% | 21     | 0        | 2       | 0           | 10      | 0              | 23             | 0                | 33            |
| Approver.cs                 | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| DiscountCalculator.cs       | 0.00%   | 0      | 0        | 0       | 17          | 5       | 0              | 0              | 17               | 22            |
| IInvoiceRepository.cs       | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs                  | 0.00%   | 0      | 2        | 0       | 0           | 0       | 0              | 0              | 2                | 2             |
| InvoiceStatus.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 71.64%

### *Coverage Thresholds: high:80 low:60 break:0*
