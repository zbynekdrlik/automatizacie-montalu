// CLIP zábradlie (#372) — nárez + Money odpis. Formulár → kontrola (odpis počtu
// tyčí + nárez per profil) → odoslať (TEST režim, auto-skip na LIVE). Nová stránka
// + nula console errors/warnings (e2e-console guard).
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	skipAkLive,
	waitHydrated,
	vyberSklo,
	expectSklo,
	ponukaSkla
} from './helpers';

async function hlavicka(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('OP1');
	await page.locator('#zakaznik').fill('E2E CLIP');
}

test('izo B1 3000×1000 — kontrola: odpis (počet tyčí) + nárez per profil', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-1');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page); // po natívnej POST navigácii na krok „kontrola"

	// odpis = kontraktný vektor izo B1 3000×1000: ZASP00116=2, ZASP00125=1, ZASP00119=2
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await expect(page.locator('input[name="qty_ZASP00116"]')).toHaveValue('2');
	await expect(page.locator('input[name="qty_ZASP00125"]')).toHaveValue('1');
	await expect(page.locator('input[name="qty_ZASP00119"]')).toHaveValue('2');

	// nárez per profil: 5 profilových riadkov + 4 drobné (kod: null, „neodpisuje sa")
	const narez = page.getByTestId('narez-tabulka').locator('tbody tr');
	await expect(narez).toHaveCount(9);
	await expect(page.getByTestId('narez-tabulka')).toContainText('vnútorné tesnenie');
	await expect(page.getByTestId('narez-tabulka')).toContainText('neodpisuje sa');

	expect(errs).toEqual([]);
});

test('izo B1 — odoslať zapíše odpis (TEST režim; na LIVE sa preskočí)', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-SEND');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await page.getByTestId('odoslat').click();

	// TEST režim → doklad do TEST priečinka, nie do ostrého Money
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText('.xlsx');

	expect(errs).toEqual([]);
});

test('klasika B3 (N=4) — kontrola: ZASP kódy (nie KM12), Patrik #372 potvrdil', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-KL');
	await vyberSklo(page.getByTestId('typ'), 'klasika');
	await page.getByTestId('variant').selectOption('4');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page); // po natívnej POST navigácii na krok „kontrola"

	// odpis = kontraktný vektor klasika B3 3000×1000: ZASP00116=2, ZASP00125=1, ZASP202413=2
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await expect(page.locator('input[name="qty_ZASP00116"]')).toHaveValue('2');
	await expect(page.locator('input[name="qty_ZASP00125"]')).toHaveValue('1');
	await expect(page.locator('input[name="qty_ZASP202413"]')).toHaveValue('2');
	// KM12* kódy zo šablóny sa nepoužívajú (Patrik #372: „Ano tie kody sú všade rovnaké")
	await expect(page.getByTestId('kontrola-tabulka')).not.toContainText('KM12');

	expect(errs).toEqual([]);
});

// ── #462 qty_ editácia: manuálna zmena počtu pred submitom ──────────────────
// Qty inputy na kontrolnej stránke sa dajú ručne upraviť pred odoslaním. Test
// overí, že zmena qty_ZASP00116 prežije do Money rozpisu.
test('#462 clip: qty_ ručná editácia pred submitom zmení odpis', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	const zak = `E2E-CLIP-QTY-${Date.now().toString(36)}`;
	await hlavicka(page, zak);
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// ručne zmeň qty
	const qtyInput = page.locator('input[name="qty_ZASP00116"]');
	await expect(qtyInput).toHaveValue('2');
	await qtyInput.fill('5');
	await expect(qtyInput).toHaveValue('5');

	// odošli s upraveným qty
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	// odpis obsahuje ✏️ (ručne upravené)
	await expect(page.locator('.row', { hasText: 'ZASP00116' })).toContainText('✏️');

	expect(errs).toEqual([]);
});

