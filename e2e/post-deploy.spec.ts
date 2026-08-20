import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs } from './helpers';

// Post-deploy smoke (#254): read-only funkčná verifikácia.
//
// - v ci.yml deploy jobe beží proti NASADENEJ appke cez SSH tunel (DEPLOY_SHA7 +
//   BASE_URL + E2E_USER/E2E_PASS zo secrets) — vtedy NAVIAC overí verziu z DOM ==
//   nasadený SHA (3. vrstva post-deploy verifikácie: liveness + verzia + funkčná).
// - v lokálnom `test` jobe beží proti preview serveru (seed user e2e) ako bežný
//   login+navigácia smoke; SHA kontrola sa preskočí (DEPLOY_SHA7 nenastavený).
//
// BY CONSTRUCTION read-only — len login + čítanie verzie + navigácia; žiadny odpis,
// žiadny form POST do Money → NIKDY sa nedotkne ostrého Money importu.
const SHA7 = process.env.DEPLOY_SHA7;

test('post-deploy smoke: login + verzia v DOM (SHA) + kľúčové stránky bez console chýb', async ({
	page
}) => {
	const errors = collectConsole(page);

	// funkčná vrstva: reálny používateľ sa prihlási (goto+hydratácia+fill+POST+redirect)
	await loginAs(page);

	// version-match vrstva: [data-testid=version] v DOM. Proti nasadenej appke
	// (DEPLOY_SHA7 nastavený) musí obsahovať nasadený SHA7; lokálne stačí, že je prítomná.
	const version = (await page.getByTestId('version').first().textContent())?.trim();
	expect(version, 'footer [data-testid=version] musí byť prítomný').toBeTruthy();
	if (SHA7) {
		expect(version, `verzia v DOM (${version}) musí obsahovať nasadený SHA ${SHA7}`).toContain(
			SHA7
		);
	}

	// liveness + funkčná: kľúčové read-only stránky sa načítajú a zhydratujú
	// (goto čaká na html[data-hydrated="1"]); URL netvrdíme kvôli role-gatingu.
	for (const path of ['/zasklenia', '/odpisy']) {
		await goto(page, path);
	}

	// zero-console-errors — rovnaká disciplína ako každý E2E (per-blok guard #247
	// vyžaduje presný tvar `expect(<var>).toEqual([])`, bez message argumentu)
	expect(errors).toEqual([]);
});
