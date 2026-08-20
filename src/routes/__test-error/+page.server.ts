import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// #245: route LEN pre E2E overenie chybovej stránky. V PRODUKCII (bez
// ENABLE_TEST_ERROR_ROUTE=1) vráti 404 — je fakticky skrytá; VPS ju NIKDY nezapína.
// Playwright preview (playwright.config.ts webServer.env) ju zapne a vyvolá tak
// neočakávanú 500 → handleError → +error.svelte s errorId. b2b sa sem nedostane
// (/__test-error je v B2B_FORBIDDEN_PREFIXES).
export const load: PageServerLoad = () => {
	if (process.env.ENABLE_TEST_ERROR_ROUTE !== '1') error(404, 'Neexistuje.');
	throw new Error('E2E: úmyselná testovacia serverová chyba (#245)');
};
