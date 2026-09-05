// Kovanie krídla (kľučka) + predvolené číre sklo + kopírovateľný rozmer skla —
// požiadavky dielne (Patrik 2026-07-27).
//
// Všetko ČÍTACIE: formulár + „Spočítať" (?/nahlad, ?/nahladMulti) iba počítajú,
// NEZAPISUJÚ odpis ani nemenia konfiguráciu → tieto testy sa dajú pustiť aj proti
// nasadenej appke (BASE_URL). Tlačidlo „Odoslať odpis" tu nikdy nepadne.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const KOVANIA = [
	'Jednostranná kľučka z vnútra bez FAB',
	'Obojstranná kľučka bez FAB',
	'Jednostranná kľučka z vnútra s FAB',
	'Obojstranná kľučka s FAB'
];

test('predvolené sklo je vždy číre (Robust aj Slide), po prepnutí systému tiež', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#sklo')).toHaveValue('Izolačné sklo 4/16/4 číre');

	await page.selectOption('#system', 'Slide');
	await expect(page.locator('#sklo')).toHaveValue('Izolačné sklo 4/8/4 číre');

	// nový posuv sa klonuje z primárneho → tiež číre
	await page.selectOption('#system', 'Robust');
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();
	await expect(page.locator('#ps0-sklo')).toHaveValue('Izolačné sklo 4/16/4 číre');
	// a po prepnutí systému posuvu ostane číre pre nový systém
	await page.selectOption('#ps0-sys', 'Slide');
	await expect(page.locator('#ps0-sklo')).toHaveValue('Izolačné sklo 4/8/4 číre');

	expect(errs).toEqual([]);
});

test('kovanie: dva selecty len pri Robuste, presne 4 možnosti + „—"', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	for (const id of ['#kovanieL', '#kovanieP']) {
		await expect(page.locator(id)).toBeVisible();
		await expect(page.locator(id)).toHaveValue(''); // default = nezadané
		const opts = await page.locator(`${id} option`).allTextContents();
		expect(opts).toEqual(['—', ...KOVANIA]);
	}

	// iný systém kovanie nemá (zatiaľ len Robust)
	for (const sys of ['Slide', 'Deluxe', 'Štandard +']) {
		await page.selectOption('#system', sys);
		await expect(page.locator('#kovanieL')).toHaveCount(0);
		await expect(page.locator('#kovanieP')).toHaveCount(0);
	}

	// späť na Robust → voľba je vynulovaná (nesmie sa niesť z predchádzajúceho stavu)
	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#kovanieL')).toHaveValue('');

	expect(errs).toEqual([]);
});

test('kovanie je pri každom posuve sólo (primárny sa nemieša s ďalším)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await page.selectOption('#kovanieL', KOVANIA[3]); // Obojstranná + FAB
	await page.selectOption('#kovanieP', KOVANIA[0]); // Jednostranná z vnútra bez FAB
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();

	// posuv sa klonuje z primárneho, ale mení sa NEZÁVISLE
	await expect(page.locator('#ps0-kovl')).toHaveValue(KOVANIA[3]);
	await page.selectOption('#ps0-kovl', KOVANIA[1]);
	await page.selectOption('#ps0-kovp', KOVANIA[2]);
	await expect(page.locator('#kovanieL')).toHaveValue(KOVANIA[3]); // primárny sa nepohol
	await expect(page.locator('#kovanieP')).toHaveValue(KOVANIA[0]);

	// Slide posuv kovanie nemá
	await page.selectOption('#ps0-sys', 'Slide');
	await expect(page.locator('#ps0-kovl')).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('jeden posuv: kovanie v náhľade + rozmer skla s mm na kopírovanie', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-KOV');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Kovanie');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
	await page.selectOption('#kovanieL', KOVANIA[3]);
	await page.selectOption('#kovanieP', KOVANIA[0]);
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// rozmer skla: jednotka hneď za číslom, medzera × medzera
	const rozmer = (await page.getByTestId('sklo-rozmer').textContent())?.trim() ?? '';
	expect(rozmer).toMatch(/^\d+mm × \d+mm$/);
	const sirka = (await page.getByTestId('sklo-sirka').textContent())?.trim();
	expect(rozmer.startsWith(`${sirka}mm`)).toBe(true);
	await expect(page.getByTestId('nahlad-sklo-rozmer')).toHaveText(rozmer);

	// kovanie vypísané v krajných krídlach náhľadu (ľavé aj pravé zvlášť)
	await expect(page.getByTestId('kovanie-l')).toContainText('Obojstranná');
	await expect(page.getByTestId('kovanie-l')).toContainText('FAB');
	await expect(page.getByTestId('kovanie-p')).toContainText('Jednostranná');

	expect(errs).toEqual([]);
});

test('viac posuvov: každý náhľad má svoje kovanie, tabuľka sklo v mm', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-KOV-M');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Kovanie multi');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
	await page.selectOption('#kovanieL', KOVANIA[3]);
	await page.selectOption('#kovanieP', KOVANIA[0]);

	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();
	await page.locator('#ps0-s').fill('4365');
	await page.locator('#ps0-v').fill('2320');
	await page.selectOption('#ps0-kovl', KOVANIA[1]);
	await page.selectOption('#ps0-kovp', KOVANIA[2]);
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// tabuľka posuvov: rozmer skla s jednotkami hneď za číslom + názov skla
	for (const i of [0, 1]) {
		const txt = (await page.getByTestId(`posuv-sklo-${i}`).textContent())?.trim() ?? '';
		expect(txt).toMatch(/^\d+mm × \d+mm · /);
		expect(txt).toContain('číre');
	}

	// dva náhľady, každý s vlastným kovaním
	const kovL = page.getByTestId('kovanie-l');
	const kovP = page.getByTestId('kovanie-p');
	await expect(kovL).toHaveCount(2);
	await expect(kovP).toHaveCount(2);
	await expect(kovL.nth(0)).toContainText('Obojstranná');
	await expect(kovP.nth(0)).toContainText('Jednostranná');
	await expect(kovL.nth(1)).toContainText('Obojstranná');
	await expect(kovP.nth(1)).toContainText('Jednostranná');
	// druhý posuv má na ľavej strane variantu BEZ FAB, prvý S FAB. Text je v SVG
	// zalomený do viacerých <text> riadkov, takže sa opierame o slovo „bez",
	// nie o frázu, ktorú by zalomenie mohlo rozdeliť.
	await expect(kovL.nth(0)).not.toContainText('bez');
	await expect(kovL.nth(1)).toContainText('bez');

	expect(errs).toEqual([]);
});
