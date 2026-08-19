// Pergola — materiál/nárez z rozmerov (#155). Všetko ČÍTACIE — modul do Money nič
// nezapisuje, dá sa pustiť aj proti nasadenej appke (BASE_URL). Zero console errors
// (browser-console-zero-errors) chytí aj $effect self-loop (nova-stranka §3).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('formulár → materiál: Massive (NIE prvý systém) prežije, predná noha 2215, nepodporované', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// §3 (nova-stranka): vyber NEPRVÝ systém (Massive; prvý je Robust) — ak by
	// reštart-effect ticho revertoval, materiál by vyšiel na Robust 18013, nie 18017
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#pocetPrednychNoh').fill('4');
	// predná svetlosť ostáva default 2200
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// systém prežil výber (Massive stĺp 18017, nie Robust 18013)
	await expect(page.getByTestId('narez-nadpis')).toContainText('Massive');
	const massiveNoha = page.getByTestId('polozka-18017');
	await expect(massiveNoha).toBeVisible();
	await expect(massiveNoha).toContainText('2215'); // 2200 + 15 (ZAK2026302)
	await expect(massiveNoha).toContainText('predná noha');
	await expect(page.getByTestId('polozka-18013')).toHaveCount(0);

	// priečka (18004) prítomná s počtom, dĺžka „—" (= HH krovu, #161 neodvoditeľné) (#205)
	await expect(page.getByTestId('polozka-18004')).toContainText('HH krovu');
	// #205: žľab (18018) + kotviaci (18019) TERAZ vo vypocitane = šírka 5760, výdaj na 6 m
	await expect(page.getByTestId('polozka-18018')).toContainText('5760');
	await expect(page.getByTestId('vydaj-18018')).toContainText('(6 m)');
	await expect(page.getByTestId('polozka-18019')).toContainText('5760');

	// informatívne: výstuha = 5760 − 280 = 5480
	await expect(page.getByTestId('vystuha-rez')).toContainText('5480');

	// zatiaľ nepodporované — krov (ticket 161), lišty (HH krovu), sklá vypísané, nič sa nehádže
	const nepodp = page.getByTestId('narez-nepodporovane');
	await expect(nepodp).toContainText('Krov');
	await expect(nepodp).toContainText('161');
	await expect(nepodp).toContainText('Sklá');

	// #195 — komponenty (spojky, krytky): Massive typy prítomné, počty honest-null „—",
	// Robust-only komponent (zakladacia lišta) sa NEzobrazí (per-systém filter)
	const komp = page.getByTestId('komponenty-tabulka');
	await expect(komp).toBeVisible();
	await expect(komp).toContainText('Spojka U');
	await expect(komp).toContainText('Krytka zadná roh');
	await expect(komp).toContainText('24007'); // CAD kód rámovej lišty (informatívny)
	await expect(komp).not.toContainText('Zakladacia lišta'); // Robust-only
	// počet honest-null: KAŽDÁ bunka počtu (5 typov Massive) = „—" (nie len „niekde v tabuľke")
	const pocty = page.getByTestId('komponent-pocet');
	await expect(pocty).toHaveCount(5);
	for (let i = 0; i < 5; i++) await expect(pocty.nth(i)).toHaveText('—');

	expect(consoleMsgs).toEqual([]);
});

test('Robust: komponenty = zakladacia lišta + krytka vrchná; Massive typy (spojka U) skryté (#195)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// Robust je default systém — necháme ho, len vyplníme rozmery a spočítame
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	const komp = page.getByTestId('komponenty-tabulka');
	await expect(komp).toBeVisible();
	await expect(komp).toContainText('Zakladacia lišta');
	await expect(komp).toContainText('Krytka vrchná');
	// Massive-only typy sa pri Robuste NEzobrazia (per-systém filter)
	await expect(komp).not.toContainText('Spojka U');
	await expect(komp).not.toContainText('Krytka zadná roh');
	// počet honest-null: obe Robust bunky počtu = „—"
	const pocty = page.getByTestId('komponent-pocet');
	await expect(pocty).toHaveCount(2);
	for (let i = 0; i < 2; i++) await expect(pocty.nth(i)).toHaveText('—');

	expect(consoleMsgs).toEqual([]);
});

