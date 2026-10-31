# Mutation baseline (before), approval scope

- Code under test: unchanged upstream code (commit 66cb3f9); `git diff --stat 66cb3f9 -- backend/src backend/tests` is empty apart from the new `stryker-config.json`.
- Tests: the 7 original `ApprovalServiceTests`.
- Tools: .NET SDK 8.0.427, Stryker.NET 4.13.0 (`.config/dotnet-tools.json`).
- Command (from `backend/tests/InvoiceApp.Tests`): `dotnet stryker -m "**/Approv*.cs" -O StrykerOutput/01-baseline-approval`

## Stryker summary

| File                  | Score  | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| --------------------- | ------ | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalService.cs    | 60.00% | 12     | 8        | 0       | 0           | 7       | 0              | 12             | 8                | 27            |
| DiscountCalculator.cs | N\/A   | 0      | 0        | 0       | 0           | 22      | 0              | 0              | 0                | 22            |
| IInvoiceRepository.cs | N\/A   | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs            | N\/A   | 0      | 0        | 0       | 0           | 2       | 0              | 0              | 0                | 2             |
| InvoiceStatus.cs      | N\/A   | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 60.00%

### *Coverage Thresholds: high:80 low:60 break:0*
