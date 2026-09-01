// Šikmý FIX — výkres konštrukcie (Dominik: šikmé fixy do bokov pergoly).
// Zadanie: appka kreslí rovnakú konštrukciu ako výrobné výkresy, dielňa reže podľa nej.
//
// Všetko ČÍTACIE — kresliaci režim „Fix z appky" (/fix) do Money nezapisuje, takže
// tieto testy sa dajú pustiť aj proti nasadenej appke (BASE_URL). (Money lane „Fix z
// cadu" /fix/cad je testovaná zvlášť v e2e/fix-cad.spec.ts — #380.)
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

/** x-ová poloha kót oboch krajných výšok v kresbe — odhalí, či je kus zrkadlený */
async function xKot(page: Page): Promise<{ v1: number; v2: number }> {
	const b1 = await page.getByTestId('fix-v1').boundingBox();
	const b2 = await page.getByTestId('fix-v2').boundingBox();
	if (!b1 || !b2) throw new Error('kóty výšok nie sú v kresbe');
	return { v1: b1.x, v2: b2.x };
}

async function hlavicka(page: Page, zak: string, op: string) {
	await page.goto('/fix');
	await waitHydrated(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E FIX');
}

test('výkres podľa OP260264: 3 polia, kóty a sklon sedia s výrobným výkresom', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX', 'OP260264');
	await page.locator('#s').fill('2795');
	await page.locator('#v1').fill('524');
	await page.locator('#v2').fill('64.6');
	await page.selectOption('#pocet', '3');
	// rovnomerné rozdelenie sa predvyplní samo a súčet sedí
	await expect(page.getByTestId('sucet-poli')).toContainText('2795');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	const v = page.getByTestId('fix-vykres');
	await expect(v).toBeVisible();
	await expect(page.getByTestId('fix-sirka')).toHaveText('2795 mm');
	await expect(page.getByTestId('fix-v1')).toHaveText('524 mm');
	await expect(page.getByTestId('fix-v2')).toHaveText('64,6 mm');
	// sklon 9,3° je kóta z výkresu OP260264
	await expect(page.getByTestId('uhol-sklonu')).toHaveText('9,3°');
	await expect(page.getByTestId('fix-sikma')).toContainText('2832,5');
	await expect(page.getByTestId('fix-uhol')).toHaveText('80,7°');

	// tabuľka polí: 3 riadky, číslované od vyššej strany, výšky na seba nadväzujú
	const riadky = page.getByTestId('fix-tabulka').locator('tbody tr');
	await expect(riadky).toHaveCount(3);
	await expect(riadky.nth(0)).toContainText('L1');
	await expect(riadky.nth(2)).toContainText('L3');
	await expect(riadky.nth(0)).toContainText('524 mm');
	await expect(riadky.nth(2)).toContainText('64,6 mm');

	// nezrkadlený kus: ľavá výška je nakreslená VĽAVO od pravej
	const x = await xKot(page);
	expect(x.v1).toBeLessThan(x.v2);

	expect(errs).toEqual([]);
});

test('modul nikam nezapisuje — žiadny Money odpis ani odoslanie', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-M', 'OP1');
	await page.locator('#s').fill('1557');
	await page.locator('#v1').fill('855');
	await page.locator('#v2').fill('197.8');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('fix-vykres')).toBeVisible();
	// žiadna karta odpisu, žiadne tlačidlo do Money
	await expect(page.locator('.card', { hasText: 'Odpis (do Money)' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Odoslať/ })).toHaveCount(0);
	// a ani formulár na zápis (jediné POST akcie sú vykres/upravit/rozdelit)
	const akcie = await page
		.locator('form[action*="?/"]')
		.evaluateAll((fs) => fs.map((f) => f.getAttribute('action') ?? ''));
	expect(akcie.every((a) => /\?\/(vykres|upravit|rozdelit)$/.test(a))).toBe(true);

	expect(errs).toEqual([]);
});

