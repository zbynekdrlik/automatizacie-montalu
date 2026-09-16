// #528: QR zákazky v hlavičke tlačeného nárezáku zasklení. Po naskenovaní kamerou tabletu na Odoo
// kiosku sa otvorí daná objednávka — QR nesie HOLÉ sale.order.name (= normOp(op) = Odoo A6 štítok).
// READ-ONLY (len „Spočítať nárezový plán", žiadne odoslanie do Money). Zero-console (helpers).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const RUN = `E2E-QR-${Date.now().toString(36).slice(-5)}`;
const SKLO = 'Sklo (základ — určuje vzorec)';

/** Vyplní hlavičku + zadanie a spočíta nárezový plán → dostane sa na tlačový náhľad (`plan-badge`). */
async function spocitajPlan(page: Page, op: string) {
	await loginAs(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E QR');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('4K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.getByLabel(SKLO).selectOption('Izolačné sklo 4/8/4 číre');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('plan-badge')).toBeVisible();
}

test('tlačený nárezák má QR zákazky s payloadom = holé sale.order.name', async ({ page }) => {
	const errs = collectConsole(page);
	await spocitajPlan(page, 'OP260900');

	const qr = page.getByTestId('qr-zakazka');
	await expect(qr).toBeVisible();
	// payload = holé sale.order.name (OP ostáva nedotknuté) — presne to kiosk zosníma
	await expect(qr).toHaveAttribute('data-payload', 'OP260900');
	// je to naozaj vykreslený QR (SVG), nie prázdny element
	await expect(qr.locator('svg')).toBeVisible();

	expect(errs).toEqual([]);
});

test('QR payload sa normalizuje na formát objednávky (holé číslo → OP prefix)', async ({
	page
}) => {
	const errs = collectConsole(page);
	// zadá sa holé číslo bez OP prefixu — QR musí niesť kanonický „OP…" tvar (ako Odoo štítok)
	await spocitajPlan(page, '260901');

	const qr = page.getByTestId('qr-zakazka');
	await expect(qr).toBeVisible();
	await expect(qr).toHaveAttribute('data-payload', 'OP260901');

	expect(errs).toEqual([]);
});
