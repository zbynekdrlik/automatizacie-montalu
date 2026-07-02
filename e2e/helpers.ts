import { expect, type Page } from '@playwright/test';

/** Zbiera console errors/warnings — každý test na konci overí, že je prázdne. */
export function collectConsole(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') {
			messages.push(`[${msg.type()}] ${msg.text()}`);
		}
	});
	page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
	return messages;
}

export const E2E_USER = process.env.E2E_USER || 'e2e';
export const E2E_PASS = process.env.E2E_PASS || 'e2e-heslo-123';

/**
 * goto + počkanie na hydratáciu. fill() pred dokončenou hydratáciou prehráva
 * s Svelte, ktorá value-bound inputy vráti na serverový stav (cez pomalý SSH
 * tunel sa JS načítava neskoro — v CI to nikdy nevidno).
 */
export async function waitHydrated(page: Page) {
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
}

export async function goto(page: Page, path: string) {
	await page.goto(path);
	await waitHydrated(page);
}

export async function loginAs(page: Page, user = E2E_USER, pass = E2E_PASS) {
	await goto(page, '/login');
	await page.getByLabel('Meno').fill(user);
	await page.getByLabel('Heslo').fill(pass);
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page).toHaveURL(/\/zasklenia/);
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
}
