// #518: editor vzorcov (`/zasklenia/nastavenia`) má dvojkrokový výber Systém → Štýl ako
// nárezák + prominentný nadpis „Upravuješ: <Systém> · <Štýl>". Cieľ: Patrik už nezamení
// starý „Štandard" so „Štandard +" (Odoo úloha 922). Read-only navigácia (žiadny zápis
// vzorcov), takže sa spúšťa aj proti LIVE. Nula console errors/warnings.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated } from './helpers';

test('editor: Systém → Štýl dvojkrok, nadpis rozlíši Štandard plus od Starého štandardu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia/nastavenia');

	const system = page.getByLabel('Systém');
	const styl = page.getByLabel('Štýl');
	const nadpis = page.getByTestId('editor-nadpis');
	const skrytySysStyl = page.locator('input[name="sysStyl"]');

	// 1. výber systému „Štandard plus" naviguje na jeho PRVÝ štýl (2K) a nadpis to ukáže
	await system.selectOption('Štandard +');
	await expect(skrytySysStyl).toHaveValue('Štandard +|2K');
	await waitHydrated(page);
	await expect(nadpis).toContainText('Upravuješ: Štandard plus · 2K');
	await expect(system).toHaveValue('Štandard +');

	// 2. druhý krok — výber štýlu „2x4K IZO" (Patrikov reálny štýl); načítajú sa vzorce PRÁVE
	//    tohto systému·štýlu (skrytý sysStyl je to, čo ide do uloženia)
	await styl.selectOption('Štandard +|2x4K IZO');
	await expect(skrytySysStyl).toHaveValue('Štandard +|2x4K IZO');
	await waitHydrated(page);
	await expect(nadpis).toContainText('Upravuješ: Štandard plus · 2x4K IZO');
	// formulár patrí tomuto štýlu (offset input existuje → vzorce sa načítali)
	await expect(page.getByLabel('Sklo — konečné zmenšenie (mm)')).toBeVisible();

	// 3. výber sa zachová cez reload (stav žije v URL ?sysStyl=)
	await page.reload();
	await waitHydrated(page);
	await expect(nadpis).toContainText('Upravuješ: Štandard plus · 2x4K IZO');
	await expect(system).toHaveValue('Štandard +');
	await expect(styl).toHaveValue('Štandard +|2x4K IZO');

	// 4. prepnutie na „Starý štandard" — nadpis + skrytý sysStyl sú JEDNOZNAČNE iný systém
	await system.selectOption('Štandard');
	await expect(skrytySysStyl).toHaveValue('Štandard|2K');
	await waitHydrated(page);
	await expect(nadpis).toContainText('Upravuješ: Starý štandard · 2K');
	// a NIE Štandard plus — jadro Patrikovho omylu je teraz vizuálne rozlíšené
	await expect(nadpis).not.toContainText('Štandard plus');

	expect(consoleMsgs).toEqual([]);
});
