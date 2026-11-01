import { expect, type Locator, type Page } from '@playwright/test';
import { apiCall } from './api';

// The demo password documented in AGENTS.md and README.md; not a real credential.
const DEMO_PASSWORD = 'ChangeMe123!';

/** The Sign in form and the Sign out button. */
export class LoginPage {
  readonly signInButton: Locator;
  readonly signOutButton: Locator;

  constructor(private readonly page: Page) {
    this.signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
    this.signOutButton = page.getByRole('button', { name: 'Sign out', exact: true });
  }

  /** Opens the app and signs in as a demo account; returns once the app shows the signed-in view. */
  async signInAs(username: string): Promise<void> {
    await this.page.goto('/');
    await this.page.getByLabel('Username', { exact: true }).fill(username);
    await this.page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await this.signInButton.click();
    await expect(this.signOutButton).toBeVisible();
  }

  /** Signs out; returns once the server ended the session and the Sign in form is back. */
  async signOut(): Promise<void> {
    const [response] = await Promise.all([
      this.page.waitForResponse(apiCall('POST', '/api/auth/logout')),
      this.signOutButton.click(),
    ]);
    expect(response.status(), 'sign out').toBe(204);
    await expect(this.signInButton).toBeVisible();
  }
}
