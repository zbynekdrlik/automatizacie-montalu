// #245: neočakávaná serverová chyba (500) vykreslí +error.svelte s bezpečnou
// SK správou a dohľadateľným errorId. Vyvolané cez test-only route /__test-error
// (zapnutá len v CI preview cez ENABLE_TEST_ERROR_ROUTE; na nasadenej appke 404,
// preto sa proti BASE_URL preskočí). Zero-console ako každý E2E.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs } from './helpers';

test('chybová stránka: 500 ukáže +error.svelte s errorId, zero-console', async ({ page }) => {
	test.skip(!!process.env.BASE_URL, 'test-error route je len v CI preview, nie na nasadenej appke');
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	const res = await page.goto('/__test-error');
	expect(res?.status()).toBe(500);

	// server-rendered obsah chybovej stránky
	await expect(page.getByTestId('error-message')).toBeVisible();
	const eid = page.getByTestId('error-id');
	await expect(eid).toBeVisible();
	await expect(eid).toHaveText(/^[0-9a-f]{12}$/);

	// späť na začiatok funguje (layout + nav sa vykreslili aj na chybovej stránke)
	await expect(page.getByRole('link', { name: /Späť na začiatok/ })).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});
