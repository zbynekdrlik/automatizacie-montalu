// E2E audit — 3. dávka (posledných 8 nálezov z test-coverage auditu). Všetky
// MENIA STAV (zapíšu odpis alebo konfiguráciu vzorcov), takže sa nedajú overiť
// proti prode: zápisové kroky sú za `skipAkLive` a editorové testy si pôvodnú
// konfiguráciu VŽDY vrátia (aj po páde) — inak by menili čísla ostatným testom.
// Nula console errors/warnings všade.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E3-${Date.now().toString(36).toUpperCase()}`;

/** rovnaké formátovanie ako appka (fmtM v +page.svelte): 3 desatinné, desatinná čiarka */
const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

const STYL = '/zasklenia/nastavenia?sysStyl=Robust%7C2K';
// #438: prepínač „nuluje Redukciu 6mm" má zaškrtnuté sklá iba v systéme Slide (4/8/4),
// takže glass-toggle test beží proti Slide stránke, nie Robustu.
const SLIDE_STYL = '/zasklenia/nastavenia?sysStyl=Slide%7C2K';
const STD_STYL = `/zasklenia/nastavenia?sysStyl=${encodeURIComponent('Štandard +|2K')}`;

// ── #15 zasklenia „⏳ Čaká" celým UI vrátane skrytého round-tripu ──────────────
// „Späť a upraviť" round-trip je krytý inde; TU ide o cestu náhľad → odoslať:
// checkbox musí prežiť skrytý input a dotiecť až do odpis_log (caka=1). Keby
// vypadol, odpis by v LIVE režime šiel priamo do dlv namiesto NA ODPIS.
test('zasklenia: „⏳ Čaká" prežije náhľad → odoslanie a zapíše sa do histórie (bez neho nie)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const fill = async (op: string, caka: boolean) => {
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-CAK`);
		await page.getByLabel('OP/OPDL číslo *').fill(op);
		await page.getByLabel('Zákazník *').fill('E2E Caka');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		if (caka) await page.getByLabel(/Čaká na materiál/).check();
		await vyberFarbuKovania(page);
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	};

	// 1. s čaká → odoslanie prejde a v histórii je ⏳
	await fill('11', true);
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. tá istá ZAK, iná OP, BEZ čaká → v histórii ⏳ nie je
	await page.getByRole('link', { name: /Nový nárezový plán/ }).click();
	await waitHydrated(page);
	await fill('12', false);
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 3. história rozlíši oba záznamy — ⏳ len pri tom s čaká.
	// Riadok sa hľadá podľa CELÝCH buniek (ZAK + OP): `hasText: '11'` by sadlo
	// aj na časovú značku (13:41:11) a kontrolovalo by cudzí riadok.
	await goto(page, '/odpisy');
	const cell = (text: string) => page.locator('td', { hasText: new RegExp(`^${text}$`) });
	const riadok = (op: string) =>
		page
			.locator('tbody tr')
			.filter({ has: cell(`${RUN}-CAK`) })
			.filter({ has: cell(op) });
	await expect(riadok('11')).toHaveCount(1);
	await expect(riadok('12')).toHaveCount(1);
	await expect(riadok('11')).toContainText('⏳');
	await expect(riadok('12')).not.toContainText('⏳');
	expect(consoleMsgs).toEqual([]);
});

// ── #16 bazén: parita náhľad → odoslanie (dvere + všetkých 9 profil polí) ─────
// Skryté inputy na kontrolnej stránke nesú CELÝ vstup; „odoslat" počíta ZNOVA
// zo surových hodnôt. Keby jedno pole zo skrytého round-tripu vypadlo, do Money
// by šlo iné množstvo, než užívateľ videl a schválil.
test('bazén: každé pole (dvere + 9 profilových) prežije kontrolu → Money rozpis je 1:1 s náhľadom', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/bazen');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BPAR`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Bazen Parita');
	await page.getByLabel('Model').selectOption('Star');
	await page.getByLabel('Koľaj', { exact: true }).selectOption('Dvojkolaj');
	await page.getByLabel('Počet sekcií *').fill('4');
	await page.getByLabel('Počet priečok').fill('2');
	await page.getByLabel('Celková dĺžka koľajníc (mm)').fill('12500');
	await page.getByLabel('Dvere', { exact: true }).check();
	// všetkých 9 profilových polí NE-defaultne (každé iné číslo → zámena sa prezradí)
	const profily: [string, string][] = [
		['VS do 4500 (počet sekcií)', '1'],
		['SS do 4500 (počet sekcií)', '2'],
		['MS do 4500 (počet sekcií)', '3'],
		['VS do 6000 (počet sekcií)', '4'],
		['SS do 6000 (počet sekcií)', '5'],
		['MS do 6000 (počet sekcií)', '6'],
		['Priečkový 4300 (počet)', '7'],
		['Priečkový 6000 (počet)', '8'],
		['Výklopné čelo (počet)', '9']
	];
	for (const [label, val] of profily) await page.getByLabel(label).fill(val);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// odfoť SCHVÁLENÝ rozpis z kontrolnej tabuľky (kód → množstvo)
	const nahlad = await page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('input[name^="qty_"]')].map((i) => [
				i.getAttribute('name')!.slice(4),
				(i as HTMLInputElement).value
			])
		)
	);
	const nenulove = Object.entries(nahlad).filter(([, v]) => Number(v) > 0);
	expect(nenulove.length).toBeGreaterThan(5);
	// dvere pridávajú tri vlastné položky — dôkaz, že checkbox naozaj zmenil rozpis
	for (const kod of ['BPP20254', 'BPP20255', 'BPP20256'])
		expect(Number(nahlad[kod]), kod).toBeGreaterThan(0);

	// odoslanie prepočíta zo skrytých inputov — musí vyjsť to isté
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.locator('.sec', { hasText: 'Money rozpis' })).toContainText(
		`${nenulove.length} položiek`
	);
	// #355: rozpis teraz nesie aj kusové komponenty (BPK*, jednotka `ks`) popri
	// metrážových profiloch (`m`) — hodnotová parita ostáva, jednotka je per-riadok.
	// Riadok cielim cez „<kod> ·" (nie holé `kod`), lebo BPK kódy majú prefixové
	// kolízie (napr. BPK20251 ⊂ BPK202510) a holý substring by v strict-mode matchol
	// dva riadky.
	for (const [kod, val] of nenulove)
		await expect(page.locator('.row', { hasText: `${kod} ·` }), kod).toContainText(
			fmtM(Number(val))
		);
	// žiadna položka nie je označená ✏️ (nič sme neupravovali → auto = odoslané)
	await expect(page.locator('.row', { hasText: 'BPP20254' })).not.toContainText('✏️');
	expect(consoleMsgs).toEqual([]);
});

