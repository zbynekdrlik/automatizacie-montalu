// #608 (Odoo úloha 1380, Patrik: „nech ma to upozorní že už je jeden vytvorený ale nech mi to dovolí
// odpísať") — DOROBENIE: druhý odpis tej istej zákazky/OP (zlé zameranie, posuv sa vyrába znova).
// Reálny používateľ v prehliadači: zasklenia odošli (TEST) → odošli znova → upozornenie „už bola
// odpísaná" + „🔁 Odoslať ako dorobenie" → zrušené potvrdenie NIČ neodošle → potvrdené odošle
// dorobenie č. 2 → /odpisy ukáže OBA záznamy (prvý ostáva, druhý s označením dorobenia).
// Zápisový test → `skipAkLive` (nič testovacie nesmie do ostrého Money). Nula console chýb/varovaní.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, vyberFarbuKovania } from './helpers';

const ZAK = `DOR-${Date.now().toString(36).toUpperCase()}`;

test('#608 zasklenia: druhý odpis upozorní a po vedomom potvrdení dovolí dorobenie; /odpisy ukáže oba', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const posli = async () => {
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(ZAK);
		await page.getByLabel('OP/OPDL číslo *').fill('OP261380');
		await page.getByLabel('Zákazník *').fill('E2E Javorský');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await vyberFarbuKovania(page);
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await page.getByTestId('odoslat').click();
	};

	// 1. prvý odpis prejde normálne
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).not.toContainText('dorobenie');

	// 2. tá istá zákazka znova → upozornenie (kedy, kto) + vedomé tlačidlo dorobenia, nič sa nezapísalo
	await posli();
	const blok = page.getByTestId('blok');
	await expect(blok).toContainText('už bola odpísaná');
	await expect(blok).toContainText(ZAK);
	await expect(blok).toContainText('Odoslať ako dorobenie');
	const tlacidlo = page.getByTestId('odoslat-ako-dorobenie');
	await expect(tlacidlo).toBeVisible();

	// 3. zrušené potvrdenie → nič sa neodošle, ostáva upozornenie
	page.once('dialog', (d) => d.dismiss());
	await tlacidlo.click();
	await expect(blok).toBeVisible();
	await expect(page.getByTestId('vysledok')).toHaveCount(0);

	// 4. vedomé potvrdenie → dorobenie č. 2 odoslané (vlastný súbor s označením dorobenia)
	let potvrdenie = '';
	page.once('dialog', (d) => {
		potvrdenie = d.message();
		void d.accept();
	});
	await tlacidlo.click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText('dorobenie-2');
	expect(potvrdenie).toContain('DOROBENIE');

	// 5. história: oba odpisy, prvý nezmenený, druhý označený ako dorobenie 2
	await goto(page, '/odpisy');
	const riadky = page.getByTestId('odpisy-tabulka').locator('tbody tr', { hasText: ZAK });
	await expect(riadky).toHaveCount(2);
	await expect(riadky.filter({ hasText: 'dorobenie 2' })).toHaveCount(1);
	await expect(riadky.filter({ hasNotText: /dorobenie \d/ })).toHaveCount(1);

	expect(consoleMsgs).toEqual([]);
});