// ── #462 clip: „← Späť a upraviť zadanie" round-trip ───────────────────────
// Na kontrolnej stránke je tlačidlo „Späť a upraviť zadanie" — celé zadanie
// musí prežiť round-trip (šírka, výška, typ, variant).
test('#462 clip: „Späť a upraviť zadanie" zachová celé zadanie', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-RT');
	await vyberSklo(page.getByTestId('typ'), 'klasika');
	await page.getByTestId('variant').selectOption('4');
	await page.locator('#sirka').fill('2500');
	await page.locator('#vyska').fill('1200');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// klikni „Späť"
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);

	// celé zadanie prežilo
	await expect(page.locator('#sirka')).toHaveValue('2500');
	await expect(page.locator('#vyska')).toHaveValue('1200');
	await expectSklo(page.getByTestId('typ'), 'klasika');
	await expect(page.getByTestId('variant')).toHaveValue('4');

	expect(errs).toEqual([]);
});

// #502: hotovo step shows production output (nárez table + glass dimensions)
test('#502 clip hotovo: výrobný podklad s nárezom a sklami', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-VP');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.locator('#ral').fill('RAL 7016');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await page.getByTestId('odoslat').click();

	// hotovo step → výrobný podklad section is visible
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('vyrobny-podklad')).toBeVisible();

	// spec badge: CLIP · IZO · B1 · dimensions
	const podklad = page.getByTestId('vyrobny-podklad');
	await expect(podklad.locator('.badge').first()).toContainText('CLIP');
	await expect(podklad.locator('.badge').first()).toContainText('B1');
	await expect(podklad.locator('.badge').first()).toContainText('3000×1000');
	// RAL badge
	await expect(podklad.locator('.badge', { hasText: 'RAL: RAL 7016' })).toBeVisible();

	// glass dimensions (izo B1 3000×1000: šírka výplne = (3000-(19+29*2))/2-8 = 1453,5, výška = 944)
	await expect(podklad).toContainText('1453,5');
	await expect(podklad).toContainText('944');

	// narez table with profile rows
	const narezTable = page.getByTestId('hotovo-narez-tabulka');
	await expect(narezTable).toBeVisible();
	// 5 profile rows + 4 drobné = 9 rows
	await expect(narezTable.locator('tbody tr')).toHaveCount(9);
	// contains profile names
	await expect(narezTable).toContainText('hlavný profil');
	await expect(narezTable).toContainText('zasklievací profil');
	// contains drobné with "neodpisuje sa" hint
	await expect(narezTable).toContainText('vnútorné tesnenie');
	await expect(narezTable).toContainText('neodpisuje sa');

	// Money rozpis section still present
	await expect(page.locator('.sec', { hasText: 'Money rozpis' })).toBeVisible();

	expect(errs).toEqual([]);
});

// #464: clip RAL metadata field — fill → assert rendered in badge
test('#464: clip RAL metadata zobrazí sa v badge', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/clip');
	await waitHydrated(page);

	// fill header
	await page.locator('#zak').fill('E2E-CLIP-RAL');
	await page.locator('#op').fill('OP1');
	await page.locator('#zakaznik').fill('E2E CLIP RAL');

	// fill RAL
	await page.locator('#ral').fill('RAL 9005');

	// fill sizes + compute
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('1');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// RAL badge should appear
	await expect(page.locator('.badge', { hasText: 'RAL: RAL 9005' })).toBeVisible();
	expect(errs).toEqual([]);
});

// ── #554: CLIP ako zasklenia — „Pridať zábradlie", SVG náhľad, rozpis rezov ──

test('#554 clip: „➕ Pridať zábradlie" viditeľné bez prepínača', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/clip');
	await waitHydrated(page);
	// nové tlačidlo je vždy viditeľné
	await expect(page.getByRole('button', { name: '➕ Pridať zábradlie' })).toBeVisible();
	// starý prepínač „Viac kusov naraz" je preč
	await expect(page.getByTestId('clip-multi-toggle')).toHaveCount(0);
	// nesprávny label „Pridať zasklenie" (bod ticketu 1009) na CLIP už nie je
	await expect(page.getByRole('button', { name: 'Pridať zasklenie' })).toHaveCount(0);
	expect(errs).toEqual([]);
});