// ── #17 bazén „⏳ Čaká" celým UI ───────────────────────────────────────────────
test('bazén: „⏳ Čaká" prežije kontrolu → odoslanie a zapíše sa do histórie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/bazen');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BCAK`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Bazen Caka');
	await page.getByLabel('Počet sekcií *').fill('3');
	await page.getByLabel(/Čaká na materiál/).check();
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-BCAK` });
	await expect(row).toContainText('Bazén');
	await expect(row).toContainText('⏳');
	expect(consoleMsgs).toEqual([]);
});

// ── #19 pergola: „Kopírovať počet tyčí" naozaj skopíruje ─────────────────────
// Doteraz sa overovalo len to, že tlačidlo VIDNO. Tu sa klikne: potvrdenie v
// texte tlačidla + obsah schránky = presne stĺpec tyčí (to sa vkladá do Solid Edge).
test('pergola: kliknutie na „Kopírovať počet tyčí" dá potvrdenie a do schránky stĺpec tyčí', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PCOP`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Kopia');
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
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// zobrazený stĺpec tyčí (jeden riadok na kód, v poradí karty)
	const karta = page.locator('.card', { hasText: 'Výstup pre Solid Edge' });
	const tyce = await karta.locator('.row b').allTextContents();
	expect(tyce).toEqual(['9(7,5m)', '9(7,5m)', '2(7,5m)']);

	const kopiruj = page.getByTestId('kopiruj-tyce');
	await expect(kopiruj).toHaveText('📋 Kopírovať počet tyčí');
	// clipboard API musí byť dostupné — localhost aj CI preview SÚ bezpečný kontext;
	// keby dostupné nebolo, test má PADNÚŤ (nie sa TICHO preskočiť)
	const secure = await page.evaluate(() => window.isSecureContext && !!navigator.clipboard);
	expect(secure, 'clipboard API nedostupné — očakávaný bezpečný kontext (localhost/https)').toBe(
		true
	);

	await kopiruj.click();
	await expect(kopiruj).toHaveText('✓ Skopírované — vlož do Solid Edge');
	const schranka = await page.evaluate(() => navigator.clipboard.readText());
	expect(schranka).toBe(tyce.join('\n'));
	expect(consoleMsgs).toEqual([]);
});

// ── #21 editor: server odmietne hodnotu, ktorú prehliadač prepustil ───────────
// HTML5 min/max je len prvá clona; keby ju niekto obišiel (upravený DOM, curl),
// hodnotu musí odmietnuť SERVER — a v DB sa nesmie zmeniť nič.
test('editor: hodnota mimo ±500 obídená v prehliadači → chybový banner a DB sa nezmení', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, STYL);

	const off = page.locator('input[name^="offset_"]').first();
	const sklo = page.getByLabel('Sklo — konečné zmenšenie (mm)');
	const pOff = await off.inputValue();
	const pSklo = await sklo.inputValue();

	// obíď HTML5 clonu (presne to, čo by spravil upravený DOM / ručný POST)
	await off.evaluate((el) => {
		el.removeAttribute('min');
		el.removeAttribute('max');
	});
	await off.fill('9999');
	await page.getByTestId('ulozit-vzorce').click();

	// server odmietol → banner, a formulár sa vrátil s hodnotami z DB
	await expect(page.getByTestId('nastavenia-error')).toContainText('mimo rozsahu');
	await expect(page.getByTestId('nastavenia-ulozene')).toHaveCount(0);
	await expect(page.locator('input[name^="offset_"]').first()).toHaveValue(pOff);

	// nič sa nezapísalo ani po znovunačítaní
	await goto(page, STYL);
	await expect(page.locator('input[name^="offset_"]').first()).toHaveValue(pOff);
	await expect(page.getByLabel('Sklo — konečné zmenšenie (mm)')).toHaveValue(pSklo);
	expect(consoleMsgs).toEqual([]);
});

// ── #22 editor: odškrtnutie skla (reálny POST) prepne nulovanie Redukcie 6mm ──
test('editor: odškrtnutie skla vypne nulovanie Redukcie 6mm a zaškrtnutie ho vráti', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, SLIDE_STYL);

	// prvé zaškrtnuté sklo (redukcia_zero = 1) — v Slide sú to 4/8/4 sklá. #438: meno
	// poľa je teraz glass_<id> (stabilné cez reload), názov skla čítame z labelu.
	const label = page.locator('label:has(input[type="checkbox"][name^="glass_"]:checked)').first();
	await expect(label).toBeVisible();
	const box = label.locator('input[type="checkbox"]');
	const name = (await box.getAttribute('name'))!; // glass_<id>
	const nazov = (await label.innerText()).trim();

	try {
		// odškrtni → uloženie vypíše zmenu 1 → 0
		await box.uncheck();
		await page.getByTestId('ulozit-vzorce').click();
		await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();
		await expect(page.getByText(`Sklo „${nazov}" nuluje Redukciu 6mm`)).toBeVisible();
		await expect(page.locator('.row', { hasText: `Sklo „${nazov}"` })).toContainText('1 → 0');

		// po návrate je checkbox naozaj odškrtnutý (perzistované v DB)
		await page.getByRole('link', { name: /Upraviť ďalší štýl/ }).click();
		await waitHydrated(page);
		await expect(page.locator(`input[name="${name}"]`)).not.toBeChecked();
	} finally {
		// VŽDY vráť pôvodný stav — inak by Slide odpis počítal iné čísla ostatným testom
		await goto(page, SLIDE_STYL);
		await page.locator(`input[name="${name}"]`).check();
		await page.getByTestId('ulozit-vzorce').click();
		await page.getByTestId('nastavenia-ulozene').waitFor();
	}

	await expect(page.locator('.row', { hasText: `Sklo „${nazov}"` })).toContainText('0 → 1');
	await goto(page, SLIDE_STYL);
	await expect(page.locator(`input[name="${name}"]`)).toBeChecked();
	expect(consoleMsgs).toEqual([]);
});