test('zrkadlový kus: polia sa značia P a konštrukcia je otočená', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-Z', 'OP2');
	await page.locator('#s').fill('1561');
	await page.locator('#v1').fill('233.9');
	await page.locator('#v2').fill('858');
	await page.locator('input[name="zrkadlo"]').check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('fix-tabulka').locator('tbody tr').first()).toContainText('P1');
	// stúpa doprava → sklon 21,8°, ostrý uhol pri vyššej (pravej) strane
	await expect(page.getByTestId('uhol-sklonu')).toHaveText('21,8°');
	await expect(page.getByTestId('fix-uhol')).toHaveText('68,2°');

	// zrkadlenie musí byť vidno v KRESBE, nie len v označení polí: ľavá výška
	// konštrukcie je pri zrkadlovom kuse nakreslená VPRAVO
	const x = await xKot(page);
	expect(x.v1).toBeGreaterThan(x.v2);
	// a vysoká strana (858 mm) je vpravo → jej kóta je tá s väčším x
	await expect(page.getByTestId('fix-v2')).toHaveText('858 mm');

	expect(errs).toEqual([]);
});

test('„← Späť a upraviť" zachová celé zadanie vrátane šírok polí', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-B', 'OP3');
	await page.locator('#s').fill('3000');
	await page.locator('#v1').fill('1270');
	await page.locator('#v2').fill('130');
	await page.selectOption('#pocet', '2');
	await page.locator('#pole0').fill('1800');
	await page.locator('#pole1').fill('1200');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#s')).toHaveValue('3000');
	await expect(page.locator('#v1')).toHaveValue('1270');
	await expect(page.locator('#v2')).toHaveValue('130');
	await expect(page.locator('#pole0')).toHaveValue('1800');
	await expect(page.locator('#pole1')).toHaveValue('1200');

	expect(errs).toEqual([]);
});

test('popisky vo výkrese sa neprekrývajú ani pri 8 poliach', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-P', 'OP5');
	// najhustejší prípad: 8 polí, plochý sklon → popisky dĺžok sú tesne pri sebe
	await page.locator('#s').fill('6000');
	await page.locator('#v1').fill('1500');
	await page.locator('#v2').fill('300');
	await page.selectOption('#pocet', '8');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// obdĺžniky popiskov dĺžok šikmej hrany + oboch uhlov sa nesmú pretínať
	const boxy: { x: number; y: number; w: number; h: number; t: string }[] = [];
	for (const loc of [
		page.getByTestId('fix-sikma-pole'),
		page.getByTestId('fix-uhol'),
		page.getByTestId('fix-uhol-tupy')
	]) {
		const n = await loc.count();
		for (let i = 0; i < n; i++) {
			const b = await loc.nth(i).boundingBox();
			const t = (await loc.nth(i).textContent()) ?? '';
			if (b) boxy.push({ x: b.x, y: b.y, w: b.width, h: b.height, t });
		}
	}
	expect(boxy.length).toBe(10); // 8 polí + ostrý + tupý uhol
	for (let i = 0; i < boxy.length; i++)
		for (let j = i + 1; j < boxy.length; j++) {
			const a = boxy[i];
			const b = boxy[j];
			const prekryv = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
			expect(prekryv, `prekryv „${a.t}" × „${b.t}"`).toBe(false);
		}

	expect(errs).toEqual([]);
});

test('server odmietne nezmyselné zadanie aj po obídení HTML5 validácie', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-V', 'OP4');
	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('800');
	await page.locator('#v2').fill('800'); // rovnaké výšky = to nie je šikmý fix
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await expect(page.getByTestId('form-error')).toContainText('rovnaké');
	await expect(page.getByTestId('fix-vykres')).toHaveCount(0);

	// súčet polí, ktorý nesedí so šírkou: klient tlačidlo zablokuje…
	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('800');
	await page.locator('#v2').fill('200');
	await page.selectOption('#pocet', '2');
	await page.locator('#pole0').fill('1500');
	await expect(page.getByTestId('nakreslit')).toBeDisabled();
	// …a keď sa blokovanie obíde skriptom, odmietne to server
	await page.getByTestId('nakreslit').evaluate((b) => {
		(b as HTMLButtonElement).disabled = false;
		(b as HTMLButtonElement).click();
	});
	await waitHydrated(page);
	await expect(page.getByTestId('form-error')).toContainText('nerovná');

	expect(errs).toEqual([]);
});
