// #511: uloženie plánu rezov cez REÁLNY prehliadač — po uložení sa (na PROD) pripne PDF plánu
// rezov na kiosk „Rezanie" (sale.order) cez montalu_narezak_upload. Upload je fire-and-forget a v
// E2E env VYPNUTÝ (žiadny ODOO_JSON2_URL) — tento test overuje USER FLOW: plán sa uloží, wiring
// uploadu nezhodí uloženie, a detail plánu renderuje TEN ISTÝ plán rezov (rezy/tyče/odpad), ktorý
// nesie kiosk PDF. Transport-kontrakt uploadu (kind/doc_id/filename/PDF bez cien) je pokrytý
// integračne v `tests/odoo-plan-rezov-upload.test.ts` cez `setJson2Transport` — server-side fetch
// sa cez prehliadač Playwrightom nezachytáva, a pôvodný odpis→narezak upload (zmazaný) nemal
// v E2E ŽIADNE pokrytie uploadu vôbec (jeho spustenie záviselo na PROD Odoo env).
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs } from './helpers';

test('uloženie plánu rezov so zákazkou → uloží sa a detail renderuje plán rezov (bez pádu)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	// vloží CAD tabuľku a spočíta plán
	const cadText = [
		'18013 PROFIL 110x110 V2\t2\t1700',
		'18013 PROFIL 110x110 V2\t2\t1600',
		'AL_50x30x2\t4\t1865'
	].join('\n');
	await page.getByTestId('cad-input').fill(cadText);
	await page.getByTestId('spocitaj').click();
	await expect(page.getByTestId('vysledok')).toBeVisible();

	// ulož plán so zákazkou (spustí queuePlanRezovUpload — v E2E vypnutý, nesmie zhodiť uloženie)
	await page.getByTestId('save-nazov').fill('E2E Kiosk plán');
	await page.getByTestId('save-zak').fill('ZAKE2E511');
	await page.getByTestId('save-btn').click();

	// uloženie prebehlo — potvrdenie + odkaz na detail v zozname uložených
	await expect(page.getByTestId('save-msg')).toBeVisible();
	const detailLink = page.getByTestId('plan-link').filter({ hasText: 'E2E Kiosk plán' }).first();
	await expect(detailLink).toBeVisible();

	// detail plánu renderuje TEN ISTÝ plán rezov, ktorý ide na kiosk (rezy/tyče/odpad)
	await detailLink.click();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Kiosk plán');
	await expect(page.getByTestId('vysledok-detail')).toBeVisible();
	await expect(page.getByTestId('vysledok-detail')).toContainText('Tyčí spolu');
	await expect(page.getByTestId('vysledok-detail')).toContainText('PROFIL 110x110 V2');
	// plán rezov NIKDY neukazuje ceny (kiosk je bez cenníka) — istota aj v UI
	await expect(page.getByTestId('vysledok-detail')).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});