test('#554 clip: 1 výplň → náhľad 1 pole/0 priečok + rozpis rezov', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-N1');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('1');
	await page.locator('#sirka').fill('1500');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// SVG náhľad: 1 pole, žiadna priečka
	await expect(page.getByTestId('clip-nahlad')).toBeVisible();
	await expect(page.getByTestId('clip-pole')).toHaveCount(1);
	await expect(page.getByTestId('clip-priecka')).toHaveCount(0);

	// rozpis rezov na tyče (pílový plán) viditeľný
	await expect(page.getByTestId('clip-rozpis-rezov')).toBeVisible();
	await expect(page.getByTestId('clip-rozpis-rezov')).toContainText('Rozpis rezov na tyče');
	expect(errs).toEqual([]);
});

test('#554 clip: 3 výplne → náhľad 2 priečky (1003/1997) + rozpis rezov', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-N3');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('3');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1200');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	// 3 polia, 2 priečky, pozície ako v Exceli 37649
	await expect(page.getByTestId('clip-pole')).toHaveCount(3);
	await expect(page.getByTestId('clip-priecka')).toHaveCount(2);
	await expect(page.getByTestId('clip-priecka-pozicie')).toContainText('1003');
	await expect(page.getByTestId('clip-priecka-pozicie')).toContainText('1997');

	await expect(page.getByTestId('clip-rozpis-rezov')).toBeVisible();
	expect(errs).toEqual([]);
});

test('#554 clip multi: pridaj 2. zábradlie → spoločný rozpis + odoslať (TEST)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await hlavicka(page, `E2E-CLIP-MULTI-${Date.now().toString(36)}`);

	// zábradlie 1 (základ)
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('1');
	await page.locator('#sirka').fill('1500');
	await page.locator('#vyska').fill('1000');

	// pridaj zábradlie 2
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await page.getByTestId('z1-variant').selectOption('3');
	await page.locator('#z1-sirka').fill('3000');
	await page.locator('#z1-vyska').fill('1200');

	// spoločný rozpis (multi)
	await page.getByRole('button', { name: /Spočítať spoločný rozpis/ }).click();
	await waitHydrated(page);

	// per-kus náhľady + spoločný rozpis rezov
	await expect(page.getByTestId('kus-detail-0')).toBeVisible();
	await expect(page.getByTestId('kus-detail-1')).toBeVisible();
	await expect(page.getByTestId('clip-rozpis-rezov')).toBeVisible();

	// odoslať spoločný odpis (TEST režim)
	await page.getByTestId('odoslat-multi').click();
	await expect(page.getByTestId('vysledok-multi')).toContainText('TEST');
	expect(errs).toEqual([]);
});

// ── #593: sklá z Odoo 6/16 mm, „Pridať sklá do objednávky", RAL nového zábradlia ──

/** Rozmer skla výplne z kontroly („Šírka výplne X mm · výška výplne Y mm"), zaokrúhlený na mm. */
async function rozmerVyplne(page: import('@playwright/test').Page, scope = page.locator('body')) {
	const txt =
		(await scope
			.getByText(/Šírka výplne [\d,]+ mm · výška/)
			.first()
			.textContent()) ?? '';
	const m = /Šírka výplne ([\d,]+) mm · výška(?: výplne)? ([\d,]+) mm/.exec(txt);
	expect(m, `rozmer výplne v „${txt}"`).not.toBeNull();
	const mm = (s: string) => Math.round(Number(s.replace(',', '.')));
	return { sirka: mm(m![1]!), vyska: mm(m![2]!) };
}

test('#593 clip: výplň ponúka len šablóny izo/klasika (CI) alebo Odoo sklá 6/16 mm (PROD)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/clip');
	const p = await ponukaSkla(page.getByTestId('typ'));
	// každá voľba sa počíta jednou zo šablón; bez Odoo presne dnešné dve voľby
	expect(p.vypocty.length).toBeGreaterThan(0);
	// obe šablóny sú vždy voliteľné (bez Odoo presne dnešné dve voľby, s Odoo Odoo typy)
	expect([...p.vypocty].sort()).toEqual(['izo', 'klasika']);
	if (p.odoo) {
		const hodnoty = await page
			.getByTestId('typ')
			.locator('option')
			.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
		expect(hodnoty.filter((h) => h.startsWith('odoo:')).length).toBeGreaterThan(1);
	}
	// predvolená voľba = šablóna IZO (ako doteraz)
	await expectSklo(page.getByTestId('typ'), 'izo');
	expect(errs).toEqual([]);
});

