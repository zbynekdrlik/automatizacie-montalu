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

	// priečka (18004) prítomná s počtom, dĺžka honest-null (bez zadaného počtu krovov sa nominál
	// nepočíta — #161 lane): nová kópia „nominálna dĺžka krovu — zatiaľ sa nepočíta" (#205)
	await expect(page.getByTestId('polozka-18004')).toContainText('Priečkový profil 105');
	await expect(page.getByTestId('polozka-18004')).toContainText('zatiaľ sa nepočíta');
	// #205: žľab (18018) + kotviaci (18019) TERAZ vo vypocitane = šírka 5760, výdaj na 6 m
	await expect(page.getByTestId('polozka-18018')).toContainText('5760');
	await expect(page.getByTestId('vydaj-18018')).toContainText('(6 m)');
	await expect(page.getByTestId('polozka-18019')).toContainText('5760');

	// informatívne: výstuha = 5760 − 280 = 5480
	await expect(page.getByTestId('vystuha-rez')).toContainText('5480');

	// zatiaľ nepodporované — krov, lišty, sklá vypísané, nič sa nehádže (#233 — plain text)
	const nepodp = page.getByTestId('narez-nepodporovane');
	await expect(nepodp).toContainText('Krov');
	await expect(nepodp).toContainText('vzorec');
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

