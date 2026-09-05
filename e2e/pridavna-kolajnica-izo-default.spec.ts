// #132 ROZHODNUTÉ — Patrik (Odoo 207, msg #1646652, 2026-08-09): „my vždy
// dávame pri štandardoch IZO spodnú koľaj navyše ale iba spodnú". Checkbox
// „Prídavná koľajnica" (Štandard +, mimo 6K) sa teraz PREDVYPLNÍ zaškrtnutý,
// keď je zvolené izolačné sklo — obsluha ho môže kedykoľvek odškrtnúť. Mení
// Money odpis (railUpsize v compute.ts): OFF → ZASP00104 (spodná 2K),
// ON → ZASP00030 (spodná 3K). Cez REÁLNY formulár, presne ako
// e2e/pridavna-v-sietke.spec.ts.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, skipAkLive, vyberFarbuKovania } from './helpers';

const IZO = 'Izolačné sklo 4.8.4';
const NIE_IZO = 'Float sklo 4 mm';

test('Štandard + | 2K | IZO sklo: checkbox sa predvyplní zaškrtnutý a odpis ukáže 3K spodnú', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).not.toBeChecked(); // predvolené sklo je číre (nie IZO)

	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await expect(checkbox).toBeChecked(); // sklo prepnuté na IZO → predvyplní sa

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-132-A-${Date.now()}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná IZO default');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.locator('.row', { hasText: 'ZASP00107' })).toBeVisible(); // horná 2K (nemení sa)
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toBeVisible(); // spodná 3K
	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toHaveCount(0); // spodná 2K preč

	expect(errs).toEqual([]);
});

test('predvyplnenie sa dá ručne odškrtnúť — odpis sa vráti na 2K spodnú', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-132-B-${Date.now()}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná ručné odškrtnutie');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toBeVisible(); // spodná 2K
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toHaveCount(0); // žiadna 3K

	expect(errs).toEqual([]);
});

test('deliberatívne odškrtnutie prežije zmenu iného poľa (rozmery)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();

	// zmena rozmerov (nesúvisiace pole) nesmie checkbox znova zaškrtnúť
	await page.getByLabel('Šírka (mm) *').fill('3200');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await expect(checkbox).not.toBeChecked();
	await page.locator('#poznamka').fill('poznámka nesúvisiaca s koľajnicou');
	await expect(checkbox).not.toBeChecked();

	expect(errs).toEqual([]);
});

test('prepnutie skla PREČ z IZO odškrtne default (žiadny IZO dôvod neostáva)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	const skloSelect = page.getByLabel('Sklo (základ — určuje vzorec)');
	await skloSelect.selectOption(IZO);

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeChecked();

	await skloSelect.selectOption(NIE_IZO);
	await expect(checkbox).not.toBeChecked();

	// a späť na IZO → znova zaškrtne (nová voľba skla = nová príležitosť na default)
	await skloSelect.selectOption(IZO);
	await expect(checkbox).toBeChecked();

	expect(errs).toEqual([]);
});

// #132 review (deep pass, requesting-code-review): manuálny override nesmie
// „prežiť navždy" prepnutie SYSTÉMU preč a späť — hranový tracker sa pri odchode
// z Štandard + tiež hranovo prepne (na false), takže návrat na Štandard + s NOVO
// zvoleným IZO sklom je opäť nová hrana a znova zaškrtne, presne ako pri prepnutí
// SKLA (test vyššie). Bez tohto testu bol scenár len odôvodnený v komentároch, nie
// overený behom.
//
// (#456) Robust je odvtedy TIEŽ `plusRailEligible` (2K/3K majú +1 koľajnicový
// variant) — checkbox teda na Robuste NEZMIZNE z DOM, ako to bolo pred #456
// (vtedy ho iný systém vôbec neponúkal). Auto-IZO default
// (`pridavnaKolajnicaDefault`/`standardPlusRailEligible`) ale OSTÁVA len pre
// Štandard + (#456 design — Patrik msg #1646652), takže odchod zo Štandard +
// je STÁLE hrana (odporúčaná hodnota true→false), len teraz s iným viditeľným
// výsledkom: checkbox ostáva vo DOM, viditeľný, no odškrtnutý — nie preč.
test('prepnutie SYSTÉMU preč z Štandard + a späť: ručný override nezostane naveky, nová voľba IZO skla znova zaškrtne', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck(); // deliberatívny override
	await expect(checkbox).not.toBeChecked();

	// odchod zo Štandard + na Robust: checkbox OSTÁVA viditeľný (#456 — Robust
	// 2K je plusRailEligible), ale auto-IZO default platí len pre Štandard + →
	// hranový tracker prepne odporúčanú hodnotu na false a checkbox je odškrtnutý
	// (reálne overené behom, nie len odvodené z kódu)
	await page.getByLabel('Systém').selectOption('Robust');
	await expect(page.getByLabel(/Prídavná koľajnica/)).toBeVisible();
	await expect(page.getByLabel(/Prídavná koľajnica/)).not.toBeChecked();

	// návrat na Štandard + | 2K — sklo sa automaticky prepnutím systému zresetuje
	// na NE-izolačné (Robustové IZO sklo tu nie je platné), checkbox ostáva
	// viditeľný, ale NEzaškrtnutý (žiadny IZO dôvod)
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await expect(checkbox).toBeVisible();
	await expect(checkbox).not.toBeChecked();

	// nová voľba IZO skla PO návrate → nová hrana → znova zaškrtne (override
	// spred odchodu zo systému neplatí naveky)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await expect(checkbox).toBeChecked();

	expect(errs).toEqual([]);
});

