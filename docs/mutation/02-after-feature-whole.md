# Mutation score after the feature (before hardening), whole scope

- Code under test: commit 2a4dfac (User Stories 1 and 2); 97 unit tests.
- Tools: .NET SDK 8.0.427, Stryker.NET 4.13.0.
- Command (from `backend/tests/InvoiceApp.Tests`): `dotnet stryker -O StrykerOutput/02-after-feature-whole`

> **This score does not cover the approval rules.** Stryker logged: `An unidentified mutation in ApprovalPolicy.cs resulted in a compile error (at 43:21) with id: CS0165, message: Use of unassigned local variable 'roleLimit'` and `Safe Mode! Stryker will remove all mutations in Decide and mark them as 'compile error'.` All 29 mutants of `ApprovalPolicy.Decide` were dropped (Compile Errors column), so the number measures `ApprovalService`, the exception and the amount format, not FR-001 to FR-006. The cause is the guard `if (LimitFor(approver.Role) is not decimal roleLimit) { throw ...; }`: removing the throw leaves `roleLimit` unassigned. See 03-after-hardening for the fix.

## Stryker summary

| File                        | Score   | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| --------------------------- | ------- | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalLimits.cs           | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalOutcome.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalPolicy.cs           | 100.00% | 1      | 0        | 0       | 0           | 0       | 29             | 1              | 0                | 30            |
| ApprovalRefusal.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalRefusedException.cs | 100.00% | 1      | 0        | 0       | 0           | 0       | 0              | 1              | 0                | 1             |
| ApprovalRoles.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalService.cs          | 91.30%  | 19     | 2        | 2       | 0           | 10      | 0              | 21             | 2                | 33            |
| Approver.cs                 | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| DiscountCalculator.cs       | 0.00%   | 0      | 0        | 0       | 17          | 5       | 0              | 0              | 17               | 22            |
| IInvoiceRepository.cs       | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs                  | 0.00%   | 0      | 2        | 0       | 0           | 0       | 0              | 0              | 2                | 2             |
| InvoiceStatus.cs            | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 52.27%

### *Coverage Thresholds: high:80 low:60 break:0*