test('samostatne stojaca (OP260282): zadná noha = ZV − profil 110 = 2680 + bočný 110×43 pod fixom 3220', async ({
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

	// #316: zadná noha = ZV − horný profil = 2790 − 110 = 2680 (kód 18013/110×110), Dominik 24.8.
	await expect(page.getByTestId('narez-tabulka')).toContainText('zadná noha');
	await expect(page.getByTestId('narez-tabulka')).toContainText('2680 mm');
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
	await expect(page.getByRole('heading', { name: 'Pergola z appky' })).toBeVisible();
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

	// krov je zjednodušený s poznámkou (#233 — plain text, žiadne #N), NIKDY sa nehádže sklon
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('konštruktér');
	await expect(page.getByTestId('pnr-bok-krov-pozn')).toContainText('konštruktér');

	// spec ukazuje potvrdené hodnoty (systém, rozostup nôh 1920) + display-only
	await expect(page.getByTestId('pnr-spec-nohy')).toContainText('1920');
	await expect(page.getByTestId('pnr-spec-money')).toContainText('/pergola');

	// #381 — výrobná varianta na stenu BEZ zadaného počtu krovov: 2 pozičné balóniky (predná
	// noha + žľab; zadná noha aj priečka sú honest-null → balónik sa nekreslí). Priečky ani
	// reťazová kóta sa BEZ potvrdeného počtu krovov NEKRESLIA (honest-null — schematické
	// delenie sa do výrobných kót nedáva). Montážne tolerancie hĺbky (CAD konštanty) + Poz.
	await expect(page.getByTestId(/^pnr-poz-\d+$/)).toHaveCount(2);
	await expect(page.getByTestId('pnr-pod-priecky')).toHaveCount(0);
	await expect(page.getByTestId('pnr-pod-retaz')).toHaveCount(0);
	await expect(page.getByTestId('pnr-spec-tolerancie')).toContainText('montáž');
	await expect(page.getByTestId('pnr-spec-tolerancie')).toContainText('+2 / +3 / +12');
	await expect(page.getByTestId('poz-1')).toBeVisible();

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
	// #381 — zadaný počet krovov odblokuje POTVRDENÉ priečky + reťazovú kótu v pôdoryse
	await page.locator('#pocetKrovov').fill('8');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// zadné nohy nakreslené: bokorys (1 profil) + pôdorys (3 štvorčeky), žiadna stena
	await expect(page.getByTestId('pnr-bok-zadna-noha')).toHaveCount(1);
	await expect(page.getByTestId(/^pnr-pod-zadna-noha-\d+$/)).toHaveCount(3);
	await expect(page.getByTestId('pnr-pod-stena')).toHaveCount(0);
	// strecha (zjednodušený obrys) sa kreslí len pri samostatne stojacej
	await expect(page.getByTestId('pnr-bok-strecha')).toHaveCount(1);
	// #316: spec ukazuje CUT dĺžku zadnej nohy = ZV − horný profil = 2900 − 140 = 2760 (Dominik 24.8.)
	await expect(page.getByTestId('pnr-spec-uchytenie')).toContainText('2760');

	// #381 — samostatne stojaca so ZADANÝM počtom krovov (8): 4 pozičné balóniky (predná +
	// zadná noha + priečka + žľab). Priečky v pôdoryse = POTVRDENÝ počet krovov (8 čiar,
	// NIE schematické delenie), reťazová kóta ich rozstupov sa vykreslí, montážne tolerancie.
	await expect(page.getByTestId(/^pnr-poz-\d+$/)).toHaveCount(4);
	await expect(page.getByTestId('pnr-pod-priecky').locator('line')).toHaveCount(8);
	await expect(page.getByTestId('pnr-pod-retaz').locator('text')).not.toHaveCount(0);
	await expect(page.getByTestId('pnr-spec-tolerancie')).toContainText('+2 / +3 / +12');

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
	// frézovanie (výrobný list) STÁLE nepodporované (#233 — plain text)
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('konštruktér');
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('frézovanie');
	// bokorys poznámka odkazuje na uloženie (plain text, žiadne #N)
	await expect(page.getByTestId('pnr-bok-krov-pozn')).toContainText('uloženie');

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
	// výkres ostáva čestný placeholder (#233 — plain text, nie uloženie detail)
	await expect(page.getByTestId('pnr-krov-ulozenie')).toHaveCount(0);
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('konštruktér');

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
	// #155 A9 (Dominik): predná noha = svetlosť 2200 + výstuha 140 = 2340 (nie starý „vždy +15" = 2215)
	await expect(page.getByTestId('narez-tabulka')).toContainText('2340');
	// priečka (18004) dĺžka honest-null (bez počtu krovov sa nominál nepočíta) — nič sa nehádže
	await expect(page.getByTestId('polozka-18004')).toContainText('Priečkový profil 105');
	await expect(page.getByTestId('polozka-18004')).toContainText('zatiaľ sa nepočíta');
	// nepodporované vypisuje priečku (18004) — dĺžka = nominálna dĺžka krovu sa zatiaľ nepočíta
	// (18016 pod fixom je vo vypocitane; „zvislá zadná výstuha" 2340 rekonciliovaná na prednú nohu — A9)
	await expect(page.getByTestId('narez-nepodporovane')).toContainText('Priečka (18004)');
	await expect(page.getByTestId('narez-nepodporovane')).toContainText('zatiaľ sa nepočíta');

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

test('#155 výstuha 200×140 + zosilnenie: noha = svetlosť + 200 (2400), svetlosť bez výstuhy 2385', async ({
	page
}) => {
	// Model 1731729 (Dominik 24.8.): výstuha skovaná 15 mm v žľabe, trčí zvyšok do svetlosti →
	// noha = svetlosť + zvislý rozmer výstuhy (200×140 → +200); bývalý −60 model odvolaný.
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('4');
	// predná svetlosť ostáva default 2200
	await page.locator('#zosilnenyNosnik').check();
	await page.locator('#vystuhaProfil').selectOption('200x140');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// predná noha (18017) = 2200 + 200 = 2400 (všeobecné pravidlo, žiadny −60)
	await expect(page.getByTestId('polozka-18017')).toContainText('2400');
	// svetlosť bez výstuhy = 2200 + trčanie 185 = 2385 (informatívne)
	await expect(page.getByTestId('info-svetlost-bez-vystuhy')).toContainText('2385');
	await expect(page.getByTestId('info-vystuha-profil')).toContainText('200x140');
	// výkres spec ukazuje profil výstuhy
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

// --- #161 KROV cut-list (derivácia 21.8. overená proti golden OP260282) ---------------
test('#161 krov cut-list (OP260282): počet krovov 8 → svetlosť 655,43, priečka nominál 3239,76, prítlačná 3279,76, zaklapávacia 14 ks', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// vstupy golden OP260282 + manuálny počet krovov = 8 (Dominik zadá)
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('4990');
	await page.locator('#hlbka').fill('3470');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.locator('#uchytenie').selectOption('samostatne');
	await page.locator('#vyskaZadna').fill('2790');
	await page.locator('#pocetZadnychNoh').fill('4');
	await page.locator('#hornyProfilZadnej').selectOption('110');
	await page.locator('#zosilnenyNosnik').check();
	await page.locator('#sklonStrechy').fill('6.1');
	await page.locator('#pocetKrovov').fill('8');

	// živý náhľad svetlosti v formulári (Dominik podľa nej pridá/uberie krov)
	await expect(page.getByTestId('svetlost-hint')).toContainText('655,43');

	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// priečka (18004) = NOMINÁL krovu (spodná hrana), NIE „—" — teraz ide do rezervácie (✅)
	const priecka = page.getByTestId('polozka-18004');
	await expect(priecka).toContainText('3239'); // ~3239,76
	await expect(priecka).toContainText('✅ v odpise');
	// prítlačná/maskovacie = nominál + 40 = 3279,76
	await expect(page.getByTestId('polozka-18006')).toContainText('3279');
	await expect(page.getByTestId('polozka-18007')).toContainText('3279');
	await expect(page.getByTestId('polozka-18008')).toContainText('3279');
	// zaklapávacia (18005) = svetlosť 655,43
	await expect(page.getByTestId('polozka-18005')).toContainText('655');

	// informatívne: počet krovov + svetlosť medzi krovmi
	await expect(page.getByTestId('info-pocet-krovov')).toContainText('8');
	await expect(page.getByTestId('info-svetlost-krovov')).toContainText('655,43');

	expect(consoleMsgs).toEqual([]);
});

// --- #415 prítlačná lišta (Robust): prídavok potvrdený, odpočet krovu ostáva samostatne na potvrdenie ---
test('#415 Robust prítlačná lišta: poznámka hovorí „prídavok … potvrdený", odpočet krovu ostáva „na potvrdenie" samostatne', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('4990');
	await page.locator('#hlbka').fill('3470');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.locator('#uchytenie').selectOption('samostatne');
	await page.locator('#vyskaZadna').fill('2790');
	await page.locator('#pocetZadnychNoh').fill('4');
	await page.locator('#hornyProfilZadnej').selectOption('110');
	await page.locator('#sklonStrechy').fill('6.1');
	await page.locator('#pocetKrovov').fill('8');

	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// prídavok (+30) je teraz opísaný ako potvrdený — appka už nesmie tvrdiť, že čaká
	const pritlacna = page.getByTestId('polozka-18006');
	await expect(pritlacna).toContainText('priamo potvrdený');
	// základná dĺžka krovu (odpočet) je SAMOSTATNÁ, stále neoverená hodnota — výhrada ostáva
	await expect(pritlacna).toContainText('na potvrdenie');

	expect(consoleMsgs).toEqual([]);
});

// --- #223 strešné sklo: výber typu → karta (šírka = svetlosť + 30/34, honest-null dĺžka) ------
test('#223 strešné sklo (OP260282): typ IZO 4.4.2-8-6 číre, n=8 → 7 tabúľ, šírka 685,43, dĺžka „—", kód TS00014', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// šírka + počet krovov určujú svetlosť (655,43); typ určuje prídavok (+30 sklo) + kód
	await page.locator('#sirka').fill('4990');
	await page.locator('#pocetKrovov').fill('8');
	await page.locator('#strechaSkloTyp').selectOption('IZO 4.4.2-8-6 číre');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	const karta = page.getByTestId('strecha-sklo-karta');
	await expect(karta).toBeVisible();
	await expect(page.getByTestId('strecha-sklo-typ')).toContainText('IZO 4.4.2-8-6 číre');
	await expect(page.getByTestId('strecha-sklo-pocet')).toHaveText('7'); // n − 1
	await expect(page.getByTestId('strecha-sklo-sirka')).toContainText('685,43'); // 655,43 + 30
	// dĺžka honest-null „—": default konfigurácia (stena, bez sklonu) nie je overená kotva krovu;
	// dĺžka sa počíta až pri samostatne+110+sklone (viď samostatný #223 test nižšie)
	await expect(page.getByTestId('strecha-sklo-dlzka')).toContainText('—');
	await expect(page.getByTestId('strecha-sklo-kod')).toHaveText('TS00014');

	expect(consoleMsgs).toEqual([]);
});

test('#223 strešné sklo — bez zvoleného typu sa karta NEzobrazí (honest-null)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#sirka').fill('4990');
	await page.locator('#pocetKrovov').fill('8');
	// typ nevybraný (default „— nevybrané —")
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('strecha-sklo-karta')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('#223 strešné sklo — polykarbonát: šírka = svetlosť + 34, kód honest-null (karta v Money neexistuje)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#sirka').fill('4990');
	await page.locator('#pocetKrovov').fill('8');
	await page.locator('#strechaSkloTyp').selectOption('polykarbonát 16 mm číry');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('strecha-sklo-sirka')).toContainText('689,43'); // 655,43 + 34
	await expect(page.getByTestId('strecha-sklo-kod')).toHaveText('—'); // polykarbonát bez TS kódu

	expect(consoleMsgs).toEqual([]);
});