test('Štandard + | 3K | IZO sklo: predvyplní tiež, odpis ukáže 4K spodnú', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');

	await expect(page.getByLabel(/Prídavná koľajnica/)).toBeChecked();

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-132-C-${Date.now()}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná 3K IZO');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.locator('.row', { hasText: 'ZASP00027' })).toBeVisible(); // horná 3K (nemení sa)
	await expect(page.locator('.row', { hasText: 'ZASP00033' })).toBeVisible(); // spodná 4K
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toHaveCount(0); // spodná 3K preč

	expect(errs).toEqual([]);
});

test('Štandard + | 6K: checkbox v UI vôbec nie je (7K koľajnica neexistuje) — IZO sklo nič nezaškrtne', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('6K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);

	await expect(page.getByLabel(/Prídavná koľajnica/)).toHaveCount(0);

	expect(errs).toEqual([]);
});

// #132 bod 5 (zdieľané pole naprieč posuvmi): „Prídavná koľajnica" je order-level
// vstup, platí pre VŠETKY posuvy (+page.server.ts, komentár „prídavná koľajnica je
// vstup na úrovni objednávky → platí pre všetky posuvy") — existujúce správanie,
// #132 mení len JEJ ŠTARTOVACIU hodnotu (default). Zmiešaný prípad: primárny posuv
// je Štandard + s IZO sklom (default ju zaškrtne), extra posuv je TIEŽ Štandard +,
// ale s NE-izolačným sklom — zdieľaný checkbox napriek tomu upsizne AJ jeho
// koľajnicu, presne ako keby ho obsluha zaškrtla ručne (žiadna nová per-posuvová
// logika, len iný zdroj štartovacej hodnoty).
test('zimná záhrada: order-level default z primárneho posuvu upsizne AJ extra posuv s NE-IZO sklom', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-132-MULTI-${Date.now()}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná multi zmiešaný');
	// primárny posuv = Štandard + | 2K | IZO sklo → default zaškrtne order-level box
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');
	await expect(page.getByLabel(/Prídavná koľajnica/)).toBeChecked();

	// extra posuv = TIEŽ Štandard + | 2K, ale s NE-izolačným sklom (vlastný default
	// by ho NEzaškrtol, keby bol per-posuv — dôkaz, že pole je naozaj zdieľané)
	await page.getByRole('button', { name: /Pridať zasklenie/ }).click();
	await page.locator('#ps0-sys').selectOption('Štandard +');
	await page.locator('#ps0-styl').selectOption('2K');
	await page.locator('#ps0-sklo').selectOption(NIE_IZO);
	await page.locator('#ps0-s').fill('3200');
	await page.locator('#ps0-v').fill('1900');

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// obidva posuvy majú hornú 2K (nemení sa checkboxom) a UPSIZNUTÚ spodnú (3K) —
	// základná 2K spodná (ZASP00104) nie je nikde, aj keď extra posuv sám o sebe
	// (jeho vlastné sklo) by default nikdy nedostal
	await expect(page.locator('.row', { hasText: 'ZASP00107' })).toBeVisible(); // horná 2K
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toBeVisible(); // spodná 3K (obidva posuvy)
	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toHaveCount(0); // základná 2K spodná nikde

	expect(errs).toEqual([]);
});

test('„Použiť znova": ručne odškrtnutá IZO objednávka sa po obnovení NEPREPÍŠE naspäť na zaškrtnutú', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await waitHydrated(page);

	const zak = `E2E-132-ZNOVA-${Date.now()}`;

	// 1. IZO sklo na Štandard + 2K → default sa predvyplní, obsluha ho ZÁMERNE odškrtne
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('Prvý zákazník IZO');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(IZO);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();

	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. „Použiť znova" z histórie
	await page.goto('/odpisy');
	const riadok = page.locator('tbody tr', { hasText: zak }).first();
	await expect(riadok).toBeVisible();
	await riadok.getByRole('link', { name: /Použiť znova/ }).click();
	await waitHydrated(page);

	// 3. systém/štýl/sklo sa obnovili na Štandard + | 2K | IZO (default BY zaškrtol),
	//    ale uložená hodnota bola FALSE — tá musí vyhrať, appka ju nesmie prepísať
	await expect(page.getByLabel('Systém')).toHaveValue('Štandard +');
	await expect(page.getByLabel('Sklo (základ — určuje vzorec)')).toHaveValue(IZO);
	await expect(checkbox).not.toBeChecked();

	expect(errs).toEqual([]);
});
