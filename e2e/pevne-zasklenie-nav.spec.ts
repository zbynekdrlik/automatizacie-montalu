// #592 (Odoo úloha 1220, Marek 29.9.): „Fixy" a „Clip" zjednotené v hornej lište pod JEDNU
// položku „Pevné zasklenie" (natívny <details> dropdown, vzor „Nástroje", bez bind:open — #583)
// s tromi voľbami: Fix z appky → /fix, Fix z CADu → /fix/cad, Zábradlia (CLIP) → /clip.
// URL ostávajú (žiadne presmerovanie). Len čítacie navigácie — bezpečné aj proti BASE_URL.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	openPevneZasklenie,
	openTools
} from './helpers';

test('#592: „Pevné zasklenie" v lište — 3 voľby, navigácia na všetky tri stránky, aktívny stav', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	// voľby hľadáme LEN v lište — karty prepínača FixModeNav na /fix(/cad) nesú podobný text
	const nav = page.locator('nav.top');

	// staré samostatné položky zmizli, nová skupina je v primárnej lište
	await expect(page.getByRole('link', { name: 'Fixy', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Clip', exact: true })).toHaveCount(0);
	const toggle = page.getByTestId('pevne-menu-toggle');
	await expect(toggle).toBeVisible();
	await expect(toggle).toContainText('Pevné zasklenie');
	const skupina = page.locator('details.nav-pevne');
	// na /zasklenia skupina nie je aktívna a je zatvorená (voľby skryté)
	await expect(skupina).not.toHaveClass(/\bactive\b/);
	await expect(nav.getByRole('link', { name: 'Fix z appky', exact: true })).toHaveCount(0);

	// 1. Fix z appky → /fix
	await openPevneZasklenie(page);
	await expect(nav.getByRole('link', { name: 'Fix z appky', exact: true })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Fix z CADu', exact: true })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Zábradlia (CLIP)', exact: true })).toBeVisible();
	await nav.getByRole('link', { name: 'Fix z appky', exact: true }).click();
	await expect(page).toHaveURL(/\/fix$/);
	await waitHydrated(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Fix z appky' })
	).toBeVisible();
	await expect(skupina).toHaveClass(/\bactive\b/);
	// po SPA navigácii sa dropdown zavrie (root layout sa neremountuje)
	await expect(skupina).not.toHaveAttribute('open', '');

	// 2. Fix z CADu → /fix/cad
	await openPevneZasklenie(page);
	await nav.getByRole('link', { name: 'Fix z CADu', exact: true }).click();
	await expect(page).toHaveURL(/\/fix\/cad$/);
	await waitHydrated(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Fix z CADu' })
	).toBeVisible();
	await expect(skupina).toHaveClass(/\bactive\b/);
	// aktívna voľba v otvorenom menu je práve „Fix z CADu", nie „Fix z appky"
	await openPevneZasklenie(page);
	await expect(nav.getByRole('link', { name: 'Fix z CADu', exact: true })).toHaveClass(
		/\bactive\b/
	);
	await expect(nav.getByRole('link', { name: 'Fix z appky', exact: true })).not.toHaveClass(
		/\bactive\b/
	);

	// 3. Zábradlia (CLIP) → /clip
	await nav.getByRole('link', { name: 'Zábradlia (CLIP)', exact: true }).click();
	await expect(page).toHaveURL(/\/clip$/);
	await waitHydrated(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Zábradlia (CLIP)' })
	).toBeVisible();
	await expect(skupina).toHaveClass(/\bactive\b/);

	// otvorenie „Pevné zasklenie" zavrie iný otvorený dropdown (Nástroje) — nikdy dve menu
	// cez seba (review nález #592)
	await openTools(page);
	await expect(page.locator('details.nav-tools')).toHaveAttribute('open', '');
	await page.getByTestId('pevne-menu-toggle').click();
	await expect(skupina).toHaveAttribute('open', '');
	await expect(page.locator('details.nav-tools')).not.toHaveAttribute('open', '');

	// staré URL fungujú aj priamo (záložky) — žiadne presmerovanie
	await goto(page, '/fix/cad');
	await expect(page).toHaveURL(/\/fix\/cad$/);
	await expect(skupina).toHaveClass(/\bactive\b/);

	expect(consoleMsgs).toEqual([]);
});

test('#592: pod 900px je „Pevné zasklenie" podsekcia v dropdowne „Moduly"', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	// voľby hľadáme LEN v lište — karty prepínača FixModeNav na /fix(/cad) nesú podobný text
	const nav = page.locator('nav.top');
	await page.setViewportSize({ width: 480, height: 900 });
	// plochý zoznam (vrátane vnoreného dropdownu) je skrytý, Moduly dropdown ho nahradí
	await expect(page.getByTestId('pevne-menu-toggle')).toBeHidden();
	await page.getByTestId('modules-menu-toggle').click();
	await expect(page.getByTestId('modules-pevne-nadpis')).toHaveText('Pevné zasklenie');
	// podsekcia nesie všetky tri voľby v poradí zo zadania
	await expect(nav.locator('.nav-subgroup a')).toHaveText([
		'Fix z appky',
		'Fix z CADu',
		'Zábradlia (CLIP)'
	]);
	expect(
		await nav.locator('.nav-subgroup a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
	).toEqual(['/fix', '/fix/cad', '/clip']);
	// otvorené menu s podsekciou nesmie spôsobiť horizontálny scroll (responzívna požiadavka #392)
	const maScroll = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
	expect(maScroll).toBe(false);
	await nav.getByRole('link', { name: 'Zábradlia (CLIP)', exact: true }).click();
	await expect(page).toHaveURL(/\/clip$/);
	await waitHydrated(page);
	await expect(page.locator('details.nav-modules-drop')).toHaveClass(/\bactive\b/);
	expect(consoleMsgs).toEqual([]);
});
