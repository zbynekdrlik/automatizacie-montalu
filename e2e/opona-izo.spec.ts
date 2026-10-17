// #504 round 3 — Štandard+ opona IZO (2×2K/2×3K/2×4K). Reálny prehliadač, READ-ONLY
// náhľad (nič sa nezapisuje do Money → bezpečné aj na LIVE, žiadny skipAkLive). Patrik
// (úloha 854, msg 1821818) hlásil, že pri Štandard+ opone chýba IZO 16 mm sklo — round 3
// doplnil nárezák (2×4K 1:1 z Money Excelu msg 1823604, 2×2K/2×3K odvodené). Test overuje:
//  1. IZO 16 mm sklo je pri opone PONÚKANÉ (predtým filtrované) a plán sa vykreslí,
//  2. 2×4K rezy/počty 1:1 z Excelu (U-profil ZASP202439 16 tyčí = 57,6 m cez FFD balenie
//     appky — Excel má naivný stĺpec tyčí vyšší; spodná koľajnica ZASP202432 z default
//     „prídavnej"); šírka skla už NIE z Excelu (574), ale podľa pravidla výroby #610
//     (Odoo úloha 1416: sklo = kladkový − 10 mm) — seed 568×1965, na PROD relácia (nižšie),
//  3. 2×2K/2×3K majú v pláne čestné „odvodené" upozornenie (banner plan-warn),
//  4. #610 testovací rozmer z úlohy 1416: 2×3K 6500 × 2070 → sklo 1020mm × 1935mm (seed).
// ŠÍRKA SKLA NA PROD = RELÁCIA, nie literál (testing.md #555): výroba ladí kladkový v editore
// vzorcov a šírka skla ho od #610 doplnku SLEDUJE (väzba v `saveCfgChanges`) — po ďalšej úprave
// by pevné 568/1020 na post-deploy (BASE_URL = PROD) padli, hoci appka je správne. Preto proti
// PROD tvrdíme `rez kladkového − sklo = 10` (presne: obe sú Math.round tej istej hodnoty ± 10),
// proti seed (CI preview) presný vektor. Seed sklo pravidlo NEsleduje (staršie profily seedu,
// `opona-izo-narezak.md`), takže relácia tam neplatí a literál áno.
// Sklo vyberáme RELAČNE ako triedu 16 (IZO nárezák), nie konkrétnu skladbu: výpočtové sklo
// „Izolačné sklo 4/8/4 číre" = Odoo 16 mm izolačné, ktoré je v ponuke Štandard + v CI (lokálny
// allow-list) aj na PROD (Patrik, Odoo úloha 1218, 29.9.: Štandardy 4/6/16 mm — 24 mm izolačné
// = 4/16/4 výroba v editore hrúbok odobrala, preto ho spec nesmie žiadať). 4/8/4 aj 4/16/4 sú pri
// Štandard + `hrubka_trieda=16`, `redukcia_zero=0`, bez per-sklo korekcie (overené aj na PROD) →
// plán 2×4K (sklo 568×1965, U-profil 57,6 m) je pre obe skladby identický.
// Každý test vyžaduje NULA console errors/warnings (browser-console-zero-errors).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, rezProfiluMm, vyberFarbuKovania, vyberSklo } from './helpers';

// výpočtové sklo triedy 16 (Odoo 16 mm izolačné) — nárezák IZO závisí od triedy, nie skladby
const IZO_16 = 'Izolačné sklo 4/8/4 číre';
const KLADKOVY = 'ZASP202415';
const RUN = `E2E-OPIZO-${Date.now().toString(36).toUpperCase()}`;

/** Šírka skla nárezáku: seed (bez BASE_URL) = presný `seedMm`; ŽIVÁ PROD cfg = relácia
 *  „rez kladkového − sklo = 10 mm" (#610, kladkový ladí výroba a sklo ho sleduje). Vráti šírku. */
async function overSirkuSkla(page: Page, seedMm: number): Promise<number> {
	const sklo = Number(await page.getByTestId('sklo-sirka').textContent());
	if (process.env.BASE_URL)
		expect(
			(await rezProfiluMm(page, KLADKOVY)) - sklo,
			'PROD: sklo = kladkový − 10 mm (#610)'
		).toBe(10);
	else expect(sklo, 'seed: vektor šírky skla').toBe(seedMm);
	return sklo;
}

