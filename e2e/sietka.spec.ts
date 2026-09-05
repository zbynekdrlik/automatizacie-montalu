// Sieťka na posuve (#86–#90) — Patrik 2026-07-31 (Odoo, kanál Vyroba automatizacia),
// KOREKCIA 2026-08-02: sieťka je ĎALŠIE krídlo toho istého posuvu (rovnaký rozmer ako
// ostatné), takže MENÍ Money odpis na Robust/Slide (rám+nos, pri 2K aj koľajnicu).
// Rozmer sa už NEZADÁVA — appka ho odvodí zo skla ("rozmer sieťoviny").
//
// Väčšina testov je ČÍTACIA: formulár + „Spočítať" (?/nahlad, ?/nahladMulti) len
// počítajú, nezapisujú odpis → dá sa pustiť aj proti nasadenej appke (BASE_URL).
// Testy, ktoré idú AŽ ZA odoslanie do Money, sú označené a používajú `skipAkLive`.
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	waitHydrated,
	goto,
	skipAkLive,
	vyberFarbuKovania,
	logout
} from './helpers';

async function zaklad(page: Page, zak: string, zakaznik: string, styl = '3K') {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill(zakaznik);
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', styl);
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
}

/** riadky karty „Odpis (do Money)" */
async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

test('sieťka: zapínač je len pri Robust/Slide, na inom systéme zmizne aj vynuluje sa', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#sietka-on')).toBeVisible();
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-box')).toBeVisible();

	// Deluxe sieťku neponúka — zapínač zmizne a stav sa vynuluje (nezostane
	// „duchom" pri prepnutí späť na Robust)
	await page.selectOption('#system', 'Deluxe');
	await expect(page.locator('#sietka-on')).toHaveCount(0);
	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#sietka-on')).not.toBeChecked();

	expect(errs).toEqual([]);
});

test('jeden posuv: sieťka pridá presnú deltu do Money odpisu (rám+nos, #86 korekcia)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// (1) najprv BEZ sieťky — referenčný odpis
	await zaklad(page, 'E2E-SIETKA', 'E2E Sietka');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bezSietky = await odpisRiadky(page);
	expect(bezSietky.length).toBeGreaterThan(0);
	await expect(page.getByTestId('nahlad-sietka')).toHaveCount(0);
	await expect(page.getByTestId('sietka-karta')).toHaveCount(0);

	// (2) to isté zadanie so sieťkou
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-uchyt').selectOption('madloVelke');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// sieťka nakreslená v náhľade ako plnohodnotné pole naviac (4. krídlo)
	await expect(page.getByTestId('nahlad-sietka')).toBeVisible();

	// karta plánu nesie stranu + rozmer sieťoviny (odvodený zo skla) + úchyt
	const karta = page.getByTestId('sietka-karta');
	await expect(karta).toContainText('pravá'); // P - L → sieťka vpravo
	await expect(karta).toContainText('vystúpené madlo veľké');

	// MONEY-KOREKCIA: sieťka MUSÍ zmeniť odpis (rámový profil pribudne)
	const soSietkou = await odpisRiadky(page);
	expect(soSietkou).not.toEqual(bezSietky);
	// rámový kód (ZASP00002) musí mať VYŠŠIE metre so sieťkou
	const ram = (riadky: string[]) => riadky.find((r) => r.includes('ZASP00002'));
	expect(ram(soSietkou)).not.toBe(ram(bezSietky));

	expect(errs).toEqual([]);
});

test('sieťka: kľučka sa neponúka, keď je sieťka zapnutá (#88)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-KOV', 'E2E Sietka kovanie');
	await expect(page.locator('#kovanieL')).toBeVisible();
	await page.locator('#kovanieL').selectOption('Obojstranná kľučka bez FAB');

	await page.locator('#sietka-on').check();
	await expect(page.locator('#kovanieL')).toHaveCount(0);
	await expect(page.locator('#kovanieP')).toHaveCount(0);

	// odškrtnutie sieťky kľučku znova ponúkne (ale hodnota sa nevracia — bola
	// vynulovaná spolu so zapnutím sieťky)
	await page.locator('#sietka-on').uncheck();
	await expect(page.locator('#kovanieL')).toBeVisible();
	await expect(page.locator('#kovanieL')).toHaveValue('');

	expect(errs).toEqual([]);
});

test('sieťka na 2K posuve ukáže upozornenie a Money odpis PRIDÁ 3K koľajnicu (#87)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-2K', 'E2E Sietka 2K', '2K');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bez2k = await odpisRiadky(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-2k-warn')).toContainText('3K');

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-2k-warn-karta')).toContainText('3K');
	// odpisová karta TERAZ obsahuje 3K koľajnicu namiesto 2K
	const so2k = (await odpisRiadky(page)).join(' ');
	expect(so2k).toContain('3K');
	expect(so2k).not.toEqual(bez2k.join(' '));

	expect(errs).toEqual([]);
});

test('sieťka prežije „← Späť a upraviť" (úchyt)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-B', 'E2E Sietka spat');
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-uchyt').selectOption('zamok');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#sietka-on')).toBeChecked();
	await expect(page.locator('#sietka-uchyt')).toHaveValue('zamok');

	expect(errs).toEqual([]);
});

