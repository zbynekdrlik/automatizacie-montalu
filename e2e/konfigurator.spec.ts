// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — E2E cez reálny prehliadač.
// Kľúčové: flow BEZ prihlásenia (verejná route), a v odpovedi sa NEOBJAVÍ žiadna cena,
// Money kód (TS*) ani nárez. Display-only, žiadny Money zápis → beží aj proti nasadenej
// appke (BASE_URL), žiadny skipAkLive. Každý test = NULA console errors/warnings.
import { test, expect } from '@playwright/test';
import { goto, collectConsole } from './helpers';

test('konfigurátor: verejný flow BEZ prihlásenia → súhrn konfigurácie, žiadna cena/Money kód, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);

	// verejná route — žiadne prihlásenie; NESMIE presmerovať na /login
	await goto(page, '/konfigurator');
	await expect(page).toHaveURL(/\/konfigurator$/);
	await expect(page.getByRole('heading', { name: /Navrhni si.*pergolu/i })).toBeVisible();

	await page.getByTestId('sirka').fill('5000');
	await page.getByTestId('hlbka').fill('4000');
	await page.getByTestId('vyskaVpredu').fill('3000');
	await page.getByTestId('sklonDeg').fill('10');

	// vyber typ skla ZISTENÝ ZA BEHU ako NIE prvý v zozname (nova-stranka disciplína #3 —
	// aspoň jeden test vyberá non-default hodnotu, aby zachytil prípadný tichý revert)
	const sklo = page.getByTestId('sklo');
	const skloOptions = sklo.locator('option');
	const vybranySklo = (await skloOptions.nth(2).getAttribute('value')) ?? '';
	expect(vybranySklo).not.toBe('');
	await sklo.selectOption(vybranySklo);

	await page.getByTestId('zobrazit').click();

	const suhrn = page.getByTestId('suhrn');
	await expect(suhrn).toBeVisible();
	// dopočítané hodnoty (celé čísla — bez zaokrúhľovacej krehkosti)
	await expect(page.getByTestId('s-plocha')).toHaveText('20 m²'); // 5000·4000 mm = 20 m²
	await expect(page.getByTestId('s-svetla')).toHaveText('2810 mm'); // 3000 − 190 (nosník)
	await expect(page.getByTestId('s-sklon')).toContainText('10');
	// zvolený (non-default) typ skla sa prejaví v súhrne
	await expect(page.getByTestId('s-sklo')).toHaveText(vybranySklo);
	await expect(page.getByTestId('s-farba')).toContainText('RAL 7016');

	// ÚNIK GUARD: nikde na stránke žiadna cena (€/EUR), žiadny Money kód (TS###), žiadny nárez
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/€|EUR\b/);
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);

	// verzia v pätičke (version-on-dashboard) — pätička je zdieľaná aj pre verejnú stránku
	await expect(page.getByTestId('version')).toHaveText(
		/^v\d+\.\d+\.\d+(-dev\.\d+)?(\s\([0-9a-f]{7}\))?$/
	);
	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor: kombinácia výška+hĺbka+sklon nad rozmedzie → friendly chyba, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	// všetky polia v rámci individuálnych min/max (prejdú client validáciou), ale
	// dopočítaná výška pri stene presiahne max enginu → server vráti friendly chybu
	await page.getByTestId('sirka').fill('8000');
	await page.getByTestId('hlbka').fill('6000');
	await page.getByTestId('vyskaVpredu').fill('4000');
	await page.getByTestId('sklonDeg').fill('30');
	await page.getByTestId('zobrazit').click();

	await expect(page.getByTestId('chyba')).toBeVisible();
	await expect(page.getByTestId('chyba')).toContainText(/stene/i);
	await expect(page.getByTestId('suhrn')).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});
