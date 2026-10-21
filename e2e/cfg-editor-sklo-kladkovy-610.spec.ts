// #610 doplnok (ROZHODNUTÉ 17.10., Odoo úloha 1416): pri Štandard + opone IZO platí pravidlo
// výroby „sklo = kladkový − 10 mm na krídlo". Výroba ladí kladkový v editore vzorcov
// (`/zasklenia/nastavenia`), ale riadok `Sklo šírka` editor neukazuje — bez väzby by ďalšia
// úprava kladkového ticho rozbila šírku skla (presne úloha 1416). Test: reálny prehliadač,
// výroba zmení kladkový 2×3K IZO o −6 mm → editor ukáže poznámku aj auditované posunutie skla →
// nárezák 6500 × 2070 má sklo stále = kladkový − 10.
//
// WRITE test (ukladá vzorce do cfg) → `skipAkLive` (nikdy proti LIVE) a `SERIOVE_SPECY`
// (`e2e/seriove.ts`). Východzí stav = PROD po v58 (kladkový −320, sklo −380): seed nesie staršie
// profily (kladkový −285, `testing.md` — seed sa s PROD zámerne nezosúlaďuje), v ktorých sklo
// pravidlo NEsleduje, preto ho fixture nastaví priamo v zdieľanej e2e.db (vzor
// `objednavka-skla-proxy-hydratacia.spec.ts`). Raz sledujúce sklo editor ťahá s kladkovým, takže
// pôvodný seed stav sa editorom obnoviť nedá — upratanie vráti OBA riadky priamo v DB (`finally`,
// beží aj po páde). Nula console errors/warnings.
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import {
	collectConsole,
	loginAs,
	goto,
	rezProfiluMm,
	skipAkLive,
	vyberFarbuKovania,
	vyberSklo
} from './helpers';

const DB_PATH = process.env.DATABASE_PATH || './data/e2e.db';
const SYS_STYL = 'Štandard +|2x3K IZO';
const N = 6; // krídla 2×3K
const KLADKOVY = 'ZASP202415';
// výpočtové sklo triedy 16 (Odoo 16 mm izolačné) — nárezák IZO závisí od triedy, nie skladby
const IZO_16 = 'Izolačné sklo 4/8/4 číre';
const POLE_SKLO = 'Sklo šírka (S) offset — sleduje kladkový − 10 mm'; // #616: bez čísla tiketu
const RUN = `E2E-SKLOKL-${Date.now().toString(36).toUpperCase()}`;

interface Riadok {
	id: number;
	offset: number;
}

/** Riadky cfg_rez 2×3K IZO, ktorých sa test dotkne: kladkový (S) a Sklo šírka. */
function riadkyCfg(db: Database.Database): { kladkovy: Riadok; sklo: Riadok } {
	const kladkovy = db
		.prepare(
			`SELECT id, offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'profil' AND kod = ? AND dim = 'S'`
		)
		.get(SYS_STYL, KLADKOVY) as Riadok | undefined;
	const sklo = db
		.prepare(`SELECT id, offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`)
		.get(SYS_STYL) as Riadok | undefined;
	if (!kladkovy || !sklo) throw new Error(`${SYS_STYL}: chýba kladkový alebo Sklo šírka v cfg_rez`);
	return { kladkovy, sklo };
}

/** Nárezák 6500 × 2070 (testovací rozmer úlohy 1416) → šírka skla a rez kladkového (mm). */
async function narezak(page: Page, krok: string): Promise<{ sklo: number; kladkovy: number }> {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${krok}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sklo sleduje kladkový');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x3K');
	await page.getByLabel('Šírka (mm) *').fill('6500');
	await page.getByLabel('Výška (mm) *').fill('2070');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), IZO_16);
	await vyberFarbuKovania(page); // Štandard+ nemá farbu kovania → no-op
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();

	const sklo = Number(await page.getByTestId('sklo-sirka').textContent());
	if (!Number.isFinite(sklo)) throw new Error(`narezak: nečakaná šírka skla ${sklo}`);
	// nárez riadok kladkového („12×1030 mm") — rozmer rezu, nie odpis karta (testing.md #416)
	return { sklo, kladkovy: await rezProfiluMm(page, KLADKOVY) };
}