test('#593 clip: „Pridať sklá do objednávky" — Zábradlie 1 × N ks rozmeru výplne, idempotentne', async ({
	page
}) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	const zak = `E2E-CLIP-SKLO-${Date.now().toString(36)}`;
	await hlavicka(page, zak);
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	const rozmer = await rozmerVyplne(page);

	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toContainText('Sklá pridané do objednávky');
	// odpis ostal dostupný (bez presmerovania preč)
	await expect(page.getByTestId('odoslat')).toBeVisible();
	// druhé pridanie nič neduplikuje
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toContainText('už sú v objednávke');

	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);
	await expect(page.locator('span[data-testid^="popis-"]')).toHaveCount(1);
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.getByTestId(/^popis-\d+$/)).toHaveText('Zábradlie 1');
	await expect(riadok.locator('td').nth(1)).toContainText(String(rozmer.sirka));
	await expect(riadok.locator('td').nth(1)).toContainText(String(rozmer.vyska));
	await expect(riadok.locator('td').nth(3)).toHaveText(/^\s*2\s*$/);
	expect(errs).toEqual([]);
});

test('#593 clip multi: 2 zábradlia → 2 riadky objednávky skla', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	const zak = `E2E-CLIP-SKLOM-${Date.now().toString(36)}`;
	await hlavicka(page, zak);
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('1');
	await page.locator('#sirka').fill('1500');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await vyberSklo(page.getByTestId('z1-typ'), 'klasika');
	await page.getByTestId('z1-variant').selectOption('3');
	await page.locator('#z1-sirka').fill('3000');
	await page.locator('#z1-vyska').fill('1200');
	await page.getByRole('button', { name: /Spočítať spoločný rozpis/ }).click();
	await waitHydrated(page);
	const r2 = await rozmerVyplne(page, page.getByTestId('kus-detail-1'));

	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toContainText('2 riadky');
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);
	const popisy = page.locator('span[data-testid^="popis-"]');
	await expect(popisy).toHaveText(['Zábradlie 1', 'Zábradlie 2']);
	const riadok2 = page.locator('tbody tr', { has: page.getByText('Zábradlie 2', { exact: true }) });
	await expect(riadok2.locator('td').nth(1)).toContainText(String(r2.sirka));
	await expect(riadok2.locator('td').nth(3)).toHaveText(/^\s*3\s*$/);
	expect(errs).toEqual([]);
});

test('#593 clip: nové zábradlie preberá RAL prvého, ručná zmena sa neprepíše', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-RAL593');
	await page.locator('#ral').fill('RAL 7016');
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await expect(page.locator('#z1-ral')).toHaveValue('RAL 7016');
	// zmena prvého sa prenesie do neupraveného ďalšieho
	await page.locator('#ral').fill('RAL 9005');
	await expect(page.locator('#z1-ral')).toHaveValue('RAL 9005');
	// ručne zmenené druhé zábradlie ostane
	await page.locator('#z1-ral').fill('RAL 3000');
	await page.locator('#ral').fill('RAL 1015');
	await expect(page.locator('#z1-ral')).toHaveValue('RAL 3000');
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await expect(page.locator('#z2-ral')).toHaveValue('RAL 1015');

	// farby idú do výpočtu (kontrola per zábradlie)
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.locator('#sirka').fill('1500');
	await page.locator('#vyska').fill('1000');
	for (const i of [1, 2]) {
		await page.locator(`#z${i}-sirka`).fill('1500');
		await page.locator(`#z${i}-vyska`).fill('1000');
	}
	await page.getByRole('button', { name: /Spočítať spoločný rozpis/ }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kus-detail-1')).toContainText('RAL: RAL 3000');
	await expect(page.getByTestId('kus-detail-2')).toContainText('RAL: RAL 1015');
	expect(errs).toEqual([]);
});

