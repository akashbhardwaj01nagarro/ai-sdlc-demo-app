import { expect, test } from '@playwright/test';
import type { InvoiceJson } from '../pages/api';
import { ApprovalsPage } from '../pages/ApprovalsPage';
import { InvoicesPage } from '../pages/InvoicesPage';
import { LoginPage } from '../pages/LoginPage';

// FirstApprovedAt and DecidedAt as the API writes them; the value itself comes from the server's clock.
const isoDateTime = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

// Spec 001, User Story 2, acceptance scenarios 1, 2 and 4, and FR-008, through the UI and the running server.
test.describe('Two approvers above 500,000 (spec 001)', () => {
  test(
    'above 500,000 the first approval is recorded and shown, the same Director is refused, and a different Director completes it',
    { tag: ['@FR-003', '@FR-004', '@FR-008'] },
    async ({ page }) => {
      const login = new LoginPage(page);
      const invoices = new InvoicesPage(page);
      const approvals = new ApprovalsPage(page);
      const customer = `E2E two approvers ${Date.now()}`;
      const awaitingSecond = 'Awaiting second approval (first: demo.director)';

      await login.signInAs('demo.director');

      // Our own pending invoice above 500,000.00, created through the UI: never the seeded INV-1006 or a guessed id.
      await invoices.open();
      const id = await invoices.create(customer, 640000);
      const submitted = await invoices.submit(id);
      expect(submitted).toMatchObject({
        id,
        customerName: customer,
        amount: 640000,
        status: 'PendingApproval',
        firstApprovedBy: null,
        decidedBy: null,
      });
      await approvals.open();
      await expect(approvals.approveButton(id)).toBeVisible();
      await expect(approvals.item(id)).not.toContainText('Awaiting second approval');

      // FR-003: above 500,000.00 a Director's approval is only the first of two. It is recorded, and the
      // invoice stays pending and undecided; every other field is as submitted.
      const firstApproval = await approvals.approve(id);
      expect(firstApproval.status()).toBe(200);
      const afterFirstApproval: InvoiceJson = await firstApproval.json();
      expect(afterFirstApproval).toEqual({
        ...submitted,
        status: 'PendingApproval',
        firstApprovedBy: 'demo.director',
        firstApprovedAt: isoDateTime,
        decidedBy: null,
        decidedAt: null,
      });

      // FR-008: the Approvals tab shows that the invoice awaits a second approval and who gave the first,
      // and still offers Approve (FR-009). The note has no role or name, so it is checked as the visible
      // text (innerText) of the invoice's list item.
      await expect(approvals.item(id)).toContainText(awaitingSecond, { useInnerText: true });
      await expect(approvals.approveButton(id)).toBeVisible();

      // FR-004: the same Director cannot also give the second approval. The server refuses (403, not 409
      // or 500) and the screen shows its reason word for word.
      const repeat = await approvals.approve(id);
      const reason =
        `Approval refused: you gave the first approval for invoice ${id}, ` +
        'so the second approval must come from a different Director.';
      expect(repeat.status()).toBe(403);
      expect(await repeat.json()).toEqual({ error: reason, code: 'SameApproverTwice' });
      await expect(approvals.decisionAlert).toHaveText(reason);

      // FR-005: the refusal changed nothing, the first approval included. The page does not refresh after
      // an error, so reload and compare every field the server returns with the state after the first approval.
      const afterRefusal = await invoices.reload();
      expect(afterRefusal.find((invoice) => invoice.id === id)).toEqual(afterFirstApproval);

      // FR-003: a different Director sees who gave the first approval, and their approval completes it.
      await login.signOut();
      await login.signInAs('demo.director2');
      await approvals.open();
      await expect(approvals.item(id)).toContainText(awaitingSecond, { useInnerText: true });
      const secondApproval = await approvals.approve(id);
      expect(secondApproval.status()).toBe(200);
      const approved: InvoiceJson = await secondApproval.json();
      expect(approved).toEqual({
        ...afterFirstApproval, // keeps the first approval: firstApprovedAt is the same instant
        status: 'Approved',
        firstApprovedBy: 'demo.director',
        decidedBy: 'demo.director2',
        decidedAt: isoDateTime,
      });

      // Server truth after a reload: approved by demo.director2 with the first approval kept, shown as
      // Approved in the Invoices table, and no longer offered for approval.
      const afterSecondApproval = await invoices.reload();
      expect(afterSecondApproval.find((invoice) => invoice.id === id)).toEqual(approved);
      await invoices.open();
      await expect(invoices.status(customer)).toHaveText('Approved');
      // The table row above is drawn in the same step as the pending list, so this count is not read too early.
      await approvals.open();
      await expect(approvals.approveButton(id)).toHaveCount(0);
    },
  );
});
