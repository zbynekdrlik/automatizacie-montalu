// #571 follow-up (PROD 27.9., 0.25.45): podklad objednávky skla s riadkom od INÉHO používateľa,
// ktorého meno je e-mail (`palo@montalu.sk`), hlásil v konzole `[svelte] hydration_mismatch`.
// Príčina: PROD je za Cloudflare — „Email Address Obfuscation" prepíše e-mail v TEXTE HTML (mimo
// `<script>`) na `<a class="__cf_email__">[email protected]</a>`, takže banner #571 má iný DOM, než
// aký vyrenderoval server a aký klient hydratuje. Cloudflare HTML NEMENÍ, keď odpoveď nesie
// `Cache-Control: no-transform` (appka ho posiela v `hooks.server.ts`).
//
// Spec EMULUJE tento zdokumentovaný kontrakt proxy cez `page.route` (prepis e-mailu + dekódovací
// skript ako Cloudflare): (1) kontrolný test prepíše VŽDY → dokáže, že emulácia vyvolá presne ten
// PROD `hydration_mismatch`; (2) regresný test prepíše LEN keď odpoveď nemá `no-transform` → appka
// ho musí poslať a konzola ostane čistá. Prehliadač beží v inej TZ (America/New_York) než server
// (CI = UTC) — dátum v banneri musí prísť hotový zo servera. Seed lokálnej e2e DB → `skipAkLive`.
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

const DB_PATH = process.env.DATABASE_PATH || './data/e2e.db';
const RUN = `E2E-PROXY-${Date.now().toString(36).slice(-5)}`;
const AUTOR = 'kolega.e2e@example.com';

test.use({ timezoneId: 'America/New_York' });

/** Emulácia Cloudflare Email Address Obfuscation na jednom HTML dokumente: e-mail v TEXTE (mimo
 *  `<script>`) → `<a class="__cf_email__">[email protected]</a>` + dekódovací skript pred `</body>`,
 *  ktorý kotvu synchrónne (pred hydratáciou) vráti na textový uzol — presne čo vidí PROD. */
function cloudflareEmailObfuscation(html: string): string {
	const casti = html.split(/(<script[\s\S]*?<\/script>)/);
	for (let i = 0; i < casti.length; i += 2) {
		casti[i] = casti[i]!.replace(
			/>([^<]*?)([\w.+-]+@[\w-]+\.[\w.]+)/g,
			(_m, pred: string, email: string) =>
				`>${pred}<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encodeURIComponent(email)}">[email&#160;protected]</a>`
		);
	}
	const dekoder =
		'<script>document.querySelectorAll("a.__cf_email__").forEach(function(a){a.replaceWith(document.createTextNode(decodeURIComponent(a.dataset.cfemail)))})</script>';
	return casti.join('').replace('</body>', dekoder + '</body>');
}

/** Riadok podkladu od INÉHO používateľa (meno = e-mail), Odoo cenníkový kód typu skla, 25.9. UTC. */
function seedCudziRiadok(zak: string): void {
	const db = new Database(DB_PATH);
	try {
		db.prepare(
			`INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, m2, created_at, created_by)
			 VALUES (?, ?, 'zasklenia', 'Zasklenie 1', 800, 2000, 1, '004', 1.6, '2026-09-25 07:52:12', ?)`
		).run(zak, zak, AUTOR);
	} finally {
		db.close();
	}
}

/** Proxy pred dokumentom podkladu. `vzdy` = prepis bez ohľadu na hlavičky (kontrolný test). */
async function cloudflareProxy(page: Page, zak: string, vzdy: boolean) {
	const stav = { prepisane: 0, noTransform: 0 };
	await page.route(
		(url) => url.pathname === `/objednavka-skla/${zak}`,
		async (route) => {
			const resp = await route.fetch();
			const headers = { ...resp.headers() };
			const cc = (headers['cache-control'] ?? '').toLowerCase();
			if (!vzdy && cc.split(',').some((d) => d.trim() === 'no-transform')) {
				stav.noTransform++;
				await route.fulfill({ response: resp });
				return;
			}
			stav.prepisane++;
			delete headers['content-length']; // telo sa zmenilo
			await route.fulfill({
				response: resp,
				headers,
				body: cloudflareEmailObfuscation(await resp.text())
			});
		}
	);
	return stav;
}

// server-side sformátovaný dátum (Europe/Bratislava) — nezávislý od TZ prehliadača
const BANNER = `Táto zákazka už obsahuje 1 riadok od ${AUTOR} (25.9.2026) — pridávaš do existujúceho podkladu`;

test('kontrola emulácie: Cloudflare prepis e-mailu → presne PROD hydration_mismatch (#571)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	const zak = `${RUN}-KONTROLA`;
	seedCudziRiadok(zak);
	const stav = await cloudflareProxy(page, zak, true);

	await loginAs(page);
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByTestId('cudzie-riadky')).toHaveText(BANNER);
	expect(stav.prepisane).toBeGreaterThan(0);

	// emulácia je verná: vyvolá JEDNO varovanie hydration_mismatch, nič iné (tvar PROD 27.9.)
	expect(consoleMsgs).toEqual([expect.stringMatching(/hydration_mismatch/)]);
});

test('objednávka skla: cudzí autor s e-mailom + proxy + iná TZ → banner bez hydration_mismatch (#571)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje lokálnu e2e DB → na ostrom nasadení (post-deploy BASE_URL) preskočí; skipAkLive je
	// sankcionovaný helper (nový doslovný BASE_URL skip riadok by zablokoval integračný push).
	await skipAkLive(page);
	const zak = `${RUN}-OPRAVA`;
	seedCudziRiadok(zak);
	const stav = await cloudflareProxy(page, zak, false);

	await loginAs(page);
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByTestId('cudzie-riadky')).toHaveText(BANNER);
	await expect(page.getByTestId('pridat-riadok').getByTestId('cudzie-riadky-pridat')).toHaveText(
		BANNER
	);
	// proxy HTML nezmenila, lebo appka poslala no-transform (a dokument sa naozaj načítal cez route)
	expect(stav.noTransform).toBeGreaterThan(0);
	expect(stav.prepisane).toBe(0);

	expect(consoleMsgs).toEqual([]);
});