// #223 — POTVRDENÁ dĺžka (Dominik 2.9.): dĺžka hornej hrany krovu + 10/20; emituje sa LEN pre
// overenú konfiguráciu kotvy (samostatne + zadný 110 + sklon). Plná OP260282 konfigurácia →
// masív 3239,76 + 20 = 3259,76 (reálny rez skla 3259 mm), celková plocha 7 tabúľ = 15,64 m².
test('#223 strešné sklo — overená konfigurácia (Massive, samostatne, zadný 110, sklon 6,1°) → dĺžka 3259,76 + plocha 15,64 m²', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('4990');
	await page.locator('#hlbka').fill('3470');
	await page.locator('#uchytenie').selectOption('samostatne');
	// #hornyProfilZadnej sa renderuje AŽ po výbere „samostatne" (podmienené pole) — Playwright
	// locator si naň počká, kým sa objaví.
	await page.locator('#hornyProfilZadnej').selectOption('110');
	await page.locator('#sklonStrechy').fill('6.1');
	await page.locator('#pocetKrovov').fill('8');
	await page.locator('#strechaSkloTyp').selectOption('IZO 4.4.2-8-6 číre');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('strecha-sklo-dlzka')).toContainText('3259,76');
	await expect(page.getByTestId('strecha-sklo-plocha')).toContainText('15,64');

	expect(consoleMsgs).toEqual([]);
});

