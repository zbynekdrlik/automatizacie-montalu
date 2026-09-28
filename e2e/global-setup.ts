// #583: sweep na ŠTARTE sady — zmaže zvyšky throwaway `e2e-` B2B účtov z minulých behov (napr. beh
// zabitý skôr, než stihol teardown fixture `e2eUcty`). Beží aj proti PROD (BASE_URL). globalSetup
// beží až po boote webServera (testing.md #291) — tu sa nič nemaže spod servera, len cez UI.
import { chromium, type FullConfig } from '@playwright/test';
import { zmazE2eUcty } from './ucty';

export default async function globalSetup(config: FullConfig) {
	const use = config.projects[0]!.use;
	const browser = await chromium.launch(use.launchOptions);
	try {
		const zmazane = await zmazE2eUcty(browser, use, () => true);
		console.log(
			`[e2e #583] sweep zvyškových e2e- účtov: ${zmazane.length ? zmazane.join(', ') : 'žiadne'}`
		);
	} finally {
		await browser.close();
	}
}