test('#593 clip: odstránenie 1. zábradlia nezhodí preberanú farbu ostatným', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-RALDEL');
	await page.locator('#ral').fill('RAL 7016');
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	await expect(page.locator('#z2-ral')).toHaveValue('RAL 7016');
	await page.getByTestId('zabradlie-remove-0').click();
	// nové prvé aj preberajúce ďalšie si farbu ponechajú
	await expect(page.locator('#ral')).toHaveValue('RAL 7016');
	await expect(page.locator('#z1-ral')).toHaveValue('RAL 7016');
	expect(errs).toEqual([]);
});

/** Ne-predvolená voľba výplne počítaná šablónou `sablona` (na PROD Odoo typ, ktorý NIE JE
 *  predvolený náprotivok šablóny ani aktuálna voľba), jej hodnota + názov. Bez Odoo (CI) je
 *  jediná voľba šablóny = tá lokálna. */
async function inaVolba(select: import('@playwright/test').Locator, sablona: string) {
	return select.evaluate((el, sab) => {
		const s = el as HTMLSelectElement;
		const sablony = [...s.options].filter((x) => x.dataset.vypocet === sab);
		const o =
			sablony.find((x) => x.dataset.naprotivok !== 'true' && x.value !== s.value) ?? sablony[0]!;
		return { value: o.value, nazov: (o.textContent ?? '').split(' · ')[0]!.trim() };
	}, sablona);
}

test('#593 clip: zvolené sklo výplne ide do výpočtu šablóny a na kontrolu (bez zápisu)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-VOLBA');
	const typ = page.getByTestId('typ');
	const p = await ponukaSkla(typ);
	const volba = await inaVolba(typ, 'klasika');
	await typ.selectOption(volba.value);
	await expectSklo(typ, 'klasika');
	await page.getByTestId('variant').selectOption('4');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	// 2. zábradlie s iným (izolačným) sklom
	await page.getByRole('button', { name: '➕ Pridať zábradlie' }).click();
	const z1 = page.getByTestId('z1-typ');
	const volba1 = await inaVolba(z1, 'izo');
	await z1.selectOption(volba1.value);
	await expectSklo(z1, 'izo');
	await page.locator('#z1-sirka').fill('1500');
	await page.locator('#z1-vyska').fill('1000');
	await page.getByRole('button', { name: /Spočítať spoločný rozpis/ }).click();
	await waitHydrated(page);
	// šablóna podľa druhu skla: klasika → ZASP202413, izo → ZASP00119 (Money kódy šablón)
	await expect(page.locator('input[name="qty_ZASP202413"]')).toBeVisible();
	await expect(page.locator('input[name="qty_ZASP00119"]')).toBeVisible();
	await expect(page.getByTestId('kus-detail-0')).toContainText('3.3.1 číre');
	await expect(page.getByTestId('kus-detail-1')).toContainText('4-8-4 IZO');
	if (p.odoo) {
		await expect(page.getByTestId('kus-detail-0')).toContainText(`sklo: ${volba.nazov}`);
		await expect(page.getByTestId('kus-detail-1')).toContainText(`sklo: ${volba1.nazov}`);
	}
	// späť na zadanie: voľby ostanú
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('typ')).toHaveValue(volba.value);
	await expect(page.getByTestId('z1-typ')).toHaveValue(volba1.value);

	// single tok: zvolené sklo na kontrole (badge „Sklo:" len pri Odoo type)
	await page.getByTestId('zabradlie-remove-1').click();
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await expect(page.locator('input[name="qty_ZASP202413"]')).toBeVisible();
	if (p.odoo) await expect(page.getByTestId('clip-sklo')).toHaveText(`Sklo: ${volba.nazov}`);
	else await expect(page.getByTestId('clip-sklo')).toHaveCount(0);
	expect(errs).toEqual([]);
});
