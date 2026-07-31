// E2E parity moduly: Bazén (kontrola množstiev), Pergola (CAD → Money + tyče
// + kombinácie), Nahlásiť problém. Nula console errors všade.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

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

test('pergola: CAD nárez → Money rozpis + tyče → odoslanie (1:1 vzorová zákazka A vektor)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PER`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola');
	await page
		.getByLabel('Materiál (CAD nárez) *')
		.fill(
			[
				'18004 PRIECKOVY PROFIL 105\t9\t3871',
				'18006 PRITLACNA LISTA\t9\t3894',
				'18016 PROFIL 110x43 V2\t2\t3812',
				'18016 PROFIL 110x43 V2\t2\t2510'
			].join('\n')
		);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// Money rozpis 1:1 (v náhľade sú množstvá v poliach na ručnú úpravu):
	// priečkový 9×7500 = 67,5 m; 110x43 FFD → 15 m
	await expect(page.getByLabel('Množstvo PRP00044')).toHaveValue('67.5');
	await expect(page.getByLabel('Množstvo PRP202410')).toHaveValue('15');
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
	await expect(page.getByLabel('Množstvo PRP202526')).toHaveValue('4.5');
	await expect(page.getByLabel('Množstvo PRP202525')).toHaveValue('6');

	// zvoľ 7500+4500 → po odoslaní je v rozpise 7500-ka a tyče 1(4,5m) 1(7,5m)
	await page.getByRole('radio', { name: /7500\+4500/ }).check();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.locator('.row', { hasText: 'PRP202524' })).toContainText('7,5 m');
	await expect(page.locator('.row', { hasText: '18021' })).toContainText('1(4,5m) 1(7,5m)');
	expect(consoleMsgs).toEqual([]);
});

test('pergola: kusy viac-variantového profilu zdieľajú tyč, bez falošného varovania', async ({
	page
}) => {
	// spocitat NEzapisuje → bezpečné aj na LIVE
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PACK`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Balenie');
	await page
		.getByLabel('Materiál (CAD nárez) *')
		.fill(
			['18019 KOTVIACI PROFIL HORNY V2\t1\t6400', '18019 KOTVIACI PROFIL HORNY V2\t1\t1030'].join(
				'\n'
			)
		);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// 6400 + 1030 = 7430 → JEDNA 7,5 m tyč (predtým 7,5 + 4,5 = nadodpis)
	await expect(page.locator('.row', { hasText: '18019' })).toContainText('1(7,5m)');
	await expect(page.getByLabel('Množstvo PRP20258')).toHaveValue('7.5');
	// 4,5 m tyč sa vôbec nepoužila (v nulových je prázdne pole)
	await expect(page.getByLabel('Množstvo PRP202510')).toHaveValue('');
	// žiadny rez > 7500 → žiadne varovanie o dlhých profiloch
	await expect(page.getByText('Dlhé profily')).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

test('pergola: ručná úprava množstva pred odoslaním (aj odmietnutie zápornej)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-EDIT`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Úprava');
	await page.getByLabel('Materiál (CAD nárez) *').fill('18004 PRIECKOVY PROFIL 105\t9\t3871');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	await expect(page.getByLabel('Množstvo PRP00044')).toHaveValue('67.5');

	// záporná hodnota → chyba, do Money nič nejde
	await page.getByLabel('Množstvo PRP00044').fill('-5');
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('nahlad-error')).toContainText('Záporné');

	// platná úprava → odošle sa upravená hodnota a je označená ✏️
	await page.getByLabel('Množstvo PRP00044').fill('60');
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.locator('.row', { hasText: 'PRP00044' })).toContainText('60 m');
	await expect(page.locator('.row', { hasText: 'PRP00044' })).toContainText('✏️');

	// vynulovanie úpravou sa vypíše, aby dielňa vedela, že položka v odpise nie je
	await goto(page, '/pergola');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-NULA`);
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('E2E Nula');
	await page.getByLabel('Materiál (CAD nárez) *').fill('18004 PRIECKOVY PROFIL 105\t9\t3871');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByLabel('Množstvo PRP00044').fill('0');
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByText('Vynulované úpravou')).toContainText('PRP00044');
	expect(consoleMsgs).toEqual([]);
});

test('bazén: „Späť a upraviť zadanie" zachová zadanie (nevynuluje)', async ({ page }) => {
	// spocitat/upravit NEzapisujú → bezpečné aj na LIVE (žiadny skipAkLive)
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/bazen');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BSP`);
	await page.getByLabel('OP/OPDL číslo *').fill('05');
	await page.getByLabel('Zákazník *').fill('E2E Bazén Späť');
	await page.getByLabel('Počet sekcií *').fill('3');
	await page.getByLabel('Celková dĺžka koľajníc (mm)').fill('10000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// „Späť a upraviť zadanie" → formulár musí byť predvyplnený (nie prázdny)
	await page.getByRole('button', { name: /Späť a upraviť zadanie/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue(`${RUN}-BSP`);
	await expect(page.getByLabel('OP/OPDL číslo *')).toHaveValue('05');
	await expect(page.getByLabel('Zákazník *')).toHaveValue('E2E Bazén Späť');
	await expect(page.getByLabel('Počet sekcií *')).toHaveValue('3');
	expect(consoleMsgs).toEqual([]);
});

test('pergola: „Späť a upraviť zadanie" zachová ZAK + celý CAD nárez', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola');
	const cad = [
		'18004 PRIECKOVY PROFIL 105\t9\t3871',
		'18006 PRITLACNA LISTA\t9\t3894',
		'18016 PROFIL 110x43 V2\t2\t3812'
	].join('\n');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PSP`);
	await page.getByLabel('OP/OPDL číslo *').fill('05');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Späť');
	await page.getByLabel('Materiál (CAD nárez) *').fill(cad);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('odoslat')).toBeVisible();

	// „Späť a upraviť zadanie" → ZAK aj CAD textarea ostanú vyplnené
	await page.getByRole('button', { name: /Späť a upraviť zadanie/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue(`${RUN}-PSP`);
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toHaveValue(cad);
	expect(consoleMsgs).toEqual([]);
});

test('pergola: nerozpoznaný CAD kód → chyba a vstup ostane vyplnený', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola');
	// kód musí byť 3–6 číslic (inak „zlý formát"); 99999 parsuje, ale nie je v CATALOG → nenamapované
	const cad = '99999 NEZNAMY PROFIL\t2\t3000';
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PBAD`);
	await page.getByLabel('OP/OPDL číslo *').fill('05');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Junk');
	await page.getByLabel('Materiál (CAD nárez) *').fill(cad);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// chyba o nenamapovanom kóde + zachovaný vstup (chybová vetva vracia vstup)
	await expect(page.getByTestId('form-error')).toContainText('Nenamapované');
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue(`${RUN}-PBAD`);
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toHaveValue(cad);
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
