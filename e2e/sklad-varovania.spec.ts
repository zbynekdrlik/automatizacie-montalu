// #459 — E2E test pre SkladVarovania (#451): blokujuce upozornenie pri
// nedostatocnom sklade + tlacidlo "Odobrat z odpisu" (qty -> 0). Testovane
// cez /bazen (BPK komponenty). Compute-only — do Money sa nic neposiela.
// VSETKY ceny/skladove cisla su VYMYSLENE (repo je verejne). Nula console
// errors/warnings vsade.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { collectConsole, loginAs, goto, waitHydrated } from './helpers';

const RUN = `SKLAD-${Date.now().toString(36).toUpperCase()}`;

// BPK00074 = Kladka D62 — vzdy pritomna pri bazenoch, jednokolaj 3 sekcie = 6 ks
const KOD_SKLAD_0 = 'BPK00074';

/** Vyplni minimalny bazenovy formular (jednokolaj, 3 sekcie, Exclusive). */
async function vyplnBazen(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/bazen');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sklad');
	await page.getByLabel('Model').selectOption('Exclusive');
	await page.getByLabel('Koľaj', { exact: true }).selectOption('Jednokolaj');
	await page.getByLabel('Počet sekcií *').fill('3');
	await page.getByLabel('Celková dĺžka koľajníc (mm)').fill('10000');
}

test('sklad=0: upozornenie sa zobrazi s kodom + cislami, odobrat nastavi qty na 0', async ({
	page
}) => {
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: neda sa zapisat fixture do vzdialeného kontajnera'
	);
	const consoleMsgs = collectConsole(page);
	// seed snapshot s BPK00074 sklad=0 (compute vytvori qty=6 → varovanie)
	fs.writeFileSync(
		'./data/e2e-ceny.json',
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				{
					kod: KOD_SKLAD_0,
					nakupCennik: 10,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 0
				}
			]
		})
	);
	await loginAs(page);
	await vyplnBazen(page, `${RUN}-SKLAD0`);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// varovanie sa zobrazuje
	const blok = page.getByTestId('sklad-varovania');
	await expect(blok).toBeVisible();
	await expect(blok.locator('.sklad-blok-ikona')).toContainText('⛔');

	// konkretna polozka s kodom + cislami
	const polozka = page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}`);
	await expect(polozka).toBeVisible();
	await expect(polozka).toContainText(KOD_SKLAD_0);
	await expect(polozka).toContainText('sklad 0');
	await expect(polozka).toContainText('požadované');

	// klik "Odobrat z odpisu" → qty input na 0 + vizualne oznacenie "Odobrana"
	await page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrat`).click();

	// qty input pre BPK00074 je teraz 0
	const qtyInput = page.locator(`input[name="qty_${KOD_SKLAD_0}"]`);
	await expect(qtyInput).toHaveValue('0');

	// "Odobrana" badge sa zobrazi
	await expect(page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrata`)).toBeVisible();
	await expect(page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrata`)).toContainText(
		'✓ Odobraná'
	);

	// tlacidlo "Odobrat" zmizne (nahradene badgom)
	await expect(page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrat`)).toBeHidden();
	expect(consoleMsgs).toEqual([]);
});

test('dostatocny sklad: upozornenie sa NEZOBRAZI', async ({ page }) => {
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: neda sa zapisat fixture do vzdialeného kontajnera'
	);
	const consoleMsgs = collectConsole(page);
	// seed snapshot s BPK00074 sklad=999 (hojne dostatok → ziadne varovanie)
	fs.writeFileSync(
		'./data/e2e-ceny.json',
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				{
					kod: KOD_SKLAD_0,
					nakupCennik: 10,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 999
				}
			]
		})
	);
	await loginAs(page);
	await vyplnBazen(page, `${RUN}-DOSTATOK`);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// sklad-varovania blok NIE JE na stranke (sklad dostatocny)
	await expect(page.getByTestId('sklad-varovania')).toBeHidden();
	expect(consoleMsgs).toEqual([]);
});
