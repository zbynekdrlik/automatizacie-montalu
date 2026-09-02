import { defineConfig } from '@playwright/test';

// BASE_URL nastavený → testuje sa NASADENÁ appka (post-deploy verifikácia).
// Bez BASE_URL (CI) sa zbuilduje a spustí preview server s test env.
const baseURL = process.env.BASE_URL || 'http://localhost:4173';

export default defineConfig({
	testDir: 'e2e',
	// #245: test-only route /__test-error existuje LEN v CI preview (cez
	// ENABLE_TEST_ERROR_ROUTE vo webServer.env nižšie); proti nasadeniu (BASE_URL)
	// je to 404 by design, takže error-stranka spec je preview-only — proti
	// deploymentu ho vynecháme na úrovni configu (nie runtime skip v spec súbore).
	testIgnore: process.env.BASE_URL ? ['**/error-stranka.spec.ts'] : [],
	timeout: 30000,
	// cez SSH tunel na nasadenú appku sú odozvy pomalšie — default 5 s expect
	// timeout intermitentne padal na login redirecte
	expect: { timeout: process.env.BASE_URL ? 15000 : 5000 },
	retries: 0,
	// sériovo: editor test dočasne mení konfiguráciu vzorcov — paralelný beh
	// by menil čísla ostatným testom (a tunel na nasadenú appku paralelu nezvláda)
	workers: 1,
	use: {
		baseURL,
		screenshot: 'only-on-failure',
		// nasadená appka má PROTOCOL_HEADER/HOST_HEADER (za Caddy proxy) —
		// pri priamom teste cez tunel ich musí posielať test, inak CSRF 403
		extraHTTPHeaders: process.env.BASE_URL
			? {
					'x-forwarded-proto': new URL(baseURL).protocol.replace(':', ''),
					'x-forwarded-host': new URL(baseURL).host
				}
			: {}
	},
	webServer: process.env.BASE_URL
		? undefined
		: {
				// #291 (2. kolo): reset zdieľanej e2e.db PRED štartom servera, nie v
				// globalSetup. `hooks.server.ts` importuje `db.ts` → migrácia beží pri BOOTE
				// servera (nie až pri prvom requeste), takže preview si otvorí + zmigruje
				// e2e.db hneď na štarte. Playwright však spúšťa globalSetup AŽ PO tom, čo je
				// webServer hotový (empiricky overené: SERVER_BOOT pred GLOBALSETUP) — starý
				// globalSetup `rmSync('./data/e2e.db')` teda mazal už zmigrovanú DB spod bežiaceho
				// servera: server ďalej obsluhoval z osirotelého inode, ale cesta na disku
				// zmizla, takže seedDopyt (test proces) otvoril ČERSTVÝ prázdny súbor →
				// „no such table: dopyt". Preto reset MUSÍ prebehnúť pred bootom → v `command`.
				// (readiness GET /health si držíme — 200 vráti až po seedData, takže testy
				// nikdy nebežia proti polovične nabehnutému serveru.)
				// #298 (5. kolo): webServer BUILDNE pred preview, inak `vite preview` servíruje
				// STALE build/ — lokálne `npx playwright test` bez predošlého `npm run build` dá
				// false failures (nová route 404, nesúvisiace timeouty). V CI je build/ už čerstvý
				// z kroku „Build" → E2E krok nastaví E2E_PREBUILT=1 a rebuild sa preskočí (žiadny
				// dvojitý build, CI sa nespomalí). Build failure padne HLASNO cez `&&` (preview sa
				// nespustí), nikdy ticho na starom build/.
				command:
					'if [ "$E2E_PREBUILT" = 1 ]; then true; else npm run build; fi && node e2e/reset-e2e-db.mjs && npm run preview',
				url: 'http://localhost:4173/health',
				reuseExistingServer: false,
				env: {
					DATABASE_PATH: './data/e2e.db',
					SEED_USERS: 'e2e:e2e-heslo-123',
					MONEY_LIVE: '0',
					MONEY_TEST_DIR: './data/e2e-odpis-export',
					// #154: E2E si vie na tento súbor napísať VLASTNÝ snapshot fixture (appka
					// beží ako lokálny child proces preview servera, zdieľa filesystem s testom)
					CENY_SNAPSHOT_PATH: './data/e2e-ceny.json',
					// #298: readback snapshot fixture cesta (neexistuje → reader je no-op, E2E seeduje
					// money_dlv priamo do DB). Deterministické bez ohľadu na absolútny default `/data/...`.
					DLV_READBACK_PATH: './data/e2e-dlv-readback.json',
					// #245: zapne test-only /__test-error route (inak 404) — E2E overí chybovú
					// stránku + errorId. VPS toto env NIKDY nemá, takže route je tam skrytá.
					ENABLE_TEST_ERROR_ROUTE: '1',
					// #390: CELÁ E2E suite odosiela dopyty/objednávky z JEDNEJ IP (127.0.0.1) v JEDNOM
					// preview procese, takže per-IP dopyt-throttle okno (default 8 / 10 min, a beh je
					// ~8 min → okno sa NERESETUJE) nazbiera naprieč NESÚVISIACIMI spec-mi a 9. dopyt
					// (posledný produkt abecedne = zimná záhrada) dostane 429 → žiadny PDF → download
					// timeout. Zvýš limit pre E2E; PROD toto env NIKDY nemá (default 8 platí). Samotný
					// throttle je pokrytý `tests/dopyt-throttle.test.ts`.
					DOPYT_MAX_PER_WINDOW: '1000'
				}
			}
});
