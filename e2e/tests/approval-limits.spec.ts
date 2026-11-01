import { expect, test } from '@playwright/test';
import { ApprovalsPage } from '../pages/ApprovalsPage';
import { InvoicesPage } from '../pages/InvoicesPage';
import { LoginPage } from '../pages/LoginPage';

// Spec 001, User Story 1, acceptance scenario 2, through the UI and the running server.
test.describe('Approval limits by role (spec 001)', () => {
  test(
    'a Manager approving 60,000 is refused with the reason shown, and the invoice is unchanged',
    { tag: ['@FR-001', '@FR-005', '@FR-009'] },
    async ({ page }) => {
      const invoices = new InvoicesPage(page);
      const approvals = new ApprovalsPage(page);
      const customer = `E2E over-limit ${Date.now()}`;

      await new LoginPage(page).signInAs('demo.manager');

      // Our own pending invoice, created through the UI: never a seeded invoice or a guessed id.
      await invoices.open();
      const id = await invoices.create(customer, 60000);
      const beforeAttempt = await invoices.submit(id);
      expect(beforeAttempt).toMatchObject({ id, status: 'PendingApproval', amount: 60000 });
      await expect(invoices.status(customer)).toHaveText('Pending Approval');

      // FR-009: the Manager is offered Approve. FR-001: 60,000 is above the Manager's limit, so the
      // server refuses (403, not 409 or 500) and the screen shows its reason word for word.
      await approvals.open();
      const response = await approvals.approve(id);
      const reason =
        `Approval refused: invoice ${id} is 60,000.00, above the 50,000.00 limit for the Manager role. ` +
        'A Director must approve it.';
      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({ error: reason, code: 'AmountAboveRoleLimit' });
      await expect(approvals.decisionAlert).toHaveText(reason);

      // FR-005: the refusal changed nothing. The page does not refresh after an error, so its DOM
      // proves nothing about the server: reload, then compare every field the server returns.
      const afterReload = await invoices.reload();
      expect(afterReload.find((invoice) => invoice.id === id)).toEqual(beforeAttempt);
      await invoices.open();
      await expect(invoices.status(customer)).toHaveText('Pending Approval');
      await expect(invoices.amount(customer)).toHaveText('$60,000.00');
      await approvals.open();
      await expect(approvals.approveButton(id)).toBeVisible();
    },
  );
});