test('#610 editor: výroba doladí kladkový 2×3K opona IZO → sklo šírka sa posunie samo (sklo = kladkový − 10)', async ({
	page
}) => {
	await skipAkLive(page);
	const consoleMsgs = collectConsole(page);
	const db = new Database(DB_PATH);
	const povodne = riadkyCfg(db);
	try {
		await loginAs(page);
		// --- 0. východzí stav DB: poznámka editora zodpovedá tomu, či sklo pravidlo sleduje
		//        (seed nesleduje → „sklo sa neposunie"; odvodené z DB, nie predpoklad) ---
		const sledujeVychodzi = povodne.sklo.offset === povodne.kladkovy.offset - 10 * N;
		await goto(page, `/zasklenia/nastavenia?sysStyl=${encodeURIComponent(SYS_STYL)}`);
		await expect(page.getByTestId('editor-nadpis')).toContainText('2x3K IZO');
		await expect(
			page.getByTestId(sledujeVychodzi ? 'sklo-sleduje-pozn' : 'sklo-nesleduje-pozn')
		).toBeVisible();

		// --- 1. fixture: stav ako na PROD po v58 — kladkový = sklo + 10 mm na krídlo ---
		const kladkovyProd = povodne.sklo.offset + 10 * N;
		db.prepare('UPDATE cfg_rez SET offset = ? WHERE id = ?').run(kladkovyProd, povodne.kladkovy.id);
		const pred = await narezak(page, 'PRED');
		expect(pred.kladkovy - pred.sklo, 'východzí stav: sklo = kladkový − 10').toBe(10);

		// --- 2. editor: poznámka pri kladkovom + zmena kladkového o −6 mm (krok výroby) ---
		await goto(page, `/zasklenia/nastavenia?sysStyl=${encodeURIComponent(SYS_STYL)}`);
		await expect(page.getByTestId('editor-nadpis')).toContainText('2x3K IZO');
		await expect(page.getByTestId('sklo-sleduje-pozn')).toContainText(
			'sklo sa posunie automaticky (o 10 mm užšie)'
		);
		await expect(page.getByTestId('sklo-nesleduje-pozn')).toHaveCount(0);
		const kladk = page.getByLabel(/Kladkový profil.*odsadenie/);
		await expect(kladk).toHaveValue(String(kladkovyProd));
		await kladk.fill(String(kladkovyProd - 6));
		await page.getByTestId('ulozit-vzorce').click();
		await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();
		// posunutie skla je v „Zmeny" (→ cfg_audit), nie tichý zápis
		await expect(page.locator('.row', { hasText: POLE_SKLO })).toContainText(
			`${povodne.sklo.offset} → ${povodne.sklo.offset - 6}`
		);

		// --- 3. nárezák: sklo išlo s kladkovým (6 mm / 6 krídel = 1 mm) — stále kladkový − 10 ---
		const po = await narezak(page, 'PO');
		expect(po.kladkovy).toBe(pred.kladkovy - 1);
		expect(po.sklo, 'sklo šírka sa musí posunúť spolu s kladkovým').toBe(pred.sklo - 1);
		expect(po.kladkovy - po.sklo).toBe(10);
	} finally {
		// net-zero: kladkový aj sklo späť na pôvodné hodnoty (editorom sa to nedá — sklo ho sleduje)
		const upd = db.prepare('UPDATE cfg_rez SET offset = ? WHERE id = ?');
		upd.run(povodne.kladkovy.offset, povodne.kladkovy.id);
		upd.run(povodne.sklo.offset, povodne.sklo.id);
		db.close();
	}

	expect(consoleMsgs).toEqual([]);
});