test('samostatne stojaca (OP260282): zadná noha = plná ZV 2790 + bočný 110×43 pod fixom 3220', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// na stenu (default) → zadné-nohy polia skryté
	await expect(page.getByTestId('zadne-nohy-box')).toHaveCount(0);

	// Vstupy reálnej zákazky OP260282 (massive, samostatne stojaca, zadná konštrukcia 110)
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('4990');
	await page.locator('#hlbka').fill('3470');
	await page.locator('#uchytenie').selectOption('samostatne');
	await expect(page.getByTestId('zadne-nohy-box')).toBeVisible();
	await page.locator('#vyskaZadna').fill('2790');
	await page.locator('#pocetZadnychNoh').fill('4');
	await page.locator('#hornyProfilZadnej').selectOption('110');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// #205 task 3: zadná noha = PLNÁ ZV = 2790 (nie ZV−profil), profil systému 18017
	await expect(page.getByTestId('narez-tabulka')).toContainText('zadná noha');
	await expect(page.getByTestId('narez-tabulka')).toContainText('2790 mm');
	// #205 task 1: bočný 110×43 „pod fixom" = hĺbka − (140+110) = 3220
	await expect(page.getByTestId('narez-tabulka')).toContainText('pod fixom');
	await expect(page.getByTestId('narez-tabulka')).toContainText('3220 mm');

	expect(consoleMsgs).toEqual([]);
});

test('← Späť a upraviť: vstup prežije (systém aj šírka), nevynuluje sa (nova-stranka §4)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await page.getByTestId('upravit').click();
	await waitHydrated(page);
	await expect(page.locator('#system')).toHaveValue('Massive');
	await expect(page.locator('#sirka')).toHaveValue('5760');
	expect(consoleMsgs).toEqual([]);
});

test('neplatná šírka cez UI: prejdeme priamo (HTML5), ale server chytí extrémnu hodnotu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');
	await page.locator('#sirka').fill('10'); // pod SIRKA_MIN
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('form-error')).toContainText(/šírka/i);
	expect(consoleMsgs).toEqual([]);
});

test('odkaz z /pergola → /pergola/narez funguje, Money odpis formulár ostáva nedotknutý', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola');
	// pôvodný CAD nárez → Money formulár je stále na svojom mieste
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toBeVisible();
	const link = page.getByTestId('link-narez');
	await expect(link).toBeVisible();
	await link.click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/narez$/);
	await expect(page.getByRole('heading', { name: 'Rezervačný odpis — pergola' })).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

// --- Technický výkres z rozmerov (#194) ----------------------------------------
test('výkres: predný pohľad + bokorys + pôdorys sa vykreslia z potvrdených rozmerov, krov → #161, console-zero', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#hlbka').fill('3690');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// výkresový hárok + tri pohľady
	await expect(page.getByTestId('vykresovy-harok')).toBeVisible();
	await expect(page.getByTestId('pnr-predny-pohlad')).toHaveCount(1);
	await expect(page.getByTestId('pnr-bokorys')).toHaveCount(1);
	await expect(page.getByTestId('pnr-podorys')).toHaveCount(1);

	// 4 predné nohy nakreslené v prednom pohľade AJ v pôdoryse (osovo zarovnané rects
	// — počítame prítomnosť, NIE toBeVisible; vykres.md)
	await expect(page.getByTestId(/^pnr-fe-noha-\d+$/)).toHaveCount(4);
	await expect(page.getByTestId(/^pnr-pod-predna-noha-\d+$/)).toHaveCount(4);

	// na stenu (default): pôdorys má čiaru steny, žiadne zadné nohy
	await expect(page.getByTestId('pnr-pod-stena')).toHaveCount(1);
	await expect(page.getByTestId(/^pnr-pod-zadna-noha-\d+$/)).toHaveCount(0);

	// krov je zjednodušený s poznámkou → #161, NIKDY sa nehádže sklon
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('#161');
	await expect(page.getByTestId('pnr-bok-krov-pozn')).toContainText('#161');

	// spec ukazuje potvrdené hodnoty (systém, rozostup nôh 1920) + display-only
	await expect(page.getByTestId('pnr-spec-nohy')).toContainText('1920');
	await expect(page.getByTestId('pnr-spec-money')).toContainText('/pergola');

	expect(consoleMsgs).toEqual([]);
});

test('výkres samostatne stojaca: zadné nohy sa objavia v bokoryse aj pôdoryse (výška 2900)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('3');
	await page.locator('#uchytenie').selectOption('samostatne');
	await page.locator('#vyskaZadna').fill('2900');
	await page.locator('#pocetZadnychNoh').fill('3');
	await page.locator('#hornyProfilZadnej').selectOption('140');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// zadné nohy nakreslené: bokorys (1 profil) + pôdorys (3 štvorčeky), žiadna stena
	await expect(page.getByTestId('pnr-bok-zadna-noha')).toHaveCount(1);
	await expect(page.getByTestId(/^pnr-pod-zadna-noha-\d+$/)).toHaveCount(3);
	await expect(page.getByTestId('pnr-pod-stena')).toHaveCount(0);
	// strecha (zjednodušený obrys) sa kreslí len pri samostatne stojacej
	await expect(page.getByTestId('pnr-bok-strecha')).toHaveCount(1);
	// #205: spec ukazuje zadnú nohu 2900 = plná ZV (výkres OP260282), nie ZV − horný profil
	await expect(page.getByTestId('pnr-spec-uchytenie')).toContainText('2900');

	expect(consoleMsgs).toEqual([]);
});

