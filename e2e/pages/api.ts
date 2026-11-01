import type { Response } from '@playwright/test';

/** An invoice as the API returns it (camelCase JSON). Only the fields the tests read are typed. */
export interface InvoiceJson {
  id: string;
  customerName: string;
  amount: number;
  status: string;
  [field: string]: unknown;
}

/** Predicate for page.waitForResponse: the response to one API call, matched by method and exact path. */
export function apiCall(method: 'GET' | 'POST', path: string): (response: Response) => boolean {
  return (response) => response.request().method() === method && new URL(response.url()).pathname === path;
}