test('viac posuvov: sieťka má len ten posuv, ktorý ju má zapnutú', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-M', 'E2E Sietka multi');
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();
	await page.locator('#ps0-s').fill('4365');
	await page.locator('#ps0-v').fill('2320');
	// sieťka len na DRUHOM posuve (primárny ostáva bez nej)
	await page.locator('#ps0-sietka-on').check();
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('nahlad-sietka')).toHaveCount(1);
	const karta = page.getByTestId('sietka-karta-multi');
	await expect(karta).toContainText('Zasklenie 2');
	await expect(karta).not.toContainText('Zasklenie 1 ');

	expect(errs).toEqual([]);
});

test('samostatná stránka /sietka: rám 2ks+2ks, nos 1ks, rozmer sieťoviny, tlačidlo Odoslať pre internych', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await goto(page, '/sietka');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-SOLO');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka solo');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2K');
	await page.locator('#otvorS').fill('1500');
	await page.locator('#otvorV').fill('1400');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);

	await expect(page.getByTestId('ram-profil')).toHaveText('2 ks + 2 ks');
	await expect(page.getByTestId('nos-profil')).toHaveText('1 ks');
	// rozmer sieťoviny je TERAZ vypočítaný (nie ručne zadaný) a vždy sa zobrazí
	await expect(page.getByTestId('sietka-samostatna-rozmer')).toBeVisible();
	// 2K posuv → tabuľka upozornenia na 3K koľajnicu
	await expect(page.getByTestId('sietka-2k-tabulka')).toContainText('3K');
	// interný používateľ VIDÍ tlačidlo na odoslanie do Money (korekcia 2026-08-02)
	await expect(page.getByTestId('odoslat-sietku')).toBeVisible();

	expect(errs).toEqual([]);
});

// ZÁPISOVÝ → `skipAkLive`, aby proti ostrej appke nikdy nebežal (rovnaký vzor ako
// e2e/klin.spec.ts „viac posuvov: klín je vidno AJ po odoslaní").
test('samostatná stránka /sietka: Odoslať do Money zapíše odpis (TEST režim)', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await goto(page, '/sietka');
	const zak = `E2E-SIETKA-ODO-${Date.now().toString(36)}`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka odoslanie');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#otvorS').fill('4645');
	await page.locator('#otvorV').fill('2320');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);

	await page.getByTestId('odoslat-sietku').click();
	await waitHydrated(page);
	await expect(page.getByText('Odpis odoslaný')).toBeVisible();

	// odoslanie ROVNAKÉHO ZAK+OP znova musí ukázať zrozumiteľnú „duplikát" hlášku,
	// NIE prázdnu stránku (review nález PR #108: step==='duplikat' vetva sa
	// renderuje v tom istom bloku ako step==='vysledok', gejtovanom na `r` — bez
	// neho zostala stránka prázdna)
	await goto(page, '/sietka');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka odoslanie');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#otvorS').fill('4645');
	await page.locator('#otvorV').fill('2320');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);
	await page.getByTestId('odoslat-sietku').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-samostatna-duplikat')).toContainText('už bola odoslaná');
	// karta s výsledkom (rám/nos/rozmer) ostáva vidno pod hláškou — nie je to
	// prázdna stránka
	await expect(page.getByTestId('sietka-samostatna-vysledok')).toBeVisible();

	expect(errs).toEqual([]);
});

test('/sietka je v nav odkazoch, b2b naň nie je presmerovaný preč a nevidí tlačidlo Odoslať', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await expect(page.getByRole('link', { name: 'Sieťka' })).toBeVisible();

	// b2b throwaway účet (rovnaký vzor ako app.spec.ts B2B test) — over, že /sietka
	// nepresmeruje preč (Patrik #89: „hlavne pre externých") a nevidí Money zápis
	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-sietka-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click(); // rola defaultne B2B
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	await logout(page);
	await loginAs(page, b2bUser, b2bPass);
	await expect(page.getByRole('link', { name: 'Sieťka' })).toBeVisible();
	await goto(page, '/sietka');
	await expect(page).toHaveURL(/\/sietka/);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-B2B');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka b2b');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#otvorS').fill('4645');
	await page.locator('#otvorV').fill('2320');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);
	// b2b nikdy nevidí tlačidlo na zápis do Money — len tabuľku/výpočet
	await expect(page.getByRole('button', { name: /Odoslať/ })).toHaveCount(0);

	// upratanie
	await logout(page);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.locator('tr', { hasText: b2bUser }).getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');

	expect(errs).toEqual([]);
});

// ── #462 poznamka: pole sa dá vyplniť a prežije round-trip na /sietka ───────
// Pole „Poznámka (viacriadková — ide aj do tlače)" na /sietka. Test overí,
// že sa dá vyplniť a po Spočítať aj pri „Späť" prežije (round-trip).
test('#462 sietka poznamka: vyplnenie + round-trip zachováva hodnotu', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/sietka');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-POZ');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka Pozn');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#otvorS').fill('3000');
	await page.locator('#otvorV').fill('2000');

	// vyplň poznámku (viacriadková)
	await page.locator('#poznamka').fill('E2E poznamka riadok');
	await expect(page.locator('#poznamka')).toHaveValue('E2E poznamka riadok');

	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);
	// po výpočte stránka ukazuje výsledok — poznámka je v skrytých inputoch pre submit
	// overí, že hidden poznamka prežila POST (je v DOM v odoslat forme)
	const hiddenPozn = page.locator('input[name="poznamka"][type="hidden"]').first();
	await expect(hiddenPozn).toHaveValue('E2E poznamka riadok');

	expect(errs).toEqual([]);
});