// --- Krov uloženie (#161) — potvrdené vzorce prahu 7° --------------------------
test('krov uloženie 8°: karta aj výkres ukážu potvrdené hodnoty (ps=0.52, lv=0.66), frézovanie ostáva #161', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.locator('#sklonStrechy').fill('8'); // verifikačný vektor
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// výstupná karta — potvrdené uloženie
	const karta = page.getByTestId('krov-ulozenie');
	await expect(karta).toBeVisible();
	await expect(karta).toContainText('dva dotyky'); // > 7° režim
	await expect(page.getByTestId('krov-ps')).toContainText('0.52'); // ps=ls
	await expect(page.getByTestId('krov-lv')).toContainText('0.66'); // lv=pv

	// výkres — uloženie detail nahradil generickú poznámku
	await expect(page.getByTestId('pnr-krov-ulozenie')).toContainText('ULOŽENIE');
	await expect(page.getByTestId('pnr-krov-ulozenie-hodnoty')).toContainText('0,52');
	await expect(page.getByTestId('pnr-krov-ulozenie-hodnoty')).toContainText('0,66');
	await expect(page.getByTestId('pnr-krov-trojuholnik')).toHaveCount(1);
	// frézovanie (výrobný list) STÁLE nepodporované → #161
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('#161');
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('frézovanie');
	// bokorys poznámka odkazuje na uloženie, stále nesie #161
	await expect(page.getByTestId('pnr-bok-krov-pozn')).toContainText('#161');

	expect(consoleMsgs).toEqual([]);
});

test('krov uloženie pod 7° (5°): čestne „nepodporované" (O5), nič sa nehádže, výkres ostáva placeholder', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#sklonStrechy').fill('5'); // pod prahom 7°
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// karta hlási nepodporované, žiadne vymyslené hodnoty
	await expect(page.getByTestId('krov-nepodporovane')).toContainText('pod prahom 7°');
	await expect(page.getByTestId('krov-ulozenie')).toHaveCount(0);
	// výkres ostáva čestný placeholder → #161 (nie uloženie detail)
	await expect(page.getByTestId('pnr-krov-ulozenie')).toHaveCount(0);
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('#161');

	expect(consoleMsgs).toEqual([]);
});

// --- #204 — tenšie čiary v pohľadoch (CAD cut/view konvencia) -------------------
test('#204 výkres: pohľadové čiary (nohy/steny) sú tenké, rezová čiara (žľab/obrys) hrubšia', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	const num = async (testid: string) =>
		parseFloat((await page.getByTestId(testid).first().getAttribute('stroke-width')) ?? 'NaN');

	const noha = await num('pnr-fe-noha-0'); // pohľadová čiara (view line)
	const zlab = await num('pnr-fe-zlab'); // rezová čiara (cut line)
	const podObrys = await num('pnr-pod-obrys'); // hlavný obrys (rez)

	// pohľadová čiara nohy je TENKÁ — výrazne pod pôvodnou 1.2 („cez skicár")
	expect(noha).toBeLessThanOrEqual(0.35);
	expect(noha).toBeLessThan(1.2);
	// rezová/obrysová čiara ostáva vizuálne ODLÍŠENÁ (hrubšia) než pohľadová, ale stále
	// tenká technická (≤ REZ_STROKE 0.5) — CAD konvencia cut line vs view line
	expect(zlab).toBeGreaterThan(noha);
	expect(zlab).toBeLessThanOrEqual(0.5);
	expect(podObrys).toBeGreaterThan(noha);
	expect(podObrys).toBeLessThanOrEqual(0.5);

	expect(consoleMsgs).toEqual([]);
});

