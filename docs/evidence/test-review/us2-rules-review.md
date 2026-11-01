I found no defect in the uncommitted US2 change: I couldn't break FR-003, FR-004 or FR-005 by reading the code or by running it. I covered checks 1, 2, 3 and 7, plus FR-008 and the JavaScript. This review uses the stand-in pr-review prompt, which was built from AGENTS.md because the workshop's own review prompt wasn't available.

**Every path at the four boundary amounts:** I traced `ApprovalPolicy.cs:13-63` and the writes at `ApprovalService.cs:61-76`, then confirmed each case with requests to the built API.

| Amount | Manager | Director | Admin or unknown role |
|---|---|---|---|
| 50,000.00 | Approved | Approved | 403 RoleCannotApprove |
| 50,000.01 | 403 AmountAboveRoleLimit | Approved | 403 RoleCannotApprove |
| 500,000.00 | 403 AmountAboveRoleLimit | Approved | 403 RoleCannotApprove |
| 500,000.01, no first approval yet | First approval recorded, invoice stays pending | First approval recorded, invoice stays pending | 403 RoleCannotApprove |
| 500,000.01, first approval exists | Same user: SameApproverTwice. Anyone else: DirectorRequired | Same user: SameApproverTwice. A different Director: Approved, first approval kept | 403 RoleCannotApprove |

**FR-004, same user twice:**
- **Name variants:** the same-user check compares against `FirstApprovedBy`, trimmed and ignoring case (`ApprovalPolicy.cs:35`, `:75-76`).
- **Manager first, same person later:** the same-user check runs before the role check, so that person is refused whatever role they now have.
- **Second approver's role:** the Director role is checked at the moment of the second approval (`ApprovalPolicy.cs:43`).
- **No single approver above 500,000:** the only way to reach Approved above 500,000 is the branch that needs an existing first approval (`ApprovalPolicy.cs:51`).
- **First approver never lost:** `FirstApprovedBy` is written in one place only (`ApprovalService.cs:65`), and only when it was empty, inside the same locked step. Nothing clears it, and Reject keeps it (`:95-98`).

**Check 7, repeats and simultaneous requests:**
- Submit, Approve and Reject each read, decide and write inside one lock (`ApprovalService.cs:35`, `:53`, `:88`).
- That lock belongs to the repository (`:15`, `:30`), and the repository is registered once for the whole app (`Program.cs:14`). So every per-request `ApprovalService` shares it.
- Live HTTP results:
  - **Same user, 25 approvals at once:** exactly one counted; the other 24 got 403 SameApproverTwice.
  - **Mixed users, 40 rounds:** each round sent 27 approvals at once from both Directors, the Manager and the Admin. Every invoice ended Approved by two different users with a Director second, and exactly two requests succeeded each time.
  - **Reject racing approvals, 20 rounds:** exactly one decision succeeded each time, and the first approval was kept.

**FR-005, refused attempts:**
- Every refusal (not found at `ApprovalService.cs:104-106`, wrong state at `:108-115`, and every policy refusal) happens before the first field is written at `:61`. `Update` is never called on a refusal.
- Over HTTP, refused attempts left the invoice JSON identical.
- The reasons match `contracts/approvals-api.md` word for word and name the invoice.

**FR-008 and JavaScript:** `app.js:72-76` adds the first approver as plain text, and nothing in `wwwroot` uses `innerHTML`. There are no limits or role checks in the JavaScript.

All 81 unit tests pass. The probe script was a local scratch file outside the repository and is not committed.

I considered three more things but didn't raise them, because none breaks a rule:
- **Half-written reads:** during a concurrent decision, a GET can return a half-updated invoice, because the repository hands out live objects. This only affects what is displayed.
- **Repository registration:** the lock only works while the repository stays a single shared instance.
- **DirectorRequired wording:** the reason says "a Director" without naming the first approver. That is exactly what spec acceptance scenario US2-3 asks for.

```json
{
  "reviewer": "review-rules",
  "scope": "US2 working tree",
  "findings": []
}
```