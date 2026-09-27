// #571 follow-up (PROD 27.9., 0.25.45): podklad objednávky skla s riadkom od INÉHO používateľa,
// ktorého meno je e-mail (`palo@montalu.sk`), hlásil v konzole `[svelte] hydration_mismatch`.
// Príčina: PROD je za Cloudflare — „Email Address Obfuscation" prepíše e-mail v TEXTE HTML (mimo
// `<script>`) na `<a class="__cf_email__">[email protected]</a>`, takže banner #571 má iný DOM, než
// aký vyrenderoval server a aký klient hydratuje. Cloudflare HTML NEMENÍ, keď odpoveď nesie
// `Cache-Control: no-transform` (appka ho posiela v `hooks.server.ts`).
//
// Test EMULUJE tento zdokumentovaný kontrakt proxy cez `page.route`: dokument podkladu prepíše
// rovnako ako Cloudflare, LEN ak odpoveď nemá `no-transform`. Zároveň beží v inej časovej zóne
// prehliadača (America/New_York) než server (CI = UTC) — kategória „server ≠ prehliadač" pre
// dátum v banneri. Seeduje lokálnu e2e DB → na ostrom nasadení `skipAkLive`.
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

const DB_PATH = process.env.DATABASE_PATH || './data/e2e.db';
const ZAK = `E2E-PROXY-${Date.now().toString(36).slice(-5)}`;
const AUTOR = 'kolega.e2e@example.com';

test.use({ timezoneId: 'America/New_York' });

/** Emulácia Cloudflare Email Address Obfuscation na jednom HTML dokumente. */
function cloudflareEmailObfuscation(html: string): string {
	// <script> obsah Cloudflare nemení (tam sú serializované `data` pre hydratáciu)
	const casti = html.split(/(<script[\s\S]*?<\/script>)/);
	for (let i = 0; i < casti.length; i += 2) {
		casti[i] = casti[i]!.replace(
			/>([^<]*?)[\w.+-]+@[\w-]+\.[\w.]+/g,
			(_m, pred: string) =>
				`>${pred}<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="00">[email&#160;protected]</a>`
		);
	}
	return casti.join('');
}

test('objednávka skla: cudzí autor s e-mailom + proxy + iná TZ → banner bez hydration_mismatch (#571)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje lokálnu e2e DB → na ostrom nasadení (post-deploy BASE_URL) preskočí; skipAkLive je
	// sankcionovaný helper (nový doslovný BASE_URL skip riadok by zablokoval integračný push).
	await skipAkLive(page);

	// riadok podkladu od INÉHO používateľa (meno = e-mail), Odoo cenníkový kód typu skla, 25.9. UTC
	const db = new Database(DB_PATH);
	try {
		db.prepare(
			`INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, m2, created_at, created_by)
			 VALUES (?, ?, 'zasklenia', 'Zasklenie 1', 800, 2000, 1, '004', 1.6, '2026-09-25 07:52:12', ?)`
		).run(ZAK, ZAK, AUTOR);
	} finally {
		db.close();
	}

	let prepisane = 0;
	let noTransform = 0;
	await page.route(
		(url) => url.pathname === `/objednavka-skla/${ZAK}`,
		async (route) => {
			const resp = await route.fetch();
			const cc = (resp.headers()['cache-control'] ?? '').toLowerCase();
			if (cc.split(',').some((d) => d.trim() === 'no-transform')) {
				noTransform++;
				await route.fulfill({ response: resp });
				return;
			}
			prepisane++;
			await route.fulfill({ response: resp, body: cloudflareEmailObfuscation(await resp.text()) });
		}
	);

	await loginAs(page);
	await goto(page, `/objednavka-skla/${ZAK}`);

	// server-side sformátovaný dátum (Europe/Bratislava) — nezávislý od TZ prehliadača
	const text = `Táto zákazka už obsahuje 1 riadok od ${AUTOR} (25.9.2026) — pridávaš do existujúceho podkladu`;
	await expect(page.getByTestId('cudzie-riadky')).toHaveText(text);
	await expect(page.getByTestId('pridat-riadok').getByTestId('cudzie-riadky-pridat')).toHaveText(
		text
	);
	// proxy HTML nezmenila, lebo appka poslala no-transform (a dokument sa naozaj načítal cez route)
	expect(noTransform).toBeGreaterThan(0);
	expect(prepisane).toBe(0);

	expect(consoleMsgs).toEqual([]);
});