test('#419 — expedičný zoznam: hotové profily (reálne počty) + komponenty („—") + odškrtávací stĺpec', async ({
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

	// karta + tabuľka expedičného zoznamu sú prítomné
	const karta = page.getByTestId('expedicia-karta');
	await expect(karta).toBeVisible();
	const tab = page.getByTestId('expedicia-tabulka');
	await expect(tab).toBeVisible();

	// súhrnný odznak nesie počet kusov, profilov aj komponentov (plain formát)
	const spolu = page.getByTestId('expedicia-spolu');
	await expect(spolu).toContainText(/\d+ ks/);
	await expect(spolu).toContainText('profilov');
	await expect(spolu).toContainText('komponentov');

	// tlačiteľné čestné upozornenie: položky čakajúce na pravidlo v zozname NIE SÚ
	await expect(page.getByTestId('expedicia-neuplne')).toContainText('NIE SÚ');

	// hotový profil (predná noha 18017) je v zozname s pozičným číslom, REÁLNYM počtom 4 ks
	// a dĺžkou 2215 mm
	const nohaRiadok = page.getByTestId('expedicia-riadok').filter({ hasText: 'predná noha' });
	await expect(nohaRiadok).toContainText('18017');
	await expect(nohaRiadok).toContainText('2215');
	await expect(nohaRiadok).toContainText('Profil');
	// pozičné číslo (Poz.) = to isté ako v Materiáli/výkrese, previazané s balónikmi
	await expect(nohaRiadok.locator('.poz-col')).toHaveText(/^\d+$/);
	// počet v poslednej bunke = presne 4 ks (nie substring z názvu „140x140")
	await expect(nohaRiadok.locator('td').last()).toHaveText('4');

	// profil s ešte neznámou dĺžkou rezu (priečka 18004, bez počtu krovov) NIE JE hotový kus —
	// Dĺžka nesie čestné „— (čaká na výkres)", nezlieva sa s komponentovým „—" (#419 review 🟡)
	const prieckaRiadok = page.getByTestId('expedicia-riadok').filter({ hasText: '18004' });
	await expect(prieckaRiadok).toContainText('čaká');

	// komponent (spojka U) je v zozname s honest-null počtom „—" (nikdy vymyslený počet)
	const spojkaRiadok = page.getByTestId('expedicia-riadok').filter({ hasText: 'Spojka U' });
	await expect(spojkaRiadok).toContainText('Komponent');
	await expect(spojkaRiadok.locator('td').last()).toHaveText('—');

	// odškrtávací stĺpec (papierový checkbox) je pri každom riadku
	await expect(tab.locator('.check-box').first()).toContainText('☐');

	expect(consoleMsgs).toEqual([]);
});

// ── #462 prieckaLight checkbox: Money kód 18102 vs 18004 ────────────────────
// Checkbox „Priečka light" voľí Money kód priečky: unchecked = 18004 (normal),
// checked = 18102 (light). Test overuje, že polozka-18102 / polozka-18004 sa
// prepína podľa stavu checkboxu — efekt na ROZPIS, nie len viditeľnosť.
test('#462 prieckaLight: unchecked → 18004, checked → 18102 v rozpise', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('3');
	// prieckaLight je defaultne UNchecked → normálna priečka 18004
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('polozka-18004')).toBeVisible();
	await expect(page.getByTestId('polozka-18102')).toHaveCount(0);

	// Späť → zapni prieckaLight → 18102 namiesto 18004
	await page.getByTestId('upravit').click();
	await waitHydrated(page);
	await page.locator('input[name="prieckaLight"]').check();
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('polozka-18102')).toBeVisible();
	await expect(page.getByTestId('polozka-18102')).toContainText('light');
	await expect(page.getByTestId('polozka-18004')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

// ── #462 fixTvar select: šikmý vs rovný mení odpis/výkres ──────────────────
// fixTvar select na pergola náreze (v sekcii „Pergola s FIXom") je disabled
// v auto režime. Test overuje, že v override režime sa dá zvoliť tvar a
// prepočet ho zohľadní — presne ten efekt, ktorý issue pýta (nie len disabled stav).
test('#462 fixTvar select: override mód zmení tvar FIXu v rozpise', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('4000');
	await page.locator('#hlbka').fill('3000');
	await page.locator('#vyskaZadna').fill('2500');
	// zapni FIX
	await page.locator('#pergolaSFixom').check();
	await waitHydrated(page);
	// fixTvar by mal byť v auto disabled stave — vypni auto
	const fixAutoBox = page.getByTestId('fix-auto');
	if (await fixAutoBox.isChecked()) {
		await fixAutoBox.uncheck();
		await waitHydrated(page);
	}
	// teraz je fixTvar enabled — zvoľ 'rovny'
	const fixTvar = page.locator('#fixTvar');
	await expect(fixTvar).toBeEnabled();
	await fixTvar.selectOption('rovny');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	// FIX sekcia vo výsledku musí obsahovať 'rovný' (efekt override voľby)
	await expect(page.locator('.card', { hasText: 'Pevné zasklenie' })).toContainText('rovný');

	expect(consoleMsgs).toEqual([]);
});

// ── #462 RucnePolozky: pridaj → odober → v rozpise riadok zmizne ────────────
// rucne-odober (data-testid) na manuálnych položkách. Test pridá riadok,
// overí počet, odoberie ho a overí, že rozpis riadok stratil.
test('#462 RucnePolozky: pridaj → odober → riadok zmizne z tabuľky', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('3');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// pridaj ručnú položku
	const karta = page.getByTestId('rucne-karta');
	await karta.locator('#rucneKod').fill('ZASP99999');
	await karta.locator('#rucneNazov').fill('E2E Test Rucna');
	await karta.locator('#rucneMnozstvo').fill('5,5');
	await karta.locator('#rucneMj').selectOption('m');
	await page.getByTestId('rucne-pridat').click();

	// overí, že sa riadok objavil
	const riadky = page.getByTestId('rucne-riadok');
	await expect(riadky).toHaveCount(1);
	await expect(riadky.first()).toContainText('ZASP99999');
	await expect(riadky.first()).toContainText('5,5');

	// odoberanie — klikni rucne-odober
	await page.getByTestId('rucne-odober').click();
	await expect(page.getByTestId('rucne-riadok')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});