// --- #205/#207 — materiál z výkresu OP260282 (odvoditeľné riadky + výdaj tyčí) ---
test('#205 OP260282 materiál: žľab/kotviaci = šírka 4990 na 6 m tyče, výstuha 4710, priečka „—"', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// vstupy zákazky OP260282: Massive 140, samostatne stojaca, výstuha 140×140
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('4990');
	await page.locator('#hlbka').fill('3470');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.locator('#uchytenie').selectOption('samostatne');
	await page.locator('#vyskaZadna').fill('2790');
	await page.locator('#pocetZadnychNoh').fill('4');
	await page.locator('#hornyProfilZadnej').selectOption('140');
	await page.locator('#zosilnenyNosnik').check();
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// žľab (18018) = 4990, výdaj 1×(6 m)
	await expect(page.getByTestId('polozka-18018')).toContainText('4990');
	await expect(page.getByTestId('vydaj-18018')).toContainText('1×(6 m)');
	// kotviaci (18019) = 4990, výdaj 1×(6 m)
	await expect(page.getByTestId('polozka-18019')).toContainText('4990');
	await expect(page.getByTestId('vydaj-18019')).toContainText('1×(6 m)');
	// výstuha horná (18017, massive) = 4990 − 280 = 4710
	await expect(page.getByTestId('narez-tabulka')).toContainText('4710');
	// priečka (18004) dĺžka „—" (HH krovu neodvoditeľné) — nič sa nehádže
	await expect(page.getByTestId('polozka-18004')).toContainText('HH krovu');
	// nepodporované vypisuje HH-krovu + zvislú zadnú výstuhu (18016 pod fixom je už vo vypocitane)
	await expect(page.getByTestId('narez-nepodporovane')).toContainText('HH krovu');

	expect(consoleMsgs).toEqual([]);
});

// --- #206 — nové voľby z výkresu OP260282 (a/b/c/d/e) ---------------------------
test('#206 (b) stena zasklená: bočný 110×43 pod kotviacim = ZV − 190 (2790 → 2600)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	// ZV pole je viditeľné pri stena + zasklená (pre bočný 110×43 pod kotviacim)
	await page.locator('#vyskaZadna').fill('2790');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// stena + zasklená má DVA riadky 18016 (pod fixom + pod kotviacim) → disambiguuj názvom.
	// (b) POTVRDENÝ vzorec: 110×43 pod kotviacim = 2790 − 190 = 2600, 2 ks
	const podKotviacim = page.getByTestId('polozka-18016').filter({ hasText: 'pod kotviacim' });
	await expect(podKotviacim).toContainText('2600');
	await expect(podKotviacim).toContainText('pod kotviacim');
	// #205: pod fixom (massive stena) = hĺbka − (140+43) = 3500 − 183 = 3317
	const podFixom = page.getByTestId('polozka-18016').filter({ hasText: 'pod fixom' });
	await expect(podFixom).toContainText('3317');

	expect(consoleMsgs).toEqual([]);
});

test('#206 (a) jednoduchá bez zasklenia: bočný 110×43 zmizne, ZV pole sa skryje', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	// zapni „jednoduchá pergola bez zasklenia" → ZV pole sa skryje (nepoužíva sa)
	await page.locator('#jednoduchaBezZasklenia').check();
	await expect(page.locator('#vyskaZadna')).toHaveCount(0);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// (a) bočný 110×43 sa nepočíta; evidencia v „nepodporované"
	await expect(page.getByTestId('polozka-18016')).toHaveCount(0);
	await expect(page.getByTestId('narez-nepodporovane')).toContainText('bez zasklenia');

	expect(consoleMsgs).toEqual([]);
});

test('#206 (c) výstuha 200×140: svetlosť −60 → predná noha 2155 (2200 − 60 + 15)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('4');
	// predná svetlosť ostáva default 2200
	await page.locator('#vystuhaProfil').selectOption('200x140');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// predná noha (18017) = (2200 − 60) + 15 = 2155
	await expect(page.getByTestId('polozka-18017')).toContainText('2155');
	// efektívna svetlosť = 2140 (informatívne)
	await expect(page.getByTestId('info-efektivna-svetlost')).toContainText('2140');
	await expect(page.getByTestId('info-vystuha-profil')).toContainText('200x140');
	// výkres spec ukazuje profil výstuhy + −60 poznámku
	await expect(page.getByTestId('pnr-spec-vystuha')).toContainText('200x140');

	expect(consoleMsgs).toEqual([]);
});

test('#206 (d)+(e) zvod frézovanie + sklá: v karte údajov aj vo výkrese', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	// (d) zvod frézovanie
	await page.locator('#zvodFrezovat').check();
	await page.locator('#zvodFrezovanieSHmm').fill('120');
	// (e) sklá
	await page.locator('#strechaSklo').fill('4-4-2číre-8-6stopsol classic grey');
	await page.locator('#obvodoveZasklenie').fill('RS STANDARD PLUS 4-8-4číre');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// karta údajov zákazky
	const udaje = page.getByTestId('narez-udaje-zakazky');
	await expect(udaje).toContainText('4-4-2číre-8-6stopsol classic grey');
	await expect(udaje).toContainText('RS STANDARD PLUS 4-8-4číre');
	await expect(udaje).toContainText('120 mm');
	// výkres spec anotácie
	await expect(page.getByTestId('pnr-spec-strechasklo')).toContainText('stopsol');
	await expect(page.getByTestId('pnr-spec-zvod')).toContainText('120');

	expect(consoleMsgs).toEqual([]);
});
