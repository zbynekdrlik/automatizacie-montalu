// Základ návrhových výkresov (#137) — interná demo stránka /vykresy/preview:
// rám + mriežka (1-16/A-L), rohová pečiatka s dátumom zo servera, vzorové kóty,
// A4 landscape tlač LEN na tejto route (existujúca portrait tlač nárezáku nedotknutá).
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole } from './helpers';

/** Nazbiera hodnoty `size` zo VŠETKÝCH `@page` pravidiel v dokumente — vrátane tých
 *  VNORENÝCH v `@media print { … }` blokoch (Svelte route-scoped <style> aj zdieľané
 *  app.css oba takto @page zabaľujú), takže bez rekurzie do `CSSMediaRule.cssRules` by
 *  test nenašiel ani vlastné pravidlo, ani existujúce portrait pravidlo v app.css. */
async function najdiPageSizes(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		const walk = (rules: CSSRuleList) => {
			for (const rule of Array.from(rules)) {
				if (rule instanceof CSSPageRule) out.push(rule.style.getPropertyValue('size').trim());
				else if (rule instanceof CSSMediaRule) walk(rule.cssRules);
			}
		};
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				walk(sheet.cssRules);
			} catch {
				continue;
			}
		}
		return out;
	});
}

test('/vykresy/preview: rám s mriežkou (1-16/A-L), pečiatka vyplnená, dátum zo servera', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/vykresy/preview');

	await expect(page.getByTestId('vykresovy-harok')).toBeVisible();

	// mriežka: čísla stĺpcov 1-16 (dvakrát — hore aj dole), po texte vieme len overiť
	// prítomnosť SVG <text> uzlov s presným obsahom
	const stlpce = page.locator('[data-testid="mriezka-stlpce"] text');
	await expect(stlpce).toHaveCount(32); // 16 stĺpcov × 2 (hore+dole)
	await expect(stlpce.filter({ hasText: /^1$/ }).first()).toBeVisible();
	await expect(stlpce.filter({ hasText: /^16$/ }).first()).toBeVisible();

	// mriežka: písmená riadkov A-L (dvakrát — vľavo aj vpravo)
	const riadky = page.locator('[data-testid="mriezka-riadky"] text');
	await expect(riadky).toHaveCount(24); // 12 riadkov × 2 (vľavo+vpravo)
	await expect(riadky.filter({ hasText: /^A$/ }).first()).toBeVisible();
	await expect(riadky.filter({ hasText: /^L$/ }).first()).toBeVisible();

	// rohová pečiatka — všetky povinné polia z issue (#137) vyplnené
	await expect(page.getByTestId('tb-nazov')).toContainText('DEMO');
	await expect(page.getByTestId('tb-projekt')).toContainText('automatizacie-montalu');
	await expect(page.getByTestId('tb-cislo-vykresu')).toContainText('OP000000');
	await expect(page.getByTestId('tb-revizia')).toContainText('0');
	await expect(page.getByTestId('tb-varianta')).toContainText('DEMO');
	await expect(page.getByTestId('tb-vypracoval')).toContainText('interné demo');
	// dátum je zo SERVERA (formatDatumCasSk, D.M.RRRR HH:MM) — over aspoň tvar, nie
	// presnú hodnotu (test beží v ľubovoľnom čase)
	await expect(page.getByTestId('tb-datum')).toHaveText(/^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/);

	// MIERKA je VYPOČÍTANÁ (nikdy natvrdo "1:20") — buď "≈1:N" alebo "—", nikdy prázdna
	await expect(page.getByTestId('tb-mierka')).toHaveText(/^(≈1:\d+|—)$/);
	await expect(page.getByTestId('tb-mierka')).not.toHaveText('1:20');

	await expect(page.getByTestId('tb-navrh')).toHaveText('NAVRH');

	// vzorové kóty cez zdieľaný Kota.svelte helper — vodorovná, zvislá, uhlová
	await expect(page.locator('[data-testid="kota-label"]')).toHaveCount(2); // vodorovná + zvislá
	await expect(page.getByTestId('demo-uhol-popis')).toContainText('4,3°'); // slovenská čiarka (fmtDeg)
	await expect(page.getByTestId('demo-poznamka')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('/vykresy/preview: tlač A4 na šírku (@page landscape) — LEN na tejto route', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/vykresy/preview');

	const pageSizes = await najdiPageSizes(page);
	expect(pageSizes.some((s) => /landscape/i.test(s))).toBe(true);

	// tlačidlo tlače je prítomné (rovnaký vzor ako fix/zasklenia)
	await expect(page.getByRole('button', { name: '🖨 Tlačiť / uložiť PDF' })).toBeVisible();
});

test('nárezový plán (zasklenia): tlač ostáva A4 na výšku — landscape z /vykresy/preview nepresiahol', async ({
	page
}) => {
	await loginAs(page);
	// najprv navštívime landscape route, aby sme overili, že jej @page pravidlo
	// NEPRETRVÁ na inú route po prechode (route-CSS-splitting, #137 bod 3)
	await goto(page, '/vykresy/preview');
	await goto(page, '/zasklenia');

	const pageSizes = await najdiPageSizes(page);
	// aspoň jedno @page pravidlo MUSÍ byť nájdené (dôkaz, že rekurzia do @media naozaj
	// funguje — inak by bol test prázdny a assert nižšie by prešiel naprázdno). Zdieľané
	// app.css má `@page { size: A4 portrait; … }`, ale CSS minifikátor v builde slovo
	// "portrait" ZAHODÍ (je to CSS default, minifikácia ho vynecháva ako nadbytočný) —
	// preto sa nekontroluje literálny reťazec "portrait", len že sa niečo našlo.
	expect(pageSizes.length).toBeGreaterThan(0);
	// a landscape z predošlej route sa NESMIE preniesť (na rozdiel od "portrait" sa
	// "landscape" pri minifikácii NEZAHADZUJE — nie je to CSS default, viď test vyššie)
	expect(pageSizes.some((s) => /landscape/i.test(s))).toBe(false);
});
