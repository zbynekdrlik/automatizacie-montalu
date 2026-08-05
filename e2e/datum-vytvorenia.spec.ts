// Dátum vytvorenia nárezáku v tlačenej hlavičke (#114, Patrik — pripomienka z výroby: dielňa
// chce vedieť, kedy plán vznikol, aby vedela dávať priority podľa dátumu). Overuje, že dátum je
// viditeľný v hlavičke pri single AJ multi posuve, v kroku „nahlad"/„nahladMulti" AJ
// „hotovo"/„hotovoMulti", je viditeľný aj v TLAČI (nie .noprint), a neprekrýva/nerozbíja
// existujúci poznámka/RAL layout (PR #50).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

const RUN = `E2E-DAT-${Date.now().toString(36).toUpperCase()}`;
const DATUM_RE = /^🕓 \d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/;

test('single posuv: dátum vytvorenia v hlavičke pri náhľade aj po odoslaní, viditeľný v tlači', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-S`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Dátum');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByLabel(/Poznámka/).fill('Test poznámky vedľa dátumu');
	await page.getByLabel(/RAL \(farba\)/).fill('7016');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// krok „nahlad" — dátum v hlavičke, správny tvar
	const vytvorene = page.getByTestId('vytvorene');
	await expect(vytvorene).toBeVisible();
	await expect(vytvorene).toHaveText(DATUM_RE);

	// poznámka + RAL box ostáva nedotknutý (PR #50) — dátum je v .sub hlavičky, nie v tom card-e
	await expect(page.getByTestId('poznamka-ral')).toBeVisible();
	await expect(page.getByTestId('ral-val')).toHaveText('7016');

	// v tlači je dátum VIDITEĽNÝ (nie .noprint), poznámka/RAL ostáva tiež
	await page.emulateMedia({ media: 'print' });
	await expect(vytvorene).toBeVisible();
	await expect(page.getByTestId('poznamka-ral')).toBeVisible();
	await page.emulateMedia({ media: 'screen' });

	// krok „hotovo" (po odoslaní) — dátum ostáva v hlavičke
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	const vytvoreneHotovo = page.getByTestId('vytvorene');
	await expect(vytvoreneHotovo).toBeVisible();
	await expect(vytvoreneHotovo).toHaveText(DATUM_RE);

	expect(consoleMsgs).toEqual([]);
});

test('viac posuvov: dátum vytvorenia v hlavičke pri spoločnom náhľade aj po odoslaní', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-M`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Dátum Multi');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('2509');
	await page.locator('#ps0-v').fill('1930');
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();

	// krok „nahladMulti"
	const vytvorene = page.getByTestId('vytvorene');
	await expect(vytvorene).toBeVisible();
	await expect(vytvorene).toHaveText(DATUM_RE);

	// krok „hotovoMulti"
	await page.getByTestId('odoslat-multi').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	const vytvoreneHotovo = page.getByTestId('vytvorene');
	await expect(vytvoreneHotovo).toBeVisible();
	await expect(vytvoreneHotovo).toHaveText(DATUM_RE);

	expect(consoleMsgs).toEqual([]);
});

// Formát v hlavičke ukazuje len minúty (nie sekundy), takže dva „Spočítať" klik-y v tom istom
// teste takmer vždy padnú do tej istej minúty — porovnávanie VYKRESLENÉHO textu na nerovnosť by
// bolo flaky (a v skutočnosti by nič neoverovalo cez hranicu minúty). Namiesto toho overujeme
// silnejšiu vlastnosť: vykreslená hodnota zodpovedá SKUTOČNÉMU aktuálnemu serverovému času (nie
// zamrznutej/build-time hodnote) — to isté zlyhá, ak by niekto `vytvorene` prerobil na hodnotu
// počítanú raz pri štarte servera namiesto per-request.
test('opakované „Spočítať" dá dátum zodpovedajúci AKTUÁLNEMU serverovému času (nie zamrznutá hodnota)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // náhľad nezapisuje → bezpečné aj na LIVE
	await goto(page, '/zasklenia');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-T1`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Dátum Time');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	const prvy = await page.getByTestId('vytvorene').textContent();
	expect(prvy).toMatch(DATUM_RE);
	expect(jeBlizkoTeraz(prvy!)).toBe(true);

	// „Späť a upraviť" → nový „Spočítať" → nový server-side timestamp (round-trip, nie
	// vypočítaný raz na klientovi/pri štarte servera a zamrznutý)
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	const druhy = await page.getByTestId('vytvorene').textContent();
	expect(druhy).toMatch(DATUM_RE);
	expect(jeBlizkoTeraz(druhy!)).toBe(true);

	expect(consoleMsgs).toEqual([]);
});

/** Je vykreslený „🕓 D.M.YYYY HH:MM" v Europe/Bratislava do 2 minút od skutočného „teraz"? */
function jeBlizkoTeraz(vykresleny: string): boolean {
	const teraz = new Date();
	const partsFor = (d: Date) =>
		new Intl.DateTimeFormat('en-US', {
			timeZone: 'Europe/Bratislava',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).formatToParts(d);
	const fmt = (d: Date) => {
		const p = partsFor(d);
		const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
		return `🕓 ${g('day')}.${g('month')}.${g('year')} ${g('hour')}:${g('minute')}`;
	};
	// akceptuj „teraz", „teraz - 1 min" aj „teraz - 2 min" (hranica minúty, latencia kliku)
	for (const delta of [0, -60_000, -120_000]) {
		if (vykresleny === fmt(new Date(teraz.getTime() + delta))) return true;
	}
	return false;
}