// ── #438 editor: sekcia skiel ukáže LEN sklá vybraného systému ────────────────
// „3.3.1" žije v Slide aj Štandard +; „Float sklo 4 mm" je len Štandard +. Cross-
// systémový render + save (WHERE nazov=?) prehadzoval redukciu obidvom (prod cfg_audit
// 16). Po oprave sekcia ukazuje len sklá zvoleného systému.
test('editor: sekcia skiel je scoped na vybraný systém (#438)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const glassLabely = async () =>
		(await page.locator('label:has(input[type="checkbox"][name^="glass_"])').allInnerTexts()).map(
			(t) => t.trim()
		);

	// Slide stránka: Slide sklá SÚ, Štandard + „Float sklo 4 mm" NIE JE.
	await goto(page, SLIDE_STYL);
	const slide = await glassLabely();
	expect(slide).toContain('3.3.1');
	expect(slide).not.toContain('Float sklo 4 mm');

	// Štandard + stránka: „Float sklo 4 mm" JE, Slide „6mm číre" NIE JE.
	await goto(page, STD_STYL);
	const standard = await glassLabely();
	expect(standard).toContain('Float sklo 4 mm');
	expect(standard).not.toContain('6mm číre');

	expect(consoleMsgs).toEqual([]);
});

// ── #23 editor: kontrolné rozmery riadia náhľad odpisu ───────────────────────
// Uloženie BEZ zmeny hodnôt (nulová mutácia) — overuje sa len to, že náhľad
// počíta na ZADANÝCH rozmeroch, nie na zabudnutom defaulte 5000×2000.
test('editor: kontrolné rozmery previewS/previewV riadia náhľad odpisu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, STYL);

	await page.getByLabel('Šírka (mm)', { exact: true }).fill('4000');
	await page.getByLabel('Výška (mm)', { exact: true }).fill('1800');
	await page.getByTestId('ulozit-vzorce').click();

	await expect(page.getByTestId('nastavenia-ulozene')).toContainText('Žiadna hodnota sa nezmenila');
	await expect(page.locator('.sec', { hasText: 'Kontrolný odpis pri' })).toContainText(
		'4000×1800 mm'
	);
	// náhľad naozaj počítal (sklo aj profily sú vypísané)
	await expect(page.locator('.row', { hasText: 'Sklo (Š×V)' })).toContainText('ks');
	expect(consoleMsgs).toEqual([]);
});

