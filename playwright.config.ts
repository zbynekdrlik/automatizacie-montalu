import { defineConfig } from '@playwright/test';

// BASE_URL nastavený → testuje sa NASADENÁ appka (post-deploy verifikácia).
// Bez BASE_URL (CI) sa zbuilduje a spustí preview server s test env.
const baseURL = process.env.BASE_URL || 'http://localhost:4173';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30000,
	retries: 0,
	use: {
		baseURL,
		screenshot: 'only-on-failure'
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
					MONEY_TEST_DIR: './data/e2e-odpis-export'
				}
			}
});
