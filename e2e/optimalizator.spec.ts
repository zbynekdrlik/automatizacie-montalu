// Nárezový optimalizátor (#212) — samostatná kalkulačka. Všetko ČÍTACIE: modul do
// Money NIČ nezapisuje, takže sa dá pustiť aj proti nasadenej appke (BASE_URL) —
// žiadny skipAkLive. Každý test vyžaduje NULA console errors/warnings.
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole } from './helpers';

async function vyplnKusy(page: Page, kusy: [number, number][]) {
	// štart je s jedným riadkom → dopridaj zvyšné
	for (let i = 1; i < kusy.length; i++) {
		await page.getByRole('button', { name: 'Pridať kus' }).click();
	}
	for (let i = 0; i < kusy.length; i++) {
		await page.getByTestId('kus-dlzka').nth(i).fill(String(kusy[i][0]));
		await page.getByTestId('kus-pocet').nth(i).fill(String(kusy[i][1]));
	}
}

test('optimalizátor: tyč 6000 + kusy zo screenshotu → 4 tyče, grafický rozpis, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/optimalizator');

	await page.getByLabel('Dĺžka tyče (mm)').fill('6000');
	await page.getByLabel('Počet tyčí').fill('10');
	await page.getByLabel('Rezná medzera (mm)').fill('10');
	await vyplnKusy(page, [
		[2280, 1],
		[1390, 1],
		[988, 1],
		[1280, 1],
		[3780, 1],
		[2831, 1],
		[2834, 2]
	]);
	await page.getByTestId('spocitaj').click();

	const vysledok = page.getByTestId('vysledok');
	await expect(vysledok).toBeVisible();
	await expect(page.getByTestId('tyce-pouzite')).toHaveText('4');
	await expect(page.getByTestId('spolu-narezane')).toHaveText('18217 mm');
	// grafický rozpis (RozpisRezov) vykreslil 4 tyče (SVG pruhy)
	await expect(vysledok.locator('svg.bar-svg')).toHaveCount(4);
	// hlavička rozpisu ukazuje POUŽITÚ reznú medzeru 10 mm (nie default 4)
	await expect(vysledok).toContainText('kotúč 10 mm');
	// zmestí sa do 10 tyčí → žiadne varovanie
	await expect(page.getByTestId('varovanie')).toHaveCount(0);

	// #417: jednomateriálový optimalizátor NEUKAZUJE „Odpad spolu" súčet (gate ≥2 profily) —
	// má vlastný „Celkový odpad" riadok; negatívna strana gate-u proti regresii > → >=
	await expect(page.getByTestId('odpad-spolu')).toHaveCount(0);

	// verzia v pätičke (version-on-dashboard)
	await expect(page.getByTestId('version')).toHaveText(
		/^v\d+\.\d+\.\d+(-dev\.\d+)?(\s\([0-9a-f]{7}\))?$/
	);
	expect(consoleMsgs).toEqual([]);
});

test('optimalizátor: kusy sa nezmestia do zadaného počtu tyčí → varovanie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/optimalizator');

	await page.getByLabel('Dĺžka tyče (mm)').fill('6000');
	await page.getByLabel('Počet tyčí').fill('1');
	await page.getByLabel('Rezná medzera (mm)').fill('10');
	await vyplnKusy(page, [
		[3780, 1],
		[2834, 2]
	]);
	await page.getByTestId('spocitaj').click();

	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('varovanie')).toContainText(/nezmest/i);
	expect(consoleMsgs).toEqual([]);
});
// #464: „x" Odobrať riadok tlačidlo
test('optimalizátor: „x" Odobrať riadok odoberie kus zo zoznamu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/optimalizator');

	await page.getByLabel('Dĺžka tyče (mm)').fill('6000');
	await page.getByLabel('Počet tyčí').fill('10');
	// pridaj 2 riadky (spolu s default = 3)
	await page.getByRole('button', { name: 'Pridať kus' }).click();
	await page.getByRole('button', { name: 'Pridať kus' }).click();
	await expect(page.getByTestId('kus-dlzka')).toHaveCount(3);

	// odobrať posledný riadok
	const removeButtons = page.getByRole('button', { name: /odobrať/i });
	await removeButtons.last().click();
	await expect(page.getByTestId('kus-dlzka')).toHaveCount(2);

	// odobrať ešte jeden
	await page
		.getByRole('button', { name: /odobrať/i })
		.last()
		.click();
	await expect(page.getByTestId('kus-dlzka')).toHaveCount(1);

	expect(consoleMsgs).toEqual([]);
});
// (b2b neprístupnosť /optimalizator overuje unit drift-guard tests/b2b-route-coverage.test.ts —
//  autoritatívne cez b2bRedirectTarget; e2e sa sústredí na funkčné vykreslenie stránky)
