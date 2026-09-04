// #453 (Patrik, Odoo ch207 msg 1792131): koliesko myši nad zaostreným
// <input type="number"> nebezpečne mení hodnotu namiesto scrollovania stránky.
// Guard (`src/lib/wheel-guard.ts`, wired v `src/routes/+layout.svelte` cez
// `<svelte:window onwheel={odfokusujCisloInputPriWheeli}>`): na wheel evente,
// ktorého target je number input, ho SYNCHRÓNNE odfokusuje (blur) — skôr, než
// prehliadač vyhodnotí svoju predvolenú (hodnotu-meniacu) akciu → tá sa vráti na
// normálny scroll. NEpoužíva preventDefault, aby scroll dlhého formulára fungoval
// aj keď kurzor prejde ponad number input (akceptačné kritérium #453).
//
// Modul je čisto čítací (žiadny Money zápis) — netreba skipAkLive.
//
// EMPIRICKÝ ROOT-CAUSE tohto spec-u (prečo NIE `page.mouse.wheel` + toBeFocused):
// `page.mouse.wheel(0, 400)` v tomto Playwright/Chromium behu dispatchne trusted
// wheel event, ktorého `target` je VŽDY <td> pod kurzorom — NIE zaostrený number
// input (empiricky overené sondou: `document.elementFromPoint` v strede inputu
// vráti INPUT, no `wheel` event má aj tak `target=TD`, input ostáva len
// `document.activeElement`). Preto pod `page.mouse.wheel`:
//   • natívny „focused-number-input increment" NIKDY nefiruje (hodnota ostáva
//     6000) — s guardom aj bez neho (kurzor nemieri NA input),
//   • guardova blur-vetva sa NIKDY nespustí (`event.target` je TD, nie INPUT),
//     takže `not.toBeFocused()` by pod `page.mouse.wheel` nemohlo prejsť nikdy.
// Guardov REÁLNY DOM kontrakt (wheel MIERIACI na number input → blur) je preto
// dokázaný DOM-dispatchnutým WheelEventom priamo na zaostrený input (target =
// input). Overené mutáciou: bez `<svelte:window onwheel>` wiringu ostane input
// zaostrený → RED (viď design/root-cause komentár na #453).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole } from './helpers';

test('wheel guard: skrol nad formulárom skroluje stránku a wheel na number input ho odfokusuje', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// úzky viewport → formulár + kusy tabuľka presiahnu výšku, stránka je skrolovateľná
	await page.setViewportSize({ width: 900, height: 500 });
	await loginAs(page);
	await goto(page, '/optimalizator');

	// zopár riadkov kusov navyše, aby bolo pod poľom dosť obsahu na skrolovanie
	for (let i = 0; i < 4; i++) {
		await page.getByRole('button', { name: 'Pridať kus' }).click();
	}

	const dlzkaTyce = page.getByLabel('Dĺžka tyče (mm)');
	await expect(dlzkaTyce).toHaveValue('6000'); // default $state pred akoukoľvek zmenou

	// --- (1) Akceptačné kritérium #453: skrol nad formulárom (aj so zaostreným
	// number inputom) skroluje stránku NORMÁLNE — guard nepoužíva preventDefault.
	// Toto vyvolá RED, ak by niekto guard prerobil na preventDefault-based.
	await dlzkaTyce.click(); // zaostrí pole (presne situácia z hlásenia)
	await expect(dlzkaTyce).toBeFocused();
	const scrollPred = await page.evaluate(() => window.scrollY);
	await page.mouse.wheel(0, 400); // koliesko myši nad zaostreným number inputom
	// scroll z wheel eventu sa aplikuje ASYNCHRÓNNE (page.mouse.wheel dispatchne
	// event, ale nečaká na dokončenie scrollu) — ohraničene počkaj namiesto
	// waitForTimeout (e2e-console.md: žiadny waitForTimeout)
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollPred);

	// --- (2) Guardov DOM kontrakt: wheel event MIERIACI na zaostrený number input
	// ho odfokusuje (blur guard). `page.mouse.wheel` naň nemieri (viď root-cause
	// komentár vyššie), preto dispatchni REÁLNY WheelEvent priamo na input.
	await dlzkaTyce.focus();
	await expect(dlzkaTyce).toBeFocused();
	await dlzkaTyce.evaluate((el) =>
		el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 400 }))
	);
	// input stratil focus (blur guard zasiahol) — presne mechanizmus z design komentára;
	// bez guardu by ostal zaostrený (mutáciou overené RED)
	await expect(dlzkaTyce).not.toBeFocused();

	// hodnota sa počas celej interakcie NEZMENILA (užívateľsky viditeľný invariant #453;
	// natívny increment nie je cez synthetic wheel test-dispatchovateľný, viď root-cause)
	await expect(dlzkaTyce).toHaveValue('6000');

	expect(consoleMsgs).toEqual([]);
});
