// #496: objednávka skla — reálny tok obsluhy: spočítať nárezový plán na /zasklenia,
// „Pridať sklá do objednávky" (?/pridatSkla), presmerovanie na /objednavka-skla/[zak],
// pridaná položka viditeľná s reálne dopočítanými rozmermi/počtom/typom skla, a
// rozmery/atyp prepínač (režim) sprístupní upload vstup. #563: nadpis podkladu = OP + zákazník
// (z odpisu), popis riadka len „Zasklenie 1", m² vyplnené. Zápisový tok (objednavka_skla + TESTOVÝ
// Money priečinok, nikdy ostrý Money) — skipAkLive na ostrom nasadení preskočí.
import { test, expect, type Page } from '@playwright/test';
import { formatDatumSk } from '../src/lib/datum';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania,
	logout
} from './helpers';

const RUN = `E2E-SKLA-${Date.now().toString(36).slice(-5)}`;

test('zasklenia: spočítať → Pridať sklá do objednávky → podklad s reálnymi rozmermi + atyp prepínač', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/zasklenia');

	const zak = `${RUN}-01`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Objednávka skla');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// reálne dopočítané hodnoty (nie ručne odvodené) — čítame ich z karty „Sklo (mm)"
	// PRED presmerovaním, aby sa dali overiť po presune na podklad objednávky
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	const sirkaTxt = (await page.getByTestId('sklo-sirka').textContent()) ?? '';
	const vyskaTxt = (await page.getByTestId('sklo-vyska').textContent()) ?? '';
	const typTxt = ((await page.locator('span:text-is("Typ") + b').textContent()) ?? '').trim();
	const pocetTxt = (await page.locator('span:text-is("Počet") + b').textContent()) ?? '';
	const sirka = Math.round(Number(sirkaTxt.replace(',', '.')));
	const vyska = Math.round(Number(vyskaTxt.replace(',', '.')));
	const pocet = parseInt(pocetTxt, 10);
	expect(sirka).toBeGreaterThan(0);
	expect(vyska).toBeGreaterThan(0);
	expect(pocet).toBeGreaterThan(0);
	expect(typTxt.length).toBeGreaterThan(0);

	// #563: najprv „uložiť nárezák" (odpis, MONEY_LIVE=0 → testový priečinok) — odpis nesie OP +
	// zákazníka pre nadpis podkladu; #514: „Pridať sklá" je dostupné aj po odpise.
	await page.getByTestId('odoslat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('vysledok')).toBeVisible();

	// #514: „Pridať sklá" už NEpresmeruje preč — ostane výsledok s potvrdením + odkazom;
	// z odkazu prejdeme na podklad objednávky.
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	// podklad objednávky KONKRÉTNEJ zákazky; #563: nadpis = OP + zákazník z odpisu (nie ZAK)
	await expect(page).toHaveURL(new RegExp(`/objednavka-skla/${zak}`));
	const nadpis = page.getByTestId('objednavka-nadpis');
	await expect(nadpis).toContainText('Objednávka skla — ');
	await expect(nadpis).toContainText('01');
	await expect(nadpis).toContainText('E2E Objednávka skla');
	await expect(nadpis).not.toContainText(zak);

	const riadok = page.locator('tbody tr').first();
	await expect(riadok).toBeVisible();
	// #563: popis len pozícia (výrobu systém/štýl nezaujíma)
	await expect(riadok.locator('td').nth(0)).toHaveText('Zasklenie 1');
	await expect(riadok.locator('td').nth(1)).toContainText(String(sirka));
	await expect(riadok.locator('td').nth(1)).toContainText(String(vyska));
	await expect(riadok.locator('td').nth(2)).toContainText(typTxt);
	await expect(riadok.locator('td').nth(3)).toContainText(String(pocet));
	// #563: m² vyplnené vopred — odvodené z rozmerov/počtu čítaných z DOM (nie pevný literál)
	const m2 = (Math.round(((sirka * vyska * pocet) / 1e6) * 1000) / 1000).toFixed(3);
	await expect(riadok.locator('td').nth(4)).toHaveText(`${m2} m²`);

	// #540: picker typu skla — select v riadku + zdroj zoznamu. Proti preview cieľu (bez Odoo
	// pripojenia) je zdroj lokálny fallback, nikdy tichý prázdny select.
	await expect(riadok.locator('select[name="typ_skla"]')).toBeVisible();
	await expect(riadok.locator('select[name="typ_skla"] option')).not.toHaveCount(0);
	await expect(page.getByTestId('glass-types-source')).toContainText('lokálny zoznam');

	// rozmery/atyp prepínač: pred prepnutím žiadny upload vstup, po prepnutí sa objaví
	await expect(riadok.locator('input[type="file"]')).toHaveCount(0);
	await riadok.locator('select[name="rezim"]').selectOption('atyp');
	await waitHydrated(page);

	const riadokPoPrepnuti = page.locator('tbody tr').first();
	await expect(riadokPoPrepnuti.locator('input[type="file"]')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

// #545: prázdny podklad (servisná zákazka bez nárezáku) → formulár „Pridať riadok" je viditeľný
// aj bez položiek → pridá sa ručný riadok (typ z pickera, atyp) → riadok pod „Pridané položky" →
// nastaví sa OP → tlačidlo Odoslať je zapnuté. NIKDY nesend-uje (proti live sa test skipne).
test('objednávka skla: prázdny podklad → ručný riadok + OP → Odoslať zapnuté', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-SERVIS`;
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	// prázdny podklad: formulár „Pridať riadok" je viditeľný aj bez položiek
	const pridatForm = page.getByTestId('pridat-riadok');
	await expect(pridatForm).toBeVisible();

	// pridaj ručný riadok: popis, typ skla z pickera (prvá reálna možnosť), 1000×1000, 2 ks, atyp
	await pridatForm.getByTestId('manual-popis').fill('ATYP podľa výkresu');
	const typSelect = pridatForm.getByTestId('manual-typ');
	await expect(typSelect.locator('option')).not.toHaveCount(0);
	// vyber prvú NEprázdnu možnosť typu skla
	const prvaMoznost = typSelect.locator('option:not([value=""])').first();
	await expect(prvaMoznost).toBeAttached();
	const typValue = await prvaMoznost.getAttribute('value');
	await typSelect.selectOption(typValue!);
	await pridatForm.getByTestId('manual-sirka').fill('1000');
	await pridatForm.getByTestId('manual-vyska').fill('1000');
	await pridatForm.getByTestId('manual-pocet').fill('2');
	await pridatForm.getByTestId('manual-rezim').selectOption('atyp');
	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	// riadok sa objaví v sekcii „Pridané položky"
	await expect(page.getByRole('heading', { name: 'Pridané položky' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.locator('td').nth(0)).toContainText('ATYP podľa výkresu');
	await expect(riadok.locator('td').nth(1)).toContainText('1000');

	// Odoslať je bez OP zatiaľ zakázané
	await expect(page.getByTestId('odoslat-odoo')).toBeDisabled();

	// nastav OP objednávky (zákazka nemá odpis) → jedno OP pre celý podklad
	await page.getByTestId('op-input').fill('260545');
	await page.getByTestId('nastav-op').click();
	await waitHydrated(page);

	// Odoslať je teraz zapnuté (≥ 1 riadok + OP); v teste NIKDY neklikáme send
	await expect(page.getByTestId('odoslat-odoo')).toBeEnabled();

	expect(consoleMsgs).toEqual([]);
});

// #546: index /objednavka-skla „Nová objednávka len skla" (zákazka + OP) → presmeruje na podklad
// s predvyplneným OP (`?op=`). Server validuje normZak/normOp, nič neukladá. Zero-console.
test('index: Nová objednávka len skla (zákazka + OP) → podklad s predvyplneným OP', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/objednavka-skla');

	const zak = `${RUN}-IDX`;
	await page.getByTestId('nova-zak').fill(zak);
	await page.getByTestId('nova-op').fill('260546');
	await page.getByTestId('nova-otvorit').click();

	// presmerovanie na podklad s ?op= v URL
	await page.waitForURL(/\/objednavka-skla\/.*[?&]op=OP260546/);
	await waitHydrated(page);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	// prázdny podklad → pridaj riadok, potom OP pole je predvyplnené z ?op=
	const pridatForm = page.getByTestId('pridat-riadok');
	await pridatForm.getByTestId('manual-popis').fill('Popraskané sklo — servis');
	const typSelect = pridatForm.getByTestId('manual-typ');
	const prva = typSelect.locator('option:not([value=""])').first();
	await typSelect.selectOption((await prva.getAttribute('value'))!);
	await pridatForm.getByTestId('manual-sirka').fill('800');
	await pridatForm.getByTestId('manual-vyska').fill('600');
	await pridatForm.getByTestId('manual-pocet').fill('1');
	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	// OP pole predvyplnené hodnotou z indexu (`?op=OP260546`)
	await expect(page.getByTestId('op-input')).toHaveValue('OP260546');

	expect(consoleMsgs).toEqual([]);
});

// #548: „iné sklo" — v pickeri „Pridať riadok" sa zvolí sentinel → odkryjú sa vlastný typ + cena
// €/m² → riadok sa uloží s manuálnym typom + cenou (zobrazený badge „iné sklo: <typ> · <cena>").
// NIKDY neposiela do Odoo (proti live sa test skipne). Zero-console.
test('objednávka skla: „iné sklo" — vlastný typ + cena/m² sa uloží a zobrazí', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-INE`;
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	const pridatForm = page.getByTestId('pridat-riadok');
	await pridatForm.getByTestId('manual-popis').fill('ATYP bronz');
	// zvoľ „iné sklo" → odkryje vlastný typ + cenu
	await pridatForm.getByTestId('manual-typ').selectOption('__ine__');
	await waitHydrated(page);
	await pridatForm.getByTestId('manual-ine-typ').fill('lepené 33.1 bronz');
	await pridatForm.getByTestId('manual-ine-cena').fill('55.50');
	await pridatForm.getByTestId('manual-sirka').fill('1000');
	await pridatForm.getByTestId('manual-vyska').fill('500');
	await pridatForm.getByTestId('manual-pocet').fill('2');
	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	// riadok pod „Pridané položky" nesie manuálny typ + cenu (badge)
	await expect(page.getByRole('heading', { name: 'Pridané položky' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.locator('td').nth(0)).toContainText('ATYP bronz');
	await expect(riadok).toContainText('lepené 33.1 bronz');
	await expect(riadok).toContainText('55.50');
	// #576: aj picker riadka je zoskupený — „iné sklo" je posledná skupina
	const riadokOptgroupy = riadok.locator('select.typ-select optgroup');
	await expect(riadokOptgroupy.last()).toHaveAttribute('label', 'Iné sklo');

	expect(consoleMsgs).toEqual([]);
});

// #576 (Marek D., Odoo úloha 1180): výber „Typ skla" nie je plochý zoznam ~99 typov — typy sú v
// `<optgroup>` podľa druhu skla, „iné sklo" je posledná skupina, žiadna hodnota sa neopakuje a
// každý typ je v niektorej skupine. RELAČNÉ (počet typov aj skupiny závisia od Odoo / lokálneho
// fallbacku — žiadny PROD literál). Len čítanie (podklad sa neukladá) → beží aj proti nasadeniu.
test('objednávka skla: výber typu skla je zoskupený podľa druhu (#576)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await goto(page, `/objednavka-skla/${RUN}-TYPY`);
	const typ = page.getByTestId('pridat-riadok').getByTestId('manual-typ');
	const skupiny = typ.locator('optgroup');
	expect(await skupiny.count()).toBeGreaterThanOrEqual(2);
	await expect(skupiny.last()).toHaveAttribute('label', 'Iné sklo');
	await expect(skupiny.last().locator('option')).toHaveAttribute('value', '__ine__');
	// každá voľba okrem placeholdera je v skupine, a žiadna hodnota nie je dvakrát
	const vsetky = await typ
		.locator('option:not([value=""])')
		.evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
	const vSkupinach = await typ
		.locator('optgroup option')
		.evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
	expect(vSkupinach).toEqual(vsetky);
	expect(new Set(vsetky).size).toBe(vsetky.length);

	expect(consoleMsgs).toEqual([]);
});

// #553: prázdny podklad → vo formulári „Pridať riadok" pri atyp priložíme výkres priamo
// (setInputFiles na `manual-subor`) → riadok sa vloží AJ s prílohou jedným odoslaním a v riadku
// je vidno názov pripnutého súboru. Money-NEUTRÁLNE (objednávka u dodávateľa). Zero-console.
test('objednávka skla: atyp riadok + výkres jedným krokom vo formulári „Pridať riadok"', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-VYKRES`;
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	const pridatForm = page.getByTestId('pridat-riadok');
	await expect(pridatForm).toBeVisible();

	await pridatForm.getByTestId('manual-popis').fill('ATYP podľa výkresu');
	const typSelect = pridatForm.getByTestId('manual-typ');
	const prva = typSelect.locator('option:not([value=""])').first();
	await typSelect.selectOption((await prva.getAttribute('value'))!);
	await pridatForm.getByTestId('manual-sirka').fill('1000');
	await pridatForm.getByTestId('manual-vyska').fill('700');
	await pridatForm.getByTestId('manual-pocet').fill('1');
	await pridatForm.getByTestId('manual-rezim').selectOption('atyp');

	// výkres priložíme priamo vo formulári (minimálny PDF ako fixture bez súboru na disku)
	const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
	await pridatForm.getByTestId('manual-subor').setInputFiles({
		name: 'vykres-553.pdf',
		mimeType: 'application/pdf',
		buffer: pdfBytes
	});

	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	// riadok pod „Pridané položky" rovno ukazuje pripnutý súbor (stĺpec Prílohy)
	await expect(page.getByRole('heading', { name: 'Pridané položky' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.locator('td').nth(0)).toContainText('ATYP podľa výkresu');
	await expect(riadok).toContainText('vykres-553.pdf');

	expect(consoleMsgs).toEqual([]);
});

// #565: Patrik (Odoo úloha 1051) — atyp s priloženým výkresom BEZ šírky/výšky (výkres má 9
// lichobežníkových tabúľ, jeden rozmer neexistuje). Prehliadač nesmie blokovať odoslanie
// („Vyplňte toto pole"); riadok sa vloží s prílohou a v stĺpci rozmer ukáže „podľa výkresu",
// m² prázdne. Money-NEUTRÁLNE (objednávka u dodávateľa). Zero-console.
test('objednávka skla: atyp s výkresom bez šírky/výšky → riadok „podľa výkresu"', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-ATYPBEZ`;
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	const pridatForm = page.getByTestId('pridat-riadok');
	const typSelect = pridatForm.getByTestId('manual-typ');
	const prva = typSelect.locator('option:not([value=""])').first();
	await typSelect.selectOption((await prva.getAttribute('value'))!);
	await pridatForm.getByTestId('manual-rezim').selectOption('atyp');
	// pri atype sú rozmery nepovinné (hint) — polia necháme PRÁZDNE
	await expect(pridatForm.getByTestId('manual-sirka')).not.toHaveAttribute('required', '');
	await expect(pridatForm.getByTestId('manual-vyska')).not.toHaveAttribute('required', '');
	await expect(pridatForm.getByTestId('manual-rozmery-hint')).toBeVisible();

	const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
	await pridatForm.getByTestId('manual-subor').setInputFiles({
		name: 'vykres-565.pdf',
		mimeType: 'application/pdf',
		buffer: pdfBytes
	});

	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	await expect(page.getByRole('heading', { name: 'Pridané položky' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok).toContainText('vykres-565.pdf');
	await expect(riadok).toContainText('podľa výkresu');
	await expect(riadok).not.toContainText('0 × 0');
	await expect(page.getByTestId('manual-chyba')).toHaveCount(0);

	// späť na režim rozmery → polia sú opäť povinné
	await pridatForm.getByTestId('manual-rezim').selectOption('rozmery');
	await expect(pridatForm.getByTestId('manual-sirka')).toHaveAttribute('required', '');

	expect(consoleMsgs).toEqual([]);
});

/** Ručný riadok cez formulár „Pridať riadok" na podklade (typ = prvá reálna možnosť pickera). */
async function pridajRucnyRiadok(page: Page, popis: string) {
	const f = page.getByTestId('pridat-riadok');
	await f.getByTestId('manual-popis').fill(popis);
	const typ = f.getByTestId('manual-typ');
	const prva = typ.locator('option:not([value=""])').first();
	await expect(prva).toBeAttached();
	await typ.selectOption((await prva.getAttribute('value'))!);
	await f.getByTestId('manual-sirka').fill('600');
	await f.getByTestId('manual-vyska').fill('700');
	await f.getByTestId('manual-pocet').fill('1');
	await f.getByTestId('manual-pridat').click();
	await waitHydrated(page);
	await expect(page.locator('tbody tr', { hasText: popis })).toBeVisible();
}

// #571 (PROD 25.9.): podklad je kľúčovaný číslom zákazky → skúšobný názov („test") zdieľa podklad
// viacerých používateľov. Reálny tok DVOCH účtov: kolega (nový interný účet) pridá riadok na
// zákazku → `e2e` na tom istom podklade vidí banner s autorom + dnešným dátumom (Europe/Bratislava),
// aj pri formulári „Pridať riadok"; jeho pridanie (ručné aj zo zasklení) NEblokuje a zasklenia
// potvrdenie nesie to isté upozornenie. Kolega na svojom podklade banner nemá. Upratanie účtu
// kolegu je vo `finally` (interný účet sa z UI zmazať nedá — najprv B2B). Zero-console.
test('objednávka skla: riadky iného používateľa → upozornenie, pridanie neblokuje (#571)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri zmene roly aj pri Zmazať
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-CUDZIE`;
	const kolega = `e2e-kolega-${Date.now().toString(36)}`;
	const kolegaPass = 'e2eheslo1';

	// 1. e2e založí interný účet kolegu
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(kolega);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(kolegaPass);
	await page.getByLabel('Rola').selectOption('internal');
	try {
		await page.getByRole('button', { name: 'Pridať účet' }).click();
		await expect(page.getByTestId('pouzivatelia-ok')).toContainText('Interný');

		// 2. kolega pridá riadok na zákazku — vlastný podklad, žiadne upozornenie
		await logout(page);
		await loginAs(page, kolega, kolegaPass);
		await goto(page, `/objednavka-skla/${zak}`);
		await pridajRucnyRiadok(page, 'E2E 571 kolega');
		await expect(page.getByTestId('cudzie-riadky')).toHaveCount(0);
		await expect(page.getByTestId('cudzie-riadky-pridat')).toHaveCount(0);
		// dátum vzniku riadka = dnes v Europe/Bratislava (NIE UTC) — ten istý formátovač ako appka
		const text = `Táto zákazka už obsahuje 1 riadok od ${kolega} (${formatDatumSk(new Date().toISOString())}) — pridávaš do existujúceho podkladu`;

		// 3. e2e na TOM ISTOM podklade → banner hore aj pri formulári „Pridať riadok"
		await logout(page);
		await loginAs(page);
		await goto(page, `/objednavka-skla/${zak}`);
		await expect(page.getByTestId('cudzie-riadky')).toHaveText(text);
		await expect(page.getByTestId('pridat-riadok').getByTestId('cudzie-riadky-pridat')).toHaveText(
			text
		);

		// 4. ručné pridanie NEblokuje — riadok e2e pribudne, kolegov ostane, upozornenie ostáva
		await pridajRucnyRiadok(page, 'E2E 571 e2e');
		await expect(page.locator('tbody tr', { hasText: 'E2E 571 kolega' })).toBeVisible();
		await expect(page.getByTestId('cudzie-riadky')).toHaveText(text);

		// 5. zasklenia „Pridať sklá" na tú istú zákazku → sklá pridané + to isté upozornenie
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E 571');
		await page.getByLabel('Šírka (mm) *').fill('3000');
		await page.getByLabel('Výška (mm) *').fill('2200');
		await page.getByLabel('Systém').selectOption('Robust');
		await page.getByLabel('Štýl').selectOption('2K');
		await vyberFarbuKovania(page);
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await waitHydrated(page);
		await page.getByTestId('pridat-skla').click();
		await waitHydrated(page);
		await expect(page.getByTestId('skla-pridane')).toContainText('Sklá pridané do objednávky');
		await expect(page.getByTestId('skla-pridane-cudzie')).toContainText(text);
	} finally {
		// 6. upratanie účtu kolegu aj pri páde (interný je nezmazateľný → najprv B2B, potom Zmazať)
		await page.context().clearCookies();
		await loginAs(page);
		await goto(page, '/pouzivatelia');
		const row = page.locator('tr', { hasText: kolega });
		if ((await row.count()) > 0) {
			await row.locator('select[name="role"]').selectOption('b2b');
			await row.getByRole('button', { name: 'Zmeniť' }).click();
			await expect(page.getByTestId('pouzivatelia-ok')).toContainText('B2B');
			await row.getByRole('button', { name: 'Zmazať' }).click();
			await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
		}
	}

	expect(consoleMsgs).toEqual([]);
});
