// #592 (Odoo úloha 1220, Marek 29.9.; ROZHODNUTÉ owner 30.9. „1"): „Pevné zasklenie" je v
// hornej lište JEDEN obyčajný odkaz na /fix (žiadny dropdown) a výber režimu sú TRI veľké karty
// pod nadpisom stránky — Fix z appky (/fix), Fix z cadu (/fix/cad), Zábradlia (CLIP) (/clip) —
// rovnaké na všetkých troch stránkach, aktuálna zvýraznená. URL ostávajú (žiadne presmerovanie).
// Len čítacie navigácie — bezpečné aj proti BASE_URL.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, openPevneZasklenie } from './helpers';

const KARTY = [
	{ testid: 'pevne-karta-fix', href: '/fix', nadpis: 'Fix z appky' },
	{ testid: 'pevne-karta-fix-cad', href: '/fix/cad', nadpis: 'Fix z cadu' },
	{ testid: 'pevne-karta-clip', href: '/clip', nadpis: 'Zábradlia (CLIP)' }
] as const;

/** Na stránke sú tri karty v poradí; `aktivna` je zvýraznená non-link, ostatné odkazy „Otvoriť →". */
async function overKarty(page: Page, aktivna: (typeof KARTY)[number]['href']) {
	const grid = page.getByTestId('pevne-karty');
	await expect(grid).toBeVisible();
	await expect(grid.locator('.mode-title')).toHaveText(KARTY.map((k) => k.nadpis));
	for (const k of KARTY) {
		const karta = page.getByTestId(k.testid);
		if (k.href === aktivna) {
			await expect(karta).toHaveClass(/\bactive\b/);
			await expect(karta).toHaveAttribute('aria-current', 'page');
			await expect(karta).not.toHaveAttribute('href');
			await expect(karta).toContainText('tu si');
		} else {
			await expect(karta).not.toHaveClass(/\bactive\b/);
			await expect(karta).toHaveAttribute('href', k.href);
			await expect(karta).toContainText('Otvoriť →');
		}
	}
}

test('#592: „Pevné zasklenie" v lište = jeden odkaz; tri karty na /fix, /clip, /fix/cad', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const nav = page.locator('nav.top .nav-modules-flat');
	const odkaz = nav.getByRole('link', { name: 'Pevné zasklenie', exact: true });

	// žiadny dropdown ani staré samostatné položky — jeden obyčajný odkaz na /fix
	await expect(page.getByTestId('pevne-menu-toggle')).toHaveCount(0);
	await expect(page.locator('nav.top details.nav-pevne')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Fixy', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Clip', exact: true })).toHaveCount(0);
	await expect(odkaz).toHaveAttribute('href', '/fix');
	await expect(odkaz).not.toHaveClass(/\bactive\b/);

	// 1. klik v lište → /fix s tromi kartami, aktívna „Fix z appky"
	await openPevneZasklenie(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Fix z appky' })
	).toBeVisible();
	await overKarty(page, '/fix');
	await expect(page.getByTestId('pevne-karta-fix')).toContainText('z rozmerov tu si');
	await expect(odkaz).toHaveClass(/\bactive\b/);

	// desktop: tri karty VEDĽA seba (rovnaký riadok)
	const ys = await page
		.getByTestId('pevne-karty')
		.locator('.mode-card')
		.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
	expect(new Set(ys).size).toBe(1);

	// 2. karta „Zábradlia (CLIP)" → /clip s tými istými kartami, aktívna CLIP
	await page.getByTestId('pevne-karta-clip').click();
	await expect(page).toHaveURL(/\/clip$/);
	await waitHydrated(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Zábradlia (CLIP)' })
	).toBeVisible();
	await overKarty(page, '/clip');
	await expect(odkaz).toHaveClass(/\bactive\b/);

	// 3. karta „Fix z cadu" → /fix/cad, aktívna CAD
	await page.getByTestId('pevne-karta-fix-cad').click();
	await expect(page).toHaveURL(/\/fix\/cad$/);
	await waitHydrated(page);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pevné zasklenie — Fix z CADu' })
	).toBeVisible();
	await overKarty(page, '/fix/cad');
	await expect(odkaz).toHaveClass(/\bactive\b/);

	// staré URL fungujú aj priamo (záložky) — žiadne presmerovanie
	await goto(page, '/clip');
	await expect(page).toHaveURL(/\/clip$/);
	await overKarty(page, '/clip');

	expect(consoleMsgs).toEqual([]);
});

test('#592: pod 900px — jedna položka v „Moduly" a karty pod sebou', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.setViewportSize({ width: 480, height: 900 });
	await page.getByTestId('modules-menu-toggle').click();
	const menu = page.locator('details.nav-modules-drop .nav-dropdown-menu');
	// jedna položka „Pevné zasklenie" (bez podsekcie), žiadne voľby režimov v menu
	await expect(menu.getByRole('link', { name: 'Pevné zasklenie', exact: true })).toHaveAttribute(
		'href',
		'/fix'
	);
	await expect(menu.locator('a[href="/fix/cad"], a[href="/clip"]')).toHaveCount(0);
	await menu.getByRole('link', { name: 'Pevné zasklenie', exact: true }).click();
	await expect(page).toHaveURL(/\/fix$/);
	await waitHydrated(page);
	await expect(page.locator('details.nav-modules-drop')).toHaveClass(/\bactive\b/);
	await overKarty(page, '/fix');

	// karty pod sebou (rovnaké x, rastúce y) a bez horizontálneho scrollu
	const boxy = await page
		.getByTestId('pevne-karty')
		.locator('.mode-card')
		.evaluateAll((els) =>
			els.map((e) => {
				const r = e.getBoundingClientRect();
				return { x: Math.round(r.left), y: Math.round(r.top) };
			})
		);
	expect(new Set(boxy.map((b) => b.x)).size).toBe(1);
	expect(boxy[0]!.y).toBeLessThan(boxy[1]!.y);
	expect(boxy[1]!.y).toBeLessThan(boxy[2]!.y);
	const maScroll = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
	expect(maScroll).toBe(false);
	expect(consoleMsgs).toEqual([]);
});

test('#592: pri šírke 800px (nad mobilom, pod 900px) sú tri karty pod sebou', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.setViewportSize({ width: 800, height: 900 });
	await goto(page, '/fix/cad');
	await overKarty(page, '/fix/cad');
	const xs = await page
		.getByTestId('pevne-karty')
		.locator('.mode-card')
		.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
	expect(new Set(xs).size).toBe(1);
	expect(consoleMsgs).toEqual([]);
});
