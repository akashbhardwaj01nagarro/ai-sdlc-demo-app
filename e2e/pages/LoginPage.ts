import { expect, type Locator, type Page } from '@playwright/test';

// The demo password documented in AGENTS.md and README.md; not a real credential.
const DEMO_PASSWORD = 'ChangeMe123!';

/** The Sign in form. */
export class LoginPage {
  readonly signOutButton: Locator;

  constructor(private readonly page: Page) {
    this.signOutButton = page.getByRole('button', { name: 'Sign out', exact: true });
  }

  /** Opens the app and signs in as a demo account; returns once the app shows the signed-in view. */
  async signInAs(username: string): Promise<void> {
    await this.page.goto('/');
    await this.page.getByLabel('Username', { exact: true }).fill(username);
    await this.page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(this.signOutButton).toBeVisible();
  }
}