// ── #24 editor: po uložení a návrate je formulár predvyplnený NOVOU hodnotou ──
test('editor: po uložení a návrate formulár drží novú hodnotu (nie starú z pamäte)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, STYL);

	const sklo = page.getByLabel('Sklo — konečné zmenšenie (mm)');
	const povodna = await sklo.inputValue();
	const nova = String(Number(povodna) + 5);

	try {
		await sklo.fill(nova);
		await page.getByTestId('ulozit-vzorce').click();
		await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();

		// „➕ Upraviť ďalší štýl" → formulár musí ukázať NOVÚ hodnotu
		await page.getByRole('link', { name: /Upraviť ďalší štýl/ }).click();
		await waitHydrated(page);
		await expect(page.getByLabel('Sklo — konečné zmenšenie (mm)')).toHaveValue(nova);

		// a rovnako po čistom znovunačítaní stránky
		await goto(page, STYL);
		await expect(page.getByLabel('Sklo — konečné zmenšenie (mm)')).toHaveValue(nova);
	} finally {
		await goto(page, STYL);
		await page.getByLabel('Sklo — konečné zmenšenie (mm)').fill(povodna);
		await page.getByTestId('ulozit-vzorce').click();
		await page.getByTestId('nastavenia-ulozene').waitFor();
	}

	await goto(page, STYL);
	await expect(page.getByLabel('Sklo — konečné zmenšenie (mm)')).toHaveValue(povodna);
	expect(consoleMsgs).toEqual([]);
});
