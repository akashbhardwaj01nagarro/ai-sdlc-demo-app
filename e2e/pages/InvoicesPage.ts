import { expect, type Locator, type Page } from '@playwright/test';
import { apiCall, type InvoiceJson } from './api';

// Column order of the "All invoices" table in wwwroot/index.html: ID, Customer, Amount, Status, Actions.
const Column = { Id: 0, Amount: 2, Status: 3 } as const;

/** The Invoices tab: the New invoice form and the "All invoices" table. */
export class InvoicesPage {
  readonly tab: Locator;
  readonly panel: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.tab = page.getByRole('tab', { name: 'Invoices', exact: true });
    this.panel = page.getByRole('tabpanel', { name: 'Invoices', exact: true });
    this.table = this.panel.getByRole('table', { name: 'All invoices', exact: true });
  }

  async open(): Promise<void> {
    await this.tab.click();
    await expect(this.panel).toBeVisible();
  }

  /** Creates an invoice through the New invoice form; returns the id the server gave it, read from its row. */
  async create(customer: string, amount: number): Promise<string> {
    await this.panel.getByLabel('Customer name', { exact: true }).fill(customer);
    await this.panel.getByLabel('Amount', { exact: true }).fill(String(amount));
    const [response] = await Promise.all([
      this.page.waitForResponse(apiCall('POST', '/api/invoices')),
      this.panel.getByRole('button', { name: 'Create invoice', exact: true }).click(),
    ]);
    expect(response.status(), `create the invoice for ${customer}`).toBe(201);

    const idCell = this.cell(customer, Column.Id);
    await expect(idCell).toHaveText(/^INV-\d+$/);
    return (await idCell.innerText()).trim();
  }

  /** Submits a draft for approval; returns the invoice as the server stored it. */
  async submit(id: string): Promise<InvoiceJson> {
    const [response] = await Promise.all([
      this.page.waitForResponse(apiCall('POST', `/api/invoices/${id}/submit`)),
      this.panel.getByRole('button', { name: `Submit invoice ${id} for approval`, exact: true }).click(),
    ]);
    expect(response.status(), `submit invoice ${id}`).toBe(200);
    return response.json();
  }

  /** Reloads the app; returns the invoices the server sent to draw the page. */
  async reload(): Promise<InvoiceJson[]> {
    const [response] = await Promise.all([
      this.page.waitForResponse(apiCall('GET', '/api/invoices')),
      this.page.reload(),
    ]);
    expect(response.status(), 'list the invoices after the reload').toBe(200);
    return response.json();
  }

  /** The table row of the invoice whose Customer cell is exactly this name. */
  row(customer: string): Locator {
    return this.table
      .getByRole('row')
      .filter({ has: this.page.getByRole('cell', { name: customer, exact: true }) });
  }

  status(customer: string): Locator {
    return this.cell(customer, Column.Status);
  }

  amount(customer: string): Locator {
    return this.cell(customer, Column.Amount);
  }

  private cell(customer: string, column: number): Locator {
    return this.row(customer).getByRole('cell').nth(column);
  }
}
