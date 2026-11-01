import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { apiCall } from './api';

/** The Approvals tab: every pending invoice with Approve and Reject, and the decision alert. */
export class ApprovalsPage {
  readonly tab: Locator;
  readonly panel: Locator;
  /** Shows the server's error text when an approval or a rejection fails. */
  readonly decisionAlert: Locator;

  constructor(private readonly page: Page) {
    this.tab = page.getByRole('tab', { name: 'Approvals', exact: true });
    this.panel = page.getByRole('tabpanel', { name: 'Approvals', exact: true });
    this.decisionAlert = this.panel.getByRole('alert');
  }

  async open(): Promise<void> {
    await this.tab.click();
    await expect(this.panel).toBeVisible();
  }

  approveButton(id: string): Locator {
    // exact: "Approve invoice INV-1006" must not also match "Approve invoice INV-10060".
    return this.panel.getByRole('button', { name: `Approve invoice ${id}`, exact: true });
  }

  /**
   * The list item of a pending invoice, found by its Approve button. Its text holds the
   * "Awaiting second approval (first: …)" note (FR-008), a plain span with no role or name of its
   * own, so tests assert that note as text of this item.
   */
  item(id: string): Locator {
    // The inner locator of `has` is searched inside each list item, so it starts at the page, not the panel.
    return this.panel
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button', { name: `Approve invoice ${id}`, exact: true }) });
  }

  /** Clicks Approve for the invoice; returns the server's response to that approval. */
  async approve(id: string): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse(apiCall('POST', `/api/approvals/${id}/approve`)),
      this.approveButton(id).click(),
    ]);
    return response;
  }
}