test('Štandard+ 2×4K opona IZO: 16 mm sklo ponúkané, rezy/počty 1:1 z Money Excelu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-4K`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona IZO');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// opona štýl → otváranie sa automaticky nastaví na „Opona"
	await page.getByLabel('Štýl').selectOption('2x4K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2100');
	// #504 round 3: IZO trieda 16 je PONÚKANÁ aj pri opone (predtým filtrovaná).
	// vyberSklo zlyhá, ak by voľba neexistovala.
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), IZO_16);

	// IZO pri Štandard+ → „prídavná koľajnica" default zaškrtnutá (#132) → spodná o 1 väčšia
	await expect(page.getByLabel(/Prídavná koľajnica/)).toBeChecked();
	await vyberFarbuKovania(page); // Štandard+ nemá farbu kovania → no-op
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// plán sa vykreslí; sklo (len plán, nie Money) 568 × 1965 v seede — šírka podľa #610 (Odoo
	// úloha 1416: sklo = kladkový − 10 mm → (5000 − 460)/8), výška V − 135 z Excel formúl
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await overSirkuSkla(page, 568);
	await expect(page.getByTestId('sklo-vyska')).toHaveText('1965');
	// U-profil ZASP202439 = 57,6 m (dôkaz IZO nárezáku); spodná koľajnica ZASP202432
	// (default „prídavná" zväčšila ZASP00033→ZASP202432, presne ako v Exceli)
	await expect(page.locator('.row', { hasText: 'ZASP202439' })).toContainText(/(^|\D)57,6 m/);
	await expect(page.locator('.row', { hasText: 'ZASP202432' })).toContainText(/(^|\D)7,5 m/);
	await expect(page.locator('.row', { hasText: 'ZASP00033' })).toHaveCount(0);
	// 2×4K je 1:1 overený → ŽIADNE „odvodené" upozornenie (banner len pri 2×2K/2×3K)
	await expect(page.getByTestId('plan-warn').filter({ hasText: /odvoden/i })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

// #610 (Odoo úloha 1416, Patrik 17.10.): testovací rozmer z úlohy — sklo = kladkový − 10 mm,
// 2×3K IZO 6500 × 2070 → 1020mm × 1935mm (appka dávala 1027mm × 1935mm). Seed (CI) overí presný
// vektor; na PROD sa šírka skla hýbe s kladkovým (väzba #610 v editore), takže tam overujeme
// reláciu sklo = kladkový − 10 a že karta „Sklo (mm)" aj výkres náhľadu nesú TEN ISTÝ rozmer —
// presne to, čo výroba kopíruje do objednávky skla.
// PREDPOKLAD na PROD (overené 17.10.): korekcia skla triedy 16 mm pre Štandard + je „systémová"
// (`cfg_sklo_trieda` bez riadku Štandard +/16) a `cfg_sys.sklo_offset` týchto štýlov = 0. Keď
// výroba v editore nastaví korekciu triedy 16 (17.10. ju skúšala 7 → späť), posunie sa šírka aj
// výška skla o tú korekciu a tento test na deployi padne — príčina je potom tá korekcia, nie kód.
test('#610 Štandard+ 2×3K opona IZO 6500 × 2070: sklo 1020mm × 1935mm (kladkový − 10)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-610`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona IZO sklo 1416');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x3K');
	await page.getByLabel('Šírka (mm) *').fill('6500');
	await page.getByLabel('Výška (mm) *').fill('2070');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), IZO_16);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// karta „Sklo (mm)" (rozmer na objednávku skla) aj výkres náhľadu nesú ten istý rozmer
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	const sirka = await overSirkuSkla(page, 1020);
	await expect(page.getByTestId('sklo-rozmer')).toHaveText(`${sirka}mm × 1935mm`);
	await expect(page.getByTestId('nahlad-sklo-rozmer')).toHaveText(`${sirka}mm × 1935mm`);
	expect(consoleMsgs).toEqual([]);
});

test('Štandard+ 2×2K opona IZO: plán má čestné „odvodené" upozornenie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-2K`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona IZO odvodené');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x2K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2100');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), IZO_16);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// 2×2K opona IZO je ODVODENÉ → plán ukáže čestný banner (Money-safety honesty)
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await expect(page.getByTestId('plan-warn')).toContainText(/odvoden/i);
	expect(consoleMsgs).toEqual([]);
});
