// #251 SEC-3: bezpečnostné hlavičby sú prítomné na skutočnej HTTP odpovedi
// /login (neprihlásený) aj /zasklenia (prihlásený). Zero-console ako každý E2E.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs } from './helpers';

function assertSecurityHeaders(headers: Record<string, string>) {
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy'] || '').toContain('camera=()');
	// ZÁMERNE bez CSP v tomto tickete
	expect(headers['content-security-policy']).toBeUndefined();
}

test('bezpečnostné hlavičky na /login (neprihlásený), zero-console', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	const res = await page.goto('/login');
	expect(res).not.toBeNull();
	assertSecurityHeaders(res!.headers());
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
	expect(consoleMsgs).toEqual([]);
});

test('bezpečnostné hlavičky na /zasklenia (prihlásený), zero-console', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const res = await page.goto('/zasklenia');
	expect(res).not.toBeNull();
	assertSecurityHeaders(res!.headers());
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
	expect(consoleMsgs).toEqual([]);
});
