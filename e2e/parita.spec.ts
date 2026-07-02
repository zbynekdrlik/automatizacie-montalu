// E2E parity moduly: Bazén (kontrola množstiev), Pergola (CAD → Money + tyče
// + kombinácie), Nahlásiť problém. Nula console errors všade.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated } from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

async function skipAkLive(page: import('@playwright/test').Page) {
	const res = await page.request.get('/health');
	const { live } = (await res.json()) as { live: boolean };
	test.skip(live === true, 'LIVE nasadenie (MONEY_LIVE=1) — zápisové E2E preskočené');
}

test('bazén: rozpis → úprava množstva → odoslanie → duplikát; záporná úprava sa odmietne', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/bazen');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BAZ`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Bazén');
	await page.getByLabel('Počet sekcií *').fill('3');
	await page.getByLabel('Počet priečok').fill('3');
	await page.getByLabel('Celková dĺžka koľajníc (mm)').fill('10000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// kontrola: 20 riadkov, auto-koľajnice 4.6/6.7 (1:1 vektor)
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await expect(page.getByLabel('Množstvo BPP00094')).toHaveValue('4.6');
	await expect(page.getByLabel('Množstvo BPP00097')).toHaveValue('6.7');

	// záporná úprava → chyba, nič sa nezapíše
	await page.getByLabel('Množstvo BPP00094').fill('-9.2');
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('kontrola-error')).toContainText('Záporné');

	// platná úprava → odoslanie
	await page.getByLabel('Množstvo BPP00094').fill('9.2');
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText(`${RUN}-BAZ`);
	await expect(page.locator('.row', { hasText: 'BPP00094' })).toContainText('9,2 m');
	await expect(page.locator('.row', { hasText: 'BPP00094' })).toContainText('✏️');

	// duplikát
	await goto(page, '/bazen');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BAZ`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Bazén');
	await page.getByLabel('Počet sekcií *').fill('2');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');
	expect(consoleMsgs).toEqual([]);
});

test('pergola: CAD nárez → Money rozpis + tyče → odoslanie (1:1 Bartoníček vektor)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PER`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola');
	await page.getByLabel('Materiál (CAD nárez) *').fill(
		[
			'18004 PRIECKOVY PROFIL 105\t9\t3871',
			'18006 PRITLACNA LISTA\t9\t3894',
			'18016 PROFIL 110x43 V2\t2\t3812',
			'18016 PROFIL 110x43 V2\t2\t2510'
		].join('\n')
	);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// Money rozpis 1:1: priečkový 9×7500 = 67,5 m; 110x43 FFD → 15 m
	await expect(page.locator('.row', { hasText: 'PRP00044' })).toContainText('67,5 m');
	await expect(page.locator('.row', { hasText: 'PRP202410' })).toContainText('15 m');
	// tyče pre Solid Edge
	await expect(page.locator('.row', { hasText: '18004' })).toContainText('9(7,5m)');
	await expect(page.locator('.row', { hasText: '18016' })).toContainText('2(7,5m)');

	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('kopiruj-tyce')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('pergola: rez > 7500 ponúkne kombinácie a voľba zmení rozpis aj tyče', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-KOM`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Kombinácia');
	await page.getByLabel('Materiál (CAD nárez) *').fill('18021 ZLABOVY PROFIL 110 V2\t1\t9120');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// varovanie + combo výber s defaultom „najmenej odpadu" (4500+6000)
	await expect(page.getByText('Dlhé profily')).toBeVisible();
	const radio = page.getByRole('radio').first();
	await expect(radio).toBeChecked();
	await expect(page.locator('.row', { hasText: 'PRP202526' })).toContainText('4,5 m');
	await expect(page.locator('.row', { hasText: 'PRP202525' })).toContainText('6 m');

	// zvoľ 7500+4500 → po odoslaní je v rozpise 7500-ka a tyče 1(4,5m) 1(7,5m)
	await page.getByRole('radio', { name: /7500\+4500/ }).check();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.locator('.row', { hasText: 'PRP202524' })).toContainText('7,5 m');
	await expect(page.locator('.row', { hasText: '18021' })).toContainText('1(4,5m) 1(7,5m)');
	expect(consoleMsgs).toEqual([]);
});

test('nahlásiť problém: uloží a zobrazí hlásenie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/problem');
	await page.getByLabel('Čoho sa to týka').selectOption('Bazén');
	await page.getByLabel('Čo zle prebehlo? *').fill(`E2E hlásenie ${RUN}`);
	await page.getByRole('button', { name: 'Odoslať hlásenie' }).click();
	await expect(page.getByTestId('problem-ulozeny')).toBeVisible();
	await goto(page, '/problem');
	await expect(page.getByText(`E2E hlásenie ${RUN}`)).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});
