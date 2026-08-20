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
	globalSetup: './e2e/global-setup.ts',
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
				command: 'npm run preview',
				port: 4173,
				reuseExistingServer: false,
				env: {
					DATABASE_PATH: './data/e2e.db',
					SEED_USERS: 'e2e:e2e-heslo-123',
					MONEY_LIVE: '0',
					MONEY_TEST_DIR: './data/e2e-odpis-export',
					// #154: E2E si vie na tento súbor napísať VLASTNÝ snapshot fixture (appka
					// beží ako lokálny child proces preview servera, zdieľa filesystem s testom)
					CENY_SNAPSHOT_PATH: './data/e2e-ceny.json',
					// #245: zapne test-only /__test-error route (inak 404) — E2E overí chybovú
					// stránku + errorId. VPS toto env NIKDY nemá, takže route je tam skrytá.
					ENABLE_TEST_ERROR_ROUTE: '1'
				}
			}
});
